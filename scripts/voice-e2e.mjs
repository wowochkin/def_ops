// Сквозная проверка панели голоса: поддельный голосовой сервис (--fake), сервер разработки окна (vite)
// и Chromium с поддельным микрофоном (WAV с «речью» — всплесками звука — и паузами).
//
//   node scripts/voice-e2e.mjs [--shots DIR] [--python PATH] [--url http://localhost:5173] [--no-stub] [--aec on|off]
//                              [--only panel,model,handsfree,intro,tours,game]
//
// --only — только эти части (без флага — все): panel — панель, калибровка, голоса, выключение, тонкая настройка;
// model — модель за правилами; handsfree — без рук, полоса и окна, подсветка, командование; intro — вступление при
// запуске; tours — туры разделов; game — без рук от запуска до доклада посредника. intro, tours и game — каждая
// в своём окне и пропускаются целиком; в первом окне пропускаются проверки, а подготовка между ними идёт как обычно.
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
// шаги открывают вкладки; «Штаб, тур по знакам» — подсветка внутри страницы справочника (iframe); «Штаб, тур по
// переигровке»; «Штаб, тур по командованию» вне игры — как в неё попасть и предложение начать; в игре (окно «без рук»,
// после доклада посредника) — тур по командованию: рамка на шапке игры, вкладку «Доклады» открывает тур, после
// «хватит» — прежняя вкладка.
// Без рук (ни одного щелчка — только поддельный микрофон): дежурный режим («отбой» — дежурю, «открой карты» не
// исполняется, «на связь» будит), вопросы dialogs.ts голосом (confirmAsync — «да», команда при открытом окне не
// исполняется; chooseAsync — «второй»; askText — диктовка и «готово»), окно «Голоса» (прослушать, назначить, записать
// новый голос, удалить — с подтверждением «да»), калибровка голосом (шаги идут сами, «готово»), предложение калибровки
// при первом запуске («нет»), вход в командование и обстановка («открой переигровку» → «рассчитай операцию» →
// «прими командование» → «без штаба» → «принимаю» → «доложи обстановку» → «покажи Зелов» → «оперативный уровень»),
// советник и решение («дай два варианта» — поддельная LM Studio отвечает вариантами → «подробнее о первом» →
// «выбираю первый» → «восьмой гвардейской наступать на Зелов» → «запиши в замысел: …» → «что не готово?»), ход
// («проводи ход» — чего нет и «Составить черновик донесения?», «да»; «проводи ход» → «да» → доклад посредника голосом
// посредника — роль umpire). В конце — отдельное окно «без рук от запуска до доклада посредника»: вступление («хватит»)
// → переигровка → расчёт → командование → обстановка → варианты → «проводи ход» → «да» → посредник.
// Компактная панель: по умолчанию полоса; открыто окно — полоса не на окне (вопрос dialogs.ts, «Принять командование»),
// ответа нет 8 с — напоминание; ответ посреди чтения окна — перебиванием «голосом» и «словом»; в командовании легенда
// свёрнута, место на карте — не под панелью и легендой; длинная фраза — в полосе целиком (панель не разворачивается),
// 10 с тишины — снова до двух строк.
// Подсветка исполненного голосом: «оперативный уровень» — рамка на переключателе, «выбираю первый» — на варианте,
// «восьмой гвардейской наступать на Зелов» — на приказе и метка на карте; рамка гаснет через ~2,5 с; мышью — без рамки.
// По каждому пункту печатается «ok …»; первый провал — код выхода 1. --shots DIR — снимки 1440×900 (JPEG)
// панели, калибровки, голосов, раздела «ИИ» (модель для голоса), окон с полосой, командования и туров (voice-tour.jpg,
// voice-tour-modeling.jpg, voice-tour-library.jpg, voice-tour-replay.jpg, voice-tour-command-entry.jpg, voice-tour-command.jpg).
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
const PARTS = ['panel', 'model', 'handsfree', 'intro', 'tours', 'game'];
const ONLY = arg('--only')?.split(',') ?? null;
for (const p of ONLY ?? []) if (!PARTS.includes(p)) { console.error(`--only: нет части «${p}», есть: ${PARTS.join(', ')}`); process.exit(2); }
/** Часть, к которой относятся следующие проверки (null — всегда). */
let part = 'panel';
const want = (p) => !ONLY || ONLY.includes(p);
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
  if (part && !want(part)) return;
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
  sessionStorage.setItem('def_ops.section', 'editor');
  localStorage.setItem('def_ops.voice.intro', 'off');  // вступление — в своей проверке в конце
  // туры разделов — в своих проверках: предложение тура при входе в «Переигровку» открыло бы окно разговора,
  // и «передайте в штаб армии» стало бы обращением
  localStorage.setItem('def_ops.tour.seen', JSON.stringify(['replay']));
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

await check('по умолчанию — полоса: не выше двух строк фразы, «Развернуть» разворачивает', async () => {
  const strip = panel.locator('.vp-card.strip');
  await strip.waitFor({ state: 'visible', timeout: T });
  const r = await strip.evaluate((e) => e.getBoundingClientRect().toJSON());
  if (r.height > 130 || r.width > 520) throw new Error(`полоса ${Math.round(r.width)}×${Math.round(r.height)} px`);
  await placeAtTop('.vp-card.strip');
  await strip.getByRole('button', { name: 'Развернуть' }).click();
  await panel.locator('.vp-card:not(.strip)').waitFor({ state: 'visible', timeout: 5000 });
  return `${Math.round(r.width)}×${Math.round(r.height)} px`;
});

await check('голос готов: «Жду обращения»', async () => {
  await panel.locator('.vp-state', { hasText: /Жду обращения|Слушаю|Думаю|Говорит/ }).waitFor({ timeout: T });
});

const minFont = () => panel.locator('.vp-card').evaluate((root) => {
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

await check('шрифт панели обычного размера не меньше 14 px, ширина карточки 360 px', async () => {
  const min = await minFont();
  if (!(min >= 14)) throw new Error(`самый мелкий текст — ${min} px`);
  const w = await panel.locator('.vp-card:not(.strip)').evaluate((c) => Math.round(c.getBoundingClientRect().width));
  if (w > 380) throw new Error(`карточка шириной ${w} px`);
  return `${min} px, ${w} px`;
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
  await placeAtTop('.vp-card');
  return `высота карточки ${Math.round(h)} px`;
});
await shot('voice-panel.jpg');

await check('кнопка «Калибровка» открывает калибровку (шаги — кнопкой «Записать»)', async () => {
  await panel.getByRole('button', { name: 'Калибровка' }).click();
  await page.locator('.vp-dialog.calib').waitFor({ state: 'visible', timeout: 3000 });
  // окно калибровки — ниже панели, панель его не закрывает
  await page.waitForTimeout(400);
  const pv = await panelVs('.vp-dialog.calib');
  if (pv.cross) throw new Error(`панель ${pv.panel} на окне калибровки ${pv.win}`);
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
} else if (want('panel')) { // часть panel пропущена (--only) — записи и не было
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

await check('кнопка «Выключить управление»: пояснение в одну строку, вопрос с полным текстом; «Выключить» — микрофон освобождён', async () => {
  await panel.getByText('Включить управление снова — только этой кнопкой.').waitFor({ timeout: 2000 });
  await panel.getByRole('button', { name: 'Выключить управление' }).click();
  const q = page.locator('.confirm-box');
  await q.getByText('включить управление голосом можно будет только кнопкой').waitFor({ timeout: 3000 });
  await q.locator('button.danger', { hasText: 'Выключить' }).waitFor({ timeout: 2000 });  // голосом подтверждается только строгим «да»
  await q.getByRole('button', { name: 'Выключить' }).click();
  await panel.locator('.vp-state', { hasText: 'Управление голосом выключено' }).waitFor({ timeout: 3000 });
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
  await panel.locator('.vp-state', { hasText: 'Управление голосом выключено' }).waitFor({ timeout: T });
  await page.waitForTimeout(3000);
  const gum = await page.evaluate(() => window.__e2e.gum);
  if (gum) throw new Error(`микрофон спрошен ${gum} раз`);
  // полоса при выключенном управлении — с кнопкой «Включить управление»; «Свернуть» на полосе — в значок
  await panel.locator('.vp-card:not(.strip)').getByRole('button', { name: 'Свернуть' }).click();
  await panel.locator('.vp-card.strip').getByRole('button', { name: 'Включить управление' }).waitFor({ timeout: 2000 });
  await panel.locator('.vp-card.strip').getByRole('button', { name: 'Свернуть' }).click();
  const icon = page.locator('.vp-icon');
  await icon.getByText('Управление голосом выключено').waitFor({ state: 'visible', timeout: 2000 });
  if (!(await icon.locator('.vp-cross').count())) throw new Error('значок не перечёркнут');
  await shot('voice-icon-off.jpg');
  await icon.click();
});

await check('«Включить управление» (с полосы) → «Жду обращения», микрофон снова открыт', async () => {
  await panel.locator('.vp-card.strip').getByRole('button', { name: 'Включить управление' }).click();
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: T });
  await micOn();
  const saved = await page.evaluate(() => localStorage.getItem('def_ops.voice.enabled'));
  if (saved === 'false') throw new Error('выключение осталось записанным');
});

await check('событие voice:power: false — выключает, true — включает', async () => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:power', { detail: false })));
  await panel.locator('.vp-state', { hasText: 'Управление голосом выключено' }).waitFor({ timeout: 3000 });
  await micOff('после voice:power false');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:power', { detail: true })));
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: T });
  await micOn();
});
/** Развернуть панель (из значка или полосы): лента, тонкая настройка, кнопки. */
async function expandPanel() {
  if (await page.locator('.vp-icon').isVisible()) await page.locator('.vp-icon').click();
  const strip = panel.locator('.vp-card.strip');
  if (await strip.isVisible().catch(() => false)) await strip.getByRole('button', { name: 'Развернуть' }).click();
  await panel.locator('.vp-card:not(.strip)').waitFor({ state: 'visible', timeout: 5000 });
}
await expandPanel();

