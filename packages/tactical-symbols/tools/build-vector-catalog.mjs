import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { sourceRegistry } from '../src/source/registry.ts';
import { registerSourceVectorData } from '../src/source-vector.ts';
import auditReport from '../data/vector-catalog-report.json' with { type: 'json' };

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const pdfRoot = path.join(packageRoot, '.work', 'vector-audit', 'pdf');
const svgRoot = path.join(packageRoot, '.work', 'vector-audit', 'svg');
const documents = new Map(sourceRegistry.documents.map(document => [document.id, document]));

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr ?? `код ${result.status}`}`);
  return result.stdout;
}

function dimensions(page) {
  const root = page.elements[0]?.html.match(/viewBox="([^"]+)"/);
  const boxes = page.elements.map(element => [element.x, element.y, element.x + element.width, element.y + element.height]);
  return {
    width: Math.max(595, ...boxes.map(box => box[2])),
    height: Math.max(842, ...boxes.map(box => box[3])),
  };
}

function headingMasks(bbox, pageNumber, firstMarkerY) {
  const page = bbox.match(/<page\b[^>]*>[\s\S]*?<\/page>/g)?.[pageNumber - 1] ?? '';
  const masks = [];
  for (const match of page.matchAll(/<line\b([^>]*)>([\s\S]*?)<\/line>/g)) {
    const attributes = match[1];
    const value = name => Number(new RegExp(`${name}="([^"]+)"`).exec(attributes)?.[1]);
    const x = value('xMin'), y = value('yMin'), right = value('xMax'), bottom = value('yMax');
    const text = match[2].replace(/<[^>]+>/g, ' ');
    if (/[A-Za-zА-Яа-яЁё]/.test(text) && bottom - y > 13 && right - x >= 100 && text.trim().length >= 10 && y < firstMarkerY - 5) masks.push({ x: x - 2, y: y - 2, right: right + 2, bottom: bottom + 2 });
  }
  return masks;
}

function descriptionBoundary(bbox, pageNumber) {
  const page = bbox.match(/<page\b[^>]*>[\s\S]*?<\/page>/g)?.[pageNumber - 1] ?? '';
  const candidates = [];
  for (const match of page.matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)) {
    const x = Number(/xMin="([^"]+)"/.exec(match[1])?.[1]);
    const text = match[2].replace(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ').trim();
    if (x >= 230 && text.length >= 30) candidates.push(x);
  }
  return candidates.length ? Math.min(...candidates) : 257.5;
}

function textNearGraphic(documentId, pageNumber, top, bottom) {
  const bbox = bboxByPage.get(documentId) ?? '';
  const page = bbox.match(/<page\b[^>]*>[\s\S]*?<\/page>/g)?.[pageNumber - 1] ?? '';
  const pageId = `${documentId}-page-${String(pageNumber).padStart(3, '0')}`;
  const boundary = boundariesByPage.get(pageId) ?? 257.5;
  const words = [...page.matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(match => ({
    x: Number(/xMin="([^"]+)"/.exec(match[1])?.[1]),
    y: Number(/yMin="([^"]+)"/.exec(match[1])?.[1]),
    text: match[2].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&'),
  })).filter(word => word.x >= boundary - 1 && word.y >= top && word.y < bottom)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  return words.map(word => word.text).join(' ').replaceAll(/\s+/g, ' ').trim();
}

function roughBox(entries, index, pageHeight) {
  const entry = entries[index];
  const previous = entries[index - 1], next = entries[index + 1];
  const top = previous ? (previous.y + entry.y) / 2 : Math.max(0, entry.y - 65);
  const bottom = next ? (entry.y + next.y) / 2 : Math.min(pageHeight, entry.y + 100);
  return { top, bottom };
}

