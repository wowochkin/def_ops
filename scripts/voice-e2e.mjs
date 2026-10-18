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
// отмена старого ответа новой репликой, модель «висит» (повтор), LM Studio не запущена (без повторов; следующая
// непонятая фраза — сразу честный ответ, без «Думаю»). Подавление эха не то, при котором сняты регуляторы, —
// подсказка «пройдите калибровку заново» и перебивание «словом».
// Тур: вступление при запуске (новое окно, калибровки не было) — подсветка колонки разделов, «Штаб, дальше» —
// рамка на кнопке колонки, «назад» без обращения, «Штаб, хватит» снимает притемнение; voice:ready-first отменён
// вступлением, после него — voice:propose; флажок «Вступление при запуске» в «Тонкой настройке». Туры разделов:
// «Штаб, открой моделирование» — предложение тура; «Штаб, открой вкладку Калибровка»; «Штаб, тур по моделированию» —
// шаги открывают вкладки; «Штаб, тур по знакам» — подсветка внутри страницы справочника (iframe).
// Без рук (ни одного щелчка — только поддельный микрофон): дежурный режим («отбой» — дежурю, «открой карты» не
// исполняется, «на связь» будит), вопросы dialogs.ts голосом (confirmAsync — «да», команда при открытом окне не
// исполняется; chooseAsync — «второй»; askText — диктовка и «готово»), окно «Голоса» (прослушать, назначить, записать
// новый голос, удалить — с подтверждением «да»), калибровка голосом (шаги идут сами, «готово»), предложение калибровки
// при первом запуске («нет»), вход в командование и обстановка («открой переигровку» → «рассчитай операцию» →
// «прими командование» → «без штаба» → «принимаю» → «доложи обстановку» → «покажи Зелов» → «оперативный уровень»),
// советник и решение («дай два варианта» — поддельная LM Studio отвечает вариантами → «подробнее о первом» →
// «выбираю первый» → «восьмой гвардейской наступать на Зелов» → «запиши в замысел: …» → «что не готово?»).
// По каждому пункту печатается «ok …»; первый провал — код выхода 1. --shots DIR — снимки 1440×900 (JPEG)
// панели, калибровки, голосов, раздела «ИИ» (модель для голоса) и туров (voice-tour.jpg, voice-tour-modeling.jpg,
// voice-tour-library.jpg).
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
  // что было в ленте панели — чтобы понять провал без повторного прогона
  try { console.log(`лента: ${(await page.locator('.vp-feed').innerText({ timeout: 1000 })).replace(/\s*\n\s*/g, ' | ').slice(-1500)}`); } catch { /* */ }
  if (process.env.E2E_DEBUG) try { console.log(JSON.stringify(await page.evaluate(() => window.__e2e.msgs.filter((m) => m.type !== 'level').slice(-40)))); console.log(voice?.log().slice(-3000)); } catch { /* */ }
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
  localStorage.setItem('def_ops.voice.intro', 'off');  // вступление — в своей проверке в конце
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
  // звуковые сигналы окна (калибровка голосом: «читайте» и «хватит» на шаге «Ваш голос»)
  e2e.beeps = 0;
  const ostart = OscillatorNode.prototype.start;
  OscillatorNode.prototype.start = function (...a) { e2e.beeps++; return ostart.apply(this, a); };
  // предложение калибровки при первом запуске — только в своей проверке (иначе вопрос штаба вмешался бы в сценарии)
  window.addEventListener('voice:ready-first', (e) => { if (!sessionStorage.getItem('e2e.offer')) e.preventDefault(); });
  /** Состояния панели по порядку (каждые 30 мс): было ли «Думаю». */
  e2e.states = [];
  setInterval(() => { const t = document.querySelector('.vp-state')?.textContent; if (t && t !== e2e.states.at(-1)) e2e.states.push(t); }, 30);
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

