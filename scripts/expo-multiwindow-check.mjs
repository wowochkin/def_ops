// Интеграция трёх настоящих страниц ExpoRoot через общий макет Tauri.
// Это Chromium, не проверка Windows/DPI/физических телевизоров. Игра пользователя не используется.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { EXPO_CFG } from './expo-mock.mjs';

const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = resolve(process.env.EXPO_CHECK_OUT ?? '.superpowers/sdd/2026-11-07-expo-multiwindow');
await mkdir(out, { recursive: true });
const allMonitors = [
  { id: '\\\\.\\DISPLAY1', name: 'Монитор слева', x: -1920, y: 0, width: 1920, height: 1080, scale: 1 },
  { id: '\\\\.\\DISPLAY2', name: 'Монитор в центре', x: 0, y: 0, width: 2560, height: 1440, scale: 1.5 },
  { id: '\\\\.\\DISPLAY3', name: 'Монитор справа', x: 2560, y: -360, width: 3840, height: 2160, scale: 2 },
];
let monitors = structuredClone(allMonitors);
let configuration = {
  ...EXPO_CFG, intro: true, attractCall: { on: false, pause: 8 }, screens: { count: 3, order: [] },
  timer: { on: false, seconds: 30 }, idleSeconds: 600, generation: { comments: false, debrief: false },
};
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const pages = new Map();
const generations = new Map();
const events = [];
const commands = [];
const lifecycle = [];
const errors = [];
const checks = {};
let currentPlan = [];
let closing = false;
let latestFrame;
let droppingSidePresence = false;

const waitFor = async (predicate, label, timeout = 20000) => {
  const end = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() >= end) throw new Error(`Ожидание: ${label}`);
    await new Promise(r => setTimeout(r, 50));
  }
};
const brief = payload => {
  const m = payload?.m;
  if (!m) return payload;
  if (m.k === 'state') return { k: m.k, state: m.state, count: m.count, screens: m.settings.screens, pin: m.settings.pin };
  if (m.k === 'map') return { k: m.k, key: m.key };
  return m;
};
async function broadcast(event, payload, from = 'native') {
  const m = payload?.m;
  if (droppingSidePresence && (m?.k === 'hello' || m?.k === 'beat') && m.window === 2) {
    events.push({ at: Date.now(), from, event, payload: brief(payload), dropped: true });
    return;
  }
  events.push({ at: Date.now(), from, event, payload: brief(payload) });
  if (m?.k === 'state') latestFrame = m;
  await Promise.all([...pages.values()].map(page => page.isClosed() ? null : page.evaluate(({ event, payload }) => window.__expoDeliver?.(event, payload), { event, payload }).catch(error => {
    if (!page.isClosed() && !closing) errors.push({ kind: 'delivery', message: String(error) });
  })));
}

async function openPage(index) {
  if (pages.has(index)) return pages.get(index);
  const generation = (generations.get(index) ?? 0) + 1;
  generations.set(index, generation);
  const page = await context.newPage();
  pages.set(index, page);
  lifecycle.push({ at: Date.now(), event: 'open', index, generation });
  page.on('pageerror', error => errors.push({ index, generation, kind: 'pageerror', message: String(error) }));
  await page.exposeFunction('__expoNative', async (cmd, args = {}) => {
    commands.push({ at: Date.now(), index, generation, cmd, ...(cmd.startsWith('expo_') ? { args } : {}) });
    if (cmd === 'plugin:event|emit') return broadcast(args.event, args.payload, `${index}:${generation}`);
    if (cmd === 'expo_settings_read') return JSON.stringify(configuration);
    if (cmd === 'expo_settings_write') { configuration = JSON.parse(args.text); return null; }
    if (cmd === 'expo_monitors') return structuredClone(monitors);
    if (cmd === 'expo_stats_today') return { sessions: 0, finished: 0, failures: 0 };
    if (cmd === 'expo_focus_main') { await pages.get(0)?.bringToFront(); return null; }
    if (cmd === 'expo_open') {
      currentPlan = structuredClone(args.windows);
      const wanted = new Set(currentPlan.map(slot => slot.index));
      for (const [i, side] of [...pages]) if (i > 0 && !wanted.has(i)) {
        pages.delete(i);
        lifecycle.push({ at: Date.now(), event: 'close', index: i, generation: generations.get(i) });
        await side.close();
      }
      for (const slot of currentPlan) if (slot.index > 0) await openPage(slot.index);
      return null;
    }
    if (cmd.startsWith('expo_')) return null;
    if (cmd === 'list_models') throw new Error('ИИ отключён в интеграционной проверке');
    if (cmd === 'read_text') return readFile(resolve(args.path), 'utf8');
    // Здесь нет проверки модели/StageDoc: модельный предрасчёт намеренно не запускается.
    // read_text достаточно для штатной проверки готовности ядра без изменения GAME.
    throw new Error(`Команда ${cmd} вне проверки связи окон`);
  });
  await page.addInitScript(({ index, generation }) => {
    const listeners = new Map();
    const callbacks = new Map();
    let n = 0;
    localStorage.setItem('def_ops.portable.setup.v1', '1');
    window.__expoGeneration = generation;
    window.__expoDeliver = (event, payload) => {
      if (payload?.m?.k === 'state') window.__expoFrame = payload.m;
      for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
    const label = index === 0 ? 'main' : `expo-${index}`;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label }, currentWebview: { windowLabel: label, label } },
      transformCallback(f) { const id = ++n; callbacks.set(id, f); return id; },
      async invoke(cmd, args) {
        if (cmd === 'plugin:event|listen') { const id = ++n; listeners.set(id, args); return id; }
        if (cmd === 'plugin:event|unlisten') { listeners.delete(args.eventId); return; }
        return window.__expoNative(cmd, args);
      },
    };
  }, { index, generation });
  await page.routeWebSocket('**', socket => socket.close());
  await page.route('**/api/portable/library', route => route.fulfill({ status: 404 }));
  await page.route('**/api/portable/stress', async route => route.fulfill({ json: JSON.parse(await readFile(resolve('apps/editor/src/expo/bank-data/stress.json'), 'utf8')) }));
  await page.route('**/api/voice', route => route.fulfill({ json: { state: 'unsupported' } }));
  await page.goto(`${url}/?expo=${index}`, { waitUntil: 'domcontentloaded' });
  return page;
}

