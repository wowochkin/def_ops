// Регрессия камеры: настоящий ExpoView/StageMap/MapLibre, фиксированные данные итогового разбора.
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = resolve('.superpowers/sdd/2026-11-07-expo-live-voice/camera');
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.route('**/expo-camera-check', r => r.fulfill({ contentType: 'text/html', body: `<!doctype html><html><head><style>body{margin:0;background:#10201d}</style></head><body><div id="root"></div><script type="module">import R from '/@react-refresh';R.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;window.__ready=true;</script></body></html>` }));
try {
  await page.goto(`${url}/expo-camera-check`);
  await page.waitForFunction(() => window.__ready);
  await page.evaluate(async root => {
    const source = await (await fetch('/src/expo/ExpoView.tsx')).text();
    const reactUrl = source.match(/from "([^\"]*deps\/react.js[^\"]*)"/)[1];
    const React = (await import(reactUrl)).default;
    const version = new URL(reactUrl, location.href).search;
    const { createRoot } = (await import('/node_modules/.vite/deps/react-dom_client.js' + version)).default;
    const { flushSync } = (await import('/node_modules/.vite/deps/react-dom.js' + version)).default;
    await import('/demo/fonts.ts');
    await import('/src/styles.css');
    const { ExpoView, mapPlan } = await import('/src/expo/ExpoView.tsx');
    const { initialState } = await import('/src/expo/director.ts');
    const { EXPO_DEFAULTS } = await import('/src/expo/settings.ts');
    const { operationDebrief, debriefSentences } = await import('/src/expo/debrief.ts');
    const { ENGINES, DEFAULT_ENGINE } = await import('/src/engine/registry.ts');
    const { MAP } = await import('/src/expo/map.ts');
    const { emptyDocument, createFeature, PRESETS } = await import(`/@fs/${root}/packages/core/src/index.ts`);
    const factory = ENGINES[DEFAULT_ENGINE].create;
    ENGINES[DEFAULT_ENGINE].create = (...args) => {
      const engine = factory(...args); window.__cameraEngine = engine; return engine;
    };
    localStorage.setItem('def_ops.basemap', 'osm');
    const scales = { axes: { speed: .5, cost: -.2, intent: 1, days: -1.5, lossRatio: 1.06, done: 2, due: 2 }, notes: { speed: 'быстрее истории', cost: 'потери больше истории', intent: 'выполнено 2 из 2' } };
    const mv = { front: 'su_1uf', turn: 3, time: '1945-05-02T05:00', hour: 384, decisions: [{ n: 3, choice: 'uf3-hist', historical: 'uf3-hist' }], reveal: null, blow: null, feed: [], busy: false, error: null, scales, map: { armies: [], prev: null, flashes: [], path: {} }, spare: 1, tasks: [], loss: { own: 0, ref: 0 }, berlinKm: { now: 0, history: 0 }, cards: [], final: { scales, rank: 'Генерал армии', matches: 1, forecast: 'Берлин взят' } };
    const doc = emptyDocument();
    doc.paper = '#efe4c8';
    doc.timeline = { start: '1945-04-16T05:00', end: mv.time, step: 60, motion: 'smooth' };
    doc.layers = [{ id: 'camera-landmarks', name: 'Ориентиры', visible: true, opacity: 1, locked: true, role: 'custom' }];
    doc.features = MAP.cities.map(city => createFeature('label', Object.keys(PRESETS.label)[0], { at: city.at, text: city.name, layerId: 'camera-landmarks' }, 2));
    const maps = { session: { doc, front: mv.front, time: mv.time, zones: [] } };
    const renderer = createRoot(document.getElementById('root'));
    const stale = 'Выбор посетителя «Юг города и выход к Торгау» полностью совпал с историческим замыслом маршала Конева, обеспечив соединение с американскими войсками у Эльбы.';
    const line = debriefSentences(operationDebrief(mv).paragraphs.slice(1, 2)).find(s => /Торгау|Берлин|Эльб/.test(s));
    function Screen({ state, spoken }) {
      React.useLayoutEffect(() => { window.__beforePaint = window.__cameraEngine?.getView(); }, [state, spoken]);
      return React.createElement(ExpoView, { window: 1, state, settings: EXPO_DEFAULTS, count: 3, model: { view: mv, error: null }, ai: { line: spoken ? { text: spoken, source: 'now' } : null, said: spoken, answer: null, thinking: null, ear: 'idle' }, maps, send: () => {} });
    }
    window.__showCamera = mode => {
      const state = { ...initialState(0), front: mv.front, phase: mode === 'turn' ? { kind: 'turn', n: 3, step: 'scroll', preparing: true } : { kind: 'result' } };
      const spoken = mode === 'active' ? line : mode === 'stale' ? stale : null;
      flushSync(() => renderer.render(React.createElement(Screen, { state, spoken })));
      const plan = mapPlan({ state, mv, maps, lit: null, count: 3, index: 1, spoken });
      return { beforePaint: window.__beforePaint, actual: window.__cameraEngine?.getView(), camera: plan.camera, line };
    };
    window.__showCamera('turn');
  }, process.cwd());
  await page.waitForFunction(() => window.__cameraEngine?.size().width > 0);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(900);
  const result = await page.evaluate(() => window.__showCamera('stale'));
  assert.equal(result.camera.scale, 1_500_000);
  assert.equal(result.camera.ms, 0);
  assert.deepEqual(result.beforePaint, result.actual);
  assert.ok(Math.abs(result.actual.center[0] - (result.camera.bbox[0] + result.camera.bbox[2]) / 2) < .0001);
  await page.waitForTimeout(1300);
  await page.screenshot({ path: `${out}/result-initial.jpg`, type: 'jpeg', quality: 90 });
  const opening = await page.evaluate(() => window.__showCamera('open'));
  assert.deepEqual(opening.camera, result.camera);
  const active = await page.evaluate(() => window.__showCamera('active'));
  assert.match(active.camera.key, /^result-turn-3/);
  await page.waitForTimeout(1100);
  const moved = await page.evaluate(() => window.__cameraEngine.getView());
  assert.notDeepEqual(moved.center, result.actual.center);
  await page.screenshot({ path: `${out}/result-active-phrase.jpg`, type: 'jpeg', quality: 90 });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, initial: result.actual, beforePaint: result.beforePaint, active: moved, screenshots: out, fixture: 'Карта с историческими географическими ориентирами; итог и реплики фиксированы, ядро и TTS не запускались.' }));
} finally { await browser.close(); }
