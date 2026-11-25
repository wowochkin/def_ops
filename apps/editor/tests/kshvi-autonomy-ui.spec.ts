import { test, expect } from 'playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

test('пустая подготовка и переход из проведения в библиотеку при масштабе 125 %', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    sessionStorage.setItem('def_ops.kshvi.csrf:/api/kshvi', 'test-session');
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
    localStorage.setItem('def_ops.kshvi.section', 'preparation');
  });
  await page.route('**/api/kshvi/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: 'u1', organizationId: 'org1', activeRole: 'TRAINEE', authorities: ['exercise:read'] }) }));
  await page.route('**/api/kshvi/exercises**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) }));
  await page.goto(process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173/');
  await expect(page.getByText('Откройте карточку учения из библиотеки.')).toBeVisible();
  await page.getByRole('button', { name: 'Проведение' }).click();
  await expect(page.getByRole('heading', { name: 'Активный сеанс не выбран' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Перехватить управление' })).toHaveCount(0);
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  await page.getByRole('button', { name: 'Открыть библиотеку' }).click();
  await expect(page.getByRole('heading', { name: 'Учения не найдены' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

// Проверка элементов формы на изолированной странице. Для перехода через рабочие вкладки нужен сеанс.
test('подготовка автономии и перехват посредника читаются при 1440×900 и 125 %', async ({ page }) => {
  const base = process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173';
  await page.goto(new URL('/tests/fixtures/autonomy-controls/index.html', base).href);
  await page.getByLabel('Интенсивность разведки').fill('0');
  await expect(page.getByText('Вероятностные события разведки отключены; плановые и реактивные сохранены')).toBeVisible();
  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  await page.getByRole('button', { name: 'Перехватить управление' }).click();
  await expect(page.getByText('Мир не откатывается; дальнейшие действия подписывает человек')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
