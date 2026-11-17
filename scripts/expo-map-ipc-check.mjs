// Размер реального итогового документа и цена синхронного сериализатора Tauri.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { expoPage } from './expo-mock.mjs';
const registries = resolve(homedir(), '.cargo/registry/src');
const candidates = readdirSync(registries).flatMap(r => readdirSync(resolve(registries, r)).filter(p => /^tauri-2\./.test(p)).map(p => resolve(registries, r, p, 'scripts/process-ipc-message-fn.js')));
const source = candidates.sort().at(-1);
if (!source) throw Error('Не найден установленный сериализатор Tauri');
const serializer = readFileSync(source, 'utf8');
const core = agentsProcess(), browser = await chromium.launch();
const page = await expoPage(browser, { core });
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = resolve('.superpowers/sdd/2026-11-07-expo-live-voice/map-ipc'); mkdirSync(out, { recursive: true });
try {
  await page.route('**/map-ipc-bench', route => route.fulfill({ contentType: 'text/html', body: '<html><body>Проверка передачи карты</body></html>' }));
  await page.goto(`${url}/map-ipc-bench`);
  const result = await page.evaluate(async serializer => {
    const [{ coreEnv }, { BANK }, { stageMaps, applyStageMap, broadcastStageMap, missingStageMaps }] = await Promise.all([
      import('/src/expo/model.ts'), import('/src/expo/bank.ts'), import('/src/expo/stage-maps.ts'),
    ]);
    const env = await coreEnv();
    await env.call('game_start', { scenario: BANK.scenario, seed: 1, takeover: 0, player: 'su', enemy: 'intent', mode: 'intent' });
    const trace = await env.call('game_turn', { orders: [], hours: BANK.end });
    const serialize = (0, eval)(serializer);
    const updates = [];
    const maps = stageMaps((key,d,aliases) => updates.push({key,d,aliases}));
    await maps.session(trace, env.history, 'su_1uf', 1);
    const update = updates[0];
    const m = { cmd: 'plugin:event|emit', payload: { event: 'expo://bus', payload: { from: 'test', m: { k: 'map', ...update } } } };
    const times = []; let json;
    for (let i = 0; i < 3; i++) { const start = performance.now(); json = serialize(m).data; times.push(performance.now() - start); }
    const sent = [];
    const bus = { send: m => sent.push(m) };
    broadcastStageMap(bus, update, 1); const singleMessages = sent.length;
    broadcastStageMap(bus, update, 3); const multiMessages = sent.length;
    const received = applyStageMap({}, JSON.parse(serialize({ k: 'map', ...update }).data));
    const result = { traceFrames: trace.frames.length, emittedUpdates: updates.length, aliases: update.aliases, bytes: new TextEncoder().encode(json).length, serializeMs: times, singleMessages, multiMessages, sameReceivedReference: received.session === received.best, initialSyncMessages: missingStageMaps(maps.docs).length, docKeys: Object.keys(update.d.doc) };
    maps.dispose(); return result;
  }, serializer);
  assert.equal(result.emittedUpdates, 1); assert.equal(result.singleMessages, 0); assert.equal(result.multiMessages, 1); assert.equal(result.sameReceivedReference, true);
  writeFileSync(`${out}/verification.json`, JSON.stringify({ ...result, serializerSource: source, note: 'Chrome + точный JS-сериализатор установленного Tauri; затраты WKWebView/Rust-доставки не измерены.' }, null, 2));
  console.log(JSON.stringify(result));
} finally { await browser.close(); core.stop(); }