await check('кнопка «Калибровка» открывает калибровку (шаги — кнопкой «Записать»)', async () => {
  await panel.getByRole('button', { name: 'Калибровка' }).click();
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
// задержкой, «не запущена» (соединение отвергается сразу) или «висит» (каждая попытка кончается через 3 с ответом
// 500 — сбой самой модели, повторяется; модель ещё ждёт, когда приходит следующая реплика).
const LM = { asked: [], settled: [], models: 0, plans: 0 };
/** Ответ потоком (stream: true): content кусками, затем [DONE]. */
const sse = (content) => [...content.match(/[\s\S]{1,200}/g).map((c) => `data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: c } }] })}\n\n`),
  `data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] })}\n\n`, 'data: [DONE]\n\n'].join('');
/** Варианты решения от «советника»: донесения в первом нет — «что не готово?» его назовёт. */
const planVariant = (title, idea, formation) => ({
  title, idea, assessment: 'Противник удерживает Зееловские высоты, подвоз доходит.', enemyIntent: 'Удержать высоты (предположение).',
  intent: `${formation}: главный удар на Зелов.`, risks: 'Контрудар с юга.', report: '',
  orders: [{ formation, task: 'attack', area: 'Зелов', toArea: null, why: 'главный удар' }], actions: [],
});
const PLAN = { variants: [planVariant('Удар на Зелов', 'Главный удар через Зелов.', '8-я гвардейская армия'), planVariant('Удар пятой ударной', 'Главный удар правее.', '5-я ударная армия')] };
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
  if (/фланге/.test(t)) return { status: 500, hang: 3000 };
  if (/погод/.test(t)) return { body: lmReply('Солнечно.') };
  return { body: lmReply('Слушаю.') };
}
async function fakeLmStudio() {
  // только адрес модели (/llm/…), не модули окна с «llm» в пути
  await ctx.route((u) => u.pathname.startsWith('/llm/'), async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/v1/models')) LM.models++;
    if (url.pathname.endsWith('/v1/models')) return route.fulfill({ json: { object: 'list', data: [{ id: 'fake-voice', object: 'model' }] } });
    if (!url.pathname.endsWith('/v1/chat/completions')) return route.fulfill({ status: 404, body: '' });
    const body = route.request().postDataJSON();
    // советник (поток окна игры): варианты решения на ход — потоком SSE, как LM Studio
    if (body.response_format?.json_schema?.name === 'staff_plan') { LM.plans++; return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(JSON.stringify(PLAN)) }).catch(() => {}); }
    const said = body.messages.at(-1)?.content ?? '';
    LM.asked.push(said);
    const a = lmAnswer(said);
    const wait = a.slow ?? a.hang ?? 0;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    // запрос могли отменить (новая реплика) — тогда ответить уже некому
    if (a.fail) await route.abort('connectionrefused').catch(() => {});
    else if (a.status) await route.fulfill({ status: a.status, json: { error: 'сбой модели' } }).catch(() => {});
    else await route.fulfill({ json: a.body }).catch(() => {});
    LM.settled.push(said);
  });
}
const script4 = join(tmp, 'script4.txt');
writeFileSync(script4, ['штаб, давай-ка перейдём к картам', 'штаб, а сыграй мне вальс', 'штаб, что там с обстановкой',
  'штаб, открой знания', 'штаб, что нового на фланге', 'штаб, открой переигровку', 'штаб, как дела у соседей',
  'штаб, расскажи про погоду', ...Array(50).fill(RECORD_TEXT)].join('\n') + '\n');
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
  // связь с моделью проверена при загрузке окна, до поддельной LM Studio, и не прошла — модель голосом не зовётся;
  // человек запустил LM Studio и вернулся в окно — связь проверяется заново
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await until(() => LM.models > 0, 10000, 'связь с моделью не проверена заново');
  await page.waitForTimeout(500);
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
    await panel.locator('.vp-item', { hasText: 'что там с обстановкой' }).waitFor({ timeout: 30000 });
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
  await check('правила работают, пока модель ещё ждёт: «Штаб, открой переигровку»', async () => {
    // «что нового на фланге»: попытки висят по 3 с и кончаются сбоем модели — повтор прозвучал, «Связи нет» нет
    await until(() => LM.asked.some((x) => /фланге/.test(x)), 30000, 'модель не спрошена о фланге');
    await chiefSaid(RETRY).first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => location.hash === '#replay', null, { timeout: 30000 });
    const lost = await chiefSaid('Связи с моделью нет').count();
    if (lost) throw new Error(`к переходу «Связи с моделью нет» прозвучало ${lost} раз — ожидание кончилось раньше`);
  });
  await check('LM Studio не запущена: без повторов — сразу «Связи с моделью нет»', async () => {
    await chiefSaid('Связи с моделью нет').waitFor({ timeout: 30000 });
    const retry = await chiefSaid(RETRY).count();
    if (retry !== 1) throw new Error(`заготовленная фраза о повторе прозвучала ${retry} раз (ждали один — по «флангу»)`);
    const asked = LM.asked.filter((x) => /соседей/.test(x)).length;
    if (asked !== 1) throw new Error(`модель спрошена о соседях ${asked} раз`);
  });
  await check('без LM Studio вторая непонятая фраза — сразу честный ответ, без «Думаю» и без модели', async () => {
    const k = await page.evaluate(() => window.__e2e.states.length);
    const heard = panel.locator('.vp-item', { hasText: 'расскажи про погоду' });
    await heard.waitFor({ timeout: 30000 });
    const t0 = Date.now();
    await chiefSaid('Языковая модель сейчас недоступна').waitFor({ timeout: 5000 });
    const dt = Date.now() - t0;
    if (dt > 1500) throw new Error(`ответ через ${dt} мс`);
    if (LM.asked.some((x) => /погод/.test(x))) throw new Error('модель спрошена, хотя недоступна');
    const states = await page.evaluate((i) => window.__e2e.states.slice(i), k);
    if (states.includes('Думаю')) throw new Error(`было «Думаю»: ${states.join(' → ')}`);
    if ((await chiefSaid('Связи с моделью нет').count()) !== 1) throw new Error('«Связи с моделью нет» — не один раз');
    // отменённое ожидание по «флангу» так и не договорилось
    await plainWords(panel.locator('.vp-feed'), 'лента');
    return `ответ через ${dt} мс`;
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
  await shot('ai-settings.jpg');
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

await check('подавление эха не то, что при калибровке: подсказка «пройдите калибровку заново», перебивание «словом»', async () => {
  const aec = await page.evaluate(() => window.__e2e.msgs.filter((m) => m.type === 'ready').at(-1)?.aec === true);
  // регуляторы будто сняты при другом подавлении эха и с перебиванием «голосом»
  await page.evaluate((a) => {
    const s = JSON.parse(localStorage.getItem('def_ops.voice.settings') || '{}');
    localStorage.setItem('def_ops.voice.settings', JSON.stringify({ vad: 0.5, ...s, barge_mode: 'voice', aec: !a, calib_mode: 'voice' }));
  }, aec);
  await page.reload();
  const box = panel.locator('.vp-aec');
  await box.getByText(`Подавление эха ${aec ? 'включено' : 'выключено'} после настройки — пройдите калибровку заново.`).waitFor({ timeout: T });
  await page.waitForFunction(() => window.__e2e.sent.some((m) => m.type === 'settings' && m.barge_mode === 'word'), null, { timeout: 5000 })
    .catch(() => { throw new Error('перебивание не переведено на «словом»'); });
  await panel.getByText('Тонкая настройка').click();
  const voiceBtn = panel.getByRole('group', { name: 'Перебивать' }).getByRole('button', { name: 'голосом' });
  if (await voiceBtn.isEnabled()) throw new Error('«голосом» доступно до калибровки');
  await panel.getByText('Тонкая настройка').click();
  await shot('voice-panel-aec.jpg');
  await box.getByRole('button', { name: 'Калибровать' }).click();
  await calibDlg.waitFor({ state: 'visible', timeout: 3000 });
  await calibDlg.getByRole('button', { name: 'Отмена' }).click();
  await calibDlg.waitFor({ state: 'hidden', timeout: 3000 });
  return aec ? 'сейчас включено' : 'сейчас выключено';
});

// ---------------------------------------------------------------- без рук: ни одного щелчка
//
// Сервис — без подавления эха и с перебиванием «голосом» (как в проверках модели): строки сценария идут по одной на
// каждый «слог» поддельного микрофона. «{тишина}» — заполнитель (реплики нет).
const QUIET = Array(80).fill('{тишина}');
async function handsFree(lines, { reload = true } = {}) {
  await stopVoice();
  if (reload) {
    await page.evaluate(() => {
      // регуляторы — «голосом»; при каком подавлении эха — допишет ответ сервиса
      localStorage.setItem('def_ops.voice.settings', JSON.stringify({ vad: 0.5, barge_vad: 0.8, barge_ms: 300, end_ms: 400, barge_mode: 'voice', aec_unknown: true }));
      localStorage.setItem('def_ops.section', 'replay');
      localStorage.setItem('def_ops.voice.panel', 'open');
    });
  }
  const f = join(tmp, `hands-${Date.now()}.txt`);
  writeFileSync(f, lines.join('\n') + '\n');
  await startVoice(f, 'off');
  // настоящая перезагрузка (переход на тот же адрес с другим #… страницу не перезагружает — связь помнила бы прежние
  // регуляторы)
  if (reload) { await page.evaluate(() => { location.hash = '#replay'; }); await page.reload(); }
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: 40000 });
}
const feedHas = (re, kind = 'chief') => panel.locator(`.vp-item.${kind}`, { hasText: re });
// щелчки считаются: без рук их быть не должно
await ctx.addInitScript(() => { window.__clicks = 0; window.addEventListener('pointerdown', () => { window.__clicks++; }, true); });

