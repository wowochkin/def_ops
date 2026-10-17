// Сквозная проверка панели голоса: поддельный голосовой сервис (--fake), сервер разработки окна (vite)
// и Chromium с поддельным микрофоном (WAV с «речью» — всплесками звука — и паузами).
//
//   node scripts/voice-e2e.mjs [--shots DIR] [--python PATH] [--url http://localhost:5173] [--no-stub]
//
// Шлюза нет: по умолчанию ответ /api/voice подставляется («ready»); --no-stub — без подстановки (шлюз молчит,
// сервис «запущен вручную» — окно должно подключиться само).
//
// Поддельное распознавание отдаёт строки --fake-script по очереди: «штаб, открой переигровку» →
// раздел «Переигровка»; «передайте в штаб армии» — в ленте «не мне»; «штаб, что я могу сказать» → ответ
// с примерами; дальше — текст для записи голоса (его же «распознаёт» проверка записи).
// По каждому пункту печатается «ok …»; первый провал — код выхода 1. --shots DIR — снимки 1440×900 (JPEG)
// панели, калибровки и голосов. Python — $VOICE_PYTHON, services/voice/.venv или python3.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const SHOTS = arg('--shots') ? resolve(arg('--shots')) : null;
const STUB = !process.argv.includes('--no-stub');
const CHROME = process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const PY = arg('--python') || process.env.VOICE_PYTHON
  || (existsSync(join(ROOT, 'services/voice/.venv/bin/python')) ? join(ROOT, 'services/voice/.venv/bin/python') : 'python3');

// текст записи голоса — тот же, что в services/voice/voices.py (RECORD_TEXT)
const RECORD_TEXT = 'Докладываю обстановку на утро. Противник за ночь подтянул к переднему краю свежие резервы '
  + 'и ведёт разведку боем на левом фланге. Наши части удерживают занимаемый рубеж, артиллерия '
  + 'готова открыть огонь по заявкам пехоты. Связь с соседями устойчивая, подвоз боеприпасов идёт '
  + 'по плану. Прошу утвердить решение на усиление обороны у переправы.';

const children = [];
const tmp = mkdtempSync(join(tmpdir(), 'voice-e2e-'));
let browser = null;
function cleanup() {
  for (const c of children) { try { process.kill(-c.pid, 'SIGTERM'); } catch { try { c.kill('SIGTERM'); } catch { /* */ } } }
  children.length = 0;
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* */ }
}
process.on('exit', cleanup);
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { cleanup(); process.exit(130); });

const ok = (what) => console.log(`ok ${what}`);
async function fail(what) {
  console.log(`FAIL ${what}`);
  try { await browser?.close(); } catch { /* */ }
  cleanup();
  process.exit(1);
}
async function check(what, fn) {
  try { const extra = await fn(); ok(extra ? `${what} (${extra})` : what); } catch (e) { await fail(`${what}: ${e?.message?.split('\n')[0] ?? e}`); }
}

const freePort = () => new Promise((res, rej) => {
  const s = createServer();
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => res(port)); });
  s.on('error', rej);
});

function run(cmd, args, opts = {}) {
  const c = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], detached: true, ...opts });
  children.push(c);
  let out = '';
  c.stdout.on('data', (d) => { out += d; });
  c.stderr.on('data', (d) => { out += d; });
  c.log = () => out;
  return c;
}

async function waitHttp(url, ms, proc) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (proc && proc.exitCode !== null) throw new Error(`процесс завершился:\n${proc.log()}`);
    try { const r = await fetch(url); if (r.ok) return; } catch { /* ещё не поднялся */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`нет ответа ${url} за ${ms} мс${proc ? `:\n${proc.log()}` : ''}`);
}

