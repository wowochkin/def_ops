// Сервисы платформы внутри настольного приложения: документы, рендер, реестр, картография и шлюз — фоновыми
// процессами на свободных портах (шлюз — на постоянном), данные — в папке пользователя (без СУБД и Docker), редактор и API — с одного адреса
// шлюза. Когда шлюз готов, в stdout — строка «DEFOPS_READY <адрес>»; приложение открывает этот адрес в окне.
//   node launch.mjs --data <папка данных> [--static <собранный редактор>] [--dev] [--port N] [--llm http://localhost:1234/v1] [--voice-dir <папка голосового сервиса>] [--watch-stdin]
// Голосовой сервис (Python, services/voice) запускается необязательным, после остальных; состояние — <данные>/voice/state.json.
// --dev — сервисы из исходников (npx tsx), иначе — собранные файлы рядом (server/dist/<сервис>.mjs).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { voicePython } from './voice-platform.mjs';
import { startVoice } from './voice.mjs';
import { prepareVoiceDirectory } from './voice-files.mjs';
import { installLibrary, verifyRuntime } from './portable-library.mjs';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dev = args.includes('--dev');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const data = resolve(opt('data', join(repo, 'data/desktop')));
mkdirSync(data, { recursive: true });
// Сохраняем stderr и этапы даже при запуске GUI без терминала.
const startupLog = join(data, 'startup.log');
const stderrWrite = process.stderr.write.bind(process.stderr);
process.stderr.write = (chunk, encoding, callback) => {
  try { appendFileSync(startupLog, chunk); } catch { /* stderr остаётся доступным */ }
  return stderrWrite(chunk, encoding, callback);
};
const stage = text => process.stderr.write(`[запуск ${new Date().toISOString()}] ${text}\n`);
process.on('uncaughtExceptionMonitor', error => {
  stage(error.stack || error.message);
  process.stdout.write(`DEFOPS_ERROR ${error.message} — журнал: ${startupLog}\n`);
});
stage('начало запуска');


