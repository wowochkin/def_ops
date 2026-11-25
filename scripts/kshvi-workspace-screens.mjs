import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';

const base = process.env.KSHVI_PREVIEW_URL ?? 'http://127.0.0.1:5173';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.on('response', response => { if (response.status() >= 500) errors.push(`${response.status()} ${response.url()}`); });
await mkdir('docs/img', { recursive: true });

async function shot(name) {
  await page.waitForTimeout(200);
  await page.screenshot({ path: `docs/img/${name}.jpg`, type: 'jpeg', quality: 88 });
  console.log(`Снимок: docs/img/${name}.jpg`);
}

try {
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
  await page.getByRole('button', { name: 'Создать учение', exact: true }).waitFor({ timeout: 15000 });
  await page.getByRole('button', { name: 'Создать учение', exact: true }).click();
  const exerciseTitle = `Учение для визуальной приёмки ${Date.now()}`;
  await page.getByLabel('Название учения').fill(exerciseTitle);
  await page.getByRole('button', { name: 'Сохранить на сервере', exact: true }).click();
  await page.getByRole('button', { name: `Продолжить подготовку ${exerciseTitle}`, exact: true }).click();
  await page.getByRole('heading', { name: 'Карта и погода исходной обстановки' }).waitFor();
  await page.getByLabel('Атлас района').locator('option').nth(1).waitFor({ state: 'attached' });
  await shot('modern-kshvi-preparation');

  await page.getByRole('button', { name: 'Зафиксировать среду и открыть карту', exact: true }).click();
  await page.locator('section[aria-label="Топографическая карта исходной обстановки"] canvas').first().waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  await shot('modern-kshvi-map');

  await page.getByRole('button', { name: 'Силы и МТО', exact: true }).click();
  await shot('modern-kshvi-forces');
  await page.getByRole('button', { name: 'Запуск', exact: true }).click();
  await shot('modern-kshvi-launch');

  await page.getByRole('button', { name: 'Условные знаки', exact: true }).click();
  await page.getByRole('heading', { name: 'Условные знаки', exact: true }).waitFor();
  await shot('modern-symbols');
  await page.getByRole('button', { name: 'По документам', exact: true }).click();
  await page.getByRole('button', { name: /01ПУ\.doc/ }).click();
  await page.getByRole('button', { name: 'Страница 1', exact: true }).click();
  await shot('modern-symbols-documents');

  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Ошибок страницы и ответов 5xx не обнаружено');
} finally {
  await browser.close();
}
