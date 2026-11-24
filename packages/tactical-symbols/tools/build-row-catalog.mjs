import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { sourceRegistry } from '../src/source/registry.ts';
import { extractNumberedEntriesFromBBox } from '../src/source/vector-extract.ts';
import { alignSourceGroups, bestSourcePage } from './align-source-groups.mjs';
import { attachSourceLocations } from './vector-signatures.mjs';
import { dedupeVectorPages } from './dedupe-vector-pages.mjs';
import auditReport from '../data/vector-catalog-report.json' with { type: 'json' };
import originalVectorPages from '../data/vector-pages.json' with { type: 'json' };
import legacyVectorSet from '../data/sets/ru-modern-v2.json' with { type: 'json' };

const packageRoot = fileURLToPath(new URL('../', import.meta.url));
const workRoot = path.join(packageRoot, '.work', 'vector-rows');
const docxRoot = path.join(workRoot, 'docx');
const rowDocxRoot = path.join(workRoot, 'row-docx');
const pdfRoot = path.join(workRoot, 'pdf');
const svgRoot = path.join(workRoot, 'svg');
const documents = new Map(sourceRegistry.documents.map(document => [document.id, document]));
const canonicalIds = new Set([...auditReport.entries.map(entry => entry.documentId), 'doc-029']);

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.error || result.status !== 0) throw new Error(`${command}: ${result.error?.message ?? result.stderr ?? `код ${result.status}`}`);
  return result.stdout;
}

function pdfFonts(pdf) {
  return run('pdffonts', [pdf]).split('\n').filter(line => /^[A-Z]+\+/.test(line.trim())).map(line => {
    const name = line.trim().split(/\s+/)[0];
    const base = name.replace(/^[A-Z]+\+/, '');
    return {
      fontFamily: /Arial/i.test(base) ? 'Arial' : /Times/i.test(base) ? 'Times New Roman' : 'sans-serif',
      fontWeight: /Bold/i.test(base) ? '700' : '400',
      fontStyle: /Italic|Oblique/i.test(base) ? 'italic' : 'normal',
    };
  });
}

function numberAttribute(attributes, name) {
  return Number(new RegExp(`${name}="([^"]+)"`).exec(attributes)?.[1]);
}

function pageXml(bbox, pageNumber = 1) {
  return bbox.match(/<page\b[^>]*>[\s\S]*?<\/page>/g)?.[pageNumber - 1] ?? '';
}

