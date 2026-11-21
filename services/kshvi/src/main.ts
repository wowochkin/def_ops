import { createService, env, onShutdown } from '@def-ops/service-kit';
import { createPool } from '@def-ops/db';
import { buildRouter } from './app';
import { InMemorySessionStore, SessionManager } from './auth/sessions';
import { PgSessionStore } from './auth/pg-session-store';
import { InMemoryExerciseStore, PgExerciseStore } from './store/exercise-store';
import { CartographyEnvironmentProvider } from './environment/cartography-provider';
import { EnvironmentSnapshotStore } from './environment/snapshot-store';

const databaseUrl = process.env.DATABASE_URL;
const pool = databaseUrl ? createPool(databaseUrl) : null;
const store = pool ? new PgSessionStore(pool, env('KSHVI_SCHEMA', 'kshvi')) : new InMemorySessionStore();
if (store instanceof PgSessionStore) await store.init();
const exerciseStore = pool ? new PgExerciseStore({ pool, schema: env('KSHVI_SCHEMA', 'kshvi') }) : new InMemoryExerciseStore();
if (exerciseStore instanceof PgExerciseStore) await exerciseStore.init();
const environmentProvider = new CartographyEnvironmentProvider({
  baseUrl: env('CARTOGRAPHY_URL', 'http://localhost:8104'),
  store: new EnvironmentSnapshotStore(env('KSHVI_ENVIRONMENT_DIR', './data/kshvi/environment')),
});
const sessions = new SessionManager({ store });
const service = createService({
  name: 'kshvi',
  version: '0.1.0',
  port: Number(env('PORT', '8105')),
  router: buildRouter({ sessions, exerciseStore, environmentProvider }),
  ready: async () => pool ? (await pool.query('select 1')).rowCount === 1 : true,
});
await service.listen();
onShutdown(async () => { await service.close(); if (pool) await pool.end(); });
