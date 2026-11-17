// Ручной монтаж интро: настоящий интерфейс, ядро и предзаписанные аудиобуферы.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { agentsProcess } from './agents-bridge.mjs';
import { EXPO_CFG, expoPage } from './expo-mock.mjs';

const url = process.env.EXPO_URL ?? 'http://localhost:5173';
const bank = JSON.parse(readFileSync(new URL('../apps/editor/src/expo/bank-data/berlin-1945.lines.json', import.meta.url), 'utf8'));
const order = [1, 13, 11, 10, 2, 3, 4, 5, 6, 7, 8, 9, 12];
const browser = await chromium.launch();
const core = agentsProcess();
const page = await expoPage(browser, { core, cfg: { ...EXPO_CFG, intro: true } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
await page.routeWebSocket(`ws://${new URL(url).host}/**`, socket => socket.close());
await page.addInitScript(() => {
  const inputs = new WeakMap(), buffers = new WeakMap();
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__TAURI_INTERNALS__.invoke = async (cmd, args) => {
    if (cmd === 'expo_voice_manifest') return fetch('/expo-voice/manifest.json').then(r => r.text());
    if (cmd === 'expo_voice_clip') {
      const data = await fetch(`/expo-voice/clips/${args.file}`).then(r => r.arrayBuffer());
      inputs.set(data, args.file);
      return data;
    }
    return invoke(cmd, args);
  };
  const decode = AudioContext.prototype.decodeAudioData;
  AudioContext.prototype.decodeAudioData = function(bytes, ...rest) {
    const file = inputs.get(bytes);
    return decode.call(this, bytes, ...rest).then(buffer => {
      if (file) buffers.set(buffer, file);
      return buffer;
    });
  };
  window.__introAudio = [];
  window.__introPhases = [];
  const create = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function(...args) {
    const source = create.apply(this, args), start = source.start, stop = source.stop;
    let entry;
    source.start = function(...startArgs) {
      const file = buffers.get(source.buffer);
      if (file) {
        entry = { file, started: performance.now(), duration: source.buffer.duration, endedAt: null, stoppedAt: null };
        window.__introAudio.push(entry);
        window.__introContext = source.context;
        source.addEventListener('ended', () => { entry.endedAt = performance.now(); });
      }
      return start.apply(this, startArgs);
    };
    source.stop = function(...stopArgs) {
      if (entry) entry.stoppedAt = performance.now();
      return stop.apply(this, stopArgs);
    };
    return source;
  };
  setInterval(() => {
    const phase = document.querySelector('.expo')?.getAttribute('data-phase');
    if (phase && window.__introPhases.at(-1)?.phase !== phase) window.__introPhases.push({ phase, at: performance.now() });
  }, 25);
});

const phase = () => page.locator('.expo').getAttribute('data-phase');
const nav = page.getByRole('navigation', { name: 'Сцены интро' });
const selectButton = n => nav.getByRole('button', { name: new RegExp(`^Перейти к сцене ${n}:`) });
const lens = n => page.getByRole('group', { name: 'Экраны стенда' }).getByRole('button', { name: String(n), exact: true });
let expected;
const audioCount = () => page.evaluate(() => window.__introAudio.length);
async function waitForScene(n, afterAudio) {
  await page.locator(`.expo-intro3d[data-line="${n}"]`).waitFor();
  await page.waitForFunction(({ count, file }) => window.__introAudio.length > count && window.__introAudio.at(-1)?.file === file,
    { count: afterAudio, file: expected[n - 1].file }, { timeout: 15000 });
  assert.equal(await nav.locator('[aria-current="step"]').getAttribute('aria-label'), await selectButton(n).getAttribute('aria-label'));
  const audio = await page.evaluate(() => window.__introAudio.at(-1));
  assert.ok(Math.abs(audio.duration * 1000 - expected[n - 1].ms) < 150, `Длительность сцены ${n}: ${JSON.stringify(audio)}`);
  return (await audioCount()) - 1;
}
async function select(n, immediate = false) {
  const count = await audioCount();
  if (immediate) await selectButton(n).evaluate(button => button.click());
  else await selectButton(n).click();
  return waitForScene(n, count);
}
async function move(button, n) {
  const count = await audioCount();
  await nav.getByRole('button', { name: button, exact: true }).click();
  await waitForScene(n, count);
}
async function screenshot(path) {
  await page.evaluate(() => document.fonts.ready);
  await page.mouse.move(5, 5);
  await page.waitForTimeout(1000);
  await page.screenshot({ path, type: 'jpeg', quality: 90 });
}

try {
  const response = await page.request.get(`${url}/expo-voice/manifest.json`);
  assert.ok(response.ok());
  const manifest = await response.json();
  expected = order.map(n => manifest.clips[bank.say[`intro-${n}`][0]]);
  assert.ok(expected.every(Boolean), 'Для всех сцен нужны настоящие записи');
  await page.goto(`${url}/?expo=0`);
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).waitFor({ timeout: 120000 });
  await page.waitForTimeout(600);
  const before = await audioCount();
  await page.getByRole('button', { name: 'Коснитесь, чтобы принять командование' }).click();
  await page.locator('.expo[data-phase="intro"]').waitFor();
  const first = await waitForScene(1, before);
  assert.equal(await nav.locator('.intro-scene-link').count(), 13);
  assert.equal(await nav.getByRole('button', { name: 'Предыдущая сцена', exact: true }).isDisabled(), true);

  await select(2);
  assert.equal(await page.locator('.expo-intro3d').getAttribute('data-scene'), 'demo');
  assert.ok(await page.evaluate(i => window.__introAudio[i].stoppedAt !== null, first));
  for (const n of [1, 13]) {
    await selectButton(n).hover();
    const bounds = await selectButton(n).locator('.intro-scene-tooltip').boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 1440 && bounds.y >= 0, `Подсказка ${n} выходит за экран`);
  }
  await select(1);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1000);
  await selectButton(1).hover();
  await page.screenshot({ path: '/tmp/intro-navigation-ui.jpg', type: 'jpeg', quality: 90 });
  await select(3);
  assert.equal(await page.locator('.expo-intro3d').getAttribute('data-scene'), 'scale');
  await move('Предыдущая сцена', 2);
  await move('Следующая сцена', 3);
  for (const [key, n] of [['ArrowLeft', 2], ['ArrowRight', 3]]) {
    const count = await audioCount();
    await page.keyboard.press(key);
    await waitForScene(n, count);
  }

  await lens(1).click();
  await page.locator('.expo-intro3d-factors canvas').waitFor();
  await select(9);
  assert.equal(await lens(1).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.expo-intro3d-factors').getAttribute('data-scene'), 'space');
  await lens(3).click();
  await page.locator('.expo-intro3d-swarm canvas').waitFor();
  await screenshot('/tmp/intro-navigation-side.jpg');
  await select(10);
  assert.equal(await lens(3).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('.expo-intro3d-swarm').getAttribute('data-scene'), 'ai');

  const rapidStart = await audioCount();
  await page.evaluate(() => {
    for (const n of [5, 13, 2]) document.querySelector(`button[aria-label^="Перейти к сцене ${n}:"]`).click();
  });
  await waitForScene(2, rapidStart);
  await page.waitForTimeout(500);
  assert.equal(await phase(), 'intro');
  assert.equal(await page.locator('.expo-intro3d').getAttribute('data-line'), '2');
  await lens(2).click();
  await page.locator('.expo-intro3d-film canvas').waitFor();
  for (const n of [1, 4, 5, 6, 7, 8, 9, 10, 11, 12]) await select(n);

  // Отмена финальной паузы не должна впоследствии открыть выбор фронта.
  const canceledFinal = await select(13);
  assert.equal(await nav.getByRole('button', { name: 'Следующая сцена', exact: true }).isDisabled(), true);
  await page.waitForFunction(i => window.__introAudio[i].endedAt !== null, canceledFinal, { timeout: 15000 });
  assert.equal(await phase(), 'intro');
  // Проверяется гонка очереди; ожидание стабильного WebGL-кадра у мышиного click
  // может занять весь трёхсекундный gap на загруженной машине.
  await select(2, true);
  await page.waitForTimeout(3100);
  assert.equal(await phase(), 'intro');
  assert.equal(await page.locator('.expo-intro3d').getAttribute('data-line'), '2');

  const final = await select(13);
  await page.waitForFunction(i => window.__introAudio[i].endedAt !== null, final, { timeout: 15000 });
  assert.equal(await phase(), 'intro');
  await page.waitForTimeout(1100);
  assert.equal(await phase(), 'intro');
  await page.locator('.expo[data-phase="welcome"]').waitFor({ timeout: 6000 });
  await page.waitForTimeout(100);
  const result = await page.evaluate(i => ({ audio: window.__introAudio[i], welcome: window.__introPhases.at(-1), all: window.__introAudio }), final);
  const gap = (result.audio.stoppedAt ?? result.welcome.at) - result.audio.endedAt;
  assert.ok(result.audio.stoppedAt === null || result.audio.stoppedAt > result.audio.endedAt, 'Финальная запись оборвана до своего конца');
  assert.ok(gap >= 2800 && gap < 5500, `Финальная пауза: ${gap} мс`);
  assert.equal(await page.locator('.expo-intro3d canvas').count(), 0);
  assert.deepEqual(errors, []);
  console.log(`ok ручной монтаж: новый порядок 1→13→11→10, prev/next/клавиатура, 13 прямых переходов, сохранение панно, rapid seek, отмена финального gap, настоящая финальная пауза ${Math.round(gap)} мс; ${result.all.length} аудиозапусков, ошибок страницы нет`);
} catch (error) {
  await page.screenshot({ path: '/tmp/intro-navigation-fail.jpg', type: 'jpeg' }).catch(() => {});
  console.error(await page.evaluate(() => ({ phase: document.querySelector('.expo')?.getAttribute('data-phase'), line: document.querySelector('.expo-intro3d')?.getAttribute('data-line'), audio: window.__introAudio, phases: window.__introPhases })).catch(() => ({})));
  if (errors.length) console.error(errors);
  throw error;
} finally {
  await browser.close();
  core.stop();
}