await check('кнопка «Выключить звук»: озвучка молчит, микрофон открыт; «Включить звук» — снова говорит; выбор запоминается', async () => {
  await panel.getByRole('button', { name: 'Выключить звук' }).click();
  await panel.locator('.vp-state', { hasText: 'звук выключен' }).waitFor({ timeout: 3000 });
  const off = await page.evaluate(() => localStorage.getItem('def_ops.voice.sound'));
  if (off !== 'off') throw new Error(`def_ops.voice.sound = ${off}`);
  await micOn(); // микрофон не затронут
  if (await panel.getByRole('button', { name: 'Калибровка' }).isEnabled()) throw new Error('калибровка доступна без звука');
  await page.reload();
  await panel.locator('.vp-state', { hasText: 'звук выключен' }).waitFor({ timeout: T });  // после перезапуска звук остаётся выключенным
  await expandPanel();
  await panel.getByRole('button', { name: 'Включить звук' }).click();
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: T });
  if ((await panel.locator('.vp-state').first().innerText()).includes('звук выключен')) throw new Error('пометка «звук выключен» осталась');
  const on = await page.evaluate(() => localStorage.getItem('def_ops.voice.sound'));
  if (on !== null) throw new Error(`выключение звука осталось записанным: ${on}`);
});

await check('значок микрофона перетаскивается мышью, место запоминается; щелчок без сдвига разворачивает; «верни значок на место»', async () => {
  await panel.locator('.vp-card:not(.strip)').getByRole('button', { name: 'Свернуть' }).click();
  await panel.locator('.vp-card.strip').getByRole('button', { name: 'Свернуть' }).click();
  const icon = page.locator('.vp-icon');
  await icon.waitFor({ state: 'visible', timeout: 3000 });
  const b0 = await icon.boundingBox();
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 + 120, b0.y + b0.height / 2 + 220, { steps: 8 });
  await page.mouse.up();
  const b1 = await icon.boundingBox();
  if (Math.abs(b1.x - (b0.x + 120)) > 3 || Math.abs(b1.y - (b0.y + 220)) > 3) throw new Error(`значок в ${Math.round(b1.x)},${Math.round(b1.y)}, ждали ${Math.round(b0.x + 120)},${Math.round(b0.y + 220)}`);
  if (await panel.locator('.vp-card').count()) throw new Error('после перетаскивания панель развернулась');
  const saved = await page.evaluate(() => localStorage.getItem('def_ops.voice.iconPos'));
  if (!saved) throw new Error('место значка не запомнено');
  await page.reload();
  await icon.waitFor({ state: 'visible', timeout: T });
  const b2 = await icon.boundingBox();
  if (Math.abs(b2.x - b1.x) > 3 || Math.abs(b2.y - b1.y) > 3) throw new Error('после перезагрузки значок не на запомненном месте');
  // за край окна значок не уходит
  await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.mouse.down();
  await page.mouse.move(-500, -500, { steps: 6 });
  await page.mouse.up();
  const b3 = await icon.boundingBox();
  if (b3.x < 0 || b3.y < 0) throw new Error('значок ушёл за край окна');
  // щелчок без сдвига — полоса
  await icon.click();
  await panel.locator('.vp-card.strip').waitFor({ state: 'visible', timeout: 3000 });
  await panel.locator('.vp-card.strip').getByRole('button', { name: 'Свернуть' }).click();
  await icon.waitFor({ state: 'visible', timeout: 3000 });
  await page.evaluate(() => localStorage.removeItem('def_ops.voice.iconPos'));
  await page.reload();
  await icon.waitFor({ state: 'visible', timeout: T });
  await icon.click();  // полоса → развернуть, как ниже по сценарию
  await panel.locator('.vp-card.strip').getByRole('button', { name: 'Развернуть' }).click();
  await panel.locator('.vp-card:not(.strip)').waitFor({ state: 'visible', timeout: 5000 });
});

await check('управление выключено, звук включён: микрофон закрыт, звук остаётся включённым (кнопка «Выключить звук» на месте)', async () => {
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:power', { detail: false })));
  await panel.locator('.vp-state', { hasText: 'Управление голосом выключено' }).waitFor({ timeout: 3000 });
  await micOff('при выключенном управлении');
  const sound = await page.evaluate(() => localStorage.getItem('def_ops.voice.sound'));
  if (sound === 'off') throw new Error('звук выключился вместе с управлением');
  await panel.getByRole('button', { name: 'Выключить звук' }).waitFor({ timeout: 2000 });
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('voice:power', { detail: true })));
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: T });
  await micOn();
});


// ---------------------------------------------------------------- модель за правилами (поддельная LM Studio)
part = 'model';
//
// Поддельная LM Studio отвечает за /llm/… (адрес модели по умолчанию) прямо в Playwright: /v1/models — список
// моделей, /v1/chat/completions — по ключевым словам последней реплики: вызов инструмента, текст, текст с
// задержкой, «не запущена» (соединение отвергается сразу) или «висит» (каждая попытка кончается через 3 с ответом
// 500 — сбой самой модели, повторяется; модель ещё ждёт, когда приходит следующая реплика).
const LM = { asked: [], settled: [], models: 0, plans: 0, umpire: 0 };
/** Разбор хода от поддельной модели: по пункту на шаг («Шагов: N» в запросе), число — цифрами (озвучка — словами). */
const UMPIRE_FIRST = 'Ход прошёл без перелома. 8-я гв. армия ведёт бой у Зелова.';
const umpireSays = (body) => {
  const n = +(/Шагов: (\d+)/.exec(body.messages.at(-1)?.content ?? '')?.[1] ?? 3);
  return Array.from({ length: n }, (_, i) => `${i + 1}. ${i ? 'Здесь видно, как шёл бой; потери участвовавших невелики.' : UMPIRE_FIRST}`).join('\n');
};
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
    // разбор хода посредником — тексты шагов от лица посредника
    if (/посредник штабной игры/.test(body.messages[0]?.content ?? '')) { LM.umpire++; return route.fulfill({ json: lmReply(umpireSays(body)) }).catch(() => {}); }
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
part = 'panel';

await llmChecks();

// снимок для описания: раздел «ИИ», карточка «Голос» (модель для голоса) — только с --shots, проверок нет
if (SHOTS) {
  await panel.getByRole('button', { name: 'Свернуть' }).click();  // в полосу
  await panel.getByRole('button', { name: 'Свернуть' }).click();  // в значок
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
  await expandPanel();
}

await check('раздел «ИИ»: модель озвучки — по умолчанию Qwen3-TTS 1.7B, выбор другой загружается и запоминается', async () => {
  await page.evaluate(() => { location.hash = '#staff'; });
  const sel = page.locator('[data-tour="staff-tts"] select');
  await sel.waitFor({ state: 'visible', timeout: 10000 });
  await page.waitForFunction(() => document.querySelector('[data-tour="staff-tts"] select')?.value === 'qwen3-1.7b', null, { timeout: 10000 });
  await sel.selectOption('qwen3-0.6b');
  await page.getByText('Говорит: Qwen3-TTS 0.6B.').waitFor({ timeout: 10000 });
  await sel.selectOption('qwen3-1.7b');  // обратно: остальные проверки идут на модели по умолчанию
  await page.getByText('Говорит: Qwen3-TTS 1.7B.').waitFor({ timeout: 10000 });
  await page.evaluate(() => { location.hash = '#replay'; });
});

