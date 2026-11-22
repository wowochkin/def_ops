import { test, expect } from 'playwright/test';
import { createServer, type ViteDevServer } from 'vite';
import { resolve } from 'node:path';

let server: ViteDevServer;
const origin = 'http://127.0.0.1:4191';

test.beforeAll(async () => {
  server = await createServer({ root: resolve('apps/editor'), configFile: resolve('apps/editor/vite.config.ts'), server: { host: '127.0.0.1', port: 4191, strictPort: true }, logLevel: 'error' });
  await server.listen();
});
test.afterAll(async () => { await server.close(); });
test.setTimeout(60_000);

test.use({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });

test('1440×900, 125 % и 1920×1080: клавиатура, статусы и длинная панель', async ({ page }) => {
      const externalRequests: string[] = [];
      await page.route('**/*', async route => {
        const url = route.request().url();
        if (!url.startsWith(origin) && !url.startsWith('data:') && !url.startsWith('blob:')) externalRequests.push(url);
        await route.continue();
      });
      await page.goto(`${origin}/tests/fixtures/kshvi-quality-workspace.html`);
      await expect(page.getByRole('heading', { name: 'Техническая эксплуатация' })).toBeVisible();
      await expect(page.getByText('Техническое уведомление 40')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      const open = page.getByRole('button', { name: 'Открыть критическую команду' });
      await open.focus();
      await page.keyboard.press('Enter');
      const dialog = page.getByRole('dialog', { name: 'Аварийная операция' });
      await expect(dialog).toBeVisible();
      await page.getByLabel('Введите ПОДТВЕРЖДАЮ').fill('ПОДТВЕРЖДАЮ');
      await page.getByRole('button', { name: 'Подтвердить операцию' }).focus();
      await page.keyboard.press('Enter');
      await expect(page.getByRole('status').filter({ hasText: 'Команда подтверждена' })).toBeVisible();

      await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
      await open.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      const bounds = await dialog.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(900);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
      await expect(open).toBeFocused();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
      await page.setViewportSize({ width: 1920, height: 1080 });
      await open.focus();
      await page.keyboard.press('Enter');
      await expect(dialog).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(page.getByText('50 / 50')).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      expect(externalRequests).toEqual([]);
});
