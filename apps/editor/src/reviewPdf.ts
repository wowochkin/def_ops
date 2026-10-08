/**
 * Разбор операции — файлом PDF, без окна печати: документ собирается в браузере (pdfmake, шрифт Roboto с
 * кириллицей) — титул, сводка, ключевые события, оглавление, разделы экспертов из их Markdown. Библиотека
 * грузится только при скачивании.
 */
import type { Content, ContentText, TDocumentDefinitions } from 'pdfmake/interfaces';
import { unfence } from './markdown';

const ACCENT = '#8c2a1e', MUTED = '#6b675d', LINE = '#d9d4c7';

/** Строка Markdown → куски текста: **полужирный**, *курсив*, `код`. */
export function inlineRuns(s: string): ContentText['text'] {
  const out: ContentText[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g;
  let last = 0, m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const pre = m[4] ?? '';
    if (m.index + pre.length > last) out.push({ text: s.slice(last, m.index + pre.length) });
    if (m[1] ?? m[2]) out.push({ text: m[1] ?? m[2], bold: true });
    else if (m[3]) out.push({ text: m[3], background: '#efede6' });
    else out.push({ text: m[5], italics: true });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ text: s.slice(last) });
  return out.length === 1 && Object.keys(out[0]).length === 1 ? (out[0].text as string) : out;
}

const BULLET = /^\s*[-*+•] +/;
const NUMBER = /^\s*\d{1,3}[.)] +/;

/** Markdown раздела → блоки PDF (заголовки, абзацы, списки, цитаты, таблицы, черта). */
export function mdToPdf(md: string): Content[] {
  const out: Content[] = [];
  const lines = unfence(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { out.push({ text: inlineRuns(h[2]), style: h[1].length <= 3 ? 'h3' : 'h4', headlineLevel: 2 }); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { out.push({ canvas: [{ type: 'line', x1: 0, y1: 0, x2: 515, y2: 0, lineWidth: 0.5, lineColor: LINE }], margin: [0, 6, 0, 6] }); continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      i--;
      const [head, , ...body] = rows;
      const n = head.length;
      out.push({ table: { headerRows: 1, widths: Array(n).fill('*'), body: [head.map((c) => ({ text: inlineRuns(c), bold: true })), ...body.map((r) => Array.from({ length: n }, (_, k) => ({ text: inlineRuns(r[k] ?? '') })))] },
        layout: 'lightHorizontalLines', fontSize: 9.5, margin: [0, 4, 0, 8] });
      continue;
    }
    if (BULLET.test(l) || NUMBER.test(l)) {
      const re = BULLET.test(l) ? BULLET : NUMBER;
      const items: Content[] = [];
      while (i < lines.length && re.test(lines[i])) { items.push({ text: inlineRuns(lines[i].replace(re, '')) }); i++; }
      i--;
      out.push(re === BULLET ? { ul: items, margin: [0, 2, 0, 6] } : { ol: items, margin: [0, 2, 0, 6] });
      continue;
    }
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(lines[i].replace(/^\s*>\s?/, '')); i++; }
      i--;
      out.push({ text: inlineRuns(q.join('\n')), italics: true, color: MUTED, margin: [12, 2, 0, 6] });
      continue;
    }
    if (l.trim()) out.push({ text: inlineRuns(l), style: 'p' });
  }
  return out;
}

export interface ReviewPdfInput {
  scenario: string;
  side: string;
  enemy: string;
  takeover: string;
  at: string;
  outcome: { result: string; text: string } | null;
  strength: string;
  goals: { title: string; game: string; history: string }[];
  sections: { title: string; role: string; text: string }[];
  models: string;
}