await check('без рук: «Штаб, отбой» — дежурю, микрофон открыт; «открой карты» не исполняется; «на связь» будит', async () => {
  await handsFree(['штаб, отбой', 'штаб, открой карты', 'штаб, на связь', 'штаб, открой карты', ...QUIET]);
  await panel.locator('.vp-state', { hasText: 'Дежурю. Скажите: «Штаб, на связь»' }).waitFor({ timeout: 30000 });
  if (!(await page.evaluate(() => window.__e2e.trackStates().includes('live')))) throw new Error('микрофон закрыт в дежурном режиме');
  await shot('voice-standby.jpg');
  await feedHas('открой карты', 'notme').waitFor({ timeout: 30000 });
  if (await page.evaluate(() => location.hash) === '#maps') throw new Error('в дежурном режиме команда исполнена');
  await feedHas('На связи').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => location.hash === '#maps', null, { timeout: 30000 });
  const clicks = await page.evaluate(() => window.__clicks);
  if (clicks) throw new Error(`щелчков: ${clicks}`);
});

/** Окно dialogs.ts — открывает его сама проверка (как открыл бы раздел); ответ — только голосом. */
async function openDialog(kind, ...args) {
  await page.evaluate(([k, a]) => { window.__dlgOut = undefined; import('/src/dialogs.ts').then((m) => m[k](...a).then((v) => { window.__dlgOut = v; })); }, [kind, args]);
  await page.locator('.confirm-box').waitFor({ timeout: 5000 });
}
const dlgOut = (ms) => page.waitForFunction(() => window.__dlgOut !== undefined, null, { timeout: ms }).then(() => page.evaluate(() => window.__dlgOut));

await check('без рук: вопрос (confirmAsync) зачитан; команда при открытом окне не исполняется; «да» нажимает «Удалить»', async () => {
  await handsFree(QUIET, { reload: false });
  await page.evaluate(() => { location.hash = '#replay'; });
  await openDialog('confirmAsync', 'Удалить слой «Рубежи»?', { ok: 'Удалить', danger: true });
  await feedHas('Удалить слой «Рубежи»? Скажите «да» — «Удалить», или «нет». Жду ответа.').waitFor({ timeout: 5000 });
  await handsFree(['штаб, открой карты', 'штаб, да', ...QUIET], { reload: false });
  await feedHas('Сначала ответьте на вопрос').waitFor({ timeout: 30000 });
  if (await page.evaluate(() => location.hash) !== '#replay') throw new Error('команда исполнена при открытом вопросе');
  const v = await dlgOut(30000);
  if (v !== true) throw new Error(`окно вернуло ${JSON.stringify(v)}`);
  await page.locator('.confirm-box').waitFor({ state: 'detached', timeout: 2000 });
});

await check('без рук: выбор (chooseAsync) — «второй»', async () => {
  await openDialog('chooseAsync', 'Что сделать с игрой?', [{ label: 'Сохранить' }, { label: 'Удалить' }, { label: 'Продолжить' }]);
  await handsFree(['штаб, второй', ...QUIET], { reload: false });
  const v = await dlgOut(30000);
  if (v !== 1) throw new Error(`выбран ${JSON.stringify(v)}`);
});

await check('без рук: строка (askText) — диктовка и «готово»', async () => {
  await openDialog('askText', 'Название участка:', 'Участок');
  await handsFree(['штаб, напиши Зеловские высоты', 'штаб, готово', ...QUIET], { reload: false });
  const v = await dlgOut(40000);
  if (v !== 'Зеловские высоты') throw new Error(`введено ${JSON.stringify(v)}`);
});

