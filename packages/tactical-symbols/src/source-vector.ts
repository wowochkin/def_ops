import rawVectorPages from '../data/vector-rows.json' with { type: 'json' };
import rawVectorDefinitions from '../data/vector-definitions.json' with { type: 'json' };
import type { SourceInscription, SymbolLabels } from './model';

export interface SourceVectorRenderOptions {
  readonly width: number;
  readonly height: number;
  readonly label?: string;
  readonly elements?: string;
  readonly inscriptions?: readonly SourceInscription[];
  readonly labels?: SymbolLabels;
}

export interface SourceVectorElement {
  readonly html: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface SourceVectorPageData {
  readonly defs?: string;
  readonly definitionIds?: readonly string[];
  readonly elements: readonly SourceVectorElement[];
}

const pages = new Map<string, string | SourceVectorPageData>();
const definitions = rawVectorDefinitions as Readonly<Record<string, string>>;

function pageDefinitions(page: SourceVectorPageData): string {
  if (!page.definitionIds) return page.defs ?? '';
  return page.definitionIds.map(id => {
    const definition = definitions[id];
    if (!definition) throw new Error(`Не найдено векторное определение ${id}`);
    return definition;
  }).join('');
}

function escapeXml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function assertPage(pageId: string, content: string): void {
  if (!/^[a-z0-9-]+$/.test(pageId)) throw new Error('Некорректный идентификатор векторной страницы');
  if (/<(?:script|foreignObject)\b/i.test(content) || /(?:href|src)\s*=\s*["'](?:https?:)?\/\//i.test(content) || /url\(\s*["']?https?:/i.test(content)) {
    throw new Error('Векторная страница содержит внешний ресурс или активное содержимое');
  }
}

export function registerSourceVectorPage(pageId: string, svg: string): void {
  assertPage(pageId, svg);
  if (!/<svg\b[^>]*>[\s\S]*<\/svg>/.test(svg)) throw new Error('Векторная страница не содержит SVG');
  pages.set(pageId, svg);
}

export function registerSourceVectorData(pageId: string, page: SourceVectorPageData): void {
  assertPage(pageId, `${pageDefinitions(page)}${page.elements.map(element => element.html).join('')}`);
  if (!Array.isArray(page.elements) || page.elements.some(element => ![element.x, element.y, element.width, element.height].every(Number.isFinite))) {
    throw new Error('Векторная страница содержит некорректные границы элемента');
  }
  pages.set(pageId, page);
}

export function sourceVectorPage(pageId: string): string {
  const page = pages.get(pageId);
  if (!page) throw new Error(`Векторная страница ${pageId} не найдена`);
  if (typeof page === 'string') return page;
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs>${pageDefinitions(page)}</defs>${page.elements.map(element => element.html).join('')}</svg>`;
}

export function renderSourceVector(pageId: string, viewBox: string, options: SourceVectorRenderOptions): string {
  const numbers = viewBox.trim().split(/\s+/).map(Number);
  if (numbers.length !== 4 || numbers.some(value => !Number.isFinite(value)) || numbers[2] <= 0 || numbers[3] <= 0) throw new Error('Некорректный viewBox векторного знака');
  if (!Number.isFinite(options.width) || !Number.isFinite(options.height) || options.width <= 0 || options.height <= 0) throw new Error('Размеры векторного знака должны быть положительными');
  const page = pages.get(pageId);
  if (!page) throw new Error(`Векторная страница ${pageId} не найдена`);
  let content: string;
  if (typeof page === 'string') {
    if (options.elements !== undefined) throw new Error('Выбор элементов требует структурированную векторную страницу');
    content = page.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/)?.[1] ?? '';
  } else {
    const indices = options.elements === undefined || options.elements === '' ? page.elements.map((_, index) => index) : options.elements.split(',').map(Number);
    if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= page.elements.length)) throw new Error('Некорректный индекс элемента векторной страницы');
    const replacements = (options.inscriptions ?? []).filter(inscription => Object.hasOwn(options.labels ?? {}, inscription.id) && options.labels?.[inscription.id] !== inscription.text);
    const removed = new Set(replacements.flatMap(inscription => inscription.elements));
    const replacementText = replacements.map(inscription => {
      const value = options.labels?.[inscription.id];
      if (value === null || value === '') return '';
      return `<text data-inscription="${escapeXml(inscription.id)}" x="${inscription.x}" y="${inscription.y}" fill="${escapeXml(inscription.fill)}" font-family="${escapeXml(inscription.fontFamily ?? 'sans-serif')}" font-size="${inscription.fontSize}" font-weight="${escapeXml(inscription.fontWeight ?? '400')}" font-style="${escapeXml(inscription.fontStyle ?? 'normal')}">${escapeXml(String(value))}</text>`;
    }).join('');
    content = `<defs>${pageDefinitions(page)}</defs>${indices.filter(index => !removed.has(index)).map(index => page.elements[index]!.html).join('')}${replacementText}`;
  }
  const label = options.label ? ` role="img" aria-label="${escapeXml(options.label)}"` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${options.width}" height="${options.height}" viewBox="${numbers.join(' ')}" data-source-page="${pageId}"${label}>${content}</svg>`;
}


for (const [pageId, page] of Object.entries(rawVectorPages as Record<string, SourceVectorPageData>)) {
  registerSourceVectorData(pageId, page);
}
