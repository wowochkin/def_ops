// Сервисы платформы внутри настольного приложения: документы, рендер, реестр, картография и шлюз — фоновыми
// процессами на свободных портах, данные — в папке пользователя (без СУБД и Docker), редактор и API — с одного адреса
// шлюза. Когда шлюз готов, в stdout — строка «DEFOPS_READY <адрес>»; приложение открывает этот адрес в окне.
//   node launch.mjs --data <папка данных> [--static <собранный редактор>] [--dev] [--port N] [--llm http://localhost:1234/v1] [--watch-stdin]
// --dev — сервисы из исходников (npx tsx), иначе — собранные файлы рядом (server/dist/<сервис>.mjs).
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : d; };
const dev = args.includes('--dev');
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');
const data = resolve(opt('data', join(repo, 'data/desktop')));
mkdirSync(data, { recursive: true });

const freePort = () => new Promise((r, j) => { const s = createServer(); s.unref(); s.on('error', j); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
/** Ошибка запуска: строкой «DEFOPS_ERROR <текст>» — приложение покажет её в окне, — и в журнал; выход. */
const fail = (text) => { process.stdout.write(`DEFOPS_ERROR ${text}\n`); process.stderr.write(`[запуск] ${text}\n`); process.exit(1); };
const portBusy = (port) => new Promise((r) => { const s = createServer(); s.once('error', () => r(true)); s.listen(port, '127.0.0.1', () => s.close(() => r(false))); });
// заданный порт шлюза (в разработке — 8080, туда vite проводит /api) занят — обычно сервисами прошлого запуска
if (Number(opt('port', 0)) && await portBusy(Number(opt('port', 0)))) {
  fail(`порт ${opt('port')} занят — скорее всего, сервисы прошлого запуска не остановились. Остановите их: lsof -ti tcp:${opt('port')} | xargs kill — и запустите приложение снова`);
}

const ports = { documents: await freePort(), render: await freePort(), registry: await freePort(), cartography: await freePort(), gateway: Number(opt('port', 0)) || await freePort() };
const url = (n) => `http://127.0.0.1:${ports[n]}`;
const services = [
  { name: 'documents', env: { STORAGE: 'file', DATA_DIR: join(data, 'documents') } },
  { name: 'render', env: { DOCUMENTS_URL: url('documents') } },
  { name: 'registry', env: { STORAGE: 'file', DATA_DIR: data } },
  // сборка театров требует Python с GDAL — в приложении выключена
  { name: 'cartography', env: { STORAGE: 'file', DATA_DIR: data, TILES_DIR: join(data, 'tiles'), THEATRE_BUILD: 'off' } },
  { name: 'gateway', env: {
    DOCUMENTS_URL: url('documents'), RENDER_URL: url('render'), REGISTRY_URL: url('registry'), CARTOGRAPHY_URL: url('cartography'),
    AUTH: 'open', LLM_URL: opt('llm', process.env.DEFOPS_LLM_URL || 'http://localhost:1234/v1'),
    ...(opt('static') ? { STATIC_DIR: resolve(opt('static')) } : {}),
  } },
];
const procs = services.map((s) => {
  const env = { ...process.env, ...s.env, PORT: String(ports[s.name]), HOST: '127.0.0.1' };
  const p = dev
    ? spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', `services/${s.name}/src/main.ts`], { cwd: repo, env, stdio: ['ignore', 'pipe', 'pipe'] })
    : spawn(process.execPath, [join(here, 'dist', `${s.name}.mjs`)], { cwd: here, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `[${s.name}] `;
  const out = (d) => process.stderr.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n');
  p.stdout.on('data', out); p.stderr.on('data', out);
  p.on('exit', (code) => { if (!stopping) { process.stderr.write(`${tag}остановился (код ${code}) — останавливаю приложение\n`); if (!ready) process.stdout.write(`DEFOPS_ERROR сервис «${s.name}» остановился при запуске (код ${code}) — подробности в терминале\n`); stop(1); } });
  return p;
});
let stopping = false, ready = false;
function stop(code = 0) { if (stopping) return; stopping = true; procs.forEach((p) => p.kill('SIGTERM')); setTimeout(() => process.exit(code), 500); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
// --watch-stdin: приложение держит вход открытым; закрылось приложение — закрылся вход — сервисы не переживают окно
if (args.includes('--watch-stdin')) { process.stdin.on('end', () => stop()); process.stdin.resume(); }

// ждём готовности шлюза и сервисов
const base = url('gateway');
let last = 'шлюз не отвечает';
for (let i = 0; i < 480 && !stopping; i++) {
  try {
    const r = await fetch(`${base}/api/health`);
    if (r.ok) { ready = true; process.stdout.write(`DEFOPS_READY ${base}\n`); break; }
    last = `шлюз отвечает ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch { /* ещё запускается */ }
  await new Promise((r) => setTimeout(r, 250));
}
// не дождались — не молчать: окно иначе остаётся на «Запуск сервисов…»
if (!ready && !stopping) { process.stdout.write(`DEFOPS_ERROR сервисы не ответили за 2 минуты (${last}) — подробности в терминале\n`); stop(1); }