function graphicWords(bbox, boundary, extended = false) {
  return [...pageXml(bbox).matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(match => ({
    x: numberAttribute(match[1], 'xMin'), y: numberAttribute(match[1], 'yMin'),
    right: numberAttribute(match[1], 'xMax'), bottom: numberAttribute(match[1], 'yMax'),
    text: match[2].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&'),
  })).filter(word => word.x > 90 && (extended ? word.x < boundary + 15 : word.right < boundary + 1) && /^\d{1,2}$/.test(word.text));
}

function sourceTextWords(bbox, boundary, pageNumber = 1) {
  return [...pageXml(bbox, pageNumber).matchAll(/<word\b([^>]*)>([\s\S]*?)<\/word>/g)].map(match => ({
    x: numberAttribute(match[1], 'xMin'), y: numberAttribute(match[1], 'yMin'),
    right: numberAttribute(match[1], 'xMax'), bottom: numberAttribute(match[1], 'yMax'),
    text: match[2].replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"').replaceAll('&apos;', "'").replaceAll('&amp;', '&'),
  })).filter(word => word.x > 80 && word.x < boundary + 15 && word.text.trim());
}

function descriptionBoundary(bbox) {
  const candidates = [];
  for (const match of pageXml(bbox).matchAll(/<block\b([^>]*)>([\s\S]*?)<\/block>/g)) {
    const x = numberAttribute(match[1], 'xMin');
    const text = match[2].replace(/<[^>]+>/g, ' ').replaceAll(/\s+/g, ' ').trim();
    if (x >= 230 && text.length >= 20) candidates.push(x);
  }
  return candidates.length ? Math.min(...candidates) : 257.5;
}

function boxFor(elements) {
  if (!elements.length) throw new Error('Пустой векторный охват');
  const left = Math.max(0, Math.min(...elements.map(element => element.x)) - 3);
  const top = Math.max(0, Math.min(...elements.map(element => element.y)) - 3);
  const right = Math.max(...elements.map(element => element.x + element.width)) + 3;
  const bottom = Math.max(...elements.map(element => element.y + element.height)) + 3;
  return [left, top, Math.max(0.01, right - left), Math.max(0.01, bottom - top)].map(value => Math.round(value * 1000) / 1000).join(' ');
}

function graphicElementIndices(page, boundary, markers) {
  const maxMarker = Math.max(0, ...markers.map(marker => Number(marker.number)));
  const sourceMarkers = markers.filter(marker => Number(marker.number) === maxMarker);
  return page.elements.map((element, index) => ({ element, index })).filter(({ element }) => {
    const right = element.x + element.width;
    if (element.width < 0 || element.height < 0 || (element.width === 0 && element.height === 0)) return false;
    if (element.x <= 80 || right <= 90 || element.x >= boundary) return false;
    if (element.html.startsWith('<g') && element.x < 110 && sourceMarkers.some(marker => Math.abs(element.y - marker.y) < 12)) return false;
    return true;
  }).map(({ index }) => index);
}

function variantCount(text) {
  const matches = [...text.matchAll(/(?:^|[;:(]\s*|\s)(\d{1,2})\s*[-–—]/g)];
  let count = 0;
  for (const match of matches) {
    if (Number(match[1]) === count + 1) count += 1;
    else if (count > 0) break;
  }
  return Math.max(1, count);
}

function inVisualReadingOrder(words) {
  const lines = [];
  for (const word of [...words].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const current = lines.at(-1);
    if (!current || word.y > current.bottom + 8) lines.push({ bottom: word.bottom, words: [word] });
    else { current.words.push(word); current.bottom = Math.max(current.bottom, word.bottom); }
  }
  return lines.flatMap(line => line.words.sort((a, b) => a.x - b.x));
}

function horizontalPairAnchors(row) {
  const points = row.graphicIndices.map(index => {
    const element = pages[row.pageId].elements[index];
    return { x: element.x + element.width / 2, y: element.y + element.height / 2 };
  });
  if (points.length < 2) return [];
  let left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x));
  for (let iteration = 0; iteration < 12; iteration += 1) {
    const leftPoints = points.filter(point => Math.abs(point.x - left) <= Math.abs(point.x - right));
    const rightPoints = points.filter(point => Math.abs(point.x - left) > Math.abs(point.x - right));
    if (!leftPoints.length || !rightPoints.length) return [];
    left = leftPoints.reduce((sum, point) => sum + point.x, 0) / leftPoints.length;
    right = rightPoints.reduce((sum, point) => sum + point.x, 0) / rightPoints.length;
  }
  if (right - left < 20) return [];
  const center = points => ({ x: points.reduce((sum, point) => sum + point.x, 0) / points.length, y: points.reduce((sum, point) => sum + point.y, 0) / points.length });
  return [
    { variant: 1, row, ...center(points.filter(point => Math.abs(point.x - left) <= Math.abs(point.x - right))) },
    { variant: 2, row, ...center(points.filter(point => Math.abs(point.x - left) > Math.abs(point.x - right))) },
  ];
}

function clusterByX(indices, page, count) {
  const points = indices.map(index => ({ index, x: page.elements[index].x + page.elements[index].width / 2 })).sort((a, b) => a.x - b.x);
  let centers = Array.from({ length: count }, (_, index) => points[Math.floor((index + 0.5) * points.length / count)]?.x ?? index);
  let clusters = [];
  for (let iteration = 0; iteration < 16; iteration += 1) {
    clusters = centers.map(() => []);
    for (const point of points) {
      const cluster = centers.reduce((best, center, index) => Math.abs(point.x - center) < Math.abs(point.x - centers[best]) ? index : best, 0);
      clusters[cluster].push(point.index);
    }
    centers = clusters.map((cluster, index) => cluster.length
      ? cluster.reduce((sum, elementIndex) => sum + page.elements[elementIndex].x + page.elements[elementIndex].width / 2, 0) / cluster.length
      : centers[index]);
  }
  return clusters.map((indices, index) => ({ indices, center: centers[index] })).sort((a, b) => a.center - b.center);
}