/** WAV 16 кГц: «слог» 1,5 с (гармоники с плавающим тоном и слоговой огибающей) и тишина 4 с — по кругу. */
function speechWav(path) {
  const sr = 16000, burst = 1.5, gap = 4.0, cycles = 4;
  const n = Math.round((burst + gap) * cycles * sr);
  const pcm = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sr, tc = t % (burst + gap);
    if (tc >= burst) continue;
    const env = Math.min(1, tc / 0.03, (burst - tc) / 0.03) * (0.75 + 0.25 * Math.sin(2 * Math.PI * 4 * tc));
    const f0 = 140 + 25 * Math.sin(2 * Math.PI * 1.3 * t);
    let v = 0;
    for (let h = 1; h <= 8; h++) v += Math.sin(2 * Math.PI * f0 * h * t + h) / h;
    pcm[i] = Math.round(Math.max(-1, Math.min(1, 0.32 * env * v)) * 32767);
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  Buffer.from(pcm.buffer).copy(buf, 44);
  writeFileSync(path, buf);
}

// ---------------------------------------------------------------- запуск

const wav = join(tmp, 'speech.wav');
speechWav(wav);
const script = join(tmp, 'script.txt');
writeFileSync(script, ['штаб, открой переигровку', 'передайте в штаб армии', 'штаб, что я могу сказать',
  ...Array(200).fill(RECORD_TEXT)].join('\n') + '\n');
// после перезапуска сервиса (проверка обрыва связи) — только текст записи: команды уже проверены
const script2 = join(tmp, 'script2.txt');
writeFileSync(script2, Array(200).fill(RECORD_TEXT).join('\n') + '\n');

// встроенные образцы голоса — из scripts/voice-bench/ref (в репозиторий не входят); нет их — свой образец:
// поддельный синтез, как и настоящий, без образца не говорит
const BENCH = join(ROOT, 'scripts/voice-bench');
let seed = BENCH;
if (!existsSync(join(BENCH, 'ref/zhukov-10s.wav'))) {
  seed = join(tmp, 'seed');
  mkdirSync(join(seed, 'ref'), { recursive: true });
  speechWav(join(seed, 'ref/zhukov-10s.wav'));
  writeFileSync(join(seed, 'refs.json'), JSON.stringify({ refs: { 'zhukov-10s': { file: 'ref/zhukov-10s.wav', text: 'Образец для проверки.' } } }));
}

const vport = await freePort();
let voice = null;
async function startVoice(lines = script) {
  voice = run(PY, ['server.py', '--fake', '--fake-script', lines, '--port', String(vport), '--data', join(tmp, 'data'), '--seed-refs', seed],
    { cwd: join(ROOT, 'services/voice') });
  await waitHttp(`http://127.0.0.1:${vport}/health`, 30000, voice);
}
function stopVoice() {
  const c = voice;
  children.splice(children.indexOf(c), 1);
  try { process.kill(-c.pid, 'SIGKILL'); } catch { c.kill('SIGKILL'); }
  return new Promise((r) => (c.exitCode !== null ? r() : c.once('exit', r)));
}
try { await startVoice(); } catch (e) { await fail(`голосовой сервис: ${e.message}`); }
ok(`голосовой сервис (--fake) на порту ${vport}`);

let app = arg('--url');
if (!app) {
  const port = await freePort();
  const vite = run(join(ROOT, 'node_modules/.bin/vite'), ['--port', String(port), '--strictPort', '--host', '127.0.0.1'],
    { cwd: join(ROOT, 'apps/editor') });
  app = `http://127.0.0.1:${port}`;
  try { await waitHttp(app + '/', 60000, vite); } catch (e) { await fail(`сервер разработки: ${e.message}`); }
}
ok(`окно: ${app}`);