await check('размер панели «крупный»: шрифт не меньше 18 px, выбор запоминается', async () => {
  const det = panel.locator('details.vp-tune');
  const wasOpen = await det.evaluate((d) => d.open);
  if (!wasOpen) await panel.getByText('Тонкая настройка').click();
  await panel.getByRole('button', { name: 'крупный' }).click();
  const min = await minFont();
  const kept = await page.evaluate(() => localStorage.getItem('def_ops.voice.size'));
  await panel.getByRole('button', { name: 'обычный' }).click();
  if (!wasOpen) await panel.getByText('Тонкая настройка').click();  // как было
  if (!(min >= 18)) throw new Error(`самый мелкий текст — ${min} px`);
  if (kept !== 'big') throw new Error(`в хранилище: ${kept}`);
  if (await page.evaluate(() => localStorage.getItem('def_ops.voice.size')) !== null) throw new Error('«обычный» не сброшен в хранилище');
});

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
part = 'handsfree';
//
// Сервис — без подавления эха и с перебиванием «голосом» (как в проверках модели): строки сценария идут по одной на
// каждый «слог» поддельного микрофона. «{тишина}» — заполнитель (реплики нет).
const QUIET = Array(80).fill('{тишина}');
/** Сколько ждать, что напоминание не повторится. */
const REMIND_WAIT = 12000;
async function handsFree(lines, { reload = true, mode = 'voice' } = {}) {
  await stopVoice();
  if (reload) {
    await page.evaluate((m) => {
      // регуляторы — «голосом» (или как велено); при каком подавлении эха — допишет ответ сервиса
      localStorage.setItem('def_ops.voice.settings', JSON.stringify({ vad: 0.5, barge_vad: 0.8, barge_ms: 300, end_ms: 400, barge_mode: m, aec_unknown: true }));
      sessionStorage.setItem('def_ops.section', 'replay');
      localStorage.setItem('def_ops.voice.panel', 'full');  // лента видна (при открытом окне — полоса)
    }, mode);
  }
  const f = join(tmp, `hands-${Date.now()}.txt`);
  writeFileSync(f, lines.join('\n') + '\n');
  await startVoice(f, 'off');
  // настоящая перезагрузка (переход на тот же адрес с другим #… страницу не перезагружает — связь помнила бы прежние
  // регуляторы)
  if (reload) { await page.evaluate(() => { location.hash = '#replay'; }); await page.reload(); }
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: 40000 });
}
/** Прямоугольники панели голоса и окна sel; пересекаются ли. */
function panelVs(sel) {
  return page.evaluate((q) => {
  const a = document.querySelector('[data-tour="voice"]')?.getBoundingClientRect();
  const b = document.querySelector(q)?.getBoundingClientRect();
  const cross = !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
  return { cross, panel: a && [a.left, a.top, a.width, a.height].map(Math.round), win: b && [b.left, b.top, b.width, b.height].map(Math.round) };
}, sel);
}
/**
 * Панель sel — сверху по центру свободной области справа от колонки разделов, сразу под верхней полосой кнопок; не
 * пересекает ни полосу кнопок (её кнопки), ни колонку разделов, ни вкладки раздела.
 */
async function placeAtTop(sel) {
  const r = await page.evaluate((q) => {
    const a = document.querySelector(q).getBoundingClientRect();
    const cross = (b) => b.width > 0 && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const bars = [...document.querySelectorAll('[data-voice-top], .rp-bar, .app > header, .kb-top, .mdl-top')].map((e) => e.getBoundingClientRect()).filter((b) => b.width > 0 && b.top < 24);
    const bar = Math.max(0, ...bars.map((b) => b.bottom));
    const hit = [...document.querySelectorAll('.rp-bar button, .rp-tools button, .rail, nav button, .cmd-tabs button')].map((e) => e.getBoundingClientRect()).filter(cross).length;
    return { box: [a.left, a.top, a.width, a.height].map(Math.round), center: a.left + a.width / 2, top: a.top, bar: Math.round(bar), hit, free: 84 + (innerWidth - 84) / 2 };
  }, sel);
  if (Math.abs(r.center - r.free) > 4) throw new Error(`не по центру: ${JSON.stringify(r)}`);
  if (r.top < r.bar || r.top > r.bar + 20) throw new Error(`не под полосой кнопок: ${JSON.stringify(r)}`);
  if (r.hit) throw new Error(`закрывает кнопки карты, вкладки или колонку разделов: ${JSON.stringify(r)}`);
  return r;
}
/**
 * Сказанное в ленте. Штаб — по отправленным сервису фразам: при открытом окне панель — полоса, ленты на экране нет;
 * реплики человека (kind 'notme', 'me') — по ленте развёрнутой панели.
 */
const feedHas = (re, kind = 'chief') => (kind !== 'chief' ? panel.locator(`.vp-item.${kind}`, { hasText: re }) : {
  waitFor: ({ timeout }) => page.waitForFunction((t) => window.__e2e.sent.some((m) => m.type === 'say' && m.role === 'chief' && m.text.includes(t)), re, { timeout, polling: 50 })
    .catch(async () => { throw new Error(`штаб не сказал «${re}»; сказано: ${JSON.stringify(await page.evaluate(() => window.__e2e.sent.filter((m) => m.type === 'say').slice(-4).map((m) => m.text)))}`); }),
});
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
  if (size < 20) throw new Error(`вопрос шрифтом ${size} px`);
  for (const b of ['Да', 'Нет']) if (!(await q.getByRole('button', { name: b }).isVisible())) throw new Error(`нет кнопки «${b}»`);
  // окно «Голоса» (640 px): полоса с вопросом — сбоку, не на нём
  await page.waitForTimeout(400);
  const pv = await panelVs('.vp-dialog.voices');
  if (pv.cross) throw new Error(`панель ${pv.panel} на окне «Голоса» ${pv.win}`);
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


// ---------------------------------------------------------------- компактная панель и окна; ответ поверх чтения (Task 1b)

/** Вопрос с длинными пояснениями: штаб читает его секунд двадцать (поддельный синтез — 15 знаков в секунду). */
const LONG_Q = ['Что сделать с игрой?', 'Игра остановлена на третьем ходу, запись хранится на этом компьютере.',
  'Если сохранить, к ней можно вернуться в разделе «Переигровка», кнопкой «Продолжить».',
  'Если удалить, запись и журнал ходов пропадут, а разбор операции останется.'].join(' ');
const LABELS = [{ label: 'Сохранить' }, { label: 'Удалить' }, { label: 'Продолжить' }];
const ZELOW = [14.38, 52.53];
/**
 * Подсветка исполненного голосом: следить за рамками (.hl-frame, data-target — селектор цели) и меткой на карте
 * (.hl-spot): когда появились и погасли, обведён ли элемент цели (рамка вокруг него), метка — внутри карты.
 */
