/** Текст из загруженного файла: PDF (pdf.js), Word .docx (mammoth), HTML, txt, md. */
export async function fileText(file: File): Promise<string> {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    const pdfjs = await import('pdfjs-dist');
    const worker = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default;
    pdfjs.GlobalWorkerOptions.workerSrc = worker;
    const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const c = await (await doc.getPage(i)).getTextContent();
      // строки: элементы с переводом строки (hasEOL) — абзацы восстанавливаются по пустым строкам
      pages.push(c.items.map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : '') : '')).join('').replace(/\n{3,}/g, '\n\n'));
    }
    return pages.join('\n\n');
  }
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
