import { chromium } from 'playwright';

const base = process.env.ATLAS_PREVIEW_URL ?? 'http://127.0.0.1:15173';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'atlas');
    localStorage.removeItem('def_ops.modern.atlas.regionStates');
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  const region = page.locator('.atlas-region').filter({ hasText: 'Харьков' }).first();
  await region.locator(':scope > summary').click();
  await region.getByRole('button', { name: 'Открыть область', exact: true }).click();
  await page.locator('.atlas-viewport canvas').first().waitFor({ timeout: 15000 });
  await page.waitForLoadState('networkidle');
  await page.screenshot({ path: 'docs/img/modern-atlas-area-name.jpg', type: 'jpeg', quality: 88 });
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Снимок обновлён: docs/img/modern-atlas-area-name.jpg');
} finally {
  await browser.close();
}