browser = await chromium.launch({
  executablePath: CHROME,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`,
    '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
await ctx.addInitScript((url) => {
  if (sessionStorage.getItem('e2e.init')) return;
  sessionStorage.setItem('e2e.init', '1');
  localStorage.clear();
  localStorage.setItem('def_ops.voice.url', url);
  localStorage.setItem('def_ops.section', 'editor');
}, `ws://127.0.0.1:${vport}/ws`);
// шлюза нет — состояние голоса отвечаем за него; --no-stub — шлюз молчит (сервис как будто запущен вручную)
if (STUB) await ctx.route('**/api/voice', (r) => r.fulfill({ json: { state: 'ready', port: vport } }));
ok(STUB ? 'ответ шлюза /api/voice подставлен' : 'шлюза нет (/api/voice не отвечает)');
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(app + '/#editor');
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const shot = async (name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, name), type: 'jpeg', quality: 88 }); };

const T = 30000;
const panel = page.locator('.vp');

// ---------------------------------------------------------------- проверки

await check('панель свёрнута в значок и разворачивается', async () => {
  await page.locator('.vp-icon').waitFor({ state: 'visible', timeout: T });
  await page.locator('.vp-icon').click();
  await panel.locator('.vp-card').waitFor({ state: 'visible', timeout: 5000 });
});

await check('голос готов: «Жду обращения»', async () => {
  await panel.locator('.vp-state', { hasText: /Жду обращения|Слушаю|Думаю|Говорит/ }).waitFor({ timeout: T });
});

await check('шрифт панели не меньше 18 px', async () => {
  const min = await panel.locator('.vp-card').evaluate((root) => {
    let m = Infinity;
    const walk = (el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) m = Math.min(m, parseFloat(cs.fontSize));
      for (const c of el.children) walk(c);
    };
    walk(root);
    return m;
  });
  if (!(min >= 18)) throw new Error(`самый мелкий текст — ${min} px`);
  return `${min} px`;
});

await check('подсказка «Не знаете, что сказать? Скажите: Штаб, что я могу?» видна', async () => {
  await panel.getByText('Не знаете, что сказать? Скажите: Штаб, что я могу?').waitFor({ state: 'visible', timeout: 2000 });
});

await check('регуляторы скрыты до «Тонкой настройки»', async () => {
  const sliders = panel.locator('input[type=range]');
  const visible = async () => { let n = 0; for (const s of await sliders.all()) if (await s.isVisible()) n++; return n; };
  const vis = await visible();
  if (vis) throw new Error(`видно регуляторов: ${vis}`);
  await panel.getByText('Тонкая настройка').click();
  await sliders.first().waitFor({ state: 'visible', timeout: 2000 });
  const n = await visible();
  if (n !== 4) throw new Error(`после раскрытия видно регуляторов: ${n}`);
  const t = await panel.locator('.vp-card').evaluate((e) => e.textContent ?? '');
  for (const w of ['VAD', 'Smart Turn', 'порог', 'голос модели', 'эхо']) if (t.includes(w)) throw new Error(`техническое слово: ${w}`);
  await panel.getByText('Тонкая настройка').click();
  return 'после раскрытия — 4';
});

await check('«штаб, открой переигровку» → раздел «Переигровка»', async () => {
  await page.waitForFunction(() => location.hash === '#replay', null, { timeout: 60000 });
});

await check('«передайте в штаб армии» — в ленте серым, «не мне»', async () => {
  const item = panel.locator('.vp-item.notme', { hasText: 'передайте в штаб армии' });
  await item.waitFor({ timeout: 30000 });
  if (!(await item.innerText()).includes('не мне')) throw new Error('нет пометки «не мне»');
});

await check('«штаб, что я могу сказать» → ответ с примерами', async () => {
  await panel.locator('.vp-item.chief', { hasText: 'Можно сказать' }).waitFor({ timeout: 30000 });
});

await check('«Что можно сказать» свёрнуто, по щелчку — примеры из реестра', async () => {
  const ex = panel.locator('.vp-can', { hasText: 'штаб, открой переигровку' });
  if (await ex.isVisible()) throw new Error('раскрыто без щелчка');
  await panel.getByText('Что можно сказать', { exact: true }).click();
  await ex.waitFor({ timeout: 2000 });
  await shot('voice-panel-hints.jpg');
  await panel.getByText('Что можно сказать', { exact: true }).click();
});