function partitionRow(row, anchors) {
  const page = pages[row.pageId];
  const result = new Map(anchors.map(anchor => [anchor, []]));
  const usedLabels = new Set();
  for (const anchor of anchors.filter(anchor => anchor.sourceLabel)) {
    const candidates = row.graphicIndices.filter(index => !usedLabels.has(index) && page.elements[index].html.startsWith('<g')).map(index => {
      const element = page.elements[index];
      const x = element.x + element.width / 2, y = element.y + element.height / 2;
      return { index, distance: Math.hypot(x - anchor.x, y - anchor.y) };
    }).filter(candidate => candidate.distance <= 16).sort((a, b) => a.distance - b.distance);
    if (candidates[0]) usedLabels.add(candidates[0].index);
  }
  const lines = [];
  for (const anchor of [...anchors].sort((a, b) => a.y - b.y)) {
    const current = lines.at(-1);
    if (!current || anchor.y > current.y + 16) lines.push({ y: anchor.y, anchors: [anchor] });
    else { current.anchors.push(anchor); current.y = current.anchors.reduce((sum, item) => sum + item.y, 0) / current.anchors.length; }
  }
  for (const [lineIndex, line] of lines.entries()) {
    const members = row.graphicIndices.filter(index => {
      if (usedLabels.has(index)) return false;
      const element = page.elements[index];
      const y = element.y + element.height / 2;
      const targetLine = lines.findIndex(candidate => y <= candidate.y + 8);
      return (targetLine < 0 ? lines.length - 1 : targetLine) === lineIndex;
    });
    if (line.anchors.length === 1) { result.get(line.anchors[0]).push(...members); continue; }
    const pathIndices = members.filter(index => !page.elements[index].html.startsWith('<g'));
    const clusters = clusterByX(pathIndices, page, line.anchors.length);
    const orderedAnchors = [...line.anchors].sort((a, b) => a.x - b.x);
    clusters.forEach((cluster, index) => { if (orderedAnchors[index]) result.get(orderedAnchors[index]).push(...cluster.indices); });
    for (const index of members.filter(index => page.elements[index].html.startsWith('<g'))) {
      const element = page.elements[index], x = element.x + element.width / 2;
      const cluster = clusters.reduce((best, candidate) => Math.abs(x - candidate.center) < Math.abs(x - best.center) ? candidate : best, clusters[0]);
      const anchor = orderedAnchors[clusters.indexOf(cluster)];
      if (anchor) result.get(anchor).push(index);
    }
  }
  return result;
}

function nameOf(text, variant = null) {
  const normalized = text.replaceAll(/\s+/g, ' ').trim();
  const colon = normalized.indexOf(':');
  const firstMarker = /(?:^|\s)1\s*[-–—]\s*/.exec(normalized);
  const listStart = colon > 0 ? colon + 1 : firstMarker?.index ?? -1;
  if (variant !== null && listStart >= 0) {
    const base = normalized.slice(0, colon > 0 ? colon : listStart).trim();
    const list = normalized.slice(listStart);
    const markers = [...list.matchAll(/(?:^|[;,.]|\s)(\d{1,2})\s*[-–—]\s*/g)];
    const current = markers.findIndex(match => Number(match[1]) === variant);
    if (current >= 0) {
      const start = (markers[current].index ?? 0) + markers[current][0].length;
      const end = markers[current + 1]?.index ?? list.length;
      const meaning = list.slice(start, end).split(/(?<=[.!?])\s/)[0].replace(/^[;:,. \s]+|[;:,. \s]+$/g, '').trim();
      if (meaning) return `${base} — ${meaning}`;
    }
  }
  const first = normalized.split(/(?<=[.!?])\s/)[0] || normalized;
  return first.length <= 180 ? first : `${first.slice(0, 179).trim()}…`;
}

function kindOf(text) {
  if (/район|зона|участок|площад|полоса|сектор/i.test(text)) return 'AREA';
  if (/маршрут|линия|направлен|переправ|дорог|рубеж|границ|движени|эвакуа|колонн|перевоз|створ/i.test(text)) return 'LINE';
  return 'POINT';
}

