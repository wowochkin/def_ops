import { createPool, type Pool } from '@def-ops/db';
import { InMemorySessionStore, type SessionStore } from './auth/sessions';
import { PgSessionStore } from './auth/pg-session-store';
import { InMemoryExerciseStore, PgExerciseStore, type ExerciseStore } from './store/exercise-store';
import { openFileExerciseStore } from './store/file-exercise-store';
import { KshviEventStore } from './store/event-store';
import {
  InMemoryExerciseEvidenceService, PgExerciseEvidenceService,
  type ExerciseEnvironmentLoader, type ExerciseEvidenceService,
} from './store/exercise-evidence-service';

export type PersistenceEnvironment = Record<string, string | undefined>;

export function assertPersistenceConfig(env: PersistenceEnvironment): void {
  const official = env.NODE_ENV === 'production' || env.KSHVI_MODE === 'official' || env.KSHVI_OFFICIAL === '1';
  if (official && !env.DATABASE_URL?.trim()) {
    throw new Error('Для production/официального режима КШВИ обязателен DATABASE_URL; неперсистентные хранилища запрещены');
  }
}

export async function createKshviPersistence(env: PersistenceEnvironment, options: { environment?: ExerciseEnvironmentLoader } = {}): Promise<{
  pool: Pool | null;
  sessionStore: SessionStore;
  exerciseStore: ExerciseStore;
  evidence: ExerciseEvidenceService;
  eventStore: KshviEventStore | null;
  schema: string;
}> {
  assertPersistenceConfig(env);
  const schema = env.KSHVI_SCHEMA ?? 'kshvi';
  const pool = env.DATABASE_URL ? createPool(env.DATABASE_URL) : null;
  const environment = options.environment ?? { load: async () => { throw new Error('Не настроено серверное хранилище снимков среды'); } };
  try {
    const eventStore = pool ? new KshviEventStore({ pool, schema }) : null;
    if (eventStore) await eventStore.init();
    const sessionStore = pool ? new PgSessionStore(pool, schema) : new InMemorySessionStore();
    if (sessionStore instanceof PgSessionStore) await sessionStore.init();
    const evidence = pool ? new PgExerciseEvidenceService({ pool, schema, environment }) : new InMemoryExerciseEvidenceService({ environment });
    if (evidence instanceof PgExerciseEvidenceService) await evidence.init();
    const exerciseStore = pool ? new PgExerciseStore({ pool, schema, evidence, environment })
      : env.KSHVI_LIBRARY_FILE ? openFileExerciseStore({ file: env.KSHVI_LIBRARY_FILE, evidence, environment })
        : new InMemoryExerciseStore({ evidence, environment });
    if (exerciseStore instanceof PgExerciseStore) await exerciseStore.init();
    return { pool, sessionStore, exerciseStore, evidence, eventStore, schema };
  } catch (error) {
    if (pool) await pool.end();
    throw error;
  }
}
