// PDF из Markdown: node scripts/gen-model-pdf.mjs [docs/simulation-model.md] [docs/simulation-model.pdf] (описание системы — docs/system.md docs/system.pdf)
// Картинки — пути относительно файла Markdown (docs/img/…). Нужны pandoc (Markdown → HTML) и браузер Playwright (CHROMIUM_PATH — свой путь к Chrome).
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const src = resolve(process.argv[2] || 'docs/simulation-model.md');
const out = resolve(process.argv[3] || 'docs/simulation-model.pdf');
const md = readFileSync(src, 'utf8');
const title = /^#\s+(.+)$/m.exec(md)?.[1] ?? 'Документ';
const body = execFileSync('pandoc', ['--from', 'gfm', '--to', 'html5'], { input: md, encoding: 'utf8' });
const css = `
@page { size: A4; margin: 18mm 17mm 18mm 19mm; }
html { font-family: 'PT Serif', 'Liberation Serif', 'DejaVu Serif', Georgia, serif; font-size: 10.5pt; line-height: 1.45; color: #1d1d1b; }
body { margin: 0; }
h1 { font-family: 'PT Sans', 'Liberation Sans', 'DejaVu Sans', sans-serif; font-size: 21pt; line-height: 1.15; margin: 0 0 6pt; color: #7a1b16; }
h2 { font-family: 'PT Sans', 'Liberation Sans', 'DejaVu Sans', sans-serif; font-size: 14pt; margin: 20pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.2pt solid #7a1b16; break-after: avoid; }
h3 { font-family: 'PT Sans', 'Liberation Sans', 'DejaVu Sans', sans-serif; font-size: 11.5pt; margin: 14pt 0 4pt; break-after: avoid; }
h2:first-of-type { break-before: auto; }
p, li { orphans: 3; widows: 3; }
ul, ol { padding-left: 16pt; }
li { margin: 2pt 0; }
table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.8pt; line-height: 1.3; break-inside: auto; }
thead { display: table-header-group; }
tr { break-inside: avoid; }
th, td { border: 0.5pt solid #b9b4a8; padding: 3pt 5pt; vertical-align: top; text-align: left; }
th { background: #efe9dc; font-family: 'PT Sans', 'Liberation Sans', 'DejaVu Sans', sans-serif; font-weight: 700; }
tr:nth-child(even) td { background: #faf8f3; }
code { font-family: 'DejaVu Sans Mono', 'Liberation Mono', monospace; font-size: 8.4pt; background: #f2eee5; padding: 0 2pt; border-radius: 2pt; }
pre { background: #f5f2ea; border-left: 2.5pt solid #7a1b16; padding: 6pt 9pt; font-size: 8.2pt; line-height: 1.35; white-space: pre; overflow: hidden; break-inside: avoid; }
pre code { background: none; padding: 0; font-size: inherit; }
hr { border: 0; border-top: 0.6pt solid #b9b4a8; margin: 14pt 0; }
a { color: #7a1b16; text-decoration: none; }
strong { color: #111; }
img { display: block; max-width: 100%; max-height: 120mm; margin: 6pt auto 2pt; border: 0.5pt solid #b9b4a8; break-inside: avoid; }
p:has(> img) { margin: 8pt 0 0; break-inside: avoid; break-after: avoid; }
p:has(> img) + p > em:only-child { display: block; text-align: center; font-size: 8.8pt; color: #555; margin-bottom: 10pt; }
`;
const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><base href="${pathToFileURL(dirname(src)).href}/"><title>${title}</title><style>${css}</style></head><body>${body}</body></html>`;
const dir = mkdtempSync(join(tmpdir(), 'model-pdf-'));
const file = join(dir, 'doc.html');
writeFileSync(file, html);
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.goto('file://' + file, { waitUntil: 'load' });
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: out, format: 'A4', printBackground: true, preferCSSPageSize: true,
  displayHeaderFooter: true, headerTemplate: '<div></div>',
  footerTemplate: `<div style="font: 7.5px 'DejaVu Sans', sans-serif; color: #888; width: 100%; padding: 0 17mm 0 19mm; display: flex; justify-content: space-between;"><span>${title.replace(/</g, '&lt;')}</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>`,
});
await browser.close();
console.log(`PDF: ${out}`);
