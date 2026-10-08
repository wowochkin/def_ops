/** Минимальный разбор Markdown для отчётов: заголовки, абзацы, списки, таблицы, полужирный, код. */
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = (s: string) => esc(s).replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');

export function mdToHtml(md: string): string {
  const out: string[] = [];
  const lines = md.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3} /.test(l)) { const n = l.indexOf(' '); out.push(`<h${n}>${inline(l.slice(n + 1))}</h${n}>`); continue; }
    if (l.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) { rows.push(lines[i].split('|').slice(1, -1).map((c) => c.trim())); i++; }
      i--;
      const [head, , ...body] = rows;
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (l.startsWith('- ')) {
      const items: string[] = [];
      while (i < lines.length && lines[i].startsWith('- ')) { items.push(`<li>${inline(lines[i].slice(2))}</li>`); i++; }
      i--;
      out.push(`<ul>${items.join('')}</ul>`);
      continue;
    }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  return out.join('\n');
}
