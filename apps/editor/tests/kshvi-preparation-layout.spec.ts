import { expect, test } from 'playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });

test('кнопки навигации мастера закреплены по краям общей рамки', async ({ page }) => {
  await page.goto(`${process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173'}/tests/helpers/preparation-preview.html`);
  await page.getByRole('button', { name: 'Силы и МТО', exact: true }).click();
  const workspace = await page.locator('.kshvi-preparation-workspace').boundingBox();
  const back = await page.getByRole('button', { name: 'Назад', exact: true }).boundingBox();
  const next = await page.getByRole('button', { name: 'Далее', exact: true }).boundingBox();
  expect(workspace).not.toBeNull(); expect(back).not.toBeNull(); expect(next).not.toBeNull();
  expect(back!.x).toBeLessThan(workspace!.x + 40);
  expect(next!.x + next!.width).toBeGreaterThan(workspace!.x + workspace!.width - 40);
  expect(back!.width).toBe(next!.width);
  expect(back!.height).toBe(next!.height);
});
