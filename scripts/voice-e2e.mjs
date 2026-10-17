// Сквозная проверка панели голоса: поддельный голосовой сервис (--fake), сервер разработки окна (vite)
// и Chromium с поддельным микрофоном (WAV с «речью» — всплесками звука — и паузами).
//
//   node scripts/voice-e2e.mjs [--shots DIR] [--python PATH] [--url http://localhost:5173] [--no-stub] [--aec on|off]
//
// Шлюза нет: по умолчанию ответ /api/voice подставляется («ready»); --no-stub — без подстановки (шлюз молчит,
// сервис «запущен вручную» — окно должно подключиться само).
//
// Поддельное распознавание отдаёт строки --fake-script по очереди: «штаб, открой переигровку» →
// раздел «Переигровка»; «передайте в штаб армии» — в ленте «не мне»; «штаб, что я могу сказать» → ответ
// с примерами; дальше — текст для записи голоса (его же «распознаёт» проверка записи). Перебивание словом —
// на перезапущенном сервисе: «штаб, что я могу сказать» (штаб отвечает), затем «стоп» (его обрывает).
// Подавление эха — как решит сервис (--aec передаётся ему; по умолчанию — есть ли пакет livekit): с ним окно берёт
// микрофон без обработки браузера и шлёт кадры с опорой (в ней — голос штаба), без него — кадры только микрофона.
// Перебивание словом проверяется на сервисе с --aec off: у поддельного микрофона нет эха, и AEC3, ещё не привязавшись
// к опоре, глушит его «речь», пока штаб говорит; заодно окно должно взять микрофон заново — с обработкой браузера.
// Модель за правилами — на поддельной LM Studio (/llm/…): свободная формулировка, выдуманное действие, «Думаю»,
// отмена старого ответа новой репликой, «модель молчит».
// По каждому пункту печатается «ok …»; первый провал — код выхода 1. --shots DIR — снимки 1440×900 (JPEG)
// панели, калибровки, голосов и раздела «ИИ» (модель для голоса).
// Python — $VOICE_PYTHON, services/voice/.venv или python3.
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
const AEC = arg('--aec');
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
// перебивание словом: штаб отвечает на «что я могу сказать», следующий кусок речи — «стоп»
const script3 = join(tmp, 'script3.txt');
writeFileSync(script3, ['штаб, что я могу сказать', ...Array(50).fill('стоп')].join('\n') + '\n');

// встроенные образцы голоса — из scripts/voice-bench/ref (в репозиторий не входят); нет их — свой образец:
// поддельный синтез, как и настоящий, без образца не говорит
const BENCH = join(ROOT, 'scripts/voice-bench');
let seed = BENCH;
if (!existsSync(join(BENCH, 'ref/zhukov-10s.wav'))) {
  seed = join(tmp, 'seed');
  mkdirSync(join(seed, 'ref'), { recursive: true });
  speechWav(join(seed, 'ref/zhukov-10s.wav'));
  speechWav(join(seed, 'ref/zhukov-14s.wav'));  // второй образец — проба одного голоса, затем другого
  writeFileSync(join(seed, 'refs.json'), JSON.stringify({ refs: {
    'zhukov-10s': { file: 'ref/zhukov-10s.wav', text: 'Образец для проверки.' },
    'zhukov-14s': { file: 'ref/zhukov-14s.wav', text: 'Второй образец для проверки.' },
  } }));
}