await check('открытая панель не закрывает раздел: «Рассчитать» и список сценариев доступны', async () => {
  const go = page.locator('.rp-go');
  await go.waitFor({ state: 'visible', timeout: 5000 });
  const covered = await page.evaluate(() => {
    const card = document.querySelector('.vp-card').getBoundingClientRect();
    const btn = document.querySelector('.rp-go');
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    const side = btn.closest('aside, .rp-side, .rp-left') ?? btn.parentElement;
    const s = side.getBoundingClientRect();
    const overlap = !(card.left >= s.right || card.right <= s.left || card.top >= s.bottom || card.bottom <= s.top);
    return { onBtn: !!hit && btn.contains(hit), overlap };
  });
  if (!covered.onBtn) throw new Error('кнопка «Рассчитать» под панелью');
  if (covered.overlap) throw new Error('панель заходит на колонку раздела');
  const h = await panel.locator('.vp-card').evaluate((c) => c.getBoundingClientRect().height);
  if (h > 660) throw new Error(`карточка высотой ${h} px`);
  return `высота карточки ${Math.round(h)} px`;
});
await shot('voice-panel.jpg');

await check('событие voice:open открывает калибровку', async () => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:open', { detail: 'calibrate' })));
  await page.locator('.vp-dialog.calib').waitFor({ state: 'visible', timeout: 3000 });
});

const calibDlg = page.locator('.vp-dialog.calib');
/** Шаги калибровки с first по last; шаг тишины — сразу после «слога» поддельного микрофона. */
async function calibSteps(first, last) {
  for (let i = first; i <= last; i++) {
    await calibDlg.getByText(`шаг ${i} из 4`).waitFor({ timeout: 40000 });
    if (i === 1) {
      await page.waitForFunction(() => Number(document.querySelector('.vp-level')?.getAttribute('data-p')) > 0.3, null, { timeout: 15000, polling: 20 });
      await page.waitForFunction(() => Number(document.querySelector('.vp-level')?.getAttribute('data-p')) < 0.05, null, { timeout: 15000, polling: 20 });
      await shot('voice-calibration.jpg');
    }
    await calibDlg.getByRole('button', { name: 'Записать' }).click();
  }
}
const TECH = ['VAD', 'Smart Turn', 'порог', 'голос модели', 'поверх модели', 'эхо', 'эха'];
async function plainWords(loc, where) {
  const t = await loc.evaluate((e) => e.textContent ?? '');
  for (const w of TECH) if (t.includes(w)) throw new Error(`${where}: техническое слово «${w}»`);
}

await check('калибровка: обрыв связи посреди шага — понятная причина, калибровка с первого шага, не зависает', async () => {
  await calibSteps(1, 1);
  await calibDlg.getByText('шаг 2 из 4').waitFor({ timeout: 20000 });
  await calibDlg.getByRole('button', { name: 'Записать' }).click();
  await stopVoice();
  // замеры прежних шагов были только у голоса и пропали с обрывом — калибровка заново, с первого шага
  await calibDlg.getByText('начнём калибровку сначала').waitFor({ timeout: 10000 });
  await calibDlg.getByText('шаг 1 из 4').waitFor({ timeout: 2000 });
  await startVoice(script2);
  await calibDlg.getByRole('button', { name: 'Записать' }).and(page.locator(':enabled')).waitFor({ timeout: 40000 });
});

await check('калибровка: четыре шага → «Регуляторы выставлены»', async () => {
  const dlg = calibDlg;
  await calibSteps(1, 4);
  await dlg.getByText('Регуляторы выставлены').waitFor({ timeout: 60000 });
  await plainWords(dlg, 'окно калибровки');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('def_ops.voice.settings') || 'null'));
  if (!saved || typeof saved.vad !== 'number') throw new Error('регуляторы не сохранены в def_ops.voice.settings');
  await shot('voice-calibration-done.jpg');
  await dlg.getByRole('button', { name: 'Готово' }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 3000 });
  return `в тишине ${saved.vad}, перебивание ${saved.barge_vad}`;
});