const reuse = process.argv.includes('--reuse');
const pages = {};
const rowsByDocument = new Map();
const convertible = sourceRegistry.documents.filter(document => canonicalIds.has(document.id));
if (!reuse) {
await mkdir(workRoot, { recursive: true });
const docPaths = convertible.map(document => path.join(packageRoot, '.work', 'vector-audit', 'documents', document.normalizedName));
run('soffice', ['--headless', '--convert-to', 'docx', '--outdir', docxRoot, ...docPaths]);
await mkdir(rowDocxRoot, { recursive: true });
run('python3', [path.join(packageRoot, 'tools', 'extract-docx-rows.py'), docxRoot, rowDocxRoot]);
const manifest = JSON.parse(await readFile(path.join(rowDocxRoot, 'manifest.json'), 'utf8'));
await mkdir(pdfRoot, { recursive: true });
await mkdir(svgRoot, { recursive: true });
const rowPdfJobs = [];
for (const document of convertible) {
  const stem = path.basename(document.normalizedName, '.doc');
  const documentPdfRoot = path.join(pdfRoot, stem);
  await mkdir(documentPdfRoot, { recursive: true });
  const documentJobs = [];
  for (const row of manifest[stem] ?? []) {
    const input = path.join(rowDocxRoot, stem, row.file);
    const job = { document, stem, row, input, pdf: path.join(documentPdfRoot, row.file.replace(/\.docx$/, '.pdf')) };
    documentJobs.push(job);
    rowPdfJobs.push(job);
  }
  run('soffice', ['--headless', '--convert-to', 'pdf', '--outdir', documentPdfRoot, ...documentJobs.map(job => job.input)]);
}

const browser = await chromium.launch({ headless: true });
const browserPage = await browser.newPage();
try {
  for (const job of rowPdfJobs) {
    const bbox = run('pdftotext', ['-bbox-layout', job.pdf, '-']);
    const boundary = descriptionBoundary(bbox);
    const expectedNumbers = new Set(auditReport.entries.filter(entry => entry.documentId === job.document.id).map(entry => entry.number));
    const markers = extractNumberedEntriesFromBBox(bbox).filter(entry => expectedNumbers.has(entry.number));
    const pageId = `${job.stem}-row-${String(job.row.row).padStart(3, '0')}`;
    const svgPath = path.join(svgRoot, `${pageId}.svg`);
    run('pdftocairo', ['-svg', '-f', '1', '-l', '1', job.pdf, svgPath]);
    const svg = await readFile(svgPath, 'utf8');
    await browserPage.setContent(`<!doctype html><html><body>${svg}</body></html>`);
    const data = await browserPage.evaluate(async () => {
      const root = document.querySelector('svg');
      if (!root) throw new Error('SVG не загружен');
      for (const image of Array.from(root.querySelectorAll('image'))) {
        const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
        if (!href?.startsWith('data:image/')) throw new Error('Внешний растр в исходной строке');
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
            new DOMPoint(box.x, box.y).matrixTransform(matrix), new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix),
            new DOMPoint(box.x + box.width, box.y + box.height).matrixTransform(matrix), new DOMPoint(box.x, box.y + box.height).matrixTransform(matrix),
          ];
          const left = Math.min(...points.map(point => point.x)), right = Math.max(...points.map(point => point.x));
          const top = Math.min(...points.map(point => point.y)), bottom = Math.max(...points.map(point => point.y));
          return { html: element.outerHTML, x: left, y: top, width: right - left, height: bottom - top };
        }),
      };
    });
    const graphicIndices = graphicElementIndices(data, boundary, markers);
    pages[pageId] = data;
    const record = { ...job.row, documentId: job.document.id, pageId, boundary, markers, graphicIndices, words: graphicWords(bbox, boundary), extendedWords: graphicWords(bbox, boundary, true), textWords: sourceTextWords(bbox, boundary), fonts: pdfFonts(job.pdf) };
    rowsByDocument.set(job.document.id, [...(rowsByDocument.get(job.document.id) ?? []), record]);
  }
} finally {
  await browser.close();
}
await writeFile(path.join(workRoot, 'row-cache.json'), JSON.stringify({ pages, rows: Object.fromEntries(rowsByDocument) }));
} else {
  const cache = JSON.parse(await readFile(path.join(workRoot, 'row-cache.json'), 'utf8'));
  Object.assign(pages, cache.pages);
  for (const [documentId, rows] of Object.entries(cache.rows)) {
    for (const row of rows) {
      const stem = row.pageId.replace(/-row-\d+$/, '');
      const pdf = path.join(pdfRoot, stem, `row-${String(row.row).padStart(3, '0')}.pdf`);
      const bbox = run('pdftotext', ['-bbox-layout', pdf, '-']);
      row.words = graphicWords(bbox, row.boundary);
      row.extendedWords = graphicWords(bbox, row.boundary, true);
      row.textWords = sourceTextWords(bbox, row.boundary);
      row.fonts = pdfFonts(pdf);
      row.graphicIndices = graphicElementIndices(pages[row.pageId], row.boundary, row.markers);
    }
    rowsByDocument.set(documentId, rows);
  }
}

function continuation(text) {
  return /^(?:\d+\s*[-–—]|[a-zа-яё])/.test(text.trim());
}

