// Живая проверка выставочного каркаса и снимки для описания: EXPO_URL=http://localhost:5174 node scripts/expo-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.addInitScript(() =>
  localStorage.setItem(
    'def_ops.expo.settings',
    JSON.stringify({
      version: 1,
      autostart: false,
      aiMode: 'noai',
      input: 'mouse-keyboard',
      voiceInput: false,
      timer: { on: true, seconds: 30 },
      fronts: ['su_1bf', 'su_1uf'],
      idleSeconds: 90,
      resultSeconds: 20,
      volume: { voice: 0.8, ambient: 0.3, ambientOn: false },
      screens: { count: 1, order: [] },
      pin: '0000',
      maxReplacements: 2,
    }),
  ),
);
await page.routeWebSocket('ws://127.0.0.1:47645/**', (socket) => socket.close());
await page.route('**/api/voice', (route) => route.fulfill({ json: { state: 'unsupported' } }));
const url = process.env.EXPO_URL ?? 'http://localhost:5174';
mkdirSync('docs/img', { recursive: true });
await page.goto(`${url}/?expo=0`);
await page.getByRole('heading', { name: 'Примите командование' }).waitFor();
await page.screenshot({ path: 'docs/img/expo-attract.jpg', type: 'jpeg', quality: 85 });
await page.waitForTimeout(500);
await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
await page.getByRole('heading', { name: 'Выберите фронт' }).waitFor();
await page.screenshot({ path: 'docs/img/expo-welcome.jpg', type: 'jpeg', quality: 85 });
await page.getByRole('button', { name: /1-й Белорусский/ }).click();
await page.getByRole('button', { name: 'К решениям' }).click();
await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 15000 });
await page.screenshot({ path: 'docs/img/expo-turn.jpg', type: 'jpeg', quality: 85 });
await page.keyboard.press('Control+Alt+Shift+KeyO');
await page.getByLabel('ПИН', { exact: true }).fill('0000');
await page.getByRole('button', { name: 'Открыть меню' }).click();
await page.getByLabel('Время выбора, с').fill('45');
const timer = await page.getByRole('timer').innerText();
await page.waitForTimeout(1200);
if ((await page.getByRole('timer').innerText()) !== timer) throw Error('таймер не на паузе');
await page.screenshot({ path: 'docs/img/expo-operator.jpg', type: 'jpeg', quality: 85 });
await page.getByLabel('Перейти к фазе').selectOption('result');
await page.getByRole('heading', { name: 'Сеанс завершён' }).waitFor();
await page.screenshot({ path: 'docs/img/expo-result.jpg', type: 'jpeg', quality: 85 });
await page.keyboard.press('Control+Alt+Shift+KeyO');
await page.getByLabel('ПИН', { exact: true }).fill('0000');
await page.getByRole('button', { name: 'Открыть меню' }).click();
await page.getByRole('button', { name: 'Выйти в полный режим' }).click();
await page.getByRole('button', { name: 'Выставочный режим…' }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: 'Выставочный режим…' }).scrollIntoViewIfNeeded();
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(1000);
await page.screenshot({ path: 'docs/img/start-page-2.jpg', type: 'jpeg', quality: 85 });
console.log(JSON.stringify({ ok: true, errors }));
await browser.close();
if (errors.length) process.exitCode = 1;
