// Проверка каркаса с настоящим процессом Rust; оконные команды Tauri заменены одноконным стендом проверки.
// Сначала: cargo build --release -p agents-core --bin agents-game. Затем EXPO_URL=… node scripts/expo-core-check.mjs
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
const core = agentsProcess();
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const calls = [];
const cfg = {
  version: 1,
  autostart: false,
  aiMode: 'ai',
  input: 'touch',
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
  calls.push(cmd);
  if (cmd === 'expo_settings_read') return JSON.stringify(cfg);
  if (cmd === 'expo_monitors') return [{ id: 'one', name: 'Экран проверки', x: 0, y: 0, width: 1440, height: 900, scale: 1 }];
  if (cmd === 'expo_stats_today') return { sessions: 0, finished: 0, failures: 0 };
  if (cmd.startsWith('expo_')) return null;
  if (cmd === 'list_models') throw Error('Модель отключена для проверки резервного режима');
  try {
    return await core.call(cmd, args);
  } catch (e) {
    console.error(cmd, String(e));
    throw e;
  }
});
await page.addInitScript(() => {
  let n = 0;
  const listeners = new Map();
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
      if (cmd === 'plugin:event|unlisten') {
        listeners.delete(args.eventId);
        return;
      }
      if (cmd === 'plugin:event|emit') {
        for (const [id, l] of listeners)
          if (l.event === args.event) window[`_${l.handler}`]?.({ event: args.event, id, payload: args.payload });
        return;
      }
      return window.__expoNative(cmd, args);
    },
  };
});
await page.route('**/api/voice', async (route) => {
  await new Promise((r) => setTimeout(r, 1000));
  await route.fulfill({ json: { state: 'off' } });
});
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
try {
  await page.goto(`${process.env.EXPO_URL ?? 'http://localhost:5173'}/?expo=0`);
  await page.locator('.expo-startup').waitFor();
  await page.screenshot({ path: 'docs/img/expo-startup.jpg', type: 'jpeg', quality: 85 });
  await page.getByRole('heading', { name: 'Примите командование' }).waitFor({ timeout: 120000 });
  if (!calls.includes('game_start') || !calls.includes('game_stop')) throw Error('Нет пробного запуска ядра');
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Время выбора, с: больше' }).click();
  await page.waitForTimeout(200);
  if (await page.getByRole('alert').count()) throw Error(await page.getByRole('alert').innerText());
  if (!calls.includes('expo_settings_write')) throw Error('В резервном режиме не сохранились настройки');
  console.log(JSON.stringify({ ok: true, coreCalls: calls.filter((c) => !c.startsWith('expo')), errors }));
  if (errors.length) process.exitCode = 1;
} finally {
  await browser.close();
  core.stop();
}
