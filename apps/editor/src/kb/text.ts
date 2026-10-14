/** PDF через pdf.js (лениво, в браузере). */
async function loadPdf(bytes: ArrayBuffer | Uint8Array) {
  const pdfjs = await import('pdfjs-dist');
  const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  // pdf.js забирает буфер себе — передаётся копия
  return pdfjs.getDocument({ data: new Uint8Array(bytes).slice() }).promise;
}

/** Текст страниц PDF (строки — по hasEOL, абзацы — по пустым строкам). */
async function pdfPageTexts(bytes: ArrayBuffer): Promise<string[]> {
  const doc = await loadPdf(bytes);
  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const c = await (await doc.getPage(i)).getTextContent();
    pages.push(c.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join('').replace(/\n{3,}/g, '\n\n'));
  }
  return pages;
}

/** Текст из загруженного файла: PDF (pdf.js), Word .docx (mammoth), HTML, txt, md. */
export async function fileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return (await pdfPageTexts(await file.arrayBuffer())).join('\n\n');
  if (name.endsWith('.docx')) {
    const mammoth = await import('mammoth/mammoth.browser.js');
    const r = await (mammoth.default ?? mammoth).extractRawText({ arrayBuffer: await file.arrayBuffer() });
    return r.value as string;
  }
  const raw = await file.text();
  if (name.endsWith('.html') || name.endsWith('.htm') || file.type === 'text/html') {
    const d = new DOMParser().parseFromString(raw, 'text/html');
    d.querySelectorAll('script, style, nav, footer').forEach((x) => x.remove());
    return [...d.body.querySelectorAll('h1, h2, h3, h4, p, li, td, th, pre, blockquote')].map((x) => x.textContent?.trim() ?? '').filter(Boolean).join('\n\n') || d.body.textContent || '';
  }
  return raw;
}

/** Картинка страницы (data: URL) и её размер в пикселях. */
export interface PageImage { url: string; width: number; height: number }

/** Страница PDF меньше чем с 50 знаками текста — скан. */
export const SCAN_CHARS = 50;

/**
 * Прочитанный файл: текст (PDF — ещё текст по страницам, номера страниц-сканов и сами байты для картинок),
 * картинка (JPG, PNG), таблица (CSV, XLSX), пакет фактов (JSON).
 */
export type ReadDoc =
  | { kind: 'text'; text: string; pages?: string[]; scanPages?: number[]; pdf?: ArrayBuffer }
  | { kind: 'image'; image: PageImage }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'facts'; json: unknown };

/** Вид входа по имени и типу файла. */
export function inputKind(file: Pick<File, 'name' | 'type'>): 'pdf' | 'image' | 'table' | 'facts' | 'text' {
  const n = file.name.toLowerCase();
  if (n.endsWith('.pdf') || file.type === 'application/pdf') return 'pdf';
  if (/\.(jpe?g|png)$/.test(n) || /^image\/(jpeg|png)$/.test(file.type)) return 'image';
  if (/\.(csv|xlsx)$/.test(n) || file.type === 'text/csv' || file.type.includes('spreadsheetml')) return 'table';
  if (n.endsWith('.json') || file.type === 'application/json') return 'facts';
  return 'text';
}

/** Все поддерживаемые типы — для accept у кнопки загрузки. */
export const ACCEPT = '.pdf,.docx,.txt,.md,.html,.htm,.jpg,.jpeg,.png,.csv,.xlsx,.json';

/** Прочитать загруженный файл (тип входа определяется сам). */
export async function readDocument(file: File): Promise<ReadDoc> {
  switch (inputKind(file)) {
    case 'pdf': {
      const pdf = await file.arrayBuffer();
      const pages = await pdfPageTexts(pdf);
      const scanPages = pages.map((t, i) => (t.trim().length < SCAN_CHARS ? i + 1 : 0)).filter(Boolean);
      return { kind: 'text', text: pages.filter((_, i) => !scanPages.includes(i + 1)).join('\n\n'), pages, scanPages, pdf };
    }
    case 'image': return { kind: 'image', image: await imageOf(file) };
    case 'table': return { kind: 'table', rows: await tableRows(file) };
    case 'facts': {
      let json: unknown;
      try { json = JSON.parse(await file.text()); } catch { throw new Error('JSON не читается'); }
      return { kind: 'facts', json };
    }
    default: return { kind: 'text', text: await fileText(file) };
  }
}

/** Двоичные данные → data: URL. */
async function dataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || 'image/png'};base64,${btoa(s)}`;
}

/** Холст: в окне — canvas, в фоновом потоке — OffscreenCanvas. */
function canvas(w: number, h: number): { ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D; blob(): Promise<Blob> } {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return { ctx: c.getContext('2d')!, blob: () => new Promise((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('картинка не получилась'))), 'image/jpeg', 0.85)) };
  }
  const c = new OffscreenCanvas(w, h);
  return { ctx: c.getContext('2d')!, blob: () => c.convertToBlob({ type: 'image/jpeg', quality: 0.85 }) };
}

/** Картинка из файла JPG/PNG. */
async function imageOf(file: Blob): Promise<PageImage> {
  const bmp = await createImageBitmap(file);
  const r = { url: await dataUrl(file), width: bmp.width, height: bmp.height };
  bmp.close();
  return r;
}

/** Страница PDF → картинка (JPEG, ширина около 1600 точек — цифры читаемы). */
export async function renderPdfPage(pdf: ArrayBuffer, page: number): Promise<PageImage> {
  const doc = await loadPdf(pdf);
  const p = await doc.getPage(page);
  const base = p.getViewport({ scale: 1 });
  const viewport = p.getViewport({ scale: Math.min(4, Math.max(1, 1600 / base.width)) });
  const w = Math.ceil(viewport.width), h = Math.ceil(viewport.height);
  const c = canvas(w, h);
  c.ctx.fillStyle = '#fff'; c.ctx.fillRect(0, 0, w, h);
  await p.render({ canvasContext: c.ctx as CanvasRenderingContext2D, viewport }).promise;
  return { url: await dataUrl(await c.blob()), width: w, height: h };
}

/** Полоса картинки (высокая страница режется на полосы: stripes). */
export async function cropImage(url: string, stripe: { y: number; h: number }, width: number): Promise<string> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const c = canvas(width, stripe.h);
  c.ctx.drawImage(bmp, 0, stripe.y, width, stripe.h, 0, 0, width, stripe.h);
  bmp.close();
  return dataUrl(await c.blob());
}

/** Таблица из CSV или XLSX (первый лист) → строки ячеек; первая строка — заголовок. Даты Excel — ГГГГ-ММ-ДД. */
export async function tableRows(file: File): Promise<string[][]> {
  const name = file.name.toLowerCase();
  const { decodeTable, parseCsv } = await import('@def-ops/knowledge');
  if (name.endsWith('.xlsx') || file.type.includes('spreadsheetml')) {
    const { readSheet } = await import('read-excel-file/browser');
    const data = await readSheet(file);
    const cell = (v: unknown): string => (v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v).trim());
    const rows = data.map((r) => r.map(cell));
    while (rows.length && !rows[rows.length - 1].some(Boolean)) rows.pop();
    return rows;
  }
  return parseCsv(decodeTable(new Uint8Array(await file.arrayBuffer())));
}