const hlWatch = () => page.evaluate(() => {
  if (window.__hl) return;
  window.__hl = [];
  const seen = new Map();
  const around = (f, sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const a = f.getBoundingClientRect(), b = el.getBoundingClientRect();
    return b.width > 0 && a.left <= b.left && a.top <= b.top && a.right >= b.right && a.bottom >= b.bottom;
  };
  new MutationObserver(() => {
    const now = performance.now();
    const cur = new Map();
    for (const f of document.querySelectorAll('.hl-frame')) cur.set(f.dataset.target, f);
    const spot = document.querySelector('.hl-spot');
    if (spot) cur.set('spot', spot);
    for (const [t, f] of cur) if (!seen.has(t)) {
      seen.set(t, now);
      let ok = true;
      if (t === 'spot') {
        const box = window.__cmdEngine?.getContainer().getBoundingClientRect(), r = f.getBoundingClientRect();
        ok = !!box && r.left >= box.left && r.left <= box.right && r.top >= box.top && r.top <= box.bottom;
      } else ok = around(f, t);
      window.__hl.push({ t, on: now, ok });
    }
    for (const t of [...seen.keys()]) if (!cur.has(t)) { seen.delete(t); const e = window.__hl.findLast((x) => x.t === t && x.off === undefined); if (e) e.off = now; }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-target', 'style'] });
});
/** Дождаться рамки на цели (селектор — точно или начало) после того, как наблюдение показало n записей. */
const hlWait = async (target, from, timeout = 10000) => {
  await page.waitForFunction(([t, n]) => window.__hl.slice(n).some((x) => x.t === t || (t.endsWith('*') && x.t.startsWith(t.slice(0, -1)))), [target, from], { timeout })
    .catch(async () => { throw new Error(`нет подсветки ${target}; было: ${JSON.stringify(await page.evaluate((n) => window.__hl.slice(n), from))}`); });
  return page.evaluate(([t, n]) => window.__hl.slice(n).find((x) => x.t === t || (t.endsWith('*') && x.t.startsWith(t.slice(0, -1)))), [target, from]);
};
const hlCount = () => page.evaluate(() => window.__hl.length);
/** Метка на карте сейчас — не под панелью голоса, легендой и советником (карта сдвинута, как у «покажи …»). */
const spotFree = async () => {
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const s = document.querySelector('.hl-spot');
    if (!s) return 'метки нет';
    const p = s.getBoundingClientRect();
    const hit = [...document.querySelectorAll('[data-tour="voice"], .legend, .advisor')].map((e) => [e.className, e.getBoundingClientRect()])
      .find(([, r]) => p.left >= r.left && p.left <= r.right && p.top >= r.top && p.top <= r.bottom);
    return hit ? `метка под ${hit[0]}` : '';
  });
  if (r) throw new Error(r);
};
/** Погасла ли рамка через ~2,5 с (не раньше 2 с, не позже 3,5 с). */
const hlGone = async (target, from) => {
  await page.waitForFunction(([t, n]) => window.__hl.slice(n).some((x) => (x.t === t || (t.endsWith('*') && x.t.startsWith(t.slice(0, -1)))) && x.off !== undefined), [target, from], { timeout: 6000 })
    .catch(() => { throw new Error(`подсветка ${target} не гаснет`); });
  const e = await page.evaluate(([t, n]) => window.__hl.slice(n).find((x) => (x.t === t || (t.endsWith('*') && x.t.startsWith(t.slice(0, -1)))) && x.off !== undefined), [target, from]);
  const ms = Math.round(e.off - e.on);
  if (ms < 1500 || ms > 3500) throw new Error(`подсветка ${target} горела ${ms} мс`);
  return ms;
};
/** Где Зелов на экране сейчас (без перемещения карты): в карте ли, под панелью голоса или легендой ли. */
const zelowSeen = () => page.evaluate((at) => {
  const en = window.__cmdEngine;
  const box = en.getContainer().getBoundingClientRect();
  const [x, y] = en.project(at);
  const p = { x: box.left + x, y: box.top + y };
  const inside = (r) => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom;
  const under = [...document.querySelectorAll('[data-tour="voice"], .legend')].map((e) => e.getBoundingClientRect()).filter(inside).length;
  return { p: [Math.round(p.x), Math.round(p.y)], under, onMap: inside(box), zoom: en.getView().zoom };
}, ZELOW);
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
  // панель — полосой и не на окне; главная кнопка окна открыта
  await panel.locator('.vp-card.strip').waitFor({ timeout: 3000 });
  await page.waitForTimeout(400);
  const pv = await panelVs('.modal.take');
  if (pv.cross) throw new Error(`панель ${pv.panel} на окне ${pv.win}`);
  // фраза штаба (вопрос окна) видна в полосе, а не только состояние
  await panel.locator('.vp-card.strip .vp-last', { hasText: 'Принять командование' }).waitFor({ timeout: 3000 }).catch(() => { throw new Error('в полосе нет вопроса окна'); });
  const main = dlg.getByRole('button', { name: /^Принять командование с/ });
  if (!(await main.evaluate((b) => { const r = b.getBoundingClientRect(); return b.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)); }))) throw new Error('главная кнопка окна закрыта');
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
  await feedHas('Цель — ').waitFor({ timeout: 30000 });
  const text = await page.evaluate(() => window.__e2e.sent.filter((m) => m.type === 'say' && m.text.includes('Цель — ')).at(-1).text);
  if (/\d/.test(text)) throw new Error(`в докладе цифры: ${text}`);
  const n = text.match(/[.!?…]+(?=\s|$)/g)?.length ?? 0;
  if (n < 5 || n > 7) throw new Error(`в докладе ${n} фраз: ${text}`);
  await hlWatch();
  const hl0 = await hlCount();
  await handsFree(['штаб, покажи Зелов', '{тишина}', 'штаб, оперативный уровень', ...QUIET], { reload: false });
  await feedHas('Показываю: Зелов').waitFor({ timeout: 30000 });
  // подсветка: метка на месте Зелова, рамка на переключателе уровня — вокруг кнопки «Оперативный»
  if (!(await hlWait('spot', hl0)).ok) throw new Error('метка Зелова не на карте');
  await page.locator('.lvl-sw button.on', { hasText: 'Оперативный' }).waitFor({ timeout: 30000 });
  if (!(await hlWait('[data-hl="level-op"]', hl0)).ok) throw new Error('рамка не вокруг переключателя уровня');
  const lvlMs = await hlGone('[data-hl="level-op"]', hl0);
  // масштаб карты — в рекомендованном интервале оперативного уровня (1:100 000 – 1:200 000), «масштаб вне» не показан
  const sbT = await page.locator('.sb-num:visible').first().innerText({ timeout: 5000 }).catch(() => '');
  const sbN = Number(sbT.replace(/\D/g, '').replace(/^1/, ''));
  if (!(sbN >= 97000 && sbN < 196000)) throw new Error(`масштаб на оперативном уровне «${sbT}»`);
  if (await page.locator('.lvl-off').count()) throw new Error('показано «масштаб вне интервала» внутри интервала');
  // Зелов — в карте и не под панелью и легендой (центр смещён к свободной части карты)
  const z = await zelowSeen();
  if (z.under || !z.onMap || z.zoom < 10) throw new Error(`Зелов в ${z.p}, масштаб ${z.zoom}: под панелью или легендой — ${z.under}`);
  if (!(await page.locator('.legend.closed').count())) throw new Error('легенда в командовании открыта');
  await page.locator('.lvl-sw button.on', { hasText: 'Оперативный' }).waitFor({ timeout: 30000 });
  await shot('voice-command.jpg');
  const clicks = await page.evaluate(() => window.__clicks);
  if (clicks) throw new Error(`щелчков: ${clicks}`);
  return `расчёт ${calcS} с; Зелов в ${z.p}; рамка уровня ${lvlMs} мс`;
});

await check('без рук: «дай два варианта» → «подробнее о первом» → «выбираю первый» → «восьмой гвардейской наступать на Зелов» → «запиши в замысел: …» → «что не готово?»', async () => {
  // советник отвечает с поддельной LM Studio (поток окна игры ходит туда же)
  await handsFree(['штаб, дай два варианта', ...QUIET], { reload: false });
  await feedHas('Прошу у советника два варианта').waitFor({ timeout: 30000 });
  await feedHas('Советник предложил два варианта').waitFor({ timeout: 90000 }).catch(() => { throw new Error(`варианты не готовы (запросов вариантов к модели: ${LM.plans})`); });
  await handsFree(['штаб, подробнее о первом', ...QUIET], { reload: false });
  await feedHas('Вариант первый: «Удар на Зелов»').waitFor({ timeout: 30000 });
  await page.locator('.plan-var .plan-body').first().waitFor({ timeout: 10000 }).catch(() => { throw new Error('вариант не раскрыт на экране'); });
  await hlWatch();
  let hl0 = await hlCount();
  await handsFree(['штаб, выбираю первый', ...QUIET], { reload: false });
  await feedHas('Вариант «Удар на Зелов» принят').waitFor({ timeout: 30000 });
  await page.locator('.plan-var.on .plan-ok', { hasText: 'принят' }).waitFor({ timeout: 10000 });
  if (!(await hlWait('[data-hl="variant-1"]', hl0)).ok) throw new Error('рамка не вокруг варианта');
  const varMs = await hlGone('[data-hl="variant-1"]', hl0);
  hl0 = await hlCount();
  await handsFree(['штаб, восьмой гвардейской наступать на Зелов', ...QUIET], { reload: false });
  await feedHas('Приказ: восьмая гвардейская армия — наступать, цель — Зелов').waitFor({ timeout: 30000 });
  await page.locator('.cmd-tabs button.on', { hasText: 'Приказы' }).waitFor({ timeout: 10000 });
  await page.locator('.draft', { hasText: '8-я гвардейская армия' }).waitFor({ timeout: 10000 });
  // рамка на новом приказе в списке и метка на месте цели — на карте
  if (!(await hlWait('[data-hl="order-*', hl0)).ok) throw new Error('рамка не вокруг приказа');
  if (!(await hlWait('spot', hl0)).ok) throw new Error('метка цели приказа не на карте');
  await spotFree();
  await shot('voice-highlight.jpg');
  await hlGone('[data-hl="order-*', hl0);
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
  return `запросов вариантов: ${LM.plans}; рамка варианта ${varMs} мс`;
});

await check('подсветка: мышью — без рамки (вкладка «Решение», уровень «Тактический»)', async () => {
  await hlWatch();
  const hl0 = await hlCount();
  await page.locator('.cmd-tabs button', { hasText: 'Решение' }).click();
  await page.locator('.lvl-sw button', { hasText: 'Тактический' }).click();
  await page.locator('.cmd-tabs button.on', { hasText: 'Решение' }).waitFor({ timeout: 5000 });
  await page.waitForTimeout(1200);
  const extra = await page.evaluate((n) => window.__hl.slice(n), hl0);
  if (extra.length) throw new Error(`мышью подсвечено: ${JSON.stringify(extra)}`);
  await page.evaluate(() => { window.__clicks = 0; }); // дальше снова без рук
  return 'без рамки';
});