function makeGroups(rows, pageTexts) {
  const groups = [];
  for (const row of rows) {
    if (!row.graphicIndices.length || /^\d+\.\s*[А-ЯA-Z]/.test(row.description)) continue;
    const current = groups.at(-1);
    const starts = !current || (row.description && !continuation(row.description));
    if (starts) groups.push({ rows: [row] });
    else current.rows.push(row);
  }
  return groups.map(group => {
    const locations = group.rows.flatMap(row => row.sourceLocations ?? []);
    const pageCounts = new Map();
    for (const location of locations) pageCounts.set(location.pageId, (pageCounts.get(location.pageId) ?? 0) + 1);
    const sourcePageId = [...pageCounts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const ownLocations = locations.filter(location => location.pageId === sourcePageId);
    return {
      ...group,
      text: [...new Set(group.rows.map(row => row.description).filter(Boolean))].join(' ').replaceAll(/\s+/g, ' ').trim(),
      page: sourcePageId ? Number(sourcePageId.slice(-3)) : bestSourcePage(group.rows.find(row => row.description)?.description ?? '', pageTexts),
      sourceTop: ownLocations.length ? Math.min(...ownLocations.map(location => location.element.y)) : null,
      sourceBottom: ownLocations.length ? Math.max(...ownLocations.map(location => location.element.y + location.element.height)) : null,
    };
  });
}

function selection(pageId, indices) {
  const ordered = [...indices].sort((a, b) => a - b);
  const elements = ordered.map(index => pages[pageId].elements[index]);
  return { elements: ordered.join(','), viewBox: boxFor(elements) };
}

function extractInscriptions(pageId, indices, words, fonts = []) {
  const page = pages[pageId];
  const available = new Set(indices.filter(index => page.elements[index].html.startsWith('<g')));
  const groups = [];
  for (const word of inVisualReadingOrder(words)) {
    const matched = [...available].filter(index => {
      const element = page.elements[index];
      const x = element.x + element.width / 2, y = element.y + element.height / 2;
      return x >= word.x - 2 && x <= word.right + 2 && y >= word.y - 2 && y <= word.bottom + 2;
    });
    if (!matched.length) continue;
    for (const index of matched) available.delete(index);
    const current = groups.at(-1);
    if (!current || word.y > current.bottom + 4 || word.x - current.right > 12) groups.push({ text: [word.text], right: word.right, bottom: word.bottom, indices: matched });
    else {
      current.text.push(word.text); current.right = word.right; current.bottom = Math.max(current.bottom, word.bottom);
      current.indices.push(...matched);
    }
  }
  return groups.map((group, groupIndex) => {
    const elements = [...new Set(group.indices)].sort((a, b) => a - b);
    const boxes = elements.map(index => page.elements[index]);
    const first = boxes[0];
    const fontIndex = Number(/glyph-(\d+)-/.exec(first.html)?.[1] ?? -1);
    const font = fonts[fontIndex] ?? { fontFamily: 'sans-serif', fontWeight: '400', fontStyle: 'normal' };
    return {
      id: `inscription-${groupIndex + 1}`, text: group.text.join(' '), elements,
      x: Math.min(...boxes.map(element => element.x)), y: Math.max(...boxes.map(element => element.y + element.height)),
      width: Math.max(...boxes.map(element => element.x + element.width)) - Math.min(...boxes.map(element => element.x)),
      height: Math.max(...boxes.map(element => element.height)),
      fontSize: Math.round(Math.max(...boxes.map(element => element.height)) / 0.75 * 100) / 100,
      fill: /fill="([^"]+)"/.exec(first.html)?.[1] ?? '#000000',
      fontFamily: font.fontFamily, fontWeight: font.fontWeight, fontStyle: font.fontStyle,
    };
  });
}

