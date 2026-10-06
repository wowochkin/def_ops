import { createService, env, log, onShutdown } from '@def-ops/service-kit';
import { MemoryRepo, type RegistryRepo } from './repo';
import { PgRepo } from './pg-repo';
import { EventBus } from './events';
import { buildRouter } from './app';

// STORAGE=postgres (по умолчанию) — PostgreSQL/PostGIS по DATABASE_URL; STORAGE=memory — в памяти, без СУБД
const storage = env('STORAGE', 'postgres');
let repo: RegistryRepo;
if (storage === 'memory') repo = new MemoryRepo();
else {
  repo = await new PgRepo({ schema: env('REGISTRY_SCHEMA', 'registry') }).init();
  log('registry', { level: 'info', msg: 'миграции схемы реестра применены' });
}

const svc = createService({
  name: 'registry',
  version: '0.2.0',
  port: Number(env('PORT', '8103')),
  router: buildRouter(repo, new EventBus()),
  bodyLimit: 5 * 1024 * 1024,
  ready: () => repo.ready(),
});
await svc.listen();
onShutdown(async () => { await svc.close(); await repo.close(); });