await check('без рук: «Голоса» — открыть, прослушать второй, назначить первый посреднику, закрыть', async () => {
  await handsFree(['штаб, голоса', 'штаб, прослушай второй голос', 'штаб, назначь первый голос посреднику', 'штаб, закрой', ...QUIET], { reload: false });
  const dlg = page.locator('.vp-dialog.voices');
  await dlg.waitFor({ state: 'visible', timeout: 30000 });
  const ids = await page.waitForFunction(() => window.__e2e.msgs.filter((m) => m.type === 'voice_list').at(-1)?.voices.map((v) => v.id), null, { timeout: 10000 }).then((h) => h.jsonValue());
  await page.waitForFunction((id) => window.__e2e.sent.some((m) => m.op === 'preview' && m.voice_id === id), ids[1], { timeout: 30000 })
    .catch(() => { throw new Error(`не прослушан второй голос ${ids[1]}`); });
  await page.waitForFunction((id) => window.__e2e.sent.some((m) => m.op === 'assign' && m.role === 'umpire' && m.voice_id === id), ids[0], { timeout: 30000 })
    .catch(() => { throw new Error(`первый голос ${ids[0]} не назначен посреднику`); });
  await dlg.waitFor({ state: 'hidden', timeout: 30000 });
});

await check('без рук: «запиши новый голос гость» — текст зачитан, запись сама началась и кончилась, голос сохранён', async () => {
  await handsFree(['штаб, голоса', 'штаб, запиши новый голос гость', ...Array(60).fill(RECORD_TEXT)], { reload: false });
  const dlg = page.locator('.vp-dialog.voices');
  await dlg.waitFor({ state: 'visible', timeout: 30000 });
  await feedHas('Прочитайте вслух текст с экрана').waitFor({ timeout: 30000 });
  await dlg.locator('.vp-recdot').waitFor({ timeout: 40000 }).catch(() => { throw new Error('запись не началась сама'); });
  await dlg.locator('.vp-recdot').waitFor({ state: 'detached', timeout: 60000 }).catch(() => { throw new Error('запись не кончилась сама'); });
  await dlg.locator('.vp-voice', { hasText: 'Гость' }).waitFor({ timeout: 30000 })
    .catch(async () => { throw new Error(`голос не сохранён: ${(await dlg.innerText()).replace(/\s+/g, ' ').slice(0, 300)}`); });
  await feedHas('Голос «Гость» сохранён').waitFor({ timeout: 10000 });
});

await check('без рук: «удали голос гость» — вопрос крупно с «Да» / «Нет», «да» — удалён; «закрой»', async () => {
  await handsFree(['штаб, удали голос гость', '{тишина}', 'штаб, да', 'штаб, закрой', ...QUIET], { reload: false });
  const q = panel.locator('.vp-confirm');
  await q.getByText('Удалить голос «Гость»?').waitFor({ timeout: 30000 });
  const size = await q.locator('.vp-q').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  if (size < 22) throw new Error(`вопрос шрифтом ${size} px`);
  for (const b of ['Да', 'Нет']) if (!(await q.getByRole('button', { name: b }).isVisible())) throw new Error(`нет кнопки «${b}»`);
  await shot('voice-confirm.jpg');
  const dlg = page.locator('.vp-dialog.voices');
  await dlg.locator('.vp-voice', { hasText: 'Гость' }).waitFor({ state: 'detached', timeout: 30000 });
  await q.waitFor({ state: 'detached', timeout: 2000 });
  await dlg.waitFor({ state: 'hidden', timeout: 30000 });
  return `вопрос ${size} px`;
});

await check('без рук: «Штаб, калибровка» — шаги идут сами, итог словами, «готово» закрывает', async () => {
  await handsFree(['штаб, калибровка', ...Array(60).fill('штаб, готово')], { reload: false });
  await calibDlg.waitFor({ state: 'visible', timeout: 30000 });
  await feedHas('Калибровка: четыре шага').waitFor({ timeout: 10000 });
  const beeps0 = await page.evaluate(() => window.__e2e.beeps);
  // шаг «Ваш голос»: крупная подсказка и сигнал перед записью
  await calibDlg.locator('.vp-hint.big', { hasText: 'После сигнала читайте' }).waitFor({ timeout: 60000 })
    .catch(() => { throw new Error('нет крупной подсказки перед шагом «Ваш голос»'); });
  await calibDlg.getByText('шаг 4 из 4').waitFor({ timeout: 90000 }).catch(async () => { throw new Error(`шаги не идут сами: «${(await calibDlg.innerText()).replace(/\s+/g, ' ').slice(0, 200)}»`); });
  await calibDlg.getByText('Регуляторы выставлены').waitFor({ timeout: 60000 })
    .catch(async () => { throw new Error(`нет итога: «${(await calibDlg.innerText()).replace(/\s+/g, ' ').slice(0, 300)}»`); });
  await feedHas('Калибровка закончена, регуляторы выставлены').waitFor({ timeout: 10000 });
  const beeps = await page.evaluate((b) => window.__e2e.beeps - b, beeps0);
  if (beeps < 2) throw new Error(`сигналов на шаге «Ваш голос»: ${beeps} (нужны перед записью и после)`);
  await calibDlg.waitFor({ state: 'hidden', timeout: 30000 });
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('def_ops.voice.settings') || 'null'));
  if (!saved?.calib_mode) throw new Error('итог калибровки не сохранён');
  const clicks = await page.evaluate(() => window.__clicks);
  if (clicks) throw new Error(`щелчков: ${clicks}`);
});

