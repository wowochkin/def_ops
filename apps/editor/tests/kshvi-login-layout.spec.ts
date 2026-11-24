import { expect, test } from 'playwright/test';

test('кнопка входа не касается и не перекрывает поле пароля', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
  });
  await page.goto(process.env.KSHVI_PREVIEW_URL ?? 'http://127.0.0.1:5173', { waitUntil: 'networkidle' });
  const password = page.getByLabel('Пароль', { exact: true });
  const button = page.getByRole('button', { name: 'Войти', exact: true });
  await expect(password).toBeVisible();
  const fieldBox = await password.boundingBox();
  const buttonBox = await button.boundingBox();
  expect(fieldBox).not.toBeNull();
  expect(buttonBox).not.toBeNull();
  expect(buttonBox!.y).toBeGreaterThanOrEqual(fieldBox!.y + fieldBox!.height + 12);
});