function selectElements(page, entries, index, masks, boundary) {
  const entry = entries[index];
  const rough = roughBox(entries, index, dimensions(page).height);
  const candidates = page.elements.map((element, elementIndex) => ({ element, elementIndex })).filter(({ element }) => {
    if (element.width < 0 || element.height < 0 || (element.width === 0 && element.height === 0)) return false;
    const right = element.x + element.width, bottom = element.y + element.height;
    if (element.x <= 90 || right < 100) return false;
    if (element.html.startsWith('<g') && element.x < 110 && Math.abs(element.y - entry.y) < 10) return false;
    if (element.x >= boundary) return false;
    if (element.html.startsWith('<g') && element.x > 230 && right > boundary + 1) return false;
    if (bottom < rough.top || element.y > rough.bottom) return false;
    return !masks.some(mask => element.x < mask.right && right > mask.x && element.y < mask.bottom && bottom > mask.y);
  });
  if (!candidates.length) throw new Error(`Не найдены элементы знака ${entry.number}`);
  const boxes = candidates.map(candidate => candidate.element);
  const left = Math.max(0, Math.min(...boxes.map(element => element.x)) - 3);
  const top = Math.max(0, Math.min(...boxes.map(element => element.y)) - 3);
  const right = Math.max(...boxes.map(element => element.x + element.width)) + 3;
  const bottom = Math.max(...boxes.map(element => element.y + element.height)) + 3;
  return {
    elements: candidates.map(candidate => candidate.elementIndex).sort((a, b) => a - b).join(','),
    viewBox: [left, top, right - left, bottom - top].map(value => Math.round(value * 1000) / 1000).join(' '),
  };
}

function kindOf(text) {
  if (/район|зона|участок|площад|полоса|сектор/i.test(text)) return 'AREA';
  if (/маршрут|линия|направлен|переправ|дорог|рубеж|границ|движени|эвакуа|колонн|перевоз|створ/i.test(text)) return 'LINE';
  return 'POINT';
}

function nameOf(entry) {
  const text = entry.text.replaceAll(/\s+/g, ' ').trim();
  if (!text) return `Исходная запись ${entry.number}`;
  const firstSentence = text.split(/(?<=[.!?])\s/)[0];
  return firstSentence.length <= 180 ? firstSentence : `${firstSentence.slice(0, 179).trim()}…`;
}