await check('без рук: «проводи ход» — чего нет и предложение («да» — черновик донесения) → «проводи ход» → «да» → доклад посредника его голосом', async () => {
  await handsFree(['штаб, проводи ход', ...QUIET], { reload: false });
  await feedHas('Ход проводить рано: не готово — боевое донесение').waitFor({ timeout: 30000 });
  await feedHas('Составить черновик донесения?').waitFor({ timeout: 10000 });
  await handsFree(['штаб, да', ...QUIET], { reload: false });
  await feedHas('Черновик донесения составлен').waitFor({ timeout: 30000 });
  await handsFree(['штаб, проводи ход', ...QUIET], { reload: false });
  await feedHas('Провожу ход: решение готово, приказов один').waitFor({ timeout: 30000 });
  await panel.locator('.vp-confirm').waitFor({ timeout: 10000 });
  await shot('voice-turn.jpg');
  // советник (открыт проверкой советника) лежит справа поверх карты — скрыть: разбор хода — на карте
  const advBtn = page.locator('.advisor .adv-h button[title^="Скрыть советника"]');
  if (await advBtn.isVisible().catch(() => false)) { await advBtn.click(); await page.evaluate(() => { window.__clicks = 0; }); }
  await handsFree(['штаб, да', ...QUIET], { reload: false });
  await feedHas('Считаю ход').waitFor({ timeout: 30000 });
  // посредник: сначала — «сведения готовятся» (его голосом, в ленте — «Посредник:»), затем разбор хода на карте
  await panel.locator('.vp-item.umpire').first().waitFor({ timeout: 180000 }).catch(() => { throw new Error('посредник молчит'); });
  const tour = page.locator('.tour');
  await tour.locator('.tour-count', { hasText: /^Разбор хода · шаг 1 из \d/ }).waitFor({ timeout: 180000 }).catch(() => { throw new Error('разбора хода нет'); });
  const ump = await page.evaluate(() => window.__e2e.sent.filter((m) => m.type === 'say' && m.role === 'umpire').map((m) => m.text));
  if (ump[0] !== 'Сведения о ходе готовятся, прошу подождать.' && !/по данным расчёта/.test(ump[0])) throw new Error(`посредник начал не с объявления: ${ump[0]}`);
  const n = +(await tour.locator('.tour-count').innerText()).match(/из (\d+)/)[1];
  if (n < 2 || n > 8) throw new Error(`шагов разбора: ${n}`);
  // общий шаг — время карты идёт от начала хода к концу (движение войск, фронт, зоны влияния)
  const hours = new Set();
  for (let i = 0; i < 12; i++) { hours.add(await page.locator('.player .pl-date span').innerText()); await page.waitForTimeout(400); }
  if (hours.size < 3) throw new Error(`ход не проигрывается: ${[...hours].join(', ')}`);
  // шаг звучит голосом посредника — текстом модели, числа словами
  await page.waitForFunction(() => window.__e2e.sent.some((m) => m.type === 'say' && m.role === 'umpire' && /^Ход прошёл без перелома\. Восьмая гвардейская армия ведёт бой у Зелова\./.test(m.text)), null, { timeout: 30000 })
    .catch(async () => { throw new Error(`шаг не голосом посредника: ${JSON.stringify(await page.evaluate(() => window.__e2e.sent.filter((m) => m.type === 'say').slice(-3)))}`); });
  // бой: карта переехала к месту, метка-пульс и рамка вокруг участников
  const view0 = await page.evaluate(() => window.__cmdEngine.getView().center);
  const battle = tour.locator('.tour-cap h2', { hasText: /^Бой / });
  if (!await battle.waitFor({ timeout: 40000 }).then(() => true, () => false)) await handsFree(['штаб, дальше', ...QUIET], { reload: false });
  await battle.waitFor({ timeout: 40000 }).catch(() => { throw new Error('шага с боем нет'); });
  await page.locator('.hl-layer .hl-spot').waitFor({ state: 'attached', timeout: 10000 }).catch(() => { throw new Error('на месте боя нет метки'); });
  await page.locator('.hl-layer .hl-frame.hl-box').waitFor({ timeout: 5000 }).catch(() => { throw new Error('вокруг места боя нет рамки'); });
  const view1 = await page.evaluate(() => window.__cmdEngine.getView().center);
  if (Math.hypot(view1[0] - view0[0], view1[1] - view0[1]) < 0.01) throw new Error('карта не переехала к месту боя');
  const spot = await page.locator('.hl-layer .hl-spot').evaluate((e) => e.getBoundingClientRect().toJSON());
  const cap = await tour.locator('.tour-cap').evaluate((e) => e.getBoundingClientRect().toJSON());
  if (spot.x > cap.left - 20 && spot.x < cap.right + 20 && spot.y > cap.top - 20 && spot.y < cap.bottom + 20) throw new Error('метка под подписью разбора');
  await page.waitForTimeout(600);
  await shot('voice-turn-review.jpg');
  const title = await battle.innerText();
  // «хватит» — разбор закончен, время карты — снова конец хода; штаб подсказывает, что дальше
  await handsFree(['штаб, хватит', ...QUIET], { reload: false });
  await tour.waitFor({ state: 'detached', timeout: 40000 }).catch(() => { throw new Error('«хватит» не закончил разбор'); });
  await page.locator('.hl-layer .hl-box').waitFor({ state: 'detached', timeout: 5000 }).catch(() => { throw new Error('рамка боя осталась после разбора'); });
  await feedHas('Решение на следующий ход').waitFor({ timeout: 60000 });
  await page.locator('.cmd-date', { hasText: 'ход 2' }).waitFor({ timeout: 10000 });
  const end = await page.locator('.player .pl-date span').innerText();
  const clicks = await page.evaluate(() => window.__clicks);
  if (clicks) throw new Error(`щелчков: ${clicks}`);
  return `шагов ${n}, «${title}», время после разбора ${end}`;
});

await check('командование: при полосе место тоже не под ней', async () => {
  // советник (открыт проверкой советника) лежит справа поверх карты — скрыть: проверки ниже — о карте
  const adv = page.locator('.advisor .adv-h button[title^="Скрыть советника"]');
  if (await adv.isVisible().catch(() => false)) await adv.click();
  const full = panel.locator('.vp-card:not(.strip)');
  if (await full.isVisible()) await full.getByRole('button', { name: 'Свернуть' }).click();
  await panel.locator('.vp-card.strip').waitFor({ timeout: 3000 });
  await page.evaluate(async (at) => { const { showAt } = await import('/src/engine/free-center.ts'); showAt(window.__cmdEngine, at, 10); }, ZELOW);
  const z = await zelowSeen();
  if (z.under || !z.onMap) throw new Error(`Зелов в ${z.p}: под панелью или легендой — ${z.under}`);
  await shot('voice-strip.jpg');
  return `Зелов в ${z.p}`;
});

await check('зоны влияния сторон: карта подкрашена (свои — красноватые, противник — голубоватые); «скрой / покажи зоны влияния»', async () => {
  await page.evaluate(() => window.__cmdEngine.setView({ center: [14.3, 52.55], zoom: 8.6 }));
  await page.waitForTimeout(1500);
  const r = await page.locator('.rp-map').evaluate((e) => e.getBoundingClientRect().toJSON());
  const clip = { x: Math.round(r.left + 20), y: Math.round(r.top + 150), width: Math.round(r.width - 80), height: Math.round(r.height - 330) };
  const on = await page.screenshot({ clip, type: 'png' });
  await handsFree(['штаб, скрой зоны влияния', ...QUIET], { reload: false });
  await feedHas('Скрыл: зоны влияния сторон').waitFor({ timeout: 30000 });
  await page.waitForTimeout(1500);
  const off = await page.screenshot({ clip, type: 'png' });
  if (on.equals(off)) throw new Error('со слоем «Зоны влияния» и без него карта одинакова');
  await handsFree(['штаб, покажи зоны влияния', ...QUIET], { reload: false });
  await feedHas('Показываю: зоны влияния сторон').waitFor({ timeout: 30000 });
  await page.evaluate(() => import('/src/voice/registry.ts').then((m) => m.act('map.legend', { open: true })));
  await page.locator('.legend .lg-zone-own').waitFor({ timeout: 5000 }).catch(() => { throw new Error('в легенде нет зон влияния'); });
  await page.waitForTimeout(1500);
  await shot('voice-zones.jpg');
  await page.evaluate(() => import('/src/voice/registry.ts').then((m) => m.act('map.legend', { open: false })));
  return 'слой включается и выключается голосом';
});

await check('полоса — сверху по центру под полосой кнопок карты: кнопки карты, вкладки и колонка разделов открыты; значок — там же', async () => {
  const strip = panel.locator('.vp-card.strip');
  await strip.waitFor({ timeout: 3000 });
  const r = await placeAtTop('.vp-card.strip');
  await strip.getByRole('button', { name: 'Свернуть' }).click();
  const icon = await page.locator('.vp-icon').evaluate((e) => e.getBoundingClientRect().toJSON());
  const ic = icon.left + icon.width / 2;
  if (Math.abs(ic - r.center) > 4 || Math.abs(icon.top - r.top) > 4) throw new Error(`значок ${Math.round(ic)},${Math.round(icon.top)}, полоса ${Math.round(r.center)},${Math.round(r.top)}`);
  await page.locator('.vp-icon').click();
  await strip.waitFor({ timeout: 3000 });
  return `полоса ${r.box}, под полосой кнопок (низ ${r.bar})`;
});

await check('окно с длинным вопросом: фраза в полосе — до трёх строк, обрезанная — «Повторить»; закрыли окно — полоса, не большая панель', async () => {
  const strip = panel.locator('.vp-card.strip');
  await openDialog('confirmAsync', LONG_Q, { ok: 'Сохранить' });
  await strip.locator('.vp-last.l3').waitFor({ timeout: 5000 });
  await strip.getByRole('button', { name: 'Повторить' }).waitFor({ timeout: 3000 }).catch(() => { throw new Error('обрезанная фраза без «Повторить»'); });
  await page.waitForTimeout(1500);
  await page.evaluate(() => import('/src/voice/registry.ts').then((m) => m.act('dialog.answer', { choice: 'нет' })));
  if ((await dlgOut(5000)) !== false) throw new Error('окно не закрылось');
  for (let i = 0; i < 10; i++) {
    if (await panel.locator('.vp-card:not(.strip)').isVisible()) throw new Error('после окна выскочила развёрнутая панель');
    await page.waitForTimeout(150);
  }
});