const originalWordCache = new Map();
function originalVariantSelection(entry, variant, count) {
  const legacy = legacyVectorSet.symbols.find(symbol => symbol.id === `source-${entry.number}`);
  if (!legacy) return null;
  const pageId = legacy.geometry.parameters.pageId;
  const page = originalVectorPages[pageId];
  const selected = legacy.geometry.parameters.elements.split(',').filter(Boolean).map(Number);
  const pathPoints = selected.filter(index => !page.elements[index].html.startsWith('<g')).map(index => ({
    index, y: page.elements[index].y + page.elements[index].height / 2,
  })).sort((a, b) => a.y - b.y);
  if (pathPoints.length < count) return null;
  let centers = Array.from({ length: count }, (_, index) => pathPoints[Math.floor((index + 0.5) * pathPoints.length / count)].y);
  let clusters = [];
  for (let iteration = 0; iteration < 20; iteration += 1) {
    clusters = centers.map(() => []);
    for (const point of pathPoints) {
      const cluster = centers.reduce((best, center, index) => Math.abs(point.y - center) < Math.abs(point.y - centers[best]) ? index : best, 0);
      clusters[cluster].push(point.index);
    }
    centers = clusters.map((cluster, index) => cluster.length
      ? cluster.reduce((sum, elementIndex) => sum + page.elements[elementIndex].y + page.elements[elementIndex].height / 2, 0) / cluster.length
      : centers[index]);
  }
  const ordered = clusters.map((indices, index) => ({ indices, center: centers[index] })).sort((a, b) => a.center - b.center);
  const target = ordered[variant - 1];
  if (!target?.indices.length) return null;
  const document = documents.get(entry.documentId);
  const pdf = path.join(packageRoot, '.work', 'vector-audit', 'pdf', document.normalizedName.replace(/\.doc$/i, '.pdf'));
  if (!originalWordCache.has(pdf)) originalWordCache.set(pdf, run('pdftotext', ['-bbox-layout', pdf, '-']));
  const bbox = originalWordCache.get(pdf);
  const [viewX, viewY, viewWidth, viewHeight] = legacy.geometry.parameters.viewBox.split(' ').map(Number);
  const labels = [...pageXml(bbox, entry.page).matchAll(/<word\b([^>]*)>(\d{1,2})<\/word>/g)].map(match => ({
    text: match[2], x: numberAttribute(match[1], 'xMin'), y: numberAttribute(match[1], 'yMin'),
    right: numberAttribute(match[1], 'xMax'), bottom: numberAttribute(match[1], 'yMax'),
  })).filter(word => Number(word.text) === variant && word.x >= viewX - 20 && word.x <= viewX + viewWidth + 20 && word.y >= viewY - 30 && word.y <= viewY + viewHeight + 30);
  const indices = new Set(target.indices);
  for (const index of selected.filter(index => page.elements[index].html.startsWith('<g'))) {
    const element = page.elements[index], y = element.y + element.height / 2;
    const nearest = ordered.reduce((best, cluster) => Math.abs(y - cluster.center) < Math.abs(y - best.center) ? cluster : best);
    if (nearest === target) indices.add(index);
  }
  if (labels.length) {
    const label = labels[0];
    const x = (label.x + label.right) / 2, y = (label.y + label.bottom) / 2;
    const labelElement = [...indices].filter(index => page.elements[index].html.startsWith('<g')).sort((a, b) => {
      const distance = index => Math.hypot(page.elements[index].x + page.elements[index].width / 2 - x, page.elements[index].y + page.elements[index].height / 2 - y);
      return distance(a) - distance(b);
    })[0];
    if (labelElement !== undefined) indices.delete(labelElement);
  }
  if (!indices.size) return null;
  pages[pageId] = page;
  const orderedIndices = [...indices].sort((a, b) => a - b);
  return { pageId, elements: orderedIndices.join(','), viewBox: boxFor(orderedIndices.map(index => page.elements[index])), fontList: pdfFonts(pdf) };
}

