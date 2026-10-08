/**
 * Минимальный разбор Markdown для отчётов и ответов модели: заголовки (# … ######), абзацы, списки
 * (-, *, +, нумерованные), цитаты, таблицы, черта, полужирный, курсив, код.
 */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s)
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_m, a, b) => `<b>${a ?? b}</b>`)
  .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\*)/g, '$1<i>$2</i>')
  .replace(/(^|[^_\w])_([^_\s][^_]*?)_(?![_\w])/g, '$1<i>$2</i>');

const BULLET = /^\s*[-*+•] +/;
const NUMBER = /^\s*\d{1,3}[.)] +/;

/** Ответ целиком в блоке ```markdown … ``` (так иногда отвечает модель) — без обёртки; остатки <think> — прочь. */
export function unfence(md: string): string {
  let t = md.replace(/\r/g, '').replace(/<think>[\s\S]*?(<\/think>|$)/g, '').replace(/^\s+/, '');
  const m = /^```(?:markdown|md)?[ \t]*\n/i.exec(t);
  if (m) t = t.slice(m[0].length).replace(/\n?```\s*$/, '');
  return t;
}

export function mdToHtml(md: string): string {
  const out: string[] = [];
  const lines = unfence(md).split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const h = /^\s*(#{1,6})\s+(.*?)\s*#*\s*$/.exec(l);
    if (h) { const n = Math.min(4, h[1].length); out.push(`<h${n}>${inline(h[2])}</h${n}>`); continue; }
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(l)) { out.push('<hr>'); continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      i--;
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    for (const [re, tag] of [[BULLET, 'ul'], [NUMBER, 'ol']] as const) {
      if (!re.test(l)) continue;
      const items: string[] = [];
      while (i < lines.length && re.test(lines[i])) { items.push(`<li>${inline(lines[i].replace(re, ''))}</li>`); i++; }
      i--;
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      break;
    }
    if (BULLET.test(l) || NUMBER.test(l)) continue;
    if (/^\s*>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) { q.push(inline(lines[i].replace(/^\s*>\s?/, ''))); i++; }
      i--;
      out.push(`<blockquote>${q.join('<br>')}</blockquote>`);
      continue;
    }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('\n');
}