const vport = await freePort();
let voice = null;
async function startVoice(lines = script, aec = AEC) {
  voice = run(PY, ['server.py', '--fake', '--fake-script', lines, '--port', String(vport), '--data', join(tmp, 'data'), '--seed-refs', seed,
    ...(aec ? ['--aec', aec] : [])],
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
// наблюдение за окном (на каждой загрузке): сообщения сервиса, звук по номерам фраз (кусок звука сервиса →
// источник звука окна), дорожки микрофона и сколько раз его просили
await ctx.addInitScript(() => {
  // frames — кадры микрофона: сколько каких (mono — только микрофон, ref — с опорой), refLoud — кадров, где в опоре
  // громкий звук (голос штаба); gumAudio — что просили у браузера для микрофона
  const e2e = { msgs: [], sent: [], sources: [], tracks: [], gum: 0, gumAudio: [], frames: { mono: 0, ref: 0, refLoud: 0 } };
  window.__e2e = e2e;
  let cur = null;
  const Ws = window.WebSocket;
  window.WebSocket = class extends Ws {
    set onmessage(f) {
      super.onmessage = f && ((e) => {
        if (typeof e.data === 'string') { try { e2e.msgs.push(JSON.parse(e.data)); } catch { /* */ } }
        else if (e.data.byteLength >= 5) cur = new DataView(e.data).getUint32(1, true);
        try { return f.call(this, e); } finally { cur = null; }
      });
    }
    get onmessage() { return super.onmessage; }
    send(d) {
      if (typeof d === 'string') { try { e2e.sent.push(JSON.parse(d)); } catch { /* */ } }
      else if (d.byteLength % 2 === 0) e2e.frames.mono++;
      else {
        e2e.frames.ref++;
        const v = new DataView(d), n = (d.byteLength - 1) / 4;
        let peak = 0;
        for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(v.getInt16(1 + 2 * n + 2 * i, true)));
        if (peak > 3000) e2e.frames.refLoud++;
      }
      return super.send(d);
    }
  };
  const start = AudioBufferSourceNode.prototype.start;
  const stop = AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start = function (...a) {
    const rec = { id: cur, on: true };
    this.__rec = rec;
    e2e.sources.push(rec);
    this.addEventListener('ended', () => { rec.on = false; });
    return start.apply(this, a);
  };
  AudioBufferSourceNode.prototype.stop = function (...a) { if (this.__rec) this.__rec.on = false; return stop.apply(this, a); };
  /** Номера фраз, звук которых играет или ждёт очереди (0 — звук калибровки). */
  e2e.playing = () => [...new Set(e2e.sources.filter((s) => s.on).map((s) => s.id))];
  /** Звучащие пробы голоса (номера из отправленных `voice preview`). */
  e2e.previews = () => { const ids = e2e.sent.filter((m) => m.op === 'preview').map((m) => m.id); return e2e.playing().filter((id) => ids.includes(id)); };
  const md = navigator.mediaDevices;
  if (md?.getUserMedia) {
    const gum = md.getUserMedia.bind(md);
    md.getUserMedia = async (c) => { e2e.gum++; e2e.gumAudio.push(c?.audio); const st = await gum(c); e2e.tracks.push(...st.getTracks()); return st; };
  }
  e2e.trackStates = () => e2e.tracks.map((t) => t.readyState);
});
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

await check('подавление эха: захват микрофона и кадры — по режиму сервиса', async () => {
  const st = await page.evaluate(() => ({ ready: window.__e2e.msgs.find((m) => m.type === 'ready'), audio: window.__e2e.gumAudio.at(-1), frames: window.__e2e.frames }));
  const aec = st.ready?.aec === true;
  if (AEC && aec !== (AEC === 'on')) throw new Error(`сервис с --aec ${AEC} сказал aec: ${st.ready?.aec}`);
  const raw = st.audio && st.audio.echoCancellation === false && st.audio.noiseSuppression === false && st.audio.autoGainControl === false;
  const proc = st.audio && st.audio.echoCancellation === true;
  if (aec ? !raw : !proc) throw new Error(`микрофон взят с ${JSON.stringify(st.audio)} при aec: ${aec}`);
  if (aec) {
    if (!st.frames.ref) throw new Error(`нет кадров с опорой: ${JSON.stringify(st.frames)}`);
    await page.waitForFunction(() => window.__e2e.frames.refLoud > 0, null, { timeout: 20000, polling: 50 })
      .catch(async () => { throw new Error(`в опоре нет голоса штаба, хотя он отвечал: ${JSON.stringify(await page.evaluate(() => window.__e2e.frames))}`); });
    st.frames = await page.evaluate(() => window.__e2e.frames);
  } else if (st.frames.ref || !st.frames.mono) throw new Error(`без подавления эха кадры ${JSON.stringify(st.frames)}`);
  return aec ? `с подавлением: кадров с опорой ${st.frames.ref}, с голосом штаба ${st.frames.refLoud}` : `без подавления: кадров ${st.frames.mono}`;
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
  await dlg.getByText('Регуляторы выставлены').waitFor({ timeout: 60000 })
    .catch(async () => { throw new Error(`нет итога калибровки: «${(await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 300)}»`); });
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

const previews = () => page.evaluate(() => window.__e2e.previews());
/** Прослушать (btn) и дождаться, что проба звучит; вернуть её номер. */
async function playPreview(btn) {
  await btn.click();
  const id = await page.evaluate(() => window.__e2e.sent.filter((m) => m.op === 'preview').at(-1)?.id);
  await page.waitForFunction((x) => window.__e2e.previews().includes(x), id, { timeout: 15000, polling: 20 })
    .catch(() => { throw new Error(`проба ${id} не звучит`); });
  return id;
}
async function silentWithin(ms, what) {
  try {
    await page.waitForFunction(() => !window.__e2e.previews().length, null, { timeout: ms, polling: 20 });
  } catch { throw new Error(`${what}: звук не прекратился за ${ms} мс (звучат пробы ${JSON.stringify(await previews())})`); }
}
/** Сервис остановил фразу: `say-done stopped`. */
const serviceStopped = (id) => page.waitForFunction(
  (x) => window.__e2e.msgs.some((m) => m.id === x && m.type === 'say-done' && m.stopped), id, { timeout: 3000 },
).catch(() => { throw new Error(`сервис не остановил пробу ${id} (нет say-done stopped)`); });

await check('голоса: проба одного голоса, затем другого — звучит только вторая', async () => {
  const dlg = page.locator('.vp-dialog.voices');
  const rows = dlg.locator('.vp-voice');
  if ((await rows.count()) < 2) throw new Error(`образцов меньше двух: ${await rows.count()}`);
  const a = await playPreview(rows.nth(0).getByRole('button', { name: 'Прослушать' }));
  const b = await playPreview(rows.nth(1).getByRole('button', { name: 'Прослушать' }));
  try {
    await page.waitForFunction((x) => !window.__e2e.previews().includes(x), a, { timeout: 1000, polling: 20 });
  } catch { throw new Error(`проба ${a} звучит вместе с новой ${b}`); }
  await serviceStopped(a);
  const p = await previews();
  if (p.some((id) => id !== b)) throw new Error(`звучат пробы ${JSON.stringify(p)}, а должна только ${b}`);
  return `прервана ${a}, звучит ${b}`;
});

await check('голоса: закрыть окно во время пробы — звук прекращён', async () => {
  const dlg = page.locator('.vp-dialog.voices');
  const a = await playPreview(dlg.locator('.vp-voice').nth(0).getByRole('button', { name: 'Прослушать' }));
  await dlg.getByRole('button', { name: 'Закрыть' }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 3000 });
  await silentWithin(1000, 'окно закрыто');
  await serviceStopped(a);
});

await check('голоса: начать запись нового голоса — проба остановлена', async () => {
  await panel.getByRole('button', { name: 'Голоса' }).click();
  const dlg = page.locator('.vp-dialog.voices');
  await dlg.waitFor({ state: 'visible', timeout: 3000 });
  await playPreview(dlg.locator('.vp-voice').nth(0).getByRole('button', { name: 'Прослушать' }));
  await dlg.getByRole('button', { name: 'Записать новый голос' }).click();
  await dlg.getByRole('button', { name: 'Начать запись' }).click();
  await silentWithin(1000, 'запись началась');
  await dlg.getByRole('button', { name: 'Закончить запись' }).click();
  await dlg.locator('.vp-check').waitFor({ timeout: 20000 });
  await dlg.getByRole('button', { name: /Не сохранять|Отмена/ }).click();
  await dlg.getByRole('button', { name: 'Закрыть' }).click();
  await dlg.waitFor({ state: 'hidden', timeout: 3000 });
});

await check('калибровка: закрыть окно во время голоса штаба — звук прекращён', async () => {
  await panel.getByRole('button', { name: 'Калибровка' }).click();
  await calibSteps(1, 2);
  await calibDlg.getByText('шаг 3 из 4').waitFor({ timeout: 40000 });
  await calibDlg.getByRole('button', { name: 'Записать' }).click();
  await page.waitForFunction(() => window.__e2e.playing().includes(0), null, { timeout: 15000, polling: 20 });
  await calibDlg.getByRole('button', { name: 'Отмена' }).click();
  await calibDlg.waitFor({ state: 'hidden', timeout: 3000 });
  try {
    await page.waitForFunction(() => !window.__e2e.playing().includes(0), null, { timeout: 1000, polling: 20 });
  } catch { throw new Error('звук калибровки не прекратился за 1000 мс'); }
});

await check('калибровка: закрыть окно, пока голос штаба готовится, — он не зазвучит потом', async () => {
  await panel.getByRole('button', { name: 'Калибровка' }).click();
  await calibSteps(1, 2);
  await calibDlg.getByText('шаг 3 из 4').waitFor({ timeout: 40000 });
  await calibDlg.getByRole('button', { name: 'Записать' }).click();
  await calibDlg.getByRole('button', { name: 'Отмена' }).click();
  // отсюда ни один кусок звука калибровки не должен начаться (даже на миг)
  const n = await page.evaluate(() => window.__e2e.sources.length);
  await calibDlg.waitFor({ state: 'hidden', timeout: 3000 });
  await page.waitForTimeout(2000);
  const late = await page.evaluate((k) => window.__e2e.sources.slice(k).filter((s) => s.id === 0).length, n);
  if (late) throw new Error(`после закрытия начато кусков звука калибровки: ${late}`);
});

const micOff = async (what) => {
  try {
    await page.waitForFunction(() => { const t = window.__e2e.trackStates(); return t.length > 0 && t.every((s) => s === 'ended'); }, null, { timeout: 3000 });
  } catch { throw new Error(`${what}: дорожки микрофона ${JSON.stringify(await page.evaluate(() => window.__e2e.trackStates()))}`); }
};
const micOn = () => page.waitForFunction(() => window.__e2e.trackStates().includes('live'), null, { timeout: 15000 });
const LIVE = /Жду обращения|Слушаю|Думаю|Говорит|Разговор/;

await check('кнопка «Выключить голос»: микрофон освобождён, «Голос выключен»', async () => {
  await panel.getByRole('button', { name: 'Выключить голос' }).click();
  await panel.locator('.vp-state', { hasText: 'Голос выключен' }).waitFor({ timeout: 3000 });
  await micOff('после выключения');
  const saved = await page.evaluate(() => localStorage.getItem('def_ops.voice.enabled'));
  if (saved !== 'false') throw new Error(`def_ops.voice.enabled = ${saved}`);
  await page.waitForTimeout(2500);
  const gum = await page.evaluate(() => window.__e2e.gum);
  await micOff('через 2,5 с');
  if (await panel.getByRole('button', { name: 'Калибровка' }).isEnabled()) throw new Error('калибровка доступна при выключенном голосе');
  await plainWords(panel.locator('.vp-card'), 'панель при выключенном голосе');
  await shot('voice-panel-off.jpg');
  return `микрофон просили ${gum} раз`;
});

await check('перезагрузка: голос остаётся выключенным, микрофон не спрашивается', async () => {
  await page.reload();
  await panel.locator('.vp-state', { hasText: 'Голос выключен' }).waitFor({ timeout: T });
  await page.waitForTimeout(3000);
  const gum = await page.evaluate(() => window.__e2e.gum);
  if (gum) throw new Error(`микрофон спрошен ${gum} раз`);
  await panel.getByRole('button', { name: 'Свернуть' }).click();
  const icon = page.locator('.vp-icon');
  await icon.getByText('Голос выключен').waitFor({ state: 'visible', timeout: 2000 });
  if (!(await icon.locator('.vp-cross').count())) throw new Error('значок не перечёркнут');
  await shot('voice-icon-off.jpg');
  await icon.click();
});

await check('«Включить голос» → «Жду обращения», микрофон снова открыт', async () => {
  await panel.getByRole('button', { name: 'Включить голос' }).click();
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: T });
  await micOn();
  const saved = await page.evaluate(() => localStorage.getItem('def_ops.voice.enabled'));
  if (saved === 'false') throw new Error('выключение осталось записанным');
});

