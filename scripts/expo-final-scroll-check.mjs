// Реальное ядро и карта; медленная подготовка голоса заменена ответом WebSocket для проверки порядка работ.
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const out = resolve('.superpowers/sdd/2026-11-07-expo-live-voice/final-scroll');
mkdirSync(out, { recursive: true });
const core = agentsProcess();
const browser = await chromium.launch();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, aiMode: 'ai', timer: { on: false, seconds: 30 }, idleSeconds: 600, resultSeconds: 120 }, voice: 'running' });
// JSON transport avoids DevTools' large-object exposeFunction serialization overhead.
if (process.env.EXPO_JSON_BRIDGE) {
  await page.route('**/__expo_core_turn', async route => {
    const { cmd, args } = route.request().postDataJSON();
    try { await route.fulfill({ contentType: 'application/json', body: JSON.stringify(await core.call(cmd, args)) }); }
    catch (error) { await route.fulfill({ status: 500, body: String(error) }); }
  });
  await page.addInitScript(() => {
    const original = window.__expoNative;
    window.__expoNative = async (cmd, args) => {
      if (cmd !== 'game_turn') return original(cmd, args);
      const response = await fetch('/__expo_core_turn', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd, args }) });
      if (!response.ok) throw Error(await response.text());
      return response.json();
    };
  });
}
const profiler = process.env.EXPO_CPU_PROFILE ? await page.context().newCDPSession(page) : null;
if (profiler) await profiler.send('Profiler.enable');
const errors = [], jobs = [];
page.on('pageerror', e => errors.push(String(e)));
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket => socket.close());
const capture = async kind => {
  const state = await page.evaluate(() => ({ time: performance.now(), phase: document.querySelector('.expo')?.dataset.phase, title: document.querySelector('.expo-phase')?.textContent ?? document.querySelector('.expo-header')?.textContent, preparing: !!document.querySelector('.expo-scroll-rest'), clock: document.querySelector('[data-clock]')?.textContent }));
  jobs.push({ kind, ...state });
};
await page.route('**/llm/v1/chat/completions', async route => {
  await capture('llm');
  await new Promise(r => setTimeout(r, 1200));
  await route.fulfill({ json: { choices: [{ message: { content: 'Решение принято. Ход операции показан на карте.' } }] } }).catch(() => {});
});
await page.routeWebSocket('ws://127.0.0.1:47645/**', socket => {
  socket.onMessage(async raw => {
    if (typeof raw !== 'string') return;
    const m = JSON.parse(raw);
    if (m.type === 'hello' || m.type === 'tts') socket.send(JSON.stringify({ type: 'ready', voices: [], roles: {}, loaded: true, tts: { current: 'qwen3-ru-stress', state: 'ready', engines: [] } }));
    if (m.type === 'prepare') {
      await capture('tts-prepare');
      await new Promise(r => setTimeout(r, 5000));
      socket.send(JSON.stringify({ type: 'prepared', id: m.id, error: 'Проверка медленного недоступного синтеза' }));
    }
    if (m.type === 'say') socket.send(JSON.stringify({ type: 'say-done', id: m.id }));
  });
});
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(1800);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.getByRole('button', { name: /1-й Украинский/ }).click();
  await page.getByRole('button', { name: 'Начать операцию' }).click();
  await page.getByRole('button', { name: 'К решениям' }).click();
  for (let n = 1; n <= 3; n++) {
    await page.getByRole('button', { name: 'Карточка 1', exact: true }).waitFor({ timeout: 120000 });
    await page.getByRole('button', { name: 'Карточка 1', exact: true }).click();
    if (n === 3 && profiler) await profiler.send('Profiler.start');
    await page.getByRole('button', { name: 'Подтвердить', exact: true }).click();
    await page.locator('.expo-reveal').waitFor({ timeout: 15000 });
    console.log(`ok начало прокрутки ${n}`);
    if (n < 3) {
      await page.locator('.expo-reveal').waitFor({ state: 'detached', timeout: 180000 });
      continue;
    }
    const started = await page.evaluate(() => performance.now());
    const perf = await page.evaluate(() => new Promise(resolve => {
      const start = performance.now(), samples = [], clockChanges = []; let last = start, lastClock = null;
      const stats = entries => {
        const gaps = entries.map(s => s.gap).sort((a,b) => a-b);
        return { frames: gaps.length, p95: gaps[Math.floor(gaps.length * .95)], max: Math.max(0, ...gaps) };
      };
      const tick = now => {
        const clock = document.querySelector('[data-clock]')?.textContent;
        const sample = { offset: now - start, gap: now - last, clock };
        samples.push(sample); last = now;
        if (clock !== lastClock) { clockChanges.push({ offset: now - start, clock }); lastClock = clock; }
        if (document.querySelector('.expo-scroll-rest')) {
          // В этом сценарии третий перелом 1-го Украинского фронта начинается 23 апреля.
          const reset = clockChanges.findIndex(c => c.clock === '23 апреля, 05:00');
          const movingFrom = reset >= 0 ? clockChanges[reset + 1]?.offset ?? Infinity : Infinity;
          const movingGaps = samples.filter(s => s.offset > movingFrom);
          resolve({ ended: now, elapsed: now - start, fps: samples.length * 1000 / (now-start), all: stats(samples), movingFrom, moving: stats(movingGaps), largest: [...samples].sort((a,b) => b.gap-a.gap).slice(0, 12), clock, clockChanges, samples });
        } else if (now - start > 180000) resolve({ error: 'Прокрутка не завершилась за180с', samples });
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    if (profiler) { const { profile } = await profiler.send('Profiler.stop'); writeFileSync(`${out}/final-scroll.cpuprofile`, JSON.stringify(profile)); }
    await page.locator('.expo-scroll-rest').waitFor();
    await page.screenshot({ path: `${out}/preparing-result.jpg`, type: 'jpeg', quality: 90 });
    const activeJobs = jobs.filter(j => j.time >= started);
    assert.ok(activeJobs.some(j => j.kind === 'tts-prepare'), 'должна начаться подготовка после визуализации');
    assert.ok(activeJobs.every(j => j.preparing), JSON.stringify(activeJobs));
    assert.match(perf.clock, /2 мая/);
    const { samples, clockChanges, ...summary } = perf;
    console.log(JSON.stringify({ ok: true, perf: summary, clockChanges: clockChanges?.slice(0, 6), jobs: activeJobs }));
    writeFileSync(`${out}/verification.json`, JSON.stringify({ perf, jobs: activeJobs, errors, transport: process.env.EXPO_JSON_BRIDGE ? 'game_turn: fetch JSON' : 'Playwright exposeFunction' }, null, 2));
  }
  await page.locator('.expo[data-phase="result"]').waitFor({ timeout: 45000 });
  await page.getByRole('button', { name: '2', exact: true }).click();
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${out}/result-initial.jpg`, type: 'jpeg', quality: 90 });
  assert.deepEqual(errors, []);
  console.log('ok общий обзор результата; снимок в каталоге final-scroll');
} catch (e) {
  await page.screenshot({ path: `${out}/failed.jpg`, type: 'jpeg', quality: 85 }).catch(() => {});
  console.error(JSON.stringify({ errors, jobs }));
  throw e;
} finally { await browser.close(); core.stop(); }
