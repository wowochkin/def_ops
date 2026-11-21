import { test, expect } from 'playwright/test';
import { resolve } from 'node:path';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

test('подготовка автономии и перехват посредника читаются при 1440×900 и 125 %', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
    localStorage.setItem('def_ops.kshvi.section', 'preparation');
  });
  await page.route('**/api/kshvi/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: 'u1', organizationId: 'org1', activeRole: 'TRAINEE', authorities: ['exercise:read'] }) }));
  await page.route('**/api/kshvi/exercises**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
  await page.goto(process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173/');
  await expect(page.getByText('240 событий · 12 категорий · 48 операций')).toBeVisible();
  await page.getByLabel('Интенсивность разведки').fill('0');
  await expect(page.getByText('Вероятностные события разведки отключены; плановые и реактивные сохранены')).toBeVisible();
  await page.getByText('Вероятностные события разведки отключены; плановые и реактивные сохранены').scrollIntoViewIfNeeded();
  await page.screenshot({ path: resolve('docs/img/modern-kshvi-autonomy.jpg'), type: 'jpeg', quality: 88, fullPage: false });
  await page.getByRole('button', { name: 'Проведение' }).click();
  await expect(page.getByText('DELEGATED')).toBeVisible();
  await page.getByRole('button', { name: 'Перехватить управление' }).click();
  await expect(page.getByText('Мир не откатывается; дальнейшие действия подписывает человек')).toBeVisible();
  await page.screenshot({ path: resolve('docs/img/modern-kshvi-agent.jpg'), type: 'jpeg', quality: 88, fullPage: false });
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
