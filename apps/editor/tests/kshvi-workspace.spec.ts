import { test, expect } from 'playwright/test';

const base = process.env.KSHVI_PREVIEW_URL ?? 'http://127.0.0.1:5173';

async function openModern(page: import('playwright/test').Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
    localStorage.setItem('def_ops.kshvi.section', 'library');
  });
  await page.goto(base, { waitUntil: 'networkidle' });
  if (await page.getByLabel('Имя пользователя').count()) {
    await page.getByLabel('Имя пользователя').fill('local-leader');
    await page.getByLabel('Пароль', { exact: true }).fill('local-kshvi');
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
  }
  await page.getByRole('button', { name: 'Создать учение', exact: true }).waitFor();
}

test('мастер ведёт от среды до запуска, а справочник открывает исходную страницу', async ({ page }) => {
  test.setTimeout(60_000);
  await openModern(page);
  const title = `Сквозная проверка ${Date.now()}`;
  await page.getByRole('button', { name: 'Создать учение', exact: true }).click();
  await page.getByLabel('Название учения').fill(title);
  await page.getByRole('button', { name: 'Сохранить на сервере', exact: true }).click();
  await page.getByRole('button', { name: `Рабочий цикл ${title}`, exact: true }).click();
  await page.getByLabel('Атлас района').locator('option').nth(1).waitFor({ state: 'attached' });
  await expect(page.getByRole('heading', { name: 'Материально-техническое обеспечение' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Материально-техническое обеспечение' })).toBeVisible();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Библиотека событий' })).toBeVisible();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Этап обеспечения боевой готовности' })).toBeVisible();
  await page.getByRole('button', { name: 'Далее', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Запустить официальный сеанс' })).toBeDisabled();

  await page.getByRole('button', { name: 'Условные знаки', exact: true }).click();
  await page.getByRole('button', { name: 'По документам', exact: true }).click();
  await page.getByRole('button', { name: /01ПУ\.doc/ }).click();
  await page.getByRole('button', { name: 'Страница 1', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Исходная страница 1 документа 01ПУ.doc' })).toBeVisible();
});
