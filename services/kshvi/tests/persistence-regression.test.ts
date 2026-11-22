import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { dropSchema } from '@def-ops/db';
import { assertPersistenceConfig, createKshviPersistence } from '../src/persistence';

it('production и официальный режим без DATABASE_URL останавливаются до выбора memory store', () => {
  expect(() => assertPersistenceConfig({ NODE_ENV: 'production' })).toThrow('DATABASE_URL');
  expect(() => assertPersistenceConfig({ KSHVI_MODE: 'official' })).toThrow('DATABASE_URL');
  expect(() => assertPersistenceConfig({ NODE_ENV: 'development' })).not.toThrow();
  expect(() => assertPersistenceConfig({ NODE_ENV: 'production', DATABASE_URL: 'postgres://localhost/db' })).not.toThrow();
});

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;
integration('официальная инициализация применяет event store миграции на свежей схеме', async () => {
  const schema = `kshvi_boot_${randomUUID().replaceAll('-', '')}`;
  const persistence = await createKshviPersistence({
    NODE_ENV: 'production', DATABASE_URL: process.env.TEST_DATABASE_URL!, KSHVI_SCHEMA: schema,
  }, { environment: { load: async () => { throw new Error('Снимок в этой проверке не загружается'); } } });
  try {
    expect(persistence.eventStore).not.toBeNull();
    expect(persistence.evidence).toBeDefined();
    const tables = await persistence.pool!.query(
      `select table_name from information_schema.tables where table_schema=$1 and table_name in ('events','snapshots','commands','outbox_deliveries','exercise_readiness_confirmations','exercise_approved_maps') order by table_name`,
      [schema],
    );
    expect(tables.rows.map(row => row.table_name)).toEqual([
      'commands', 'events', 'exercise_approved_maps', 'exercise_readiness_confirmations', 'outbox_deliveries', 'snapshots',
    ]);
  } finally {
    if (persistence.pool) {
      await dropSchema(persistence.pool, schema);
      await persistence.pool.end();
    }
  }
});