const browser = await chromium.launch({ headless: true });
const browserPage = await browser.newPage();
const pages = {};
const masksByPage = new Map();
const boundariesByPage = new Map();
const bboxByPage = new Map();
try {
  await mkdir(svgRoot, { recursive: true });
  for (const document of sourceRegistry.documents) {
    const pdfPath = path.join(pdfRoot, document.normalizedName.replace(/\.doc$/i, '.pdf'));
    const bbox = run('pdftotext', ['-bbox-layout', pdfPath, '-']);
    bboxByPage.set(document.id, bbox);
    for (const fragmentId of document.fragmentIds) {
      const pageNumber = Number(fragmentId.slice(-3));
      const firstMarkerY = Math.min(...auditReport.entries.filter(entry => entry.documentId === document.id && entry.page === pageNumber).map(entry => entry.y));
      masksByPage.set(fragmentId, headingMasks(bbox, pageNumber, firstMarkerY));
      boundariesByPage.set(fragmentId, descriptionBoundary(bbox, pageNumber));
      const target = path.join(svgRoot, `${fragmentId}.svg`);
      run('pdftocairo', ['-svg', '-f', String(pageNumber), '-l', String(pageNumber), pdfPath, target]);
      const svg = await readFile(target, 'utf8');
      await browserPage.setContent(`<!doctype html><html><body>${svg}</body></html>`);
      const data = await browserPage.evaluate(async () => {
        const root = document.querySelector('svg');
        if (!root) throw new Error('SVG не загружен');
        for (const image of Array.from(root.querySelectorAll('image'))) {
          const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
          if (!href?.startsWith('data:image/')) throw new Error('Растр не является встроенным данными источника');
          const decoded = new Image(); decoded.src = href; await decoded.decode();
          const canvas = document.createElement('canvas'); canvas.width = decoded.naturalWidth; canvas.height = decoded.naturalHeight;
          const context = canvas.getContext('2d', { willReadFrequently: true });
          if (!context) throw new Error('Не удалось прочитать встроенный растр');
          context.drawImage(decoded, 0, 0);
          const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
          const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
          for (const name of ['id', 'transform', 'clip-path', 'opacity', 'style']) {
            const value = image.getAttribute(name); if (value) group.setAttribute(name, value);
          }
          const x = Number(image.getAttribute('x') ?? 0), y = Number(image.getAttribute('y') ?? 0);
          const scaleX = Number(image.getAttribute('width') ?? canvas.width) / canvas.width;
          const scaleY = Number(image.getAttribute('height') ?? canvas.height) / canvas.height;
          for (let row = 0; row < canvas.height; row += 1) {
            let start = 0;
            while (start < canvas.width) {
              const offset = (row * canvas.width + start) * 4;
              const signature = pixels.slice(offset, offset + 4).join('/');
              let end = start + 1;
              while (end < canvas.width && pixels.slice((row * canvas.width + end) * 4, (row * canvas.width + end + 1) * 4).join('/') === signature) end += 1;
              if (pixels[offset + 3] > 0) {
                const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                rect.setAttribute('x', String(x + start * scaleX)); rect.setAttribute('y', String(y + row * scaleY));
                rect.setAttribute('width', String((end - start) * scaleX)); rect.setAttribute('height', String(scaleY));
                rect.setAttribute('fill', `rgb(${pixels[offset]}, ${pixels[offset + 1]}, ${pixels[offset + 2]})`);
                if (pixels[offset + 3] < 255) rect.setAttribute('fill-opacity', String(pixels[offset + 3] / 255));
                group.appendChild(rect);
              }
              start = end;
            }
          }
          image.replaceWith(group);
        }
        const children = Array.from(root.children);
        return {
          defs: children.filter(element => element.tagName === 'defs').map(element => element.innerHTML).join(''),
          elements: children.filter(element => element.tagName !== 'defs').map(element => {
            const box = element.getBBox();
            const rootMatrix = root.getCTM(), elementMatrix = element.getCTM();
            if (!rootMatrix || !elementMatrix) return { html: element.outerHTML, x: box.x, y: box.y, width: box.width, height: box.height };
            const matrix = rootMatrix.inverse().multiply(elementMatrix);
            const points = [
              new DOMPoint(box.x, box.y).matrixTransform(matrix),
              new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix),
              new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix),
              new DOMPoint(box.x, box.y + box.height).matrixTransform(matrix),
            ];
            const left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x));
            const top = Math.min(...points.map(point => point.y)), bottom = Math.max(...points.map(point => point.y));
            return { html: element.outerHTML, x: left, y: top, width: right - left, height: bottom - top };
          }),
        };
      });
      registerSourceVectorData(fragmentId, data);
      pages[fragmentId] = data;
    }
  }
} finally {
  await browser.close();
}

function selectTrailingElements(pageId, used) {
  const page = pages[pageId];
  const masks = masksByPage.get(pageId) ?? [], boundary = boundariesByPage.get(pageId) ?? 257.5;
  const available = page.elements.map((element, elementIndex) => ({ element, elementIndex })).filter(({ element, elementIndex }) => {
    if (used.has(elementIndex) || element.width < 0 || element.height < 0 || (element.width === 0 && element.height === 0)) return false;
    const right = element.x + element.width;
    if (element.x <= 90 || right < 100 || element.x >= boundary) return false;
    if (element.html.startsWith('<g') && element.x > 230 && right > boundary + 1) return false;
    const bottom = element.y + element.height;
    return !masks.some(mask => element.x < mask.right && right > mask.x && element.y < mask.bottom && bottom > mask.y);
  });
  const bands = [];
  for (const candidate of available.sort((a, b) => a.element.y - b.element.y)) {
    const current = bands.at(-1);
    if (!current || candidate.element.y > current.bottom + 8) bands.push({ bottom: candidate.element.y + candidate.element.height, candidates: [candidate] });
    else { current.candidates.push(candidate); current.bottom = Math.max(current.bottom, candidate.element.y + candidate.element.height); }
  }
  if (!bands.length) throw new Error(`На предыдущей странице нет свободной графики: ${pageId}`);
  const graphicIndex = bands.findLastIndex(band => band.candidates.some(candidate => /<(?:path|rect|polygon|polyline|circle|ellipse|line)\b/.test(candidate.element.html)));
  if (graphicIndex < 0) throw new Error(`Свободная полоса содержит только подписи: ${pageId}`);
  const selected = bands.slice(graphicIndex).flatMap(band => band.candidates);
  const boxes = selected.map(candidate => candidate.element);
  const left = Math.max(0, Math.min(...boxes.map(element => element.x)) - 3);
  const top = Math.max(0, Math.min(...boxes.map(element => element.y)) - 3);
  const right = Math.max(...boxes.map(element => element.x + element.width)) + 3;
  const bottom = Math.max(...boxes.map(element => element.y + element.height)) + 3;
  return {
    elements: selected.map(candidate => candidate.elementIndex).sort((a, b) => a - b).join(','),
    viewBox: [left, top, right - left, bottom - top].map(value => Math.round(value * 1000) / 1000).join(' '),
  };
}