await check('событие voice:power: false — выключает, true — включает', async () => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:power', { detail: false })));
  await panel.locator('.vp-state', { hasText: 'Голос выключен' }).waitFor({ timeout: 3000 });
  await micOff('после voice:power false');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:power', { detail: true })));
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: T });
  await micOn();
});


// ---------------------------------------------------------------- модель за правилами (поддельная LM Studio)
//
// Поддельная LM Studio отвечает за /llm/… (адрес модели по умолчанию) прямо в Playwright: /v1/models — список
// моделей, /v1/chat/completions — по ключевым словам последней реплики: вызов инструмента, текст, текст с
// задержкой, «молчит» (соединение обрывается сразу — как будто LM Studio не запущена) или «висит» (каждая попытка
// обрывается через 3 с — модель ещё ждёт, когда приходит следующая реплика).
const LM = { asked: [], settled: [] };
const lmReply = (content, tool) => ({
  id: 'fake', object: 'chat.completion', model: 'fake-voice',
  choices: [{ index: 0, finish_reason: tool ? 'tool_calls' : 'stop', message: {
    role: 'assistant', content,
    ...(tool ? { tool_calls: [{ id: 'call_1', type: 'function', function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : {}),
  } }],
});
const LM_SLOW_MS = 9000;
/** Ответ по ключевым словам: body — ответ; slow — задержка; fail — обрыв (сразу или через hang мс). */
function lmAnswer(text) {
  const t = text.toLowerCase();
  if (/карт/.test(t)) return { body: lmReply('Перехожу к картам.', { name: 'shell__open', args: { section: 'maps' } }) };
  if (/вальс/.test(t)) return { body: lmReply('Играю вальс.', { name: 'music__waltz', args: {} }) };
  if (/обстановк/.test(t)) return { body: lmReply('Обстановка спокойная, противник молчит.'), slow: LM_SLOW_MS };
  if (/соседей/.test(t)) return { fail: true };
  if (/фланге/.test(t)) return { fail: true, hang: 3000 };
  return { body: lmReply('Слушаю.') };
}
async function fakeLmStudio() {
  // только адрес модели (/llm/…), не модули окна с «llm» в пути
  await ctx.route((u) => u.pathname.startsWith('/llm/'), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/v1/models')) return route.fulfill({ json: { object: 'list', data: [{ id: 'fake-voice', object: 'model' }] } });
    if (!url.pathname.endsWith('/v1/chat/completions')) return route.fulfill({ status: 404, body: '' });
    const said = route.request().postDataJSON().messages.at(-1)?.content ?? '';
    LM.asked.push(said);
    const a = lmAnswer(said);
    const wait = a.slow ?? a.hang ?? 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    // запрос могли отменить (новая реплика) — тогда ответить уже некому
    if (a.fail) await route.abort('connectionrefused').catch(() => {});
    else await route.fulfill({ json: a.body }).catch(() => {});
    LM.settled.push(said);
  });
}
const script4 = join(tmp, 'script4.txt');
writeFileSync(script4, ['штаб, давай-ка перейдём к картам', 'штаб, а сыграй мне вальс', 'штаб, доложи обстановку',
  'штаб, открой знания', 'штаб, как дела у соседей', 'штаб, что нового на фланге', 'штаб, открой переигровку',
  ...Array(50).fill(RECORD_TEXT)].join('\n') + '\n');
const chiefSaid = (re) => panel.locator('.vp-item.chief', { hasText: re });
const RETRY = 'Связь с моделью прервалась';
async function until(cond, ms, what) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(what);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function llmChecks() {
  await fakeLmStudio();
  // режим «голосом»: в режиме «словом» поддельное распознавание проверяет куски речи поверх штаба (стоп-слово ли)
  // и на каждом снимает следующую строку сценария — строки «съедаются». Человек в режиме «словом» реплику
  // «Штаб, …» не теряет (обращение обрывает штаб), но сквозная проверка шла бы не по сценарию
  await panel.getByText('Тонкая настройка').click();
  await panel.getByRole('group', { name: 'Перебивать' }).getByRole('button', { name: 'голосом' }).click();
  await panel.getByText('Тонкая настройка').click();
  await stopVoice();
  await startVoice(script4);
  await check('модель: «Штаб, давай-ка перейдём к картам» → раздел «Карты» и ответ штаба', async () => {
    await page.waitForFunction(() => location.hash === '#maps', null, { timeout: 60000 });
    await chiefSaid('Перехожу к картам').waitFor({ timeout: 10000 });
    if (!LM.asked.some((x) => /картам/.test(x))) throw new Error('модель не спрошена');
  });
  await check('модель: «Штаб, а сыграй мне вальс» → «Этого система пока не предусматривает…»', async () => {
    await chiefSaid('Этого система пока не предусматривает').waitFor({ timeout: 30000 });
    if (await chiefSaid('Играю вальс').count()) throw new Error('выдуманное действие озвучено');
  });
  await check('модель: пока отвечает — «Думаю»', async () => {
    await panel.locator('.vp-item', { hasText: 'доложи обстановку' }).waitFor({ timeout: 30000 });
    await panel.locator('.vp-state', { hasText: 'Думаю' }).waitFor({ timeout: 5000 });
    await shot('voice-panel-thinking.jpg');
  });
  await check('модель: новая реплика во время ожидания — старый ответ не звучит', async () => {
    await page.waitForFunction(() => location.hash === '#knowledge', null, { timeout: 30000 });
    if (LM.settled.some((x) => /обстановк/.test(x))) throw new Error('ответ на «обстановку» отдан раньше новой реплики — проверка вхолостую');
    // ждём, когда поддельная LM Studio отдаст ответ на «обстановку», и ещё секунду — он не должен появиться
    await until(() => LM.settled.some((x) => /обстановк/.test(x)), LM_SLOW_MS + 5000, 'поддельная LM Studio не ответила на «обстановку»');
    await page.waitForTimeout(1000);
    if (await chiefSaid('Обстановка спокойная').count()) throw new Error('отменённый ответ показан');
    return `ответ отдан через ${LM_SLOW_MS / 1000} с и не прозвучал`;
  });
  await check('модель молчит: повтор один раз, затем «Связи с моделью нет»', async () => {
    await chiefSaid('Связи с моделью нет').waitFor({ timeout: 30000 });
    const retry = await chiefSaid(RETRY).count();
    if (retry !== 1) throw new Error(`заготовленная фраза о повторе прозвучала ${retry} раз`);
  });
  await check('правила работают, пока модель ещё ждёт: «Штаб, открой переигровку»', async () => {
    // «что нового на фланге»: попытки висят по 3 с — модель ждёт; повтор прозвучал, «Связи нет» ещё нет
    await until(() => LM.asked.some((x) => /фланге/.test(x)), 30000, 'модель не спрошена о фланге');
    await chiefSaid(RETRY).nth(1).waitFor({ timeout: 15000 });
    await page.waitForFunction(() => location.hash === '#replay', null, { timeout: 30000 });
    const lost = await chiefSaid('Связи с моделью нет').count();
    if (lost !== 1) throw new Error(`к переходу «Связи с моделью нет» прозвучало ${lost} раз — ожидание кончилось раньше`);
    // отменённое ожидание не договаривается: «Связи с моделью нет» по «флангу» так и не звучит
    await page.waitForTimeout(8000);
    if ((await chiefSaid('Связи с моделью нет').count()) !== 1) throw new Error('отменённое ожидание сообщило «Связи с моделью нет»');
    await plainWords(panel.locator('.vp-feed'), 'лента');
  });
  await stopVoice();
  await startVoice(script2);
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: 40000 });
}
// ---------------------------------------------------------------- конец: модель за правилами

