import { test, expect } from 'playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'ru-RU' });

test('справочник читается при 125 % и не запрашивает внешние ресурсы или TTF', async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  const fontRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) externalRequests.push(request.url());
    if (/\.ttf(?:$|\?)/i.test(url.pathname)) fontRequests.push(request.url());
  });
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'symbols');
  });
  await page.route('**/api/kshvi/symbols/fragments/**', route => route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    body: Buffer.from('/9j/2Q==', 'base64'),
  }));
  const base = process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173';
  await page.goto(`${base}/`);
  await expect(page.getByRole('heading', { name: 'Условные знаки' })).toBeVisible();
  await expect(page.getByRole('img', { name: 'Пример на топооснове' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История версий' })).toBeVisible();
  await page.getByLabel('main').check();
  await expect(page.locator('[role="img"][aria-label="Векторный образец знака"] [data-modifier="main"]')).toHaveCount(1);
  await page.evaluate(() => { document.body.style.zoom = '125%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Вставить на карту' })).toBeDisabled();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(fontRequests).toEqual([]);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: 'docs/img/modern-symbols.jpg', type: 'jpeg', quality: 88, fullPage: false, animations: 'disabled' });
});
