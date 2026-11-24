import { createPool, dropSchema, type Pool } from '@def-ops/db';
import { randomUUID } from 'node:crypto';
import { KshviEventStore } from '../../src/store/event-store';

export async function withKshviDatabase(run: (store: KshviEventStore) => Promise<void>): Promise<void> {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Для интеграционного теста нужен TEST_DATABASE_URL');
  const pool: Pool = createPool(url, 2);
  const schema = `kshvi_test_${randomUUID().replaceAll('-', '')}`;
  const store = new KshviEventStore({ pool, schema });
  try {
    await store.init();
    await run(store);
  } finally {
    await dropSchema(pool, schema);
    await pool.end();
  }
}

export const command = (idempotencyKey = 'cmd-1') => ({
  organizationId: 'org1',
  instanceId: 'i1',
  branchId: 'b1',
  aggregateRevision: 0,
  idempotencyKey,
  type: 'resource.consumed.v1',
  payload: { resourceId: 'fuel', amount: 2 },
});
