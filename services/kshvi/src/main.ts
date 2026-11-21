import { createService, env, onShutdown } from '@def-ops/service-kit';
import { createPool } from '@def-ops/db';
import { buildRouter } from './app';
import { InMemorySessionStore, SessionManager } from './auth/sessions';
import { PgSessionStore } from './auth/pg-session-store';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : null;
const store = pool ? new PgSessionStore(pool, env('KSHVI_SCHEMA', 'kshvi')) : new InMemorySessionStore();
if (store instanceof PgSessionStore) await store.init();
const sessions = new SessionManager({ store });
const service = createService({
  name: 'kshvi',
  version: '0.1.0',
  port: Number(env('PORT', '8105')),
  router: buildRouter({ sessions }),
  ready: async () => pool ? (await pool.query('select 1')).rowCount === 1 : true,
});
await service.listen();
onShutdown(async () => { await service.close(); if (pool) await pool.end(); });
