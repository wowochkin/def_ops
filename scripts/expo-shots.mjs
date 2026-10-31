// Живая проверка выставочного каркаса и снимки для описания: EXPO_URL=http://localhost:5174 node scripts/expo-shots.mjs
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { agentsProcess } from './agents-bridge.mjs';
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
// Модель — настоящий процесс ядра (как в expo-core-check.mjs): без него перелом и итог остаются без карточек и карты.
const core = agentsProcess();
const cfg = {
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
    };
await page.exposeFunction('__expoNative', async (cmd, args) => {
  if (cmd === 'expo_settings_read') return JSON.stringify(cfg);
  if (cmd === 'expo_monitors') return [{ id: 'one', name: 'Экран', x: 0, y: 0, width: 1440, height: 900, scale: 1 }];
  if (cmd === 'expo_stats_today') return { sessions: 0, finished: 0, failures: 0 };
  if (cmd.startsWith('expo_')) return null;
  if (cmd === 'list_models') throw Error('модель отключена для снимков');
  return core.call(cmd, args);
});
await page.addInitScript(() => {
  let n = 0;
  const listeners = new Map();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: (f) => {
      const id = ++n;
      window[`_${id}`] = f;
      return id;
    },
    invoke: async (cmd, args) => {
      if (cmd === 'plugin:event|listen') {
        const id = ++n;
        listeners.set(id, args);
        return id;
      }
      if (cmd === 'plugin:event|unlisten') return void listeners.delete(args.eventId);
      if (cmd === 'plugin:event|emit') {
        for (const [id, l] of listeners) if (l.event === args.event) window[`_${l.handler}`]?.({ event: args.event, id, payload: args.payload });
        return;
      }
      return window.__expoNative(cmd, args);
    },
  };
});
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
await page.getByRole('img', { name: 'Обстановка к 16 апреля 1945' }).waitFor();
await page.screenshot({ path: 'docs/img/expo-briefing.jpg', type: 'jpeg', quality: 85 });
await page.getByRole('button', { name: 'К решениям' }).click();
await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 15000 });
await page.getByRole('button', { name: 'Подробнее о карточке 2' }).click();
await page.screenshot({ path: 'docs/img/expo-turn.jpg', type: 'jpeg', quality: 85 });
await page.getByRole('button', { name: 'Карточка 2', exact: true }).click();
await page.getByText(/Именно так поступил|решил иначе/).waitFor({ timeout: 60000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'docs/img/expo-scroll.jpg', type: 'jpeg', quality: 85 });
await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 90000 });
await page.keyboard.press('Control+Alt+Shift+KeyO');
await page.getByLabel('ПИН', { exact: true }).fill('0000');
await page.getByRole('button', { name: 'Открыть меню' }).click();
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Время выбора, с: больше' }).click();
const timer = await page.getByRole('timer').innerText();
await page.waitForTimeout(1200);
if ((await page.getByRole('timer').innerText()) !== timer) throw Error('таймер не на паузе');
await page.screenshot({ path: 'docs/img/expo-operator.jpg', type: 'jpeg', quality: 85 });
await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
for (const n of [2, 3]) {
  await page.getByRole('button', { name: 'Карточка 1', exact: true }).click();
  if (n === 2) await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 90000 });
}
await page.locator('.expo-rank').waitFor({ timeout: 120000 });
await page.waitForTimeout(500);
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
core.stop();
if (errors.length) process.exitCode = 1;
