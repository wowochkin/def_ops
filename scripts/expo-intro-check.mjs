// Проверка интро в браузере и снимки 1440×900: EXPO_URL=http://localhost:5173 node scripts/expo-intro-check.mjs
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';

const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const core = agentsProcess();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, intro: true } });
// Правки в соседних окнах разработки не должны перезапускать проверяемый сеанс через HMR.
await page.routeWebSocket(`ws://${new URL(url).host}/**`, (socket) => socket.close());
const errors = [];
page.on('pageerror', (error) => errors.push(String(error)));
const phase = () => page.locator('.expo').getAttribute('data-phase');
const shot = async (name) => {
  if (process.argv.includes('--no-shots')) return;
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `docs/img/${name}.jpg`, type: 'jpeg', quality: 85 });
};
const lens = async (value) => page.evaluate((detail) => dispatchEvent(new CustomEvent('expo-lens', { detail })), value);

try {
  // Отсутствие записей должно дать полный визуальный цикл, без живого синтеза.
  await page.route('**/expo-voice/**', (route) => route.fulfill({ status: 404, body: '' }));
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120_000 });
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.locator('.expo[data-phase="intro"]').waitFor();
  await page.locator('.expo-intro3d canvas').waitFor();
  await page.waitForTimeout(13_000);
  assert.equal(await phase(), 'intro');
  assert.equal(await page.locator('.expo-header').count(), 0);
  assert.equal(await page.locator('.expo-footer').count(), 0);
  assert.equal(await page.locator('.expo-intro3d iframe, .expo-intro3d video').count(), 0);
  await page.getByText('info@profdailog.ru', { exact: true }).click();
  assert.equal(await phase(), 'intro');
  mkdirSync('docs/img', { recursive: true });
  await shot('expo-intro');
  for (const [window, pane] of [[0, 'factors'], [2, 'swarm']]) {
    await lens({ count: 3, window });
    await page.locator(`.expo-intro3d-${pane} canvas`).waitFor();
    await page.waitForTimeout(600);
    assert.equal(await page.getByRole('button', { name: 'Пропустить' }).count(), 0);
    assert.equal(await page.locator('.expo-intro3d-line').count(), 0);
    await shot(`expo-intro-${pane}`);
  }
  await lens(null);
  await page.getByRole('button', { name: 'Пропустить' }).click();
  await page.getByRole('heading', { name: 'Выберите фронт' }).waitFor();
  assert.equal(await page.locator('.expo-intro3d').count(), 0);
  console.log('ok интро: сцены, подписи, кнопка центра, выход и уничтожение холста');

  // Без клипов выход происходит сам по общим часам режиссёра.
  await page.getByRole('button', { name: 'На заставку' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.locator('.expo[data-phase="intro"]').waitFor();
  await page.getByRole('heading', { name: 'Выберите фронт' }).waitFor({ timeout: 190_000 });
  console.log('ok интро без записей: автоматический переход к выбору фронта');

  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('tab', { name: 'Звук' }).click();
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.textContent === 'Звук');
  await page.waitForTimeout(350); // Дождаться смены подчёркивания вкладки перед снимком.
  assert.equal(await page.getByRole('checkbox', { name: 'Интро сеанса', exact: true }).isChecked(), true);
  await shot('expo-operator-intro');
  await page.getByRole('checkbox', { name: 'Интро сеанса', exact: true }).click();
  // Настройка приходит обратно после асинхронной записи в хранилище приложения.
  await page.waitForFunction(() => ![...document.querySelectorAll('.expo-check')].find((label) => label.textContent?.trim() === 'Интро сеанса')?.querySelector('input')?.checked);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'На заставку' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.getByRole('heading', { name: 'Выберите фронт' }).waitFor();
  assert.equal(await page.locator('.expo-intro3d').count(), 0);
  console.log('ok выключатель: следующий сеанс сразу открывает выбор фронта');
  assert.deepEqual(errors, []);
} catch (error) {
  if (errors.length) console.error(errors);
  await page.screenshot({ path: '/tmp/expo-intro-check-fail.jpg', type: 'jpeg' }).catch(() => {});
  throw error;
} finally {
  await browser.close();
  core.stop();
}