await check('без рук: переигровка → «рассчитай операцию» → «прими командование» → «принимаю» → «доложи обстановку» → «покажи Зелов» → «оперативный уровень»', async () => {
  await page.evaluate(() => { localStorage.removeItem('def_ops.mapLevel'); location.hash = '#editor'; });
  await handsFree(['штаб, открой переигровку', 'штаб, рассчитай операцию', ...QUIET], { reload: false });
  await page.waitForFunction(() => location.hash === '#replay', null, { timeout: 30000 });
  await feedHas('Считаю: Берлинская операция').waitFor({ timeout: 30000 });
  const t0 = Date.now();
  await page.locator('.take-btn').waitFor({ timeout: 240000 }).catch(() => { throw new Error('расчёт не закончился'); });
  await feedHas('Расчёт готов').waitFor({ timeout: 30000 });
  const calcS = Math.round((Date.now() - t0) / 1000);
  // окно «Принять командование» зачитывается и ждёт ответа; противник — голосом
  await handsFree(['штаб, прими командование', ...QUIET], { reload: false });
  const dlg = page.locator('.modal.take');
  await dlg.waitFor({ timeout: 30000 });
  await feedHas('Принять командование с шестнадцатого апреля').waitFor({ timeout: 10000 });
  await shot('voice-takeover.jpg');
  // ответы — по одному, когда штаб дочитал окно (сервис перезапускается — это и есть пауза)
  await handsFree(['штаб, без штаба', ...QUIET], { reload: false });
  await feedHas('Противник — без штаба').waitFor({ timeout: 40000 });
  if (!(await dlg.locator('.take-enemy label.on', { hasText: 'Без штаба' }).count())) throw new Error('в окне не выбран «Без штаба»');
  await handsFree(['штаб, принимаю', ...QUIET], { reload: false });
  await dlg.waitFor({ state: 'detached', timeout: 40000 }).catch(() => { throw new Error('«принимаю» не начал игру'); });
  await page.locator('.cmd-date').waitFor({ timeout: 120000 });
  await feedHas('Скажите, например: «Штаб, доложи обстановку»').waitFor({ timeout: 30000 });
  await handsFree(['штаб, доложи обстановку', ...QUIET], { reload: false });
  const rep = feedHas('Цель — ');
  await rep.waitFor({ timeout: 30000 });
  const text = (await rep.last().innerText()).replace(/^\s*Штаб:\s*/, '');
  if (/\d/.test(text)) throw new Error(`в докладе цифры: ${text}`);
  const n = text.match(/[.!?…]+(?=\s|$)/g)?.length ?? 0;
  if (n < 5 || n > 7) throw new Error(`в докладе ${n} фраз: ${text}`);
  await handsFree(['штаб, покажи Зелов', '{тишина}', 'штаб, оперативный уровень', ...QUIET], { reload: false });
  await feedHas('Показываю: Зелов').waitFor({ timeout: 30000 });
  const v = await page.evaluate(() => window.__cmdEngine.getView());
  if (Math.abs(v.center[0] - 14.38) > 0.1 || Math.abs(v.center[1] - 52.53) > 0.1 || v.zoom < 10) throw new Error(`карта не у Зелова: ${JSON.stringify(v)}`);
  await page.locator('.lvl-sw button.on', { hasText: 'Оперативный' }).waitFor({ timeout: 30000 });
  await shot('voice-command.jpg');
  const clicks = await page.evaluate(() => window.__clicks);
  if (clicks) throw new Error(`щелчков: ${clicks}`);
  return `расчёт ${calcS} с`;
});

await check('без рук: «дай два варианта» → «подробнее о первом» → «выбираю первый» → «восьмой гвардейской наступать на Зелов» → «запиши в замысел: …» → «что не готово?»', async () => {
  // советник отвечает с поддельной LM Studio (поток окна игры ходит туда же)
  await handsFree(['штаб, дай два варианта', ...QUIET], { reload: false });
  await feedHas('Прошу у советника два варианта').waitFor({ timeout: 30000 });
  await feedHas('Советник предложил два варианта').waitFor({ timeout: 90000 }).catch(() => { throw new Error(`варианты не готовы (запросов вариантов к модели: ${LM.plans})`); });
  await handsFree(['штаб, подробнее о первом', ...QUIET], { reload: false });
  await feedHas('Вариант первый: «Удар на Зелов»').waitFor({ timeout: 30000 });
  await page.locator('.plan-var .plan-body').first().waitFor({ timeout: 10000 }).catch(() => { throw new Error('вариант не раскрыт на экране'); });
  await handsFree(['штаб, выбираю первый', ...QUIET], { reload: false });
  await feedHas('Вариант «Удар на Зелов» принят').waitFor({ timeout: 30000 });
  await page.locator('.plan-var.on .plan-ok', { hasText: 'принят' }).waitFor({ timeout: 10000 });
  await handsFree(['штаб, восьмой гвардейской наступать на Зелов', ...QUIET], { reload: false });
  await feedHas('Приказ: восьмая гвардейская армия — наступать, цель — Зелов').waitFor({ timeout: 30000 });
  await page.locator('.cmd-tabs button.on', { hasText: 'Приказы' }).waitFor({ timeout: 10000 });
  await page.locator('.draft', { hasText: '8-я гвардейская армия' }).waitFor({ timeout: 10000 });
  await shot('voice-orders.jpg');
  await handsFree(['штаб, запиши в замысел: главный удар на Зелов, к вечеру выйти к Мюнхебергу', ...QUIET], { reload: false });
  await feedHas('Записал в «Замысел»').waitFor({ timeout: 30000 });
  const intent = await page.locator('.dfield textarea').nth(2).inputValue();
  if (!/^Главный удар на Зелов, к вечеру выйти к Мюнхебергу/.test(intent)) throw new Error(`замысел: ${intent}`);
  await handsFree(['штаб, что не готово?', ...QUIET], { reload: false });
  await feedHas('Не готово: боевое донесение').waitFor({ timeout: 30000 });
  await shot('voice-decision.jpg');
  const clicks = await page.evaluate(() => window.__clicks);
  if (clicks) throw new Error(`щелчков: ${clicks}`);
  return `запросов вариантов: ${LM.plans}`;
});