await llmChecks();

// снимок для описания: раздел «ИИ», карточка «Голос» (модель для голоса) — только с --shots, проверок нет
if (SHOTS) {
  await panel.getByRole('button', { name: 'Свернуть' }).click();
  await page.evaluate(() => { location.hash = '#staff'; });
  const card = page.locator('.staff-voice');
  await card.waitFor({ state: 'visible', timeout: 10000 });
  // связь проверена при загрузке окна, до поддельной LM Studio, — проверить заново
  await page.getByRole('button', { name: 'Проверить связь' }).click();
  await page.getByText('моделей: 1').first().waitFor({ timeout: 10000 }).catch(() => {});
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(1000);
  await shot('ai-voice-model.jpg');
  await page.evaluate(() => { location.hash = '#replay'; });
  await page.locator('.vp-icon').click();
  await panel.locator('.vp-card').waitFor({ state: 'visible', timeout: 5000 });
}

await check('тонкая настройка: «Перебивать: голосом / словом» переключается и запоминается', async () => {
  await panel.getByText('Тонкая настройка').click();
  const mode = panel.getByRole('group', { name: 'Перебивать' });
  const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('def_ops.voice.settings') || '{}').barge_mode);
  const accepted = (m) => page.waitForFunction((x) => window.__e2e.msgs.some((s) => s.type === 'settings' && s.barge_mode === x), m, { timeout: 3000 })
    .catch(() => { throw new Error(`сервис не принял режим ${m}`); });
  await mode.getByRole('button', { name: 'голосом' }).click();
  if ((await saved()) !== 'voice') throw new Error(`после «голосом» сохранено ${await saved()}`);
  await accepted('voice');
  await mode.getByRole('button', { name: 'словом' }).click();
  if ((await saved()) !== 'word') throw new Error(`после «словом» сохранено ${await saved()}`);
  await accepted('word');
  await panel.getByText('Штаб замолкает, когда вы скажете «Стоп»').waitFor({ timeout: 2000 });
  await page.reload();
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: T });
  await panel.getByText('Тонкая настройка').click();
  const on = await panel.getByRole('group', { name: 'Перебивать' }).getByRole('button', { name: 'словом' }).getAttribute('aria-pressed');
  if (on !== 'true') throw new Error('после перезагрузки режим не «словом»');
  const hello = await page.evaluate(() => window.__e2e.sent.find((m) => m.type === 'hello')?.settings?.barge_mode);
  if (hello !== 'word') throw new Error(`окно сообщило сервису режим ${hello}`);
  await plainWords(panel.locator('.vp-card'), 'тонкая настройка');
  await panel.getByText('Тонкая настройка').click();
});

