// Живая проверка выставочного каркаса и снимки для описания: EXPO_URL=http://localhost:5174 node scripts/expo-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const browser = await chromium.launch();
// Модель — настоящий процесс ядра (как в expo-core-check.mjs): без него перелом и итог остаются без карточек и карты.
const core = agentsProcess();
const page = await expoPage(browser, { core, reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
const url = process.env.EXPO_URL ?? 'http://localhost:5174';
const shot = async (name) => {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: `docs/img/${name}.jpg`, type: 'jpeg', quality: 85 });
};
mkdirSync('docs/img', { recursive: true });
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('heading', { name: 'Примите командование' }).waitFor();
  await shot('expo-attract');
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.getByRole('heading', { name: 'Выберите фронт' }).waitFor();
  await shot('expo-welcome');
  await page.getByRole('button', { name: /1-й Белорусский/ }).click();
  await page.getByRole('img', { name: 'Обстановка к 16 апреля 1945' }).waitFor();
  await shot('expo-briefing');
  await page.getByRole('button', { name: 'К решениям' }).click();
  await page.locator('.expo-card-main strong').first().filter({ hasNotText: 'Карточка готовится' }).waitFor({ timeout: 30000 });
  // подсвечена первая карточка с распоряжениями — её стрелки на карте
  let lit = 0;
  for (; lit < 2; lit++) {
    await page.locator('.expo-card').nth(lit).hover();
    if (await page.locator('.expo-arrows path').count()) break;
  }
  await page.waitForTimeout(300);
  await shot('expo-turn');
  await page.getByRole('button', { name: `Подробнее о карточке ${lit + 1}` }).click();
  await shot('expo-turn-open');
  await page.getByRole('button', { name: `Выбрать вариант ${lit + 1}` }).click();
  await page.getByText(/Именно так поступил|решил иначе/).waitFor({ timeout: 60000 });
  await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 90000 });
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Время выбора, с: больше' }).click();
  const timer = await page.getByRole('timer').innerText();
  await page.waitForTimeout(1200);
  if ((await page.getByRole('timer').innerText()) !== timer) throw Error('таймер не на паузе');
  await shot('expo-operator');
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  for (const n of [2, 3]) {
    await page.getByRole('button', { name: 'Карточка 1', exact: true }).click();
    if (n === 2)
      await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 90000 });
  }
  // прокрутку, итог и ответ ИИ снимает expo-core-check.mjs; здесь — что итог с картой собирается
  await page.getByRole('img', { name: /Ваш путь армий/ }).waitFor({ timeout: 120000 });
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.getByRole('button', { name: 'Выйти в полный режим' }).click();
  await page.getByRole('button', { name: 'Выставочный режим…' }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: 'Выставочный режим…' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await shot('start-page-2');
  console.log(JSON.stringify({ ok: true, errors }));
} catch (e) {
  await page.screenshot({ path: '/tmp/expo-shots-fail.jpg', type: 'jpeg', quality: 70 }).catch(() => {});
  throw e;
} finally {
  await browser.close();
  core.stop();
}
if (errors.length) process.exitCode = 1;
