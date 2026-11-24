import { readFileSync } from 'node:fs';
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
    body: readFileSync('packages/tactical-symbols/data/fragments/doc-001/page-001.jpg'),
  }));
  const base = process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173';
  await page.goto(`${base}/`);
  await expect(page.getByRole('heading', { name: 'Условные знаки' })).toBeVisible({ timeout: 20_000 });
  await page.getByText('Пример на топооснове', { exact: true }).click();
  await expect(page.getByRole('img', { name: 'Пример на топооснове' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'История версий' })).toBeVisible();
  const source = page.getByRole('img', { name: 'Исходный фрагмент страницы' });
  await expect(source).toBeVisible();
  await expect.poll(() => source.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
  await expect(page.getByText('Модификаторы', { exact: true })).toBeVisible();
  await expect(page.getByText('Не предусмотрены', { exact: true })).toBeVisible();
  await page.evaluate(() => { document.body.style.zoom = '125%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.getByRole('button', { name: 'Вставить на карту' })).toBeDisabled();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  expect(fontRequests).toEqual([]);
  await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.modern-workspace')?.scrollTo(0, 0); });
  await page.screenshot({ path: 'docs/img/modern-symbols.jpg', type: 'jpeg', quality: 88, fullPage: false, animations: 'disabled' });
});


test('вариант тыла не содержит пояснительную цифру, а исходная надпись сохраняет начертание', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'symbols');
  });
  await page.route('**/api/kshvi/symbols/fragments/**', route => route.fulfill({
    status: 200,
    contentType: 'image/jpeg',
    body: readFileSync('packages/tactical-symbols/data/fragments/doc-001/page-001.jpg'),
  }));
  await page.goto(process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173');
  await page.getByRole('searchbox', { name: 'Поиск знака' }).fill('68.6');
  await page.getByRole('button', { name: /68\.6/ }).click();
  await expect(page.getByRole('heading', { name: /— тыла/ })).toBeVisible();
  const vector = page.locator('.symbol-preview > [role="img"]');
  await expect(vector).toBeVisible();
  expect(await vector.locator('svg').getAttribute('viewBox')).toBe('102.176 72.648 121.117 26.328');
  await page.getByLabel('Надпись 2мсд').fill('3тд');
  await expect(vector.locator('[data-inscription]')).toHaveText('3тд');
  await expect(vector.locator('[data-inscription]')).toHaveAttribute('font-weight', '700');
  await expect(vector.locator('[data-inscription]')).toHaveAttribute('font-style', 'italic');
  await page.getByLabel('Надпись 2мсд').fill('2мсд');
  await expect(vector.locator('[data-inscription]')).toHaveCount(0);
  await page.locator('.symbol-card-workspace').scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'docs/img/modern-symbols-variant.jpg', type: 'jpeg', quality: 90, animations: 'disabled' });
});
