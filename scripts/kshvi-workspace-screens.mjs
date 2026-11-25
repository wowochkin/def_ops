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
  const modernMode = page.getByRole('button', { name: 'Современный режим', exact: true });
  if (await modernMode.count()) await modernMode.click();
  const kshviSection = page.getByRole('button', { name: 'КШВИ', exact: true });
  if (await kshviSection.count()) await kshviSection.click();
  const username = page.getByLabel('Имя пользователя');
  if (await username.waitFor({ timeout: 5000 }).then(() => true).catch(() => false)) {
    await username.fill('local-leader');
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
  await shot('modern-kshvi-preparation');

  const sealEnvironment = page.getByRole('button', { name: 'Зафиксировать среду и открыть карту', exact: true });
  if (await sealEnvironment.count()) {
    await sealEnvironment.click();
    await page.locator('section[aria-label="Топографическая карта исходной обстановки"] canvas').first().waitFor({ timeout: 30000 });
    await page.waitForTimeout(1500);
    await shot('modern-kshvi-map');
  }

  await page.getByRole('button', { name: 'Силы и МТО', exact: true }).click();
  await page.getByRole('button', { name: 'Добавить силу', exact: true }).click();
  await page.getByLabel('Название подразделения').fill('1-я бригада');
  await page.getByLabel('Сторона силы').fill('blue');
  await page.getByLabel('Инстанция силы').fill('hq-blue');
  await page.getByLabel('Личный состав').fill('820');
  await page.getByLabel('Боевая задача').fill('Занять рубеж');
  await page.getByRole('button', { name: 'Применить данные силы', exact: true }).click();
  await shot('modern-kshvi-forces');

  await page.getByRole('button', { name: 'События', exact: true }).click();
  await page.getByText(/шаблонов · показано/).waitFor({ timeout: 30000 });
  await shot('modern-kshvi-autonomy');

  await page.getByRole('button', { name: 'Готовность', exact: true }).click();
  await page.getByRole('heading', { name: 'Сценарная боевая готовность сил' }).waitFor();
  await shot('modern-kshvi-readiness');

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
