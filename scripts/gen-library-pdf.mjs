// PDF-справочник библиотеки знаков: node scripts/gen-library-pdf.mjs [адрес редактора] [файл]
// По умолчанию — запущенный редактор (npm run dev) и docs/library.pdf.
// Если Playwright не находит браузер, укажите путь: CHROMIUM_PATH=/путь/к/chrome
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://localhost:5173';
const out = process.argv[3] || 'docs/library.pdf';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage();
await page.goto(`${base.replace(/\/$/, '')}/library.html?print=1`);
await page.waitForSelector('body[data-ready]');
await page.waitForTimeout(500);
await page.emulateMedia({ media: 'print' });
await page.pdf({
  path: out,
  format: 'A4',
  printBackground: true,
  margin: { top: '14mm', bottom: '16mm', left: '12mm', right: '12mm' },
  displayHeaderFooter: true,
  headerTemplate: '<div></div>',
  footerTemplate: '<div style="font: 8px sans-serif; color: #888; width: 100%; padding: 0 12mm; display: flex; justify-content: space-between;"><span>Библиотека условных знаков</span><span><span class="pageNumber"></span> / <span class="totalPages"></span></span></div>',
});
await browser.close();
console.log(`PDF: ${out}`);
