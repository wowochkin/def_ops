// Полный проход настоящей предзаписи в браузере. Без синтеза и подмены аудиобуферов.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';
const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const browser = await chromium.launch();
const core = agentsProcess();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, intro: true } });
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket => socket.close());
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.addInitScript(() => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = (cmd, args) => {
    if (cmd === 'expo_voice_manifest') return fetch('/expo-voice/manifest.json').then(r => r.text());
    if (cmd === 'expo_voice_clip') return fetch(`/expo-voice/clips/${args.file}`).then(r => r.arrayBuffer());
    return invoke(cmd, args);
  };
  window.__introAudio = [];
  const create = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function(...args) {
    const source = create.apply(this, args);
    const start = source.start;
    source.start = function(...startArgs) {
      const n = Number(document.querySelector('.expo-intro3d')?.getAttribute('data-line'));
      const entry = { line: n, started: performance.now(), duration: source.buffer?.duration, ended: false };
      if (n) { window.__introContext = source.context; window.__introAudio.push(entry); source.addEventListener('ended', () => { entry.ended = true; }); }
      return start.apply(this, startArgs);
    };
    return source;
  };
  window.__introSeen = [];
  setInterval(() => {
    const n = Number(document.querySelector('.expo-intro3d')?.getAttribute('data-line'));
    if (n && window.__introSeen.at(-1) !== n) window.__introSeen.push(n);
  }, 50);
});
try {
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.locator('.expo[data-phase="intro"]').waitFor();
  await page.locator('.expo-intro3d canvas').waitFor();
  await page.locator('.expo-intro3d[data-line="3"]').waitFor({ timeout: 60000 });
  // Номер сцены публикуется до декодирования клипа: паузу проверяем уже на звучащей записи.
  await page.waitForFunction(() => window.__introAudio.length === 3 && !window.__introAudio[2].ended);
  await page.keyboard.press('Control+Alt+Shift+KeyO');
  await page.getByLabel('ПИН', { exact: true }).fill('0000');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await page.waitForTimeout(700);
  const before = await page.evaluate(() => ({ line: document.querySelector('.expo-intro3d')?.getAttribute('data-line'), time: window.__introContext.currentTime, state: window.__introContext.state }));
  await page.waitForTimeout(2400);
  const after = await page.evaluate(() => ({ line: document.querySelector('.expo-intro3d')?.getAttribute('data-line'), time: window.__introContext.currentTime, state: window.__introContext.state }));
  assert.equal(before.state, 'suspended');
  assert.equal(after.time, before.time);
  assert.equal(after.line, before.line);
  await page.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('heading', { name: 'Выберите фронт' }).waitFor({ timeout: 220000 });
  const result = await page.evaluate(() => ({ seen: window.__introSeen, audio: window.__introAudio }));
  assert.deepEqual(result.seen, Array.from({ length: 13 }, (_, i) => i + 1));
  assert.equal(result.audio.length, 13, JSON.stringify(result.audio));
  assert.ok(result.audio.every(a => a.ended && a.duration > 5), JSON.stringify(result.audio));
  assert.equal(await page.locator('.expo-intro3d canvas').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`ok все 13 сцен по порядку; 13 настоящих аудиоклипов доиграли; ${result.audio.reduce((s,a)=>s+a.duration,0).toFixed(1)} с речи; пауза замораживает голос и сцену; переход к выбору фронта; холст освобождён`);
} finally { await browser.close(); core.stop(); }
