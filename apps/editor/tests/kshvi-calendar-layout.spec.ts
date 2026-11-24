import { expect, test } from 'playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

test('календарь целиком помещается в окно приложения', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
    localStorage.setItem('def_ops.kshvi.section', 'library');
  });
  await page.goto(process.env.KSHVI_PREVIEW_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  if (await page.getByLabel('Имя пользователя').count()) {
    await page.getByLabel('Имя пользователя').fill('local-leader');
    await page.getByLabel('Пароль', { exact: true }).fill('local-kshvi');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Создать учение', exact: true }).click();
  await page.getByLabel('Начало', { exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Дата и время: Начало' });
  await expect(dialog).toBeVisible();
  const box = await dialog.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
});
