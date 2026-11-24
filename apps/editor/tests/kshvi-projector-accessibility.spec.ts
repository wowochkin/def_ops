import { test, expect } from 'playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';

let server: ViteDevServer;
const externalRequests: string[] = [];

test.beforeAll(async () => {
  server = await createServer({
    root: resolve('apps/editor'), configFile: resolve('apps/editor/vite.config.ts'),
    server: { host: '127.0.0.1', port: 4187, strictPort: true }, logLevel: 'error',
  });
  await server.listen();
});
test.afterAll(async () => { await server.close(); });
test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

test('панель и критическая команда доступны при 125 % и 1920×1080 без внешних запросов', async ({ page }) => {
  await page.route('**/*', async route => {
    const url = route.request().url();
    if (!url.startsWith('http://127.0.0.1:4187') && !url.startsWith('data:') && !url.startsWith('blob:')) externalRequests.push(url);
    await route.continue();
  });
  await page.goto('http://127.0.0.1:4187/tests/fixtures/kshvi-admin-preview.html');
  await expect(page.getByRole('heading', { name: 'Техническая эксплуатация' })).toBeVisible();
  await expect(page.getByText('Очередь событий превышает порог')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  await page.getByRole('button', { name: 'Открыть критическую команду' }).click();
  const dialog = page.getByRole('dialog', { name: 'Аварийная операция' });
  await expect(dialog).toBeVisible();
  await page.getByLabel('Введите ПОДТВЕРЖДАЮ').fill('ПОДТВЕРЖДАЮ');
  await page.getByRole('button', { name: 'Подтвердить операцию' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status', { name: undefined }).filter({ hasText: 'Команда подтверждена' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await expect(page.getByText('50 / 50')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(externalRequests).toEqual([]);
});
