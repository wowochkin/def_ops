import { createPool } from '@def-ops/db';
import { PostgresArchiveJobManager } from '../../src/archive/postgres-jobs.ts';

const owner = { organizationId: 'org-1', userId: 'owner-1', authorities: ['archive.jobs.create', 'archive.jobs.read', 'archive.jobs.cancel'] };
const pool = createPool(process.env.TEST_DATABASE_URL, 2);
const manager = new PostgresArchiveJobManager({
  pool,
  schema: process.env.JOB_SCHEMA,
  managerId: 'crash-driver',
  limits: { maxConcurrent: 1, maxQueue: 2, maxPayloadBytes: 10000, maxDurationMs: 10000, maxMemoryMb: 128, recoveryAfterMs: 200 },
});
await manager.init();
const job = await manager.submit({
  idempotencyKey: 'crash-effect',
  kind: 'EXPORT',
  payload: { value: 'crash-result' },
  owner,
  task: { module: process.env.JOB_TASK_MODULE, exportName: 'idempotentEffect' },
});
console.log(`JOB_ID=${job.id}`);
await manager.start();
setInterval(() => undefined, 1000);