await check('первый запуск без калибровки: штаб предлагает её («да / нет»), «нет» — отменено', async () => {
  await stopVoice();
  await page.evaluate(() => { sessionStorage.setItem('e2e.offer', '1'); localStorage.removeItem('def_ops.voice.settings'); });
  const f = join(tmp, 'offer.txt');
  writeFileSync(f, ['{тишина}', 'штаб, нет', 'штаб, нет', ...QUIET].join('\n') + '\n');
  await startVoice(f, 'off');
  await page.reload();
  const q = panel.locator('.vp-confirm');
  await q.getByText('Калибровки ещё не было').waitFor({ timeout: 40000 });
  await feedHas('Отменено.').waitFor({ timeout: 40000 });
  await q.waitFor({ state: 'detached', timeout: 2000 });
  if (await calibDlg.isVisible()) throw new Error('калибровка открылась после «нет»');
  await page.evaluate(() => sessionStorage.removeItem('e2e.offer'));
});

await check('флажок «Вступление при запуске» в «Тонкой настройке» — запоминается', async () => {
  await panel.getByText('Тонкая настройка').click();
  const box = panel.getByLabel('Вступление при запуске');
  if (await box.isChecked()) throw new Error('выключенное вступление показано включённым');
  await box.click();
  await page.waitForFunction(() => localStorage.getItem('def_ops.voice.intro') === 'on', null, { timeout: 2000 });
  await box.click();
  await page.waitForFunction(() => localStorage.getItem('def_ops.voice.intro') === 'off', null, { timeout: 2000 });
  await panel.getByText('Тонкая настройка').click();
});

// ---------------------------------------------------------------- тур: вступление при запуске
// новое окно (калибровки не было), сервис с репликами тура; каждый «слог» микрофона — следующая реплика
const scriptTour = join(tmp, 'script-tour.txt');
writeFileSync(scriptTour, ['штаб, дальше', 'назад', 'штаб, хватит', ...Array(60).fill('передайте в штаб армии')].join('\n') + '\n');
await ctx.close();  // прежнее окно тоже подключено к сервису — оно забрало бы реплики тура
await stopVoice();
await startVoice(scriptTour);
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
await ctx2.addInitScript((url) => {
  if (sessionStorage.getItem('e2e.init')) return;
  sessionStorage.setItem('e2e.init', '1');
  localStorage.clear();
  localStorage.setItem('def_ops.voice.url', url);
  localStorage.setItem('def_ops.section', 'editor');
  localStorage.setItem('def_ops.voice.panel', 'open');  // лента реплик видна
}, `ws://127.0.0.1:${vport}/ws`);
// события панели голоса: отменено ли voice:ready-first и пришло ли voice:propose
await ctx2.addInitScript(() => {
  window.__tour = { ready: null, propose: 0 };
  window.addEventListener('voice:ready-first', (e) => { setTimeout(() => { window.__tour.ready = e.defaultPrevented; }, 0); });
  window.addEventListener('voice:propose', () => { window.__tour.propose++; });
});
if (STUB) await ctx2.route('**/api/voice', (r) => r.fulfill({ json: { state: 'ready', port: vport } }));
const page2 = await ctx2.newPage();
page2.on('pageerror', (e) => errors.push(e.message));
await page2.goto(app + '/#editor');
const tourLayer = page2.locator('.tour');
const feed2 = async () => (await page2.locator('.vp-feed').innerText().catch(() => '')).replace(/\s+/g, ' ');
const tourTitle = (t) => ({ waitFor: (o) => tourLayer.locator('.tour-cap h2', { hasText: t }).waitFor(o)
  .catch(async () => { throw new Error(`нет шага «${t}»; лента: ${await feed2()}`); }) });
/**
 * Рамка тура — вокруг видимого элемента data-tour и доехала до него (отступ: у кнопок колонки 1 px, иначе 8 px);
 * подпись не закрывает ни рамку, ни панель голоса.
 */
const frameOn = (target) => page2.waitForFunction((t) => {
  const pad = /^rail-/.test(t) ? 1 : 8;
  const f = document.querySelector('.tour-frame:not(.none)')?.getBoundingClientRect();
  const el = [...document.querySelectorAll(`[data-tour="${t}"]`)].map((e) => e.getBoundingClientRect()).find((r) => r.width > 0);
  const cap = document.querySelector('.tour-cap')?.getBoundingClientRect();
  const card = document.querySelector('.vp-card')?.getBoundingClientRect();
  const cross = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return !!f && !!el && [f.left + pad - el.left, f.top + pad - el.top, f.width - 2 * pad - el.width, f.height - 2 * pad - el.height].every((d) => Math.abs(d) < 1.5)
    && !cross(cap, f) && !cross(cap, card);
}, target, { timeout: 15000, polling: 50 }).catch(() => { throw new Error(`рамка не вокруг [data-tour="${target}"] или подпись на ней / на панели`); });