function detachTrailingElements(pageId, currentNumber, symbols) {
  const previousNumber = String(Number(currentNumber) - 1);
  const previous = symbols.find(symbol => symbol.id === `source-${previousNumber}`);
  const previousEntry = auditReport.entries.find(entry => entry.number === previousNumber);
  if (!previous || !previousEntry || previous.geometry.parameters.pageId !== pageId) throw new Error(`Нет предыдущей записи для разделения: ${previousNumber}`);
  const page = pages[pageId];
  const selected = previous.geometry.parameters.elements.split(',').filter(Boolean).map(Number)
    .map(elementIndex => ({ elementIndex, element: page.elements[elementIndex] })).sort((a, b) => a.element.y - b.element.y);
  const bands = [];
  for (const candidate of selected) {
    const current = bands.at(-1);
    if (!current || candidate.element.y > current.bottom + 4) bands.push({ bottom: candidate.element.y + candidate.element.height, candidates: [candidate] });
    else { current.candidates.push(candidate); current.bottom = Math.max(current.bottom, candidate.element.y + candidate.element.height); }
  }
  let primaryIndex = bands.findIndex(band => previousEntry.y >= Math.min(...band.candidates.map(candidate => candidate.element.y)) && previousEntry.y <= band.bottom);
  if (primaryIndex < 0) {
    const distance = band => {
      const top = Math.min(...band.candidates.map(candidate => candidate.element.y));
      return top > previousEntry.y ? top - previousEntry.y : previousEntry.y - band.bottom;
    };
    primaryIndex = bands.reduce((best, band, index) => distance(band) < distance(bands[best]) ? index : best, 0);
  }
  if (primaryIndex === bands.length - 1) throw new Error(`Нет отделяемой полосы после записи ${previousNumber}`);
  const trailing = bands.slice(primaryIndex + 1).flatMap(band => band.candidates);
  const remaining = bands.slice(0, primaryIndex + 1).flatMap(band => band.candidates);
  const detach = new Set(trailing.map(candidate => candidate.elementIndex));
  const used = usedByPage.get(pageId);
  if (used) for (const elementIndex of detach) used.delete(elementIndex);
  const boxFor = candidates => {
    const boxes = candidates.map(candidate => candidate.element);
    const left = Math.max(0, Math.min(...boxes.map(element => element.x)) - 3), top = Math.max(0, Math.min(...boxes.map(element => element.y)) - 3);
    const right = Math.max(...boxes.map(element => element.x + element.width)) + 3, bottom = Math.max(...boxes.map(element => element.y + element.height)) + 3;
    return [left, top, right - left, bottom - top].map(value => Math.round(value * 1000) / 1000).join(' ');
  };
  previous.geometry.parameters.elements = remaining.map(candidate => candidate.elementIndex).sort((a, b) => a - b).join(',');
  previous.geometry.parameters.viewBox = boxFor(remaining);
  return { elements: trailing.map(candidate => candidate.elementIndex).sort((a, b) => a - b).join(','), viewBox: boxFor(trailing) };
}