await check('«Разбор операции» (окно почти во весь экран): окно — ниже панели, панель с фразой, заголовок и кнопки окна открыты', async () => {
  // ход уже проведён (проверка «проводи ход») — разбор открывается из меню игры
  await page.locator('.cmd-top').getByRole('button', { name: '⋯' }).click();
  await page.locator('.menu button', { hasText: 'Разбор операции' }).click();
  const rv = page.locator('.modal.review[data-modal]');
  await rv.waitFor({ timeout: 5000 });
  await page.waitForTimeout(700);
  await panel.locator('.vp-card.strip').waitFor({ timeout: 2000 });
  const v = await panelVs('.modal.review');
  if (v.cross) throw new Error(`панель ${v.panel} на окне ${v.win}`);
  const w = await rv.evaluate((e) => e.getBoundingClientRect().bottom);
  if (w > 900) throw new Error(`окно ушло за низ экрана: ${w}`);
  await shot('voice-review.jpg');
  await rv.locator('.rv-h button.x').click();
  return `панель ${v.panel}, окно ${v.win}`;
});

await check('полоса: короткая фраза штаба — в полосе; длинная — в полосе целиком (не развёрнутая панель), через 10 с тишины снова обрезана', async () => {
  const strip = panel.locator('.vp-card.strip');
  await strip.waitFor({ timeout: 3000 });
  const say = (t) => page.evaluate((x) => import('/src/voice/registry.ts').then((m) => m.speak(x)), t);
  /** Штаб договорил всё, что было в очереди звука. */
  const silent = (ms) => page.waitForFunction(() => !window.__e2e.playing().length, null, { timeout: ms, polling: 100 });
  await silent(60000);
  await say('Обстановка без изменений.');
  await strip.locator('.vp-last', { hasText: 'Обстановка без изменений.' }).waitFor({ timeout: 5000 });
  await panel.locator('.vp-state', { hasText: 'Говорит начальник штаба' }).waitFor({ timeout: 5000 }).catch(() => {});
  await shot('voice-strip-speaking.jpg');
  await panel.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: 15000 });
  const LONG = 'Противник за ночь подтянул к переднему краю свежие резервы и ведёт разведку боем на левом фланге. Наши части удерживают рубеж.';
  await say(LONG);
  const whole = strip.locator('.vp-last.whole', { hasText: 'Наши части удерживают рубеж.' });
  await whole.waitFor({ timeout: 5000 }).catch(() => { throw new Error('длинная фраза — в полосе не целиком'); });
  if (await panel.locator('.vp-card:not(.strip)').isVisible()) throw new Error('длинная фраза развернула панель');
  // фраза видна вся: не обрезана и без «Повторить»
  const cut = await whole.evaluate((e) => e.scrollHeight > e.clientHeight + 1);
  if (cut) throw new Error('фраза в полосе обрезана');
  if (await strip.locator('.vp-cut').isVisible()) throw new Error('при целой фразе — «Повторить»');
  const h = await strip.evaluate((e) => Math.round(e.getBoundingClientRect().height));
  await shot('voice-strip-whole.jpg');
  // договорил (поддельный синтез — 15 знаков в секунду) и 10 с тишины — снова две строки
  await silent(60000);
  const t0 = Date.now();
  await strip.locator('.vp-last:not(.whole)').waitFor({ timeout: 20000 }).catch(async () => {
    const d = await page.evaluate(() => ({ size: JSON.stringify(window.__voiceSize), state: document.querySelector('.vp-state')?.textContent, playing: window.__e2e.playing(), confirm: !!document.querySelector('.vp-confirm') }));
    throw new Error(`фраза не обрезалась после тишины: ${JSON.stringify(d)}`);
  });
  const dt = (Date.now() - t0) / 1000;
  if (dt < 8) throw new Error(`обрезалась через ${dt} с тишины — раньше 10 с`);
  await strip.locator('.vp-cut').waitFor({ timeout: 2000 }).catch(() => { throw new Error('обрезанная фраза без «Повторить»'); });
  return `полоса с целой фразой ${h} px; обрезана через ${Math.round(dt)} с тишины`;
});

await check('открыто окно — панель полосой и не на окне; ответа нет 8 с — «Да или нет? Жду ответа.» (один раз); «нет»', async () => {
  await handsFree(QUIET, { reload: false });
  await openDialog('confirmAsync', 'Удалить слой «Рубежи» вместе с подписями? Рубежи нарисованы по директиве, их можно взять снова из базы знаний.', { ok: 'Удалить', danger: true });
  await panel.locator('.vp-card.strip').waitFor({ timeout: 3000 }).catch(() => { throw new Error('при открытом окне панель не полоса'); });
  await page.waitForTimeout(400); // место панели пересчитывается раз в 300 мс
  const v = await panelVs('.confirm-box');
  if (v.cross) throw new Error(`панель ${v.panel} на окне ${v.win}`);
  const fs = await page.locator('.confirm-box').evaluate((b) => Math.min(...[...b.querySelectorAll('p, button')].map((e) => parseFloat(getComputedStyle(e).fontSize))));
  if (fs < 18) throw new Error(`шрифт окна ${fs} px`);
  await feedHas('Да или нет? Жду ответа.').waitFor({ timeout: 40000 });
  await shot('voice-dialog.jpg');
  await page.waitForTimeout(REMIND_WAIT);
  const n = await page.evaluate(() => window.__e2e.sent.filter((m) => m.type === 'say' && m.text === 'Да или нет? Жду ответа.').length);
  if (n !== 1) throw new Error(`напоминаний: ${n}`);
  await handsFree(['штаб, нет', ...QUIET], { reload: false });
  if ((await dlgOut(30000)) !== false) throw new Error('«нет» не закрыло окно');
  return `панель ${v.panel}, окно ${v.win}`;
});

/** Окно открыто и читается; ответ «второй» — посреди чтения: окно закрыто, чтение оборвано (stopped — как узнать). */
async function answerOverReading(stopped) {
  const k = await page.evaluate(() => ({ msgs: window.__e2e.msgs.length, sent: window.__e2e.sent.length }));
  await openDialog('chooseAsync', LONG_Q, LABELS);
  const t0 = Date.now();
  const v = await dlgOut(40000).catch(async (e) => {
    const log = await page.evaluate(() => ({ msgs: window.__e2e.msgs.filter((m) => !['level', 'speech'].includes(m.type)).slice(-8), feed: document.querySelector('.vp-card')?.innerText }));
    throw new Error(`${e.message.split('\n')[0]}; ${JSON.stringify(log)}`);
  });
  if (v !== 1) throw new Error(`выбран ${JSON.stringify(v)}`);
  const dt = Date.now() - t0;
  const read = await page.evaluate((i) => window.__e2e.sent.slice(i).find((m) => m.type === 'say' && m.text.startsWith('Что сделать с игрой?')), k.sent);
  if (!read) throw new Error('вопрос не зачитан');
  if (!read.text.startsWith('Что сделать с игрой? Варианты: первый')) throw new Error(`сначала не варианты: ${read.text.slice(0, 80)}`);
  const cut = await page.evaluate(([i, j, id, how]) => (how === 'barge'
    ? window.__e2e.msgs.slice(i).some((m) => m.type === 'barge' && m.id === id)
    : window.__e2e.msgs.slice(i).some((m) => m.type === 'over' && m.text === 'второй') && window.__e2e.sent.slice(j).some((m) => m.type === 'stop')
      && window.__e2e.sent.slice(j).some((m) => m.type === 'say' && m.text === 'Повторите ответ после вопроса: номер варианта или «отмена». Жду ответа.')), [k.msgs, k.sent, read.id, stopped]);
  if (!cut) throw new Error(`чтение не оборвано (${stopped})`);
  // «голосом» ответ исполнен сразу; «словом» — слово было в сказанном (могло быть эхом): переспрос, повтор — исполнен
  if (stopped === 'barge' && dt > read.text.length / 15 * 1000) throw new Error(`ответ принят через ${dt} мс — после чтения`);
  return `ответ принят через ${Math.round(dt / 100) / 10} с, вопрос читался бы ${Math.round(read.text.length / 15)} с`;
}

await check('ответ посреди чтения окна, перебивание «голосом»: «второй» — штаб оборван, выбран второй', async () => {
  // каждый «слог» — «второй»: до окна — не мне, посреди чтения — перебивает штаб и отвечает
  await handsFree(['второй', 'второй', ...QUIET]);
  return answerOverReading('barge');
});