export function reviewDoc(x: ReviewPdfInput): TDocumentDefinitions {
  const meta: [string, ContentText['text']][] = [
    ['Сторона', x.side], ['Противник', x.enemy], ['Командование принято', x.takeover], ['Разбор на', x.at],
    ['Итог', x.outcome ? [{ text: x.outcome.result === 'victory' ? 'Победа' : 'Поражение', bold: true }, { text: ` — ${x.outcome.text}` }] : 'игра не окончена'],
    ['В строю', x.strength],
  ];
  return {
    pageSize: 'A4',
    pageMargins: [40, 48, 40, 52],
    info: { title: `Разбор операции — ${x.scenario}`, subject: 'Отчётный документ', creator: 'def_ops' },
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.3, color: '#1f1f1f' },
    styles: {
      kicker: { fontSize: 8.5, bold: true, color: ACCENT, characterSpacing: 1.2 },
      title: { fontSize: 24, bold: true, margin: [0, 4, 0, 4] },
      sub: { fontSize: 13, color: MUTED, margin: [0, 0, 0, 16] },
      h2: { fontSize: 15, bold: true, margin: [0, 0, 0, 2] },
      role: { fontSize: 10, italics: true, color: MUTED, margin: [0, 0, 0, 8] },
      h3: { fontSize: 12, bold: true, margin: [0, 8, 0, 3] },
      h4: { fontSize: 11, bold: true, margin: [0, 6, 0, 2] },
      p: { margin: [0, 0, 0, 5], alignment: 'justify' },
      note: { fontSize: 8.5, color: MUTED },
    },
    // заголовок не остаётся один внизу страницы — переносится к своему тексту
    pageBreakBefore: (node, following) => (node.headlineLevel === 1 && following.length < 2) || (node.headlineLevel === 2 && following.length === 0),
    footer: (page, pages) => ({ columns: [{ text: `Разбор операции · ${x.scenario.split(':')[0]}`, style: 'note' }, { text: `${page} / ${pages}`, alignment: 'right', style: 'note' }], margin: [40, 16, 40, 0] }),
    content: [
      { text: 'ОТЧЁТНЫЙ ДОКУМЕНТ', style: 'kicker' },
      { text: 'Разбор операции', style: 'title' },
      { text: x.scenario, style: 'sub' },
      { text: `Разбор составлен языковой моделью${x.models ? ` (${x.models})` : ''} по записи игры ${new Date().toLocaleDateString('ru-RU')}. Оценки — мнение модели в роли экспертов, а не исторический факт.`, style: 'note', margin: [0, 0, 0, 12] },
      { table: { widths: [130, '*'], body: meta.map(([k, v]) => [{ text: k, bold: true }, { text: v }]) }, layout: 'lightHorizontalLines', margin: [0, 0, 0, 14] },
      ...(x.goals.length ? [
        { text: 'Ключевые события', style: 'h3' } as Content,
        { table: { headerRows: 1, widths: ['*', 70, 70], body: [[{ text: 'Событие', bold: true }, { text: 'В игре', bold: true }, { text: 'В истории', bold: true }], ...x.goals.map((g) => [g.title, g.game, g.history])] },
          layout: 'lightHorizontalLines', fontSize: 9.5, margin: [0, 0, 0, 12] } as Content,
      ] : []),
      { text: 'Содержание', style: 'h3' },
      { ol: x.sections.map((s) => ({ text: [{ text: s.title }, { text: ` — ${s.role}`, color: MUTED, fontSize: 9.5 }] })) },
      ...x.sections.flatMap((s, i): Content[] => [
        // разделы идут подряд; первый — с новой страницы после титула
        { text: `${i + 1}. ${s.title}`, style: 'h2', headlineLevel: 1, ...(i === 0 ? { pageBreak: 'before' as const } : { margin: [0, 18, 0, 2] as [number, number, number, number] }) },
        { text: s.role, style: 'role' },
        ...mdToPdf(s.text),
      ]),
    ],
  };
}

/** Собрать и скачать PDF. */
export async function downloadReviewPdf(x: ReviewPdfInput, fileName: string) {
  const [{ default: pdfMake }, { default: vfs }] = await Promise.all([import('pdfmake/build/pdfmake'), import('pdfmake/build/vfs_fonts')]);
  const v = (vfs as unknown as { pdfMake?: { vfs: Record<string, string> }; vfs?: Record<string, string> });
  (pdfMake as unknown as { vfs: Record<string, string> }).vfs = v.pdfMake?.vfs ?? v.vfs ?? (vfs as unknown as Record<string, string>);
  // свой «скачать» по ссылке: имя файла сохраняется во всех браузерах
  // pdfmake 0.2 отдаёт файл в обратный вызов, новые версии — обещанием
  const doc = pdfMake.createPdf(reviewDoc(x)) as unknown as { getBlob: (cb?: (b: Blob) => void) => Promise<Blob> | void };
  const blob = await new Promise<Blob>((res, rej) => { const p = doc.getBlob(res); if (p && typeof p.then === 'function') p.then(res, rej); });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