const byPage = new Map();
for (const entry of auditReport.entries) {
  const pageId = `${entry.documentId}-page-${String(entry.page).padStart(3, '0')}`;
  byPage.set(pageId, [...(byPage.get(pageId) ?? []), entry]);
}
const symbols = [];
const failures = [];
const crossPage = [];
const usedByPage = new Map();
for (const [pageId, entries] of byPage) {
  entries.sort((a, b) => a.y - b.y);
  for (const [index, entry] of entries.entries()) {
    let selected;
    let graphicPageId = pageId;
    try {
      try {
        selected = selectElements(pages[pageId], entries, index, masksByPage.get(pageId) ?? [], boundariesByPage.get(pageId) ?? 257.5);
      } catch (cause) {
        if (entry.page <= 1) throw cause;
        graphicPageId = `${entry.documentId}-page-${String(entry.page - 1).padStart(3, '0')}`;
        try {
          selected = selectTrailingElements(graphicPageId, usedByPage.get(graphicPageId) ?? new Set());
        } catch {
          selected = detachTrailingElements(graphicPageId, entry.number, symbols);
        }
        crossPage.push({ number: entry.number, textPageId: pageId, graphicPageId });
      }
      const used = usedByPage.get(graphicPageId) ?? new Set();
      for (const elementIndex of selected.elements.split(',').filter(Boolean).map(Number)) used.add(elementIndex);
      usedByPage.set(graphicPageId, used);
      const document = documents.get(entry.documentId);
      const next = entries[index + 1];
      const textBottom = next ? (entry.y + next.y) / 2 : Infinity;
      const textTop = Number(selected.viewBox.split(' ')[1]) - 8;
      const nearby = graphicPageId === pageId ? textNearGraphic(entry.documentId, entry.page, textTop, textBottom) : '';
      const text = (nearby || entry.text).replaceAll(/\s+/g, ' ').trim();
      symbols.push({
        id: `source-${entry.number}`,
        version: '2.0.0',
        name: nameOf({ ...entry, text }),
        code: entry.number,
        purpose: text || 'Текст правила не извлечён; содержание доступно на странице источника.',
        kind: kindOf(text),
        frame: 'NONE',
        affiliation: 'UNKNOWN',
        forceType: document?.topics[0] ?? 'OTHER_ORGANIZATIONS',
        objectType: `SOURCE_${entry.number}`,
        organizationalLevel: null,
        modifiers: [],
        allowedModifierIds: [],
        labels: {},
        labelLayout: {},
        color: '#000000',
        anchor: [0.5, 0.5],
        scaling: { minPx: 16, maxPx: 512, simplifyBelowZoom: 0 },
        geometry: { version: 1, template: 'SOURCE_VECTOR', parameters: { pageId: graphicPageId, ...selected } },
        status: 'MAPPED',
        source: {
          sourceDocument: entry.sourceDocument,
          page: entry.page,
          symbolNumber: entry.number,
          fragmentId: pageId,
          ruleText: text || null,
          gaps: [
            'Векторный перенос выполнен из исходного DOC; методическое утверждение не присвоено автоматически.',
            ...(text ? [] : ['Текст правила не извлечён; используется изображение страницы источника.']),
            ...(graphicPageId === pageId ? [] : [`Графика знака находится на странице ${entry.page - 1}, а номер и продолжение текста — на странице ${entry.page}.`]),
          ],
        },
      });
    } catch (error) {
      failures.push({ number: entry.number, pageId, error: error.message });
    }
  }
}

const set = {
  id: 'ru-modern',
  version: 'ru-modern-v2',
  status: 'DRAFT',
  gaps: [
    'Исходные номера 321–323 отсутствуют в поставленном DOC и не восстанавливаются предположительно.',
    'Непронумерованные страницы «Усл.знаки МПО.doc» требуют отдельного пообъектного разбора.',
    'Варианты сохранены внутри векторных образцов номерованных записей; их отдельные охваты проверяются независимо.',
    'Технический перенос не заменяет визуальную, смысловую и методическую приёмку.',
  ],
  symbols,
};
await writeFile(path.join(packageRoot, 'data', 'vector-pages.json'), JSON.stringify(pages));
await writeFile(path.join(packageRoot, 'data', 'sets', 'ru-modern-v2.json'), `${JSON.stringify(set, null, 2)}\n`);
await writeFile(path.join(packageRoot, 'data', 'vector-build-report.json'), `${JSON.stringify({ schemaVersion: 1, sourceAuditSha256: auditReport.archiveSha256, numberedEntries: symbols.length, vectorPages: Object.keys(pages).length, failures }, null, 2)}\n`);
console.log(JSON.stringify({ numberedEntries: symbols.length, vectorPages: Object.keys(pages).length, failures }, null, 2));
if (failures.length || symbols.length !== 610) process.exitCode = 1;