await check('ответ посреди чтения окна, перебивание «словом»: «второй» поверх штаба (есть в сказанном) — штаб замолк и переспросил; повтор — выбран второй', async () => {
  // по ходу речи поверх штаба куски распознаются (стоп-слово ли) и тоже снимают строки сценария
  await handsFree([...Array(30).fill('второй'), ...QUIET], { mode: 'word' });
  const r = await answerOverReading('stop');
  await page.locator('.vp-card').first().waitFor({ timeout: 2000 });
  return r;
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
await ctx.close();  // прежнее окно тоже подключено к сервису — оно забрало бы реплики следующих частей
// рамка тура — нужна турам разделов и игре (части tours и game)
/**
 * Рамка тура — вокруг [data-tour=target] в окне или в странице во врезке (iframe; координаты — со сдвигом врезки);
 * capFree — подпись не на рамке и не на панели голоса.
 */
const frameIn = (pg) => (target, capFree = true) => pg.waitForFunction(([t, free]) => {
  const pad = /^rail-/.test(t) ? 1 : /^cmd-tab-/.test(t) ? 2 : 8; // как padFor в TourLayer.tsx
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
part = 'intro';
if (want('intro')) { // часть intro (--only) — до ctx2.close()
const scriptTour = join(tmp, 'script-tour.txt');
writeFileSync(scriptTour, ['штаб, дальше', 'назад', 'штаб, хватит', ...Array(60).fill('передайте в штаб армии')].join('\n') + '\n');
await stopVoice();
await startVoice(scriptTour);
const ctx2 = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
await ctx2.addInitScript((url) => {
  if (sessionStorage.getItem('e2e.init')) return;
  sessionStorage.setItem('e2e.init', '1');
  localStorage.clear();
  localStorage.setItem('def_ops.voice.url', url);
  sessionStorage.setItem('def_ops.section', 'editor');
  localStorage.setItem('def_ops.voice.panel', 'full');  // лента реплик видна
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
  const pad = /^rail-/.test(t) ? 1 : /^cmd-tab-/.test(t) ? 2 : 8; // как padFor в TourLayer.tsx
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
}

// ---------------------------------------------------------------- туры разделов и вкладки голосом
part = 'tours';
if (want('tours')) { // часть tours (--only) — до ctx3.close()
// новое окно (вступление выключено), сервис с репликами: раздел, вкладка, тур по моделированию с переключением
// вкладок, тур по знакам — подсветка внутри страницы справочника (iframe)
const scriptSections = join(tmp, 'script-sections.txt');
writeFileSync(scriptSections, ['штаб, открой моделирование', 'штаб, открой вкладку калибровка', 'штаб, тур по моделированию',
  'штаб, дальше', 'штаб, дальше', 'штаб, дальше', 'штаб, хватит', 'штаб, тур по знакам', 'штаб, дальше', 'штаб, дальше', 'штаб, хватит',
  'штаб, тур по переигровке', 'штаб, хватит',
  // поддельная «речь» поверх голоса штаба перебивает шаг (пауза) — тур вне игры листается «дальше» до конца
  'штаб, тур по командованию', ...Array(5).fill('штаб, дальше'), ...QUIET].join('\n') + '\n');
await stopVoice();
await startVoice(scriptSections);
const ctx3 = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
await ctx3.addInitScript((url) => {
  if (sessionStorage.getItem('e2e.init')) return;
  sessionStorage.setItem('e2e.init', '1');
  localStorage.clear();
  localStorage.setItem('def_ops.voice.url', url);
  sessionStorage.setItem('def_ops.section', 'editor');
  localStorage.setItem('def_ops.voice.intro', 'off');
  localStorage.setItem('def_ops.voice.panel', 'full');  // лента видна (при открытом окне — полоса)
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
const frame3 = frameIn(page3);

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

await check('«Штаб, тур по переигровке» — раздел «Переигровка», рамка на шапке раздела; «хватит» — тур окончен', async () => {
  await heard3('тур по переигровке');
  await page3.locator('[data-tour="section-replay"]').waitFor({ state: 'visible', timeout: 20000 });
  await title3('Переигровка');
  await frame3('replay-head');
  await page3.waitForTimeout(300);
  if (SHOTS) await page3.screenshot({ path: join(SHOTS, 'voice-tour-replay.jpg'), type: 'jpeg', quality: 88 });
  await layer3.waitFor({ state: 'detached', timeout: 40000 });
});

await check('«Штаб, тур по командованию» вне игры — как попасть в игру, рамка на «Рассчитать», в конце — предложение начать', async () => {
  await heard3('тур по командованию');
  await layer3.locator('.tour-count', { hasText: 'Командование · шаг 1 из 5' }).waitFor({ timeout: T })
    .catch(async () => { throw new Error(`тура «Командование» вне игры нет; лента: ${await feed3()}`); });
  await title3('Сначала расчёт');
  await frame3('replay-go');
  const say = await layer3.locator('.tour-cap').innerText();
  if (!say.includes('Штаб, рассчитай операцию')) throw new Error(`подпись: ${say}`);
  if (SHOTS) await page3.screenshot({ path: join(SHOTS, 'voice-tour-command-entry.jpg'), type: 'jpeg', quality: 88 });
  await page3.locator('.vp-item.chief', { hasText: 'Рассчитать операцию сейчас? Скажите «да»' }).first().waitFor({ timeout: 90000 })
    .catch(async () => { throw new Error(`предложения начать нет; лента: ${(await feed3()).slice(-800)}`); });
  if (await layer3.count()) throw new Error('тур не закончился');
});
await ctx3.close();
}

// ---------------------------------------------------------------- без рук: от запуска до доклада посредника
part = 'game';
if (want('game')) { // часть game (--only) — до ctx4.close()
// Новое окно (калибровки не было, вступление включено), поддельная LM Studio: советник даёт полный вариант решения
// (с донесением), штаб противника — решение, посредник — доклад. Ни одного щелчка: «хватит» (вступление) → «покажи
// переигровку» → «рассчитай операцию» → «прими командование» → «принимаю» → «доложи обстановку» → «дай два варианта»
// → «выбираю первый» → «проводи ход» → «да» → доклад посредника его голосом.
const PLAN_FULL = { variants: PLAN.variants.map((v) => ({ ...v, report: 'Войска ведут бой за Зееловские высоты, подвоз доходит.' })) };
const DECISION_DE = { assessment: 'Русские наступают на Зелов.', enemyIntent: 'Прорыв к Берлину.', intent: 'Удерживать вторую полосу.', orders: [], requests: [], risks: [], actions: [], basis: [] };
await stopVoice();
const ctx4 = await browser.newContext({ viewport: { width: 1440, height: 900 }, permissions: ['microphone'] });
await ctx4.addInitScript((url) => {
  if (sessionStorage.getItem('e2e.init')) return;
  sessionStorage.setItem('e2e.init', '1');
  localStorage.clear();
  localStorage.setItem('def_ops.voice.url', url);
  sessionStorage.setItem('def_ops.section', 'editor');
  localStorage.setItem('def_ops.voice.panel', 'full');  // лента видна (при открытом окне — полоса)
  localStorage.setItem('def_ops.voice.settings', JSON.stringify({ vad: 0.5, barge_vad: 0.8, barge_ms: 300, end_ms: 400, barge_mode: 'voice', aec_unknown: true }));
}, `ws://127.0.0.1:${vport}/ws`);
await ctx4.addInitScript(() => {
  window.__clicks = 0; window.addEventListener('pointerdown', () => { window.__clicks++; }, true);
  window.__said = [];
  const Ws = window.WebSocket;
  window.WebSocket = class extends Ws { send(d) { if (typeof d === 'string') { try { window.__said.push(JSON.parse(d)); } catch { /* */ } } return super.send(d); } };
});
const LM4 = { plans: 0, enemy: 0, umpire: 0, log: [] };
await ctx4.route((u) => u.pathname.startsWith('/llm/'), async (route) => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/v1/models')) return route.fulfill({ json: { object: 'list', data: [{ id: 'fake-voice', object: 'model' }] } });
  if (!url.pathname.endsWith('/v1/chat/completions')) return route.fulfill({ status: 404, body: '' });
  const body = route.request().postDataJSON();
  const schema = body.response_format?.json_schema?.name;
  const reply = (content) => (body.stream ? route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: sse(content) }) : route.fulfill({ json: lmReply(content) }));
  if (schema === 'staff_plan') { LM4.plans++; return reply(JSON.stringify(PLAN_FULL)).catch(() => {}); }
  if (schema === 'staff_decision') { LM4.enemy++; LM4.log.push('enemy'); return reply(JSON.stringify(DECISION_DE)).catch(() => {}); }
  if (schema) return reply('{}').catch(() => {});
  if (/посредник штабной игры/.test(body.messages[0]?.content ?? '')) { LM4.umpire++; LM4.log.push('umpire'); return reply(umpireSays(body)).catch(() => {}); }
  return reply('Слушаю.').catch(() => {});
});
if (STUB) await ctx4.route('**/api/voice', (r) => r.fulfill({ json: { state: 'ready', port: vport } }));
const page4 = await ctx4.newPage();
page4.on('pageerror', (e) => errors.push(e.message));
const panel4 = page4.locator('.vp');
// при открытом окне панель — полоса: фраза штаба — в ней (последняя), иначе — в ленте
const said4 = (re, kind = 'chief') => panel4.locator(kind === 'chief' ? `.vp-item.${kind}, .vp-card.strip .vp-last` : `.vp-item.${kind}`, { hasText: re }).first();
const feed4 = async () => (await page4.locator('.vp-feed').innerText().catch(() => '')).replace(/\s+/g, ' ');
/** Следующие реплики «микрофона»: сервис перезапускается с ними (окно подключается само). */
async function hands4(lines) {
  await stopVoice();
  const f = join(tmp, `hands4-${Date.now()}.txt`);
  writeFileSync(f, [...lines, ...QUIET].join('\n') + '\n');
  await startVoice(f, 'off');
  await panel4.locator('.vp-state', { hasText: LIVE }).waitFor({ timeout: 40000 });
}
const step4 = (what, loc, ms = 30000) => loc.waitFor({ timeout: ms }).catch(async () => { throw new Error(`${what}; лента: ${(await feed4()).slice(-600)}`); });

await check('без рук от запуска до доклада посредника: вступление «хватит» → переигровка → расчёт → командование → обстановка → варианты → «проводи ход» → «да» → посредник', async () => {
  const t0 = Date.now();
  // запуск: вступление (калибровки не было) — «хватит»
  const f0 = join(tmp, 'hands4-start.txt');
  writeFileSync(f0, ['{тишина}', 'штаб, хватит', ...QUIET].join('\n') + '\n');
  await startVoice(f0, 'off');
  await page4.goto(app + '/#editor');
  await step4('вступление не началось', page4.locator('.tour'), 60000);
  await page4.locator('.tour').waitFor({ state: 'detached', timeout: 60000 }).catch(async () => { throw new Error(`«хватит» не закончил вступление; лента: ${await feed4()}`); });
  await hands4(['штаб, покажи переигровку', 'штаб, рассчитай операцию']);
  await page4.waitForFunction(() => location.hash === '#replay', null, { timeout: 30000 });
  await step4('расчёт не начат', said4('Считаю: Берлинская операция'));
  await step4('расчёт не закончился', page4.locator('.take-btn'), 240000);
  await step4('о готовности расчёта не сказано', said4('Расчёт готов'));
  await hands4(['штаб, прими командование']);
  const dlg = page4.locator('.modal.take');
  await step4('окно «Принять командование» не открылось', dlg);
  await step4('окно не зачитано', said4('Принять командование с шестнадцатого апреля'));
  await hands4(['штаб, принимаю']);
  await dlg.waitFor({ state: 'detached', timeout: 40000 }).catch(() => { throw new Error('«принимаю» не начал игру'); });
  await step4('игра не началась', page4.locator('.cmd-date'), 120000);
  await hands4(['штаб, доложи обстановку']);
  await step4('доклада обстановки нет', said4('Цель — '));
  await hands4(['штаб, дай два варианта']);
  await step4(`варианты не готовы (запросов: ${LM4.plans})`, said4('Советник предложил два варианта'), 90000);
  await hands4(['штаб, выбираю первый']);
  await step4('вариант не принят', said4('Вариант «Удар на Зелов» принят'));
  await hands4(['штаб, проводи ход']);
  await step4('подтверждения хода нет', said4('Провожу ход: решение готово, приказов один'));
  await hands4(['штаб, да']);
  await step4('ход не начат', said4('Считаю ход'));
  await step4(`доклада посредника нет (штаб противника: ${LM4.enemy}, посредник: ${LM4.umpire})`, panel4.locator('.vp-item.umpire').first(), 240000);
  const ump = await page4.evaluate(() => window.__said.filter((m) => m.type === 'say' && m.role === 'umpire').map((m) => m.text));
  if (!ump.length) throw new Error('доклад посредника не голосом посредника (role umpire)');
  // разбор хода на карте — тур посредника; шаги может прервать перебивание (поддельный микрофон без подавления эха) —
  // разбор встаёт на паузу; «хватит» — разбор закончен, штаб подсказывает, что дальше
  await step4('разбора хода нет', page4.locator('.tour .tour-count', { hasText: /^Разбор хода · шаг 1 из \d/ }), 120000);
  await page4.waitForFunction(() => window.__said.some((m) => m.type === 'say' && m.role === 'umpire' && /^Ход прошёл без перелома/.test(m.text)), null, { timeout: 60000 })
    .catch(() => { throw new Error('первый шаг разбора не прозвучал голосом посредника'); });
  await hands4(['штаб, хватит']);
  await page4.locator('.tour').waitFor({ state: 'detached', timeout: 40000 }).catch(async () => { throw new Error(`«хватит» не закончил разбор; лента: ${(await feed4()).slice(-400)}`); });
  await said4('Решение на следующий ход').waitFor({ timeout: 150000 }).catch(async () => {
    const d = await page4.evaluate(() => ({ tour: document.querySelector('.tour-count')?.textContent, phase: document.querySelector('.tour')?.getAttribute('data-phase'),
      says: window.__said.filter((m) => m.type === 'say' || m.type === 'stop' || m.op).slice(-8).map((m) => `${m.type ?? m.op}:${m.role ?? ''}:${String(m.text ?? m.id ?? '').slice(0, 30)}`) }));
    throw new Error(`штаб не подсказал, что дальше: ${JSON.stringify(d)}; лента: ${(await feed4()).slice(-300)}`);
  });
  const ump4 = await page4.evaluate(() => window.__said.filter((m) => m.type === 'say' && m.role === 'umpire').map((m) => m.text));
  if (ump4[0] !== 'Сведения о ходе готовятся, прошу подождать.') throw new Error(`посредник не объявил, что сведения готовятся: ${ump4[0]}`);
  if (!ump4.some((x) => /^Ход прошёл без перелома\. Восьмая гвардейская армия ведёт бой у Зелова\./.test(x))) throw new Error(`разбор хода не с модели или цифрами: ${ump4.join(' | ')}`);
  // штаб противника — после посредника: его запрос к модели идёт, когда доклад готов (сначала — справка из базы)
  await until(() => LM4.log.lastIndexOf('enemy') > LM4.log.indexOf('umpire'), 60000, `после доклада штаб противника не спрошен: ${LM4.log.join(', ')}`);
  if (SHOTS) await page4.screenshot({ path: join(SHOTS, 'voice-handsfree-umpire.jpg'), type: 'jpeg', quality: 88 });
  const clicks = await page4.evaluate(() => window.__clicks);
  if (clicks) throw new Error(`щелчков: ${clicks}`);
  return `щелчков 0, ${Math.round((Date.now() - t0) / 1000)} с, запросы к модели: ${LM4.log.join(" → ")}`;
});

await check('в игре «Штаб, тур по командованию» — рамка на шапке игры, затем вкладка «Доклады» открыта туром; «хватит» — вкладка прежняя', async () => {
  const layer4 = page4.locator('.tour');
  const frame4 = frameIn(page4);
  const tabOn = () => page4.evaluate(() => document.querySelector('[data-tour^="cmd-tab-"].on')?.getAttribute('data-tour'));
  // до тура — не «Доклады» (тур откроет их сам и вернёт прежнюю)
  await hands4(['штаб, открой приказы']);
  await step4('вкладка «Приказы» не открылась', page4.locator('[data-tour="cmd-tab-orders"].on'));
  await hands4(['штаб, тур по командованию']);
  await step4('тура по командованию нет', layer4.locator('.tour-count', { hasText: 'Командование · шаг 1 из 11' }));
  await frame4('cmd-head');
  // шаг листается сам, когда штаб договорил; перебила поддельная «речь» (пауза) — «дальше»
  const reports = layer4.locator('.tour-cap h2', { hasText: 'Доклады' });
  if (!await reports.waitFor({ timeout: 20000 }).then(() => true, () => false)) await hands4(['штаб, дальше']);
  await step4('шаг «Доклады» не настал', reports);
  await step4('тур не открыл «Доклады»', page4.locator('[data-tour="cmd-tab-reports"].on'));
  await frame4('cmd-tab-reports');
  await page4.waitForTimeout(300);
  if (SHOTS) await page4.screenshot({ path: join(SHOTS, 'voice-tour-command.jpg'), type: 'jpeg', quality: 88 });
  const say = await layer4.locator('.tour-cap').innerText();
  if (!say.includes('Штаб, доложи о восьмой гвардейской')) throw new Error(`подпись: ${say}`);
  await hands4(['штаб, хватит']);
  await layer4.waitFor({ state: 'detached', timeout: 40000 }).catch(async () => { throw new Error(`«хватит» не закончил тур; лента: ${(await feed4()).slice(-600)}`); });
  await page4.waitForFunction(() => document.querySelector('[data-tour="cmd-tab-orders"].on'), null, { timeout: 5000 })
    .catch(async () => { throw new Error(`после тура открыта ${await tabOn()}, а не «Приказы»`); });
});
await ctx4.close();
}
part = null;

await check('в окне нет ошибок JavaScript', async () => {
  if (errors.length) throw new Error(errors.join('; '));
});

await browser.close();
cleanup();
console.log('все пункты ok');
process.exit(0);
