// Запуск всех сервисов локально (с перезапуском при изменениях). Редактор — отдельно: npm run dev.
import { spawn } from 'node:child_process';

const services = [
  { name: 'documents', dir: 'services/documents', env: { PORT: '8101', DATA_DIR: './data/documents' } },
  { name: 'render', dir: 'services/render', env: { PORT: '8102', DOCUMENTS_URL: 'http://localhost:8101' } },
  // реестр: с DATABASE_URL — PostgreSQL/PostGIS, иначе в памяти (данные теряются при перезапуске)
  { name: 'registry', dir: 'services/registry', env: { PORT: '8103', STORAGE: process.env.DATABASE_URL ? 'postgres' : 'memory' } },
  { name: 'gateway', dir: 'services/gateway', env: { PORT: '8080', DOCUMENTS_URL: 'http://localhost:8101', RENDER_URL: 'http://localhost:8102', REGISTRY_URL: 'http://localhost:8103', AUTH: process.env.AUTH ?? 'open', API_KEYS: process.env.API_KEYS ?? '' } },
];
const colors = [36, 35, 32, 33];
const procs = services.map((s, i) => {
  const p = spawn('npx', ['tsx', 'watch', `${s.dir}/src/main.ts`], { env: { ...process.env, ...s.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = `\x1b[${colors[i]}m[${s.name}]\x1b[0m `;
  const out = (d) => process.stdout.write(d.toString().split('\n').filter(Boolean).map((l) => tag + l).join('\n') + '\n');
  p.stdout.on('data', out); p.stderr.on('data', out);
  return p;
});
const stop = () => { procs.forEach((p) => p.kill('SIGTERM')); process.exit(0); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