const symbols = [];
const failures = [];
const fallbacks = [];
const variantFailures = [];
const covered = new Set();
for (const document of convertible) {
  if (document.id === 'doc-029') continue;
  const entries = auditReport.entries.filter(entry => entry.documentId === document.id);
  const originalPdf = path.join(packageRoot, '.work', 'vector-audit', 'pdf', document.normalizedName.replace(/\.doc$/i, '.pdf'));
  const pageTexts = run('pdftotext', ['-layout', originalPdf, '-']).split('\f');
  const documentRows = rowsByDocument.get(document.id) ?? [];
  const originalPages = Object.fromEntries(document.fragmentIds.map(fragmentId => [fragmentId, originalVectorPages[fragmentId]]));
  attachSourceLocations(documentRows, originalPages, pages);
  const groups = makeGroups(documentRows, pageTexts);
  for (const { group, entries: assignedEntries } of alignSourceGroups(entries, groups)) {
    const text = group.text;
    const count = variantCount(text);
    const anchors = [];
    const collectAnchors = mode => {
      anchors.length = 0;
      let expected = 1;
      const found = new Set();
      for (const row of group.rows) {
        const smallMarkers = row.markers.filter(marker => Number(marker.number) <= count).map(marker => ({
          text: marker.number, x: marker.x, y: marker.y, right: marker.x + 7, bottom: marker.y + 12,
        }));
        const primary = [...row.words, ...smallMarkers];
        const extended = [...row.extendedWords, ...smallMarkers];
        const sourceWords = mode === 2 || (mode === 1 && !primary.some(word => Number(word.text) === expected)) ? extended : primary;
        for (const word of inVisualReadingOrder(sourceWords)) {
          const variant = Number(word.text);
          const matches = mode === 2 ? variant >= 1 && variant <= count && !found.has(variant) : variant === expected && expected <= count;
          if (matches) {
            anchors.push({ variant, row, x: (word.x + word.right) / 2, y: (word.y + word.bottom) / 2, sourceLabel: true });
            found.add(variant);
            if (mode !== 2) expected += 1;
          }
        }
      }
    };
    collectAnchors(0);
    if (count > 1 && anchors.length < count) collectAnchors(1);
    if (count > 1 && anchors.length < count) collectAnchors(2);
    if (count === 2 && anchors.length === 0 && group.rows.length === 1) anchors.push(...horizontalPairAnchors(group.rows[0]));
    const variantsResolved = count === 1 || anchors.length === count;
    if (!variantsResolved) variantFailures.push({ numbers: assignedEntries.map(entry => entry.number), expected: count, found: anchors.length, text: text.slice(0, 180) });
    for (const [entryIndex, entry] of assignedEntries.entries()) {
      const assignedRows = group.rows.length >= assignedEntries.length
        ? group.rows.filter((_, rowIndex) => Math.floor(rowIndex * assignedEntries.length / group.rows.length) === entryIndex)
        : group.rows;
      const groupAnchors = variantsResolved && count > 1 ? anchors.filter(anchor => assignedRows.includes(anchor.row)) : [];
      const outputs = groupAnchors.length ? groupAnchors : assignedRows.map((row, index) => ({ variant: index + 1, row }));
      for (const output of outputs) {
        let indices = output.row.graphicIndices;
        if (groupAnchors.length) {
          const sameRow = groupAnchors.filter(anchor => anchor.row === output.row);
          if (sameRow.length) indices = partitionRow(output.row, sameRow).get(output) ?? [];
        }
        if (!indices.length) {
          output.fallback = originalVariantSelection(entry, output.variant, count);
          if (output.fallback) fallbacks.push({ number: entry.number, variant: output.variant, pageId: output.fallback.pageId });
          else {
            failures.push({ number: entry.number, row: output.row.row, variant: output.variant, error: 'Пустой векторный вариант, включая исходную страницу' });
            continue;
          }
        }
        const variant = output.variant;
        const id = `source-${entry.number}-${variant}`;
        const ownText = [...new Set(assignedRows.map(row => row.description).filter(Boolean))].join(' ').replaceAll(/\s+/g, ' ').trim();
        const firstGroupText = group.rows.find(row => row.description)?.description ?? '';
        const entryText = ownText && entryIndex > 0 && continuation(ownText) && firstGroupText ? `${firstGroupText} ${ownText}` : ownText || text || entry.text;
        const documentRecord = documents.get(document.id);
        const geometryParameters = output.fallback
          ? { pageId: output.fallback.pageId, elements: output.fallback.elements, viewBox: output.fallback.viewBox }
          : { pageId: output.row.pageId, ...selection(output.row.pageId, indices) };
        const inscriptionWords = output.fallback ? sourceTextWords(originalWordCache.get(originalPdf) ?? '', Infinity, entry.page) : output.row.textWords;
        const inscriptionFonts = output.fallback?.fontList ?? output.row.fonts;
        const inscriptions = extractInscriptions(geometryParameters.pageId, geometryParameters.elements.split(',').filter(Boolean).map(Number), inscriptionWords, inscriptionFonts);
        symbols.push({
          id, version: '3.0.0', name: nameOf(entryText, variant), code: `${entry.number}.${variant}`,
          purpose: entryText, kind: kindOf(entryText), frame: 'NONE', affiliation: 'UNKNOWN',
          forceType: documentRecord?.topics[0] ?? 'OTHER_ORGANIZATIONS', objectType: `SOURCE_${entry.number}_${variant}`,
          organizationalLevel: null, modifiers: [], allowedModifierIds: [], labels: {}, inscriptions, labelLayout: {}, color: '#000000', anchor: [0.5, 0.5],
          scaling: { minPx: 16, maxPx: 512, simplifyBelowZoom: 0 },
          geometry: { version: 1, template: 'SOURCE_VECTOR', parameters: geometryParameters },
          status: 'MAPPED',
          source: {
            sourceDocument: entry.sourceDocument, page: entry.page, symbolNumber: entry.number, variant,
            fragmentId: `${entry.documentId}-page-${String(entry.page).padStart(3, '0')}`, ruleText: entryText,
            gaps: [output.fallback ? 'Плавающая графика восстановлена непосредственно из исходной векторной страницы.' : 'Векторный вариант изолирован из исходной строки DOC.', 'Пояснительная цифра варианта не входит в рабочий знак.', 'Методическое утверждение не присвоено автоматически.'],
          },
        });
        covered.add(entry.number);
      }
    }
  }
}