await check('вступление при запуске: притемнение, рамка вокруг колонки разделов, подпись крупно', async () => {
  await tourTitle('Штабные игры').waitFor({ timeout: T });
  await frameOn('rail');
  await page2.waitForTimeout(700);  // полосы доехали (переезд — полсекунды)
  const st = await page2.evaluate(() => {
    let m = Infinity;
    for (const el of document.querySelectorAll('.tour-cap, .tour-cap *')) {
      if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) m = Math.min(m, parseFloat(getComputedStyle(el).fontSize));
    }
    // притемнение: полосы вокруг проёма закрывают весь экран, кроме рамки
    const dims = [...document.querySelectorAll('.tour-dim')];
    // площадь в пределах окна (рамка колонки выходит за край на отступ)
    const vis = (r) => Math.max(0, Math.min(innerWidth, r.right) - Math.max(0, r.left)) * Math.max(0, Math.min(innerHeight, r.bottom) - Math.max(0, r.top));
    const area = dims.reduce((a, d) => a + vis(d.getBoundingClientRect()), 0);
    const rest = innerWidth * innerHeight - vis(document.querySelector('.tour-frame').getBoundingClientRect());
    return { min: m, dim: dims.length === 4 && dims.every((d) => getComputedStyle(d).backgroundColor === 'rgba(12, 12, 14, 0.62)') && Math.abs(area - rest) < innerWidth * innerHeight * 0.005,
      say: document.querySelector('.tour-cap')?.textContent ?? '' };
  });
  if (!(st.min >= 20)) throw new Error(`самый мелкий текст подписи — ${st.min} px`);
  if (!st.dim) throw new Error('экран вокруг рамки не притемнён');
  if (!st.say.includes('искусственного интеллекта')) throw new Error('в подписи нет текста шага');
  if (!st.say.includes('Больше не показывать')) throw new Error('на подписи вступления нет «Больше не показывать»');
  return `подпись не мельче ${st.min} px`;
});

/** Номер шага в подписи («шаг N из M»). */
const stepNo = async () => +(/шаг (\d+) из/.exec(await tourLayer.locator('.tour-count').innerText())?.[1] ?? NaN);
/** Сказанное появилось в ленте («Вы: …»). */
const heard = (t) => page2.locator('.vp-item', { hasText: t }).first().waitFor({ timeout: 40000 })
  .catch(async () => { throw new Error(`в ленте нет «${t}»: ${await feed2()}`); });
let afterNext = 0;
await check('«Штаб, дальше» → следующий шаг, рамка переехала на кнопку колонки', async () => {
  // шаги, договорённые до первой реплики, листаются сами — сравниваем с номером на момент «дальше»
  await heard('штаб, дальше');
  await page2.waitForTimeout(400);
  afterNext = await stepNo();
  const target = await page2.locator('.tour-frame').getAttribute('data-target');
  if (!/^rail-/.test(target ?? '')) throw new Error(`подсвечено «${target}», а не кнопка колонки (шаг ${afterNext})`);
  await frameOn(target);
  await page2.waitForTimeout(300);
  if (SHOTS) await page2.screenshot({ path: join(SHOTS, 'voice-tour.jpg'), type: 'jpeg', quality: 88 });
  return `шаг ${afterNext}, ${target}`;
});

await check('«назад» без обращения (разговор) → шаг назад', async () => {
  await heard('Вы: назад');
  await page2.waitForFunction((n) => /шаг (\d+) из/.exec(document.querySelector('.tour-count')?.textContent ?? '')?.[1] === String(n), afterNext - 1, { timeout: 5000 })
    .catch(async () => { throw new Error(`после «назад» шаг ${await stepNo()}, ждали ${afterNext - 1}`); });
  const target = await page2.locator('.tour-frame').getAttribute('data-target');
  await frameOn(target);
  return `шаг ${afterNext - 1}, ${target}`;
});

await check('«Штаб, хватит» → тура нет, притемнение снято полностью', async () => {
  await tourLayer.waitFor({ state: 'detached', timeout: 30000 });
  const left = await page2.evaluate(() => document.querySelectorAll('.tour, .tour-dim, .tour-frame, .tour-cap').length);
  if (left) throw new Error(`осталось элементов тура: ${left}`);
  const free = await page2.evaluate(() => {
    const r = document.querySelector('[data-tour="rail-replay"]').getBoundingClientRect();
    return !!document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('[data-tour="rail-replay"]');
  });
  if (!free) throw new Error('кнопка колонки закрыта');
});

await check('voice:ready-first отменён вступлением, после «хватит» — voice:propose (калибровку предлагает панель)', async () => {
  await page2.waitForFunction(() => window.__tour.propose === 1, null, { timeout: 5000 })
    .catch(async () => { throw new Error(`события: ${JSON.stringify(await page2.evaluate(() => window.__tour))}`); });
  if ((await page2.evaluate(() => window.__tour.ready)) !== true) throw new Error('voice:ready-first не отменён');
});
await ctx2.close();

// ---------------------------------------------------------------- туры разделов и вкладки голосом
// новое окно (вступление выключено), сервис с репликами: раздел, вкладка, тур по моделированию с переключением
// вкладок, тур по знакам — подсветка внутри страницы справочника (iframe)
const scriptSections = join(tmp, 'script-sections.txt');
writeFileSync(scriptSections, ['штаб, открой моделирование', 'штаб, открой вкладку калибровка', 'штаб, тур по моделированию',
  'штаб, дальше', 'штаб, дальше', 'штаб, дальше', 'штаб, хватит', 'штаб, тур по знакам', 'штаб, дальше', 'штаб, дальше', 'штаб, хватит',
  ...Array(60).fill('передайте в штаб армии')].join('\n') + '\n');
await stopVoice();
await startVoice(scriptSections);
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
await ctx3.addInitScript((url) => {
  if (sessionStorage.getItem('e2e.init')) return;
  sessionStorage.setItem('e2e.init', '1');
  localStorage.clear();
  localStorage.setItem('def_ops.voice.url', url);
  localStorage.setItem('def_ops.section', 'editor');
  localStorage.setItem('def_ops.voice.intro', 'off');
  localStorage.setItem('def_ops.voice.panel', 'open');
}, `ws://127.0.0.1:${vport}/ws`);
if (STUB) await ctx3.route('**/api/voice', (r) => r.fulfill({ json: { state: 'ready', port: vport } }));
const page3 = await ctx3.newPage();
page3.on('pageerror', (e) => errors.push(e.message));
await page3.goto(app + '/#editor');
const layer3 = page3.locator('.tour');
const feed3 = async () => (await page3.locator('.vp-feed').innerText().catch(() => '')).replace(/\s+/g, ' ');
const heard3 = (t) => page3.locator('.vp-item', { hasText: t }).first().waitFor({ timeout: 40000 })
  .catch(async () => { throw new Error(`в ленте нет «${t}»: ${await feed3()}`); });
