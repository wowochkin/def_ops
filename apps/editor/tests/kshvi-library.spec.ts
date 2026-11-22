import { test, expect } from 'playwright/test';
import { resolve } from 'node:path';

const exercises = [{
  id: '6d87bf6c-eda5-4b4f-b3f2-93415b1600a1',
  title: 'Учение «Рубеж»',
  purpose: 'planned',
  scale: 'operational',
  state: 'IN_REVIEW',
  revision: 3,
  ownerId: 'Начальник штаба',
  startsAt: '2026-12-01T06:00:00.000Z',
  endsAt: '2026-12-03T18:00:00.000Z',
  readiness: 72,
  validation: 'WARNING',
  createdAt: '2026-11-10T08:00:00.000Z',
  updatedAt: '2026-11-20T08:00:00.000Z',
  archivedAt: null,
  lastSessionId: 'session-1',
}, {
  id: 'ee1f0cf0-5809-4e1e-bf58-c73af6110c5c',
  title: 'Штабная тренировка «Связь»',
  purpose: 'special',
  scale: 'tactical',
  state: 'APPROVED',
  revision: 2,
  ownerId: 'Руководитель учения',
  startsAt: '2026-12-10T07:00:00.000Z',
  endsAt: '2026-12-11T17:00:00.000Z',
  readiness: 100,
  validation: 'OK',
  createdAt: '2026-11-12T08:00:00.000Z',
  updatedAt: '2026-11-19T08:00:00.000Z',
  archivedAt: null,
  lastSessionId: null,
}];

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

test('библиотека КШВИ читается при 1440×900 и 125 %, служебный ключ карты не меняется', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('def_ops.app.mode', 'modern');
    localStorage.setItem('def_ops.modern.section', 'kshvi');
    localStorage.setItem('def_ops.kshvi.section', 'library');
    localStorage.setItem('def_ops.modern.weather.region', '{"bounds":[1,2,3,4]}');
  });
  await page.route('**/api/kshvi/auth/me', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      userId: 'author-1', activeRole: 'DIRECTOR', organizationId: 'org1',
      authorities: ['exercise:read', 'exercise:create', 'exercise:copy', 'exercise:archive'],
    }),
  }));
  await page.route('**/api/kshvi/exercises**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: exercises }),
  }));

  await page.goto(process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173/');
  await expect(page.getByRole('heading', { name: 'КШВИ', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Библиотека учений' })).toBeVisible();
  await expect(page.getByText('Учение «Рубеж»')).toBeVisible();
  await expect(page.getByText('Редакция 3')).toBeVisible();
  await expect(page.getByText('Есть предупреждения')).toBeVisible();
  for (const name of ['Библиотека', 'Подготовка', 'Проведение', 'Разбор', 'Архив']) {
    await expect(page.getByRole('button', { name, exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Администрирование' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Показ' })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('def_ops.modern.weather.region'))).toBe('{"bounds":[1,2,3,4]}');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect(page.locator('.modern-kshvi > .kshvi-heading')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(page.locator('.modern-kshvi > .kshvi-heading')).toHaveCSS('white-space', 'normal');
  expect(errors).toEqual([]);

  await page.screenshot({
    path: resolve('docs/img/modern-kshvi-library.jpg'),
    type: 'jpeg',
    quality: 88,
    fullPage: false,
  });

  await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
  await expect(page.getByText('Учение «Рубеж»')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
