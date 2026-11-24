import { expect, it } from 'vitest';
import { SnapshotLifecycle } from '../src/store/snapshot-store';
import { withKshviDatabase } from './helpers/database';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

it('выполняет все контрольные снимки и миграции на копии до снимка', async () => {
  const calls: string[] = [];
  const lifecycle = new SnapshotLifecycle({
    every: 2,
    save: async reason => { calls.push(reason); },
    migrateOnCopy: async () => { calls.push('MIGRATE_COPY'); },
  });
  await lifecycle.start();
  await lifecycle.beforeJump();
  await lifecycle.afterJump();
  await lifecycle.afterEvents(1);
  await lifecycle.afterEvents(1);
  await lifecycle.beforeCompletion();
  await lifecycle.beforeBackup();
  await lifecycle.beforeCopy();
  expect(calls).toEqual(['START', 'BEFORE_JUMP', 'AFTER_JUMP', 'SCHEDULED', 'BEFORE_COMPLETION', 'BEFORE_BACKUP', 'MIGRATE_COPY', 'BEFORE_COPY']);
});

integration('проводит jobs по разрешённым transitions и обрабатывает результат', async () => {
  await withKshviDatabase(async store => {
    const queued = await store.submitJob({ organizationId: 'org1', kind: 'ARCHIVE', key: 'job-1', payload: { value: 2 } });
    expect((await store.transitionJob({ organizationId: 'org1', id: queued.id, to: 'running' })).status).toBe('running');
    const completed = await store.transitionJob({ organizationId: 'org1', id: queued.id, to: 'succeeded', progress: 100, result: { url: 'local-result' } });
    expect(completed).toMatchObject({ status: 'succeeded', progress: 100, result: { url: 'local-result' } });
    await expect(store.transitionJob({ organizationId: 'org1', id: queued.id, to: 'running' })).rejects.toThrow('переход');
    await expect(store.transitionJob({ organizationId: 'org2', id: queued.id, to: 'cancelled' })).rejects.toThrow('не найдено');

    await store.submitJob({ organizationId: 'org1', kind: 'ARCHIVE', key: 'job-2', payload: { value: 3 } });
    const processed = await store.runNextJob({ organizationId: 'org1', kind: 'ARCHIVE', handler: async job => ({ doubled: (job.payload as { value: number }).value * 2 }) });
    expect(processed).toMatchObject({ status: 'succeeded', progress: 100, result: { doubled: 6 } });

    await store.submitJob({ organizationId: 'org1', kind: 'ARCHIVE', key: 'job-3', payload: {} });
    const failed = await store.runNextJob({ organizationId: 'org1', kind: 'ARCHIVE', handler: async () => { throw new Error('ожидаемый сбой'); } });
    expect(failed).toMatchObject({ status: 'failed', error: 'ожидаемый сбой' });
    if (!failed) throw new Error('Задание со сбоем не найдено');
    expect((await store.transitionJob({ organizationId: 'org1', id: failed.id, to: 'queued' })).status).toBe('queued');
  });
});


integration('применяет миграции event store на изолированной схеме-копии', async () => {
  await withKshviDatabase(async store => {
    const targetSchema = `${store.schema}_copy`;
    const copy = await store.migrateCopy(targetSchema);
    try {
      expect(copy.schema).toBe(targetSchema);
      const columns = await copy.pool.query(
        `select column_name from information_schema.columns where table_schema=$1 and table_name='events' and column_name in ('organization_id','schema_version','wall_clock_at','operational_at','actor','cause_ids','versions','reducer_version','hash_version')`,
        [targetSchema],
      );
      expect(columns.rows).toHaveLength(9);
      const deliveries = await copy.pool.query(`select count(*)::int as count from ${targetSchema}.outbox_deliveries`);
      expect(deliveries.rows[0].count).toBe(0);
    } finally {
      await copy.pool.query(`drop schema if exists ${targetSchema} cascade`);
    }
  });
});
