import { test, expect } from 'playwright/test';
import { resolve } from 'node:path';
import { kshviProjection } from './kshvi-fixtures';

const baseUrl = process.env.KSHVI_BASE_URL ?? 'http://127.0.0.1:5173';
const previewUrl = `${baseUrl}/src/modern/kshvi/conduct/preview.html`;

test.use({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: 'dark' });

async function mockConductApi(page: import('playwright').Page) {
  await page.route('**/api/kshvi/instances/*/projection?*', async route => {
    const url = new URL(route.request().url());
    const role = url.searchParams.get('role') ?? 'TRAINEE';
    const audience = url.searchParams.get('audience');
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(kshviProjection({ role, ...(audience ? { projectorTitle: 'Публичный итог этапа' } : {}) })) });
  });
  await page.route('**/api/kshvi/instances/*/audience-check', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ allowed: true, reason: 'Проверено сервером' }) }));
  await page.route('**/api/kshvi/instances/*/commands', async route => {
    const body = route.request().postDataJSON() as { type?: string; payload?: { objectIds?: string[]; orderId?: string } };
    const ids = body.payload?.objectIds ?? [];
    const results = ids.map(objectId => ({
      objectId,
      status: body.type === 'inputs.preview' ? objectId === 'input-3' ? 'APPROVAL_REQUIRED' : 'ALLOWED' : objectId === 'input-3' ? 'REJECTED' : 'APPLIED',
      message: body.type === 'inputs.preview' ? objectId === 'input-3' ? 'Требуется утверждение' : 'Допустимо' : objectId === 'input-3' ? 'Вне делегирования' : 'Серверная ревизия 4',
    }));
    if (body.type === 'inputs.preview' || body.type === 'inputs.apply') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(results) });
    if (body.type === 'order.cancel') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...kshviProjection().order, id: body.payload?.orderId, status: 'CANCELLED_AFTER_RECEIPT' }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ eventId: 'event-server', revision: 1, idempotent: false }) });
  });
}

test('рабочие места загружают проекции и команды при 1440×900 и 125 %, без внешних запросов', async ({ page }) => {
  const errors: string[] = [];
  const external: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) external.push(request.url());
  });
  await mockConductApi(page);
  await page.goto(previewUrl);
  const roles = [
    ['Обучаемый', 'trainee'], ['Руководитель', 'leader'], ['Группа розыгрыша', 'playgroup'], ['Посредник', 'intermediary'], ['Аналитик', 'analyst'],
  ] as const;
  for (const [role, id] of roles) {
    await page.getByRole('button', { name: role, exact: true }).click();
    await expect(page.locator('.kshvi-conduct-workspace')).toBeVisible();
    if (id === 'playgroup') {
      await page.getByLabel('Единое обоснование').fill('Плановая вводная G2');
      await page.getByRole('button', { name: 'Предварительная проверка' }).click();
      await expect(page.getByText('input-1: Допустимо')).toBeVisible();
      await page.getByRole('button', { name: 'Применить выбранное' }).click();
      await expect(page.getByText('input-1: Серверная ревизия 4')).toBeVisible();
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: resolve(`docs/release/kshvi/evidence/kshvi-${id}-1440.jpg`), type: 'jpeg', quality: 88, fullPage: false });
    await page.evaluate(() => { document.documentElement.style.zoom = '1.25'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
  }
  expect(errors).toEqual([]);
  expect(external).toEqual([]);
});

test('проектор получает аудиторную проекцию и помещается в 1920×1080', async ({ page }) => {
  await mockConductApi(page);
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto(previewUrl);
  await page.getByRole('button', { name: 'Проектор', exact: true }).click();
  await expect(page.getByText('Аудитория не выбрана')).toBeVisible();
  await page.getByLabel('Профиль аудитории').selectOption('PUBLIC_FINAL');
  await page.getByRole('button', { name: 'Вывести на проектор' }).click();
  await expect(page.getByText('Публичный итог этапа')).toBeVisible();
  await expect(page.getByText(/Проверка видимости: Проверено сервером/)).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve('docs/release/kshvi/evidence/kshvi-projector-1920.jpg'), type: 'jpeg', quality: 88, fullPage: false });
});
