import { test, expect } from 'playwright/test';

test.use({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark', locale: 'ru-RU' });

test('AC-28 UI: browser entry управляет показом и выводит только аудиторную проекцию 1920×1080', async ({ page }) => {
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) && !['data:', 'blob:'].includes(url.protocol)) externalRequests.push(request.url());
  });

  const base = process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173';
  await page.goto(`${base}/src/modern/kshvi/exposition/index.html`);
  await expect(page.getByRole('heading', { name: 'Демонстрация «Рубеж»', level: 1 })).toBeVisible();
  await expect(page.getByText('Экспозиция', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('Архивный показ', { exact: true })).toBeVisible();
  await expect(page.getByText('Погода: Пасмурно, видимость 8 км')).toBeVisible();
  await expect(page.getByText('Местность: Лес и рубеж высоты')).toBeVisible();
  await expect(page.getByText('МТО: Склад и маршрут подвоза')).toBeVisible();
  await expect(page.getByText('Батальон', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /официальн.*оцен|оцен.*обучаем/i })).toHaveCount(0);

  await page.getByRole('button', { name: 'Запустить показ' }).click();
  await expect(page.getByRole('button', { name: 'Приостановить показ' })).toBeVisible();
  await page.getByRole('button', { name: 'Приостановить показ' }).click();
  await page.getByRole('button', { name: 'Ускорить ×2' }).click();
  await expect(page.getByText('Темп: 2×', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Развитие действий' }).click();
  await expect(page.getByText('Текущая глава: Развитие действий', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Открыть решение' }).click();
  await expect(page.getByText('Закрытое обоснование решения')).toBeVisible();
  await page.getByRole('button', { name: 'Предпросмотр аудитории' }).click();
  await expect(page.getByText('Закрытое обоснование решения')).toHaveCount(0);
  await expect(page.getByText('Служебный замысел ведущего')).toHaveCount(0);
  await expect(page.getByText('Проекторный профиль: browser-projector', { exact: true })).toBeVisible();
  await expect(page.getByText('Пояснение для аудитории', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);
  await expect(page).toHaveScreenshot('exposition-projector-1920x1080.png', { fullPage: true, animations: 'disabled' });
});