await check('режим «словом»: пока штаб говорит — «Перебить: скажите «Стоп»», «стоп» его обрывает', async () => {
  await stopVoice();
  const gum0 = await page.evaluate(() => window.__e2e.gum);
  await startVoice(script3, 'off');
  const hint = panel.locator('.vp-hint.stop', { hasText: 'Перебить: скажите «Стоп»' });
  await hint.waitFor({ timeout: 40000 });
  await panel.locator('.vp-state', { hasText: 'Говорит начальник штаба' }).waitFor({ timeout: 1000 });
  await shot('voice-panel-stop.jpg');
  await page.waitForFunction(() => window.__e2e.msgs.some((m) => m.type === 'barge'), null, { timeout: 20000 })
    .catch(() => { throw new Error('«стоп» не оборвал штаб'); });
  await hint.waitFor({ state: 'hidden', timeout: 2000 });
  const st = await page.evaluate(() => ({ audio: window.__e2e.gumAudio.at(-1), gum: window.__e2e.gum, frames: { ...window.__e2e.frames } }));
  if (st.audio?.echoCancellation !== true) throw new Error(`сервис без подавления эха, а микрофон взят с ${JSON.stringify(st.audio)}`);
  await page.waitForTimeout(500);
  const later = await page.evaluate(() => window.__e2e.frames);
  if (later.ref !== st.frames.ref || later.mono <= st.frames.mono) throw new Error(`кадры после перезапуска без подавления эха: ${JSON.stringify(later)}`);
  return st.gum > gum0 ? 'микрофон переоткрыт с обработкой браузера' : 'микрофон уже был с обработкой браузера';
});

await check('в окне нет ошибок JavaScript', async () => {
  if (errors.length) throw new Error(errors.join('; '));
});

await browser.close();
cleanup();
console.log('все пункты ok');
process.exit(0);
