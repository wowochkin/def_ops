import { test, expect } from 'playwright/test';
import { resolve } from 'node:path';

test.use({ viewport: { width: 1440, height: 900 } });

test('рабочее место реплея синхронизирует панели при 1440×900 и 125 %', async ({ page }) => {
  const errors: string[] = [];
  await page.addInitScript(() => { (window as unknown as { __replayErrors: string[] }).__replayErrors = []; });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173'}/src/modern/kshvi/replay/index.html`);
  await expect(page.getByRole('heading', { name: 'Синхронизированный реплей' })).toBeVisible();
  await expect(page.getByTestId('replay-panel')).toHaveCount(22);
  await page.getByLabel('Позиция реплея').fill('3');
  await expect(page.getByTestId('replay-panel').first()).toHaveAttribute('data-sequence', '3');
  await page.screenshot({ path: resolve('docs/img/modern-kshvi-replay.jpg'), type: 'jpeg', quality: 88, fullPage: false });
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