const title3 = (t) => layer3.locator('.tour-cap h2', { hasText: t }).waitFor({ timeout: T })
  .catch(async () => { throw new Error(`нет шага «${t}»; лента: ${await feed3()}`); });
/**
 * Рамка тура — вокруг [data-tour=target] в окне или в странице во врезке (iframe; координаты — со сдвигом врезки);
 * capFree — подпись не на рамке и не на панели голоса.
 */
const frame3 = (target, capFree = true) => page3.waitForFunction(([t, free]) => {
  const pad = /^rail-/.test(t) ? 1 : 8;
  const f = document.querySelector('.tour-frame:not(.none)')?.getBoundingClientRect();
  const sel = `[data-tour="${t}"]`;
  let el = [...document.querySelectorAll(sel)].map((e) => e.getBoundingClientRect()).find((r) => r.width > 0);
  if (!el) {
    for (const fr of document.querySelectorAll('iframe')) {
      const o = fr.getBoundingClientRect();
      const r = [...(fr.contentDocument?.querySelectorAll(sel) ?? [])].map((e) => e.getBoundingClientRect()).find((x) => x.width > 0);
      if (r) { el = new DOMRect(o.left + r.left, o.top + r.top, r.width, r.height); break; }
    }
  }
  const cap = document.querySelector('.tour-cap')?.getBoundingClientRect();
  const card = document.querySelector('.vp-card')?.getBoundingClientRect();
  const cross = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return !!f && !!el && [f.left + pad - el.left, f.top + pad - el.top, f.width - 2 * pad - el.width, f.height - 2 * pad - el.height].every((d) => Math.abs(d) < 1.5)
    && (!free || (!cross(cap, f) && !cross(cap, card)));
}, [target, capFree], { timeout: 15000, polling: 50 }).catch(() => { throw new Error(`рамка не вокруг [data-tour="${target}"]${capFree ? ' или подпись на ней / на панели' : ''}`); });

await check('«Штаб, открой моделирование» — раздел открыт, штаб предлагает тур по нему (первый вход)', async () => {
  await page3.locator('[data-tour="section-modeling"]').waitFor({ state: 'visible', timeout: 40000 });
  await page3.locator('.vp-item', { hasText: 'Показать, что есть в разделе «Моделирование»' }).first().waitFor({ timeout: T })
    .catch(async () => { throw new Error(`предложения тура нет: ${await feed3()}`); });
});

await check('«Штаб, открой вкладку Калибровка» — вкладка открыта и запомнена', async () => {
  await heard3('открой вкладку калибровка');
  await page3.locator('[data-tour="modeling-tab-calibrate"].on').waitFor({ timeout: 10000 });
  const kept = await page3.evaluate(() => localStorage.getItem('def_ops.modeling.tab'));
  if (kept !== 'calibrate') throw new Error(`запомнена вкладка ${kept}`);
  await page3.locator('.vp-item', { hasText: 'Открыта вкладка «Калибровка»' }).first().waitFor({ timeout: 10000 });
});

await check('«Штаб, тур по моделированию» — тур идёт по вкладкам: «дальше» открывает следующую, рамка на ней', async () => {
  await heard3('тур по моделированию');
  await title3('Моделирование');
  await frame3('modeling-tabs');
  await title3('Сравнение');
  await page3.locator('[data-tour="modeling-tab-compare"].on').waitFor({ timeout: 5000 });
  await frame3('modeling-tab-compare');
  await page3.waitForTimeout(300);
  if (SHOTS) await page3.screenshot({ path: join(SHOTS, 'voice-tour-modeling.jpg'), type: 'jpeg', quality: 88 });
  const say = await layer3.locator('.tour-cap').innerText();
  if (!say.includes('четырёх наборов правил')) throw new Error(`подпись: ${say}`);
});

await check('«Штаб, хватит» — тур по моделированию окончен, открыта и запомнена вкладка, что была до тура', async () => {
  await layer3.waitFor({ state: 'detached', timeout: 40000 });
  await page3.locator('[data-tour="modeling-tab-calibrate"].on').waitFor({ timeout: 5000 })
    .catch(() => { throw new Error('после тура открыта не «Калибровка»'); });
  const kept = await page3.evaluate(() => localStorage.getItem('def_ops.modeling.tab'));
  if (kept !== 'calibrate') throw new Error(`запомнена вкладка ${kept}`);
});

await check('«Штаб, тур по знакам» — раздел «Знаки», подсветка внутри страницы справочника (iframe)', async () => {
  await heard3('тур по знакам');
  await title3('Справочник знаков');
  await frame3('section-library', false);
  await title3('Оформление');
  await frame3('lib-styles');
  await page3.waitForTimeout(300);
  if (SHOTS) await page3.screenshot({ path: join(SHOTS, 'voice-tour-library.jpg'), type: 'jpeg', quality: 88 });
  await title3('Поиск');
  await frame3('lib-search');
  return 'lib-styles, lib-search';
});

await check('«Штаб, хватит» — тур по знакам окончен, притемнения нет', async () => {
  await layer3.waitFor({ state: 'detached', timeout: 40000 });
  const left = await page3.evaluate(() => document.querySelectorAll('.tour, .tour-dim, .tour-frame, .tour-cap').length);
  if (left) throw new Error(`осталось элементов тура: ${left}`);
});
await ctx3.close();

await check('в окне нет ошибок JavaScript', async () => {
  if (errors.length) throw new Error(errors.join('; '));
});

await browser.close();
cleanup();
console.log('все пункты ok');
process.exit(0);