const freePort = () => new Promise((r, j) => { const s = createServer(); s.unref(); s.on('error', j); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
/** Ошибка запуска: строкой «DEFOPS_ERROR <текст>» — приложение покажет её в окне, — и в журнал; выход. */
const fail = (text) => { process.stdout.write(`DEFOPS_ERROR ${text}\n`); process.stderr.write(`[запуск] ${text}\n`); process.exit(1); };
const portable = resolve(opt('portable', process.env.DEFOPS_PORTABLE_DIR || join(here, '../portable')));
if (existsSync(join(portable, 'library/manifest.json'))) {
  try { stage('проверка и перенос библиотеки'); await installLibrary(join(portable, 'library'), data); stage('библиотека готова'); }
  catch (e) { fail(`Не удалось проверить и перенести библиотеку: ${e.message}`); }
}
if (existsSync(join(portable, 'runtime/manifest.json'))) {
  try { stage('проверка голосового runtime'); await verifyRuntime(join(portable, 'runtime'), data); stage('runtime проверен'); }
  catch (e) { fail(`Не удалось проверить голосовой runtime: ${e.message}`); }
  process.env.DEFOPS_VOICE_RUNTIME = join(portable, 'runtime');
}
const portBusy = (port) => new Promise((r) => { const s = createServer(); s.once('error', () => r(true)); s.listen(port, '127.0.0.1', () => s.close(() => r(false))); });
// заданный порт шлюза (в разработке — 8080, туда vite проводит /api) занят — обычно сервисами прошлого запуска
if (Number(opt('port', 0)) && await portBusy(Number(opt('port', 0)))) {
  fail(`порт ${opt('port')} занят — закройте предыдущий экземпляр приложения и запустите снова`);
}

// Порт шлюза постоянный (записан в папке данных): хранилище окна (IndexedDB, localStorage) привязано к адресу с
// портом, и на новом порту окно не увидело бы базу знаний, переигровки и настройки прошлых запусков.
// Занят чужой программой — остановка с объяснением, а не пустой профиль на другом origin.
async function gatewayPort() {
  const file = join(data, 'gateway-port');
  let saved = 0;
  try { saved = Number(readFileSync(file, 'utf8').trim()) || 0; } catch { /* первый запуск */ }
  if (saved && !(await portBusy(saved))) return saved;
  if (saved) fail(`порт приложения ${saved} занят. Закройте предыдущий экземпляр или освободите этот порт: адрес базы знаний сохранён и не будет изменён`);
  for (const p of [47615, 47625, 47635]) if (!(await portBusy(p))) { writeFileSync(file, String(p)); return p; }
  const p = await freePort(); writeFileSync(file, String(p)); return p;
}
const ports = { documents: await freePort(), render: await freePort(), registry: await freePort(), cartography: await freePort(), gateway: Number(opt('port', 0)) || await gatewayPort() };
const url = (n) => `http://127.0.0.1:${ports[n]}`;
async function llmUrl() {
  const given = opt('llm', process.env.DEFOPS_LLM_URL || '');
  if (given) return given;
  for (const port of [1235, 1234]) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/v1/models`, { signal: AbortSignal.timeout(800) });
      if (r.ok) return `http://127.0.0.1:${port}/v1`;
    } catch { /* следующий порт */ }
  }
  return 'http://127.0.0.1:1234/v1';
}
const llm = await llmUrl();
const services = [
  { name: 'documents', env: { STORAGE: 'file', DATA_DIR: join(data, 'documents') } },
  { name: 'render', env: { DOCUMENTS_URL: url('documents') } },
  { name: 'registry', env: { STORAGE: 'file', DATA_DIR: data } },
  // сборка театров требует Python с GDAL — в приложении выключена
  // нарезка карты OpenHistoricalMap всего театра держит в памяти объекты района (≈ 1 ГБ на пике):
  // куча — с запасом, иначе предел V8 по умолчанию на машинах с 8 ГБ
  { name: 'cartography', env: { STORAGE: 'file', DATA_DIR: data, TILES_DIR: join(data, 'tiles'), THEATRE_BUILD: 'off',
    GIS_PYTHON: process.env.GIS_PYTHON || (process.env.DEFOPS_VOICE_RUNTIME ? voicePython('', process.platform, process.env.DEFOPS_VOICE_RUNTIME) : ''),
    GIS_ADDONS: process.env.GIS_ADDONS || (existsSync(join(here, 'gis/addons/defops-gis-runtime.json')) ? join(here, 'gis/addons') : ''),
    NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=3072`.trim() } },
  { name: 'gateway', env: {
    DOCUMENTS_URL: url('documents'), RENDER_URL: url('render'), REGISTRY_URL: url('registry'), CARTOGRAPHY_URL: url('cartography'),
    VOICE_STATE: join(data, 'voice', 'state.json'),
    PORTABLE_DATA: data, PORTABLE_ASSETS: portable,
    // файлы игры (журнал, разбор, запись) — в «Загрузки» без окна выбора: окно приложения шлёт их шлюзу
    DOWNLOADS_DIR: process.env.DEFOPS_DOWNLOADS_DIR || join(homedir(), 'Downloads'),
    // разработка: окно — vite (:5173), /api оно проводит на шлюз — ему тоже можно сохранять
    ...(dev ? { DEFOPS_DEV: '1' } : {}),
    // шлюз открыт на постоянном порту: принимает только запросы своего окна (Host и Origin)
    DEFOPS_DESKTOP: '1',
    AUTH: 'open', LLM_URL: llm,
    ...(opt('static') ? { STATIC_DIR: resolve(opt('static')) } : {}),
  } },
];
const procs = services.map((s) => {
  const env = { ...process.env, ...s.env, PORT: String(ports[s.name]), HOST: '127.0.0.1' };
  const p = dev
    ? spawn(process.execPath, ['--import', 'tsx', `services/${s.name}/src/main.ts`], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.execPath, [join(here, 'dist', `${s.name}.mjs`)], { cwd: here, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${s.name}] `;
  const out = (d) => process.stderr.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n');
  p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
  p.stdout.on('data', out); p.stderr.on('data', out);
  p.on('error', (e) => { if (!stopping) { process.stdout.write(`DEFOPS_ERROR сервис «${s.name}» не запускается: ${e.message}\n`); stop(1); } });
  p.on('exit', (code) => { if (!stopping) { process.stderr.write(`${tag}остановился (код ${code}) — останавливаю приложение\n`); if (!ready) process.stdout.write(`DEFOPS_ERROR сервис «${s.name}» остановился при запуске (код ${code}) — подробности в терминале\n`); stop(1); } });
  return p;
});
let stopping = false, ready = false;
// Голос (Python) — после остальных сервисов и необязателен: нет окружения или сервис упал — приложение работает без него;
// запуск не ждём, готовность шлюза от него не зависит. Папка сервиса: --voice-dir, DEFOPS_VOICE_DIR, иначе services/voice.
let voice = null;
Promise.resolve().then(() => {
  stage('подготовка исходников голоса');
  const voiceDir = prepareVoiceDirectory({ explicit: opt('voice-dir', process.env.DEFOPS_VOICE_DIR), repo, data, bundled: join(here, 'voice-service') });
  stage('исходники голоса готовы');
  return startVoice({ repo, data, voiceDir: resolve(voiceDir), log: s => process.stderr.write(s + '\n'), isStopping: () => stopping });
}).then(v => { voice = v; if (stopping) v.stop(); }).catch(e => {
  stage(`голос не запущен: ${e.stack || e.message}`);
  try { mkdirSync(join(data, 'voice'), { recursive: true }); writeFileSync(join(data, 'voice/state.json'), JSON.stringify({ state: 'error', error: e.message })); } catch { }
});
function stop(code = 0) { if (stopping) return; stopping = true; procs.forEach((p) => p.kill('SIGTERM')); voice?.stop(); setTimeout(() => process.exit(code), 500); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
// --watch-stdin: приложение держит вход открытым; закрылось приложение — закрылся вход — сервисы не переживают окно
if (args.includes('--watch-stdin')) { process.stdin.on('end', () => stop()); process.stdin.resume(); }

// ждём готовности шлюза и сервисов
const base = url('gateway');
let last = 'шлюз не отвечает';
const readyDeadline = Date.now() + 120_000;
for (let i = 0; i < 480 && !stopping && Date.now() < readyDeadline; i++) {
  try {
    const r = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (r.ok) { ready = true; stage('сервисы готовы'); process.stdout.write(`DEFOPS_READY ${base}\n`); break; }
    last = `шлюз отвечает ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch { /* ещё запускается */ }
  await new Promise((r) => setTimeout(r, 250));
}
// не дождались — не молчать: окно иначе остаётся на «Запуск сервисов…»
if (!ready && !stopping) { process.stdout.write(`DEFOPS_ERROR сервисы не ответили за 2 минуты (${last}) — подробности в терминале\n`); stop(1); }
