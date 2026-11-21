import { test, expect } from 'playwright/test';
import { resolve } from 'node:path';

const baseUrl = process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173';
const previewUrl = `${baseUrl}/src/modern/kshvi/conduct/preview.html`;

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

test('рабочие места читаются при 1440×900 и 125 %, без внешних запросов', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url());
  });
  await page.goto(previewUrl);
  const roles = [
    ['Обучаемый', 'trainee'], ['Руководитель', 'leader'], ['Группа розыгрыша', 'playgroup'],
    ['Посредник', 'intermediary'], ['Аналитик', 'analyst'],
  ] as const;
  for (const [role, id] of roles) {
    await page.getByRole('button', { name: role, exact: true }).click();
    await expect(page.locator('.kshvi-conduct-workspace')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(`docs/release/kshvi/evidence/kshvi-${id}-1440.jpg`), type: 'jpeg', quality: 88, fullPage: false });
    await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('проектор требует аудиторию и помещается в 1920×1080', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(previewUrl);
  await page.getByRole('button', { name: 'Проектор', exact: true }).click();
  await expect(page.getByText('Аудитория не выбрана')).toBeVisible();
  await page.getByLabel('Профиль аудитории').selectOption('PUBLIC_FINAL');
  await page.getByRole('button', { name: 'Вывести на проектор' }).click();
  await expect(page.getByText('Публичный итог этапа')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve('docs/release/kshvi/evidence/kshvi-projector-1920.jpg'), type: 'jpeg', quality: 88, fullPage: false });
});
