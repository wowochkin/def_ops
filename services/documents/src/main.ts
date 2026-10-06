import { createService, env, onShutdown } from '@def-ops/service-kit';
import { createPool, waitForDb } from '@def-ops/db';
import { FileStore, MemoryStore, type DocumentStore } from './store';
import { PgStore } from './pg-store';
import { EventBus } from './events';
import { buildRouter } from './app';

// STORAGE: postgres (DATABASE_URL) | file (DATA_DIR) | memory
async function openStore(kind: string): Promise<DocumentStore> {
  if (kind === 'memory') return new MemoryStore();
  if (kind === 'postgres') {
    const pool = createPool();
    await waitForDb(pool);
    const pg = new PgStore(pool, env('DB_SCHEMA', 'documents'));
    await pg.init();
    onShutdown(() => pool.end());
    return pg;
  }
  return new FileStore(env('DATA_DIR', './data/documents'));
}

const store = await openStore(env('STORAGE', process.env.DATABASE_URL ? 'postgres' : 'file'));
const svc = createService({
  name: 'documents',
  version: '0.2.0',
  port: Number(env('PORT', '8101')),
  router: buildRouter(store, new EventBus()),
  ready: () => store.ready(),
});
await svc.listen();
onShutdown(svc.close);
