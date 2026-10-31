// Страница стенда для проверок: оконные команды Tauri заменены одноконным стендом, модель — настоящий процесс ядра.
export const EXPO_CFG = {
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

/** Новая страница с макетом Tauri; `calls` — журнал команд, `voice` — ответ голосовой службы (с задержкой `voiceMs`, при `firstOnly` — только первый). */
export async function expoPage(browser, { core, cfg = EXPO_CFG, viewport = { width: 1440, height: 900 }, reducedMotion = 'no-preference', calls = [], voice = 'unsupported', voiceMs = 0, firstOnly = false }) {
  const context = await browser.newContext({ viewport, reducedMotion });
  const page = await context.newPage();
  await page.exposeFunction('__expoNative', async (cmd, args) => {
    calls.push(cmd);
    if (cmd === 'expo_settings_read') return JSON.stringify(cfg);
    if (cmd === 'expo_monitors') return [{ id: 'one', name: 'Экран проверки', x: 0, y: 0, width: viewport.width, height: viewport.height, scale: 1 }];
    if (cmd === 'expo_stats_today') return { sessions: 0, finished: 0, failures: 0 };
    if (cmd.startsWith('expo_')) return null;
    if (cmd === 'list_models') throw Error('Модель отключена для проверки');
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
  let delay = voiceMs;
  await page.route('**/api/voice', async (route) => {
    if (delay) await new Promise((r) => setTimeout(r, delay));
    if (firstOnly) delay = 0;
    await route.fulfill({ json: { state: voice } });
  });
  return page;
}
