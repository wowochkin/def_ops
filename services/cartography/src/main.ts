import { createService, env, log, onShutdown } from '@def-ops/service-kit';
import { MemoryRepo, type MapRepo } from './repo';
import { PgRepo } from './pg-repo';
import { EventBus } from './events';
import { JobRunner } from './jobs';
import { TileStore } from './tiles';
import { buildRouter } from './app';
import { USER_AGENT } from './xyz';

// STORAGE=postgres (по умолчанию при DATABASE_URL) — описания карт в PostgreSQL/PostGIS; memory — в памяти.
// Тайлы в любом случае — на диске, в TILES_DIR.
const storage = env('STORAGE', process.env.DATABASE_URL ? 'postgres' : 'memory');
let repo: MapRepo;
if (storage === 'memory') repo = new MemoryRepo();
else {
  repo = await new PgRepo({ schema: env('CARTOGRAPHY_SCHEMA', 'cartography') }).init();
  log('cartography', { level: 'info', msg: 'миграции схемы картографии применены' });
}
const interrupted = await repo.failInterrupted('Прервано перезапуском сервиса; запустите заново (загруженные тайлы будут пропущены)');
if (interrupted) log('cartography', { level: 'warn', msg: `незавершённых заданий: ${interrupted}` });

const MB = 1024 * 1024;
const bus = new EventBus();
const jobs = new JobRunner(repo, bus, { log: (e) => log('cartography', { level: 'error', error: String((e as Error)?.stack || e) }) });
const store = new TileStore(env('TILES_DIR', './data/tiles'));

const svc = createService({
  name: 'cartography',
  version: '0.2.0',
  port: Number(env('PORT', '8104')),
  router: buildRouter({
    repo, store, bus, jobs,
    options: {
      maxTilesPerJob: Number(env('MAX_TILES_PER_JOB', '50000')),
      maxUploadBytes: Number(env('MAX_UPLOAD_MB', '200')) * MB,
      maxPackageBytes: Number(env('MAX_PACKAGE_MB', '20480')) * MB,
      rasterMemoryBytes: Number(env('RASTER_MEMORY_MB', '256')) * MB,
      allowedHosts: env('XYZ_ALLOWED_HOSTS', '').split(',').map((s) => s.trim()).filter(Boolean),
      xyz: { userAgent: env('XYZ_USER_AGENT', USER_AGENT), concurrency: Number(env('XYZ_CONCURRENCY', '3')) },
    },
  }),
  bodyLimit: 5 * MB,
  ready: () => repo.ready(),
});
await svc.listen();
onShutdown(async () => { await jobs.stop(); await svc.close(); await repo.close(); });