await check('голоса: окно, предупреждение и текст для чтения', async () => {
  await panel.getByRole('button', { name: 'Голоса' }).click();
  const dlg = page.locator('.vp-dialog.voices');
  await dlg.waitFor({ state: 'visible', timeout: 3000 });
  await dlg.getByText('Начальник штаба').first().waitFor({ timeout: 5000 });
  await dlg.getByRole('button', { name: 'Записать новый голос' }).click();
  await dlg.getByText('хранится только на этом компьютере').waitFor({ timeout: 3000 });
  await dlg.getByText('Докладываю обстановку на утро').waitFor({ timeout: 3000 });
});

await check('голоса: обрыв связи посреди записи — запись сброшена с понятной причиной, можно записать заново', async () => {
  const dlg = page.locator('.vp-dialog.voices');
  await dlg.getByRole('button', { name: 'Начать запись' }).click();
  await dlg.getByRole('button', { name: 'Закончить запись' }).waitFor({ timeout: 5000 });
  await stopVoice();
  await dlg.getByText('запись не сохранилась').waitFor({ timeout: 10000 });
  await startVoice(script2);
  await panel.locator('.vp-state', { hasText: /Жду обращения|Слушаю|Думаю|Говорит|Разговор/ }).waitFor({ timeout: 40000 });
  await dlg.getByRole('button', { name: 'Записать новый голос' }).click();
  await dlg.getByRole('button', { name: 'Начать запись' }).waitFor({ timeout: 3000 });
});

let passed = false;
await check('запись голоса → результат проверки', async () => {
  const dlg = page.locator('.vp-dialog.voices');
  await dlg.getByRole('button', { name: 'Начать запись' }).click();
  await dlg.getByRole('button', { name: 'Закончить запись' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(18000);
  await dlg.getByRole('button', { name: 'Закончить запись' }).click();
  const res = dlg.locator('.vp-check');
  await res.waitFor({ timeout: 20000 });
  const text = await res.innerText();
  passed = /Запись подходит/.test(text);
  await plainWords(dlg, 'окно голосов');
  return passed ? 'запись подходит' : `перечитать: ${text.replace(/\s+/g, ' ').slice(0, 120)}`;
});

if (passed) {
  await check('проба и сохранение нового голоса', async () => {
    const dlg = page.locator('.vp-dialog.voices');
    await dlg.getByRole('button', { name: 'Прослушать пробу' }).click();
    await dlg.getByLabel('Имя голоса').fill('Гость');
    await shot('voice-voices.jpg');
    await dlg.getByRole('button', { name: 'Сохранить' }).click();
    await dlg.locator('.vp-voice', { hasText: 'Гость' }).waitFor({ timeout: 10000 });
  });
  await check('назначение роли и удаление голоса', async () => {
    const dlg = page.locator('.vp-dialog.voices');
    const row = dlg.locator('.vp-voice', { hasText: 'Гость' });
    await row.getByRole('button', { name: 'Начальник штаба' }).click();
    await row.getByText('голос начальника штаба').waitFor({ timeout: 5000 });
    await row.getByRole('button', { name: 'Удалить' }).click();
    await page.locator('.confirm-box').getByRole('button', { name: 'Удалить' }).click();
    await row.waitFor({ state: 'detached', timeout: 5000 });
  });
} else {
  await shot('voice-voices.jpg');
  await fail('запись по --fake не прошла проверку — проба и сохранение не проверены');
}

await check('в окне нет ошибок JavaScript', async () => {
  if (errors.length) throw new Error(errors.join('; '));
});

await browser.close();
cleanup();
console.log('все пункты ok');
process.exit(0);