const mpoDocument = documents.get('doc-029');
const mpoPdf = path.join(packageRoot, '.work', 'vector-audit', 'pdf', mpoDocument.normalizedName.replace(/\.doc$/i, '.pdf'));
const mpoPageTexts = run('pdftotext', ['-layout', mpoPdf, '-']).split('\f');
const mpoRows = makeGroups(rowsByDocument.get('doc-029') ?? [], mpoPageTexts).flatMap(group => group.rows.map(row => ({ row, text: group.text })));
for (const [index, { row, text }] of mpoRows.entries()) {
  const page = bestSourcePage(row.description || text, mpoPageTexts);
  if (!page) { failures.push({ documentId: 'doc-029', row: row.row, error: 'Не найдена исходная страница МПО' }); continue; }
  const localNumber = String(index + 1).padStart(3, '0');
  symbols.push({
    id: `mpo-${localNumber}`, version: '3.0.0', name: nameOf(text), code: `МПО-${localNumber}`,
    purpose: text, kind: kindOf(text), frame: 'NONE', affiliation: 'UNKNOWN', forceType: 'MORAL_PSYCHOLOGICAL_SUPPORT',
    objectType: `MPO_${localNumber}`, organizationalLevel: null, modifiers: [], allowedModifierIds: [], labels: {}, inscriptions: extractInscriptions(row.pageId, row.graphicIndices, row.textWords, row.fonts), labelLayout: {},
    color: '#000000', anchor: [0.5, 0.5], scaling: { minPx: 16, maxPx: 512, simplifyBelowZoom: 0 },
    geometry: { version: 1, template: 'SOURCE_VECTOR', parameters: { pageId: row.pageId, ...selection(row.pageId, row.graphicIndices) } },
    status: 'MAPPED',
    source: {
      sourceDocument: mpoDocument.originalName, page, symbolNumber: null, variant: null,
      fragmentId: `doc-029-page-${String(page).padStart(3, '0')}`, ruleText: text,
      gaps: ['В исходном документе номер отсутствует; локальный идентификатор не является уставным номером.', 'Методическое утверждение не присвоено автоматически.'],
    },
  });
}

const set = {
  id: 'ru-modern', version: 'ru-modern-v3', status: 'DRAFT',
  gaps: ['Исходные номера 321–323 отсутствуют в поставленном DOC и не восстанавливаются предположительно.', 'Двадцать знаков МПО имеют только локальные идентификаторы: исходный документ их не нумерует.', 'Технический перенос не заменяет визуальную, смысловую и методическую приёмку.'],
  symbols,
};
const deduped = dedupeVectorPages(pages);
await writeFile(path.join(packageRoot, 'data', 'vector-rows.json'), JSON.stringify(deduped.pages));
await writeFile(path.join(packageRoot, 'data', 'vector-definitions.json'), JSON.stringify(deduped.definitions));
await writeFile(path.join(packageRoot, 'data', 'sets', 'ru-modern-v3.json'), `${JSON.stringify(set, null, 2)}\n`);
const report = { schemaVersion: 1, sourceAuditSha256: auditReport.archiveSha256, numberedGroups: covered.size, symbols: symbols.length, vectorPages: Object.keys(pages).length, failures, fallbacks, variantFailures };
await writeFile(path.join(packageRoot, 'data', 'vector-row-build-report.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ numberedGroups: covered.size, symbols: symbols.length, vectorPages: Object.keys(pages).length, failures: failures.length, fallbacks: fallbacks.length, variantFailures: variantFailures.length }, null, 2));
if (failures.length || variantFailures.length || covered.size !== 610) process.exitCode = 1;