async function view(index) {
  return pages.get(index).evaluate(() => {
    const stage = document.querySelector('.expo');
    const intro = document.querySelector('.expo-intro3d');
    return { generation: window.__expoGeneration, phase: stage?.dataset.phase, count: Number(stage?.dataset.count), line: Number(intro?.dataset.line), scene: intro?.dataset.scene, pane: intro?.className, paused: window.__expoFrame?.state.paused, state: window.__expoFrame?.state };
  });
}
async function views(count) { return Promise.all(Array.from({ length: count }, (_, i) => view(i))); }
async function synced(count, line, timeout = 20000) {
  await waitFor(async () => pages.size === count && (await views(count)).every(v => v.count === count && v.phase === 'intro' && v.line === line), `${count} окон, сцена ${line}`, timeout);
  return views(count);
}
const stableState = state => ({ phase: state.phase, front: state.front, session: state.session, paused: state.paused });
const centerInput = ev => broadcast('expo://bus', { from: 'center-test-input', m: { k: 'input', ev } }, 'test');
let result;
try {
  const main = await openPage(0);
  await waitFor(() => latestFrame?.count === 3 && latestFrame.state.phase.kind === 'attract', 'готовность трёх окон', 120000);
  await waitFor(() => commands.some(c => c.cmd === 'expo_log' && JSON.stringify(c.args).includes('Стенд готов')), 'завершение запуска', 120000);
  await waitFor(() => latestFrame.state.now - latestFrame.state.phaseStart >= 1000, 'защита от повторного касания после запуска');
  assert.equal(pages.size, 3);
  checks.startup = { pages: pages.size, plan: structuredClone(currentPlan), monitors: allMonitors };
  console.log('ok startup: 3 страницы');
  const center = pages.get(1);
  await center.locator('.expo-attract-root').click({ position: { x: 700, y: 400 } });
  checks.intro = await synced(3, 1);
  assert.match(checks.intro[0].pane, /expo-intro3d-factors/);
  assert.match(checks.intro[1].pane, /expo-intro3d-film/);
  assert.match(checks.intro[2].pane, /expo-intro3d-swarm/);
  await center.getByRole('button', { name: /^Перейти к сцене 5:/ }).click();
  checks.seek = await synced(3, 5);
  console.log('ok intro: одинаковая сцена, три разные роли');
  await center.keyboard.press('Control+Alt+Shift+KeyO');
  await main.getByRole('dialog', { name: 'Меню оператора' }).waitFor();
  await waitFor(() => commands.some(c => c.cmd === 'expo_focus_main' && c.index === 0), 'фокус главного окна');
  await waitFor(async () => (await views(3)).every(v => v.paused), 'пауза на всех экранах');
  checks.operator = { request: events.find(e => e.from === '1:1' && e.payload?.k === 'operator-open'), focus: commands.find(c => c.cmd === 'expo_focus_main'), sideDialogs: await Promise.all([1, 2].map(i => pages.get(i).getByRole('dialog').count())) };
  assert.deepEqual(checks.operator.sideDialogs, [0, 0]);
  await main.getByLabel('ПИН', { exact: true }).fill('0000');
  await main.getByRole('button', { name: 'Открыть меню' }).click();
  await main.getByRole('tab', { name: 'Экраны', exact: true }).click();
  await main.locator('.expo-monitors li').nth(2).waitFor();
  await main.evaluate(() => document.fonts.ready);
  await main.locator('.expo-tabs').evaluate(el => el.scrollIntoView({ block: 'start' }));
  await main.screenshot({ path: resolve(out, 'operator-screens.jpg'), type: 'jpeg', quality: 90 });
  await main.getByRole('button', { name: 'Показать номера экранов', exact: true }).click();
  await Promise.all([...pages.values()].map(page => page.locator('.expo-identify').waitFor()));
  checks.identification = await Promise.all([...pages.values()].map(page => page.locator('.expo-identify').innerText()));
  checks.identification.forEach((text, i) => { assert.ok(text.includes(`Экран ${i + 1}`)); assert.ok(text.includes(allMonitors[i].id)); });
  console.log('ok operator: запрос с центра, ПИН на host, номера во всех окнах');
  const stateBefore = stableState(latestFrame.state);
  const generationsBefore = [...generations];
  await main.getByRole('button', { name: 'Монитор в центре: выше', exact: true }).click();
  await waitFor(() => currentPlan[0]?.monitor === allMonitors[1].id && latestFrame.settings.screens.order[0] === allMonitors[1].id, 'перестановка экранов');
  assert.deepEqual(stableState(latestFrame.state), stateBefore);
  assert.deepEqual([...generations], generationsBefore);
  checks.reorder = { plan: structuredClone(currentPlan), statePreserved: true, samePages: true, views: await synced(3, 5) };
  assert.match(checks.reorder.views[0].pane, /expo-intro3d-factors/);
  assert.match(checks.reorder.views[1].pane, /expo-intro3d-film/);
  assert.match(checks.reorder.views[2].pane, /expo-intro3d-swarm/);
  const unpluggedAt = Date.now();
  monitors = allMonitors.slice(0, 2);
  await broadcast('expo://monitors', monitors);
  checks.twoScreens = await synced(2, 5);
  assert.match(checks.twoScreens[0].pane, /expo-intro3d-film/);
  assert.deepEqual(stableState(latestFrame.state), stateBefore);
  assert.ok(lifecycle.some(e => e.event === 'close' && e.index === 2 && e.at >= unpluggedAt));
  const reconnectedAt = Date.now();
  // Старые heartbeat не должны заменить сигнал нового экземпляра окна.
  droppingSidePresence = true;
  monitors = structuredClone(allMonitors);
  await broadcast('expo://monitors', monitors);
  checks.reconnected = await synced(3, 5);
  assert.equal(generations.get(2), 2);
  assert.deepEqual(stableState(latestFrame.state), stateBefore);
  assert.ok(!events.some(e => e.at >= reconnectedAt && e.from === '2:2' && ['hello', 'beat'].includes(e.payload?.k) && !e.dropped));
  droppingSidePresence = false;
  await waitFor(() => events.some(e => e.at >= reconnectedAt && e.from === '2:2' && e.payload?.k === 'beat' && !e.dropped), 'новый heartbeat после возврата');
  checks.freshPresence = { newGeneration: 2, reconnectAt: reconnectedAt, firstFreshBeat: events.find(e => e.at >= reconnectedAt && e.from === '2:2' && e.payload?.k === 'beat' && !e.dropped), dropped: events.filter(e => e.dropped).length };
  const phasesAfterIntro = events.filter(e => e.payload?.k === 'state' && e.at >= checks.operator.focus.at).map(e => e.payload.state.phase.kind);
  assert.ok(phasesAfterIntro.every(phase => phase === 'intro'), 'Перестановка и hotplug не перезапускают сеанс');

  await main.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await waitFor(() => !latestFrame.state.paused, 'выход из меню оператора');
  await centerInput({ t: 'restart' });
  await waitFor(() => latestFrame.state.phase.kind === 'welcome' && latestFrame.state.session > 0, 'новый сеанс');
  await centerInput({ t: 'pickFront', front: 'su_1uf' });
  await waitFor(() => latestFrame.state.phase.kind === 'briefing', 'доклад');
  await centerInput({ t: 'next' });
  // Проверяем режиссёра и шину в настоящих окнах. Сигналы карты подаёт макет,
  // поэтому ни пересчёта операции, ни запуска голосовой модели здесь нет.
  for (let n = 1; n <= 3; n++) {
    await waitFor(() => latestFrame.state.phase.kind === 'turn' && latestFrame.state.phase.n === n, `решение ${n}`);
    await centerInput({ t: 'step', step: 'choose' });
    await waitFor(() => latestFrame.state.phase.step === 'choose', `выбор решения ${n}`);
    await centerInput({ t: 'choose', card: 0 });
    await waitFor(() => latestFrame.state.phase.step === 'scroll', `прокрутка решения ${n}`);
    await centerInput({ t: 'scrollReady' });
    await waitFor(() => latestFrame.state.phase.scrollBegan, `начало движения карты ${n}`);
    if (n < 3) await centerInput({ t: 'scrollDone' });
  }
  await waitFor(async () => (await views(3)).every(v => v.phase === 'turn'), 'третий ход на всех экранах');
  const thirdTurn = stableState(latestFrame.state);
  const outageAt = Date.now();
  const outageCommands = commands.length;
  const outageLifecycle = lifecycle.length;
  droppingSidePresence = true;
  await waitFor(() => commands.slice(outageCommands).some(c => c.cmd === 'expo_open'), 'watchdog заметил потерю heartbeat и восстановил раскладку', 45000);
  assert.ok(events.some(e => e.at >= outageAt && e.dropped && e.payload?.k === 'beat'));
  assert.ok(events.some(e => e.at >= outageAt && e.payload?.k === 'health' && e.payload.states.windows === 'fail'));
  assert.ok(!commands.slice(outageCommands).some(c => c.cmd === 'expo_close_all'), 'при восстановлении окна не закрываются');
  assert.equal(lifecycle.length, outageLifecycle, 'ни одно окно не пересоздано');
  assert.deepEqual(stableState(latestFrame.state), thirdTurn);
  assert.ok((await views(3)).every(v => v.phase === 'turn' && v.state.phase.n === 3 && v.state.session === thirdTurn.session));

  droppingSidePresence = false;
  const recoveredAt = Date.now();
  await waitFor(() => events.some(e => e.at >= recoveredAt && e.from === '2:2' && e.payload?.k === 'beat' && !e.dropped), 'сердцебиение третьего окна после сбоя');
  await waitFor(() => events.some(e => e.at >= recoveredAt && e.payload?.k === 'health' && e.payload.states.windows === 'ok'), 'watchdog снова видит все окна', 25000);
  await centerInput({ t: 'scrollDone' });
  await waitFor(async () => (await views(3)).every(v => v.phase === 'result' && v.state.session === thirdTurn.session), 'итог того же сеанса на всех экранах');
  assert.ok(events.filter(e => e.at >= outageAt && e.payload?.k === 'state').every(e => ['turn', 'result'].includes(e.payload.state.phase.kind) && e.payload.state.session === thirdTurn.session));
  checks.heartbeatOutage = { session: thirdTurn.session, repairedWithoutClose: true, recovered: true, views: await views(3) };
  assert.ok(!events.some(e => e.payload?.k === 'state' && e.payload.pin), 'ПИН не передаётся боковым окнам');
  assert.deepEqual(errors, []);
  result = { ok: true, environment: 'Chromium / actual ExpoRoot / isolated Tauri mock bus / read_text from repository', checks, lifecycle, commands: commands.filter(c => c.cmd.startsWith('expo_')), pageErrors: errors, limits: ['Физические мониторы, native fullscreen, реальные DPI и Windows hotplug здесь не проверяются', 'Координаты и scale — входные данные макета; viewport всех страниц 1440×900', 'Модельные команды отключены, GAME не используется; макет посылает события запуска и завершения карты', 'Проверены интро, меню, кадры, роли, жизненный цикл окон и сохранение сеанса при потере heartbeat на третьем ходу; карта и озвучка итога не входят в эту проверку'], screenshot: resolve(out, 'operator-screens.jpg') };
  console.log('ok: три страницы, перестановка, hotplug 3→2→3, потеря heartbeat на третьем ходу и итог того же сеанса');
} catch (error) {
  result = { ok: false, error: String(error), checks, lifecycle, commands: commands.filter(c => c.cmd.startsWith('expo_')), inputs: events.filter(e => e.payload?.k === 'input'), recentEvents: events.slice(-20), pageErrors: errors };
  for (const [i, page] of pages) if (!page.isClosed()) await page.screenshot({ path: resolve(out, `failure-${i}.jpg`), type: 'jpeg', quality: 85 }).catch(() => {});
  throw error;
} finally {
  await writeFile(resolve(out, 'verification.json'), JSON.stringify(result, null, 2));
  closing = true;
  await browser.close();
}
