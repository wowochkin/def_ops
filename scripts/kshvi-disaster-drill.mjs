import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createPool, dropSchema } from '@def-ops/db';
import { emptyWorld, reduceWorld } from '@def-ops/kshvi';
import { KshviEventStore } from '../services/kshvi/src/store/event-store.ts';
import { appendCommittedCommand } from '../services/kshvi/src/admin/recovery-coordinator.ts';
import { BackupService } from '../services/kshvi/src/admin/backup-service.ts';
import { RestoreService, planRestore } from '../services/kshvi/src/admin/restore-service.ts';
import { WorkerRecoveryService } from '../services/kshvi/src/admin/worker-recovery.ts';
import { assertRecoveryObjectives } from '../services/kshvi/src/admin/restore-verification.ts';

const outputIndex = process.argv.indexOf('--output');
const output = outputIndex >= 0 ? process.argv[outputIndex + 1] : undefined;
const url = process.env.TEST_DATABASE_URL;
if (!url) throw new Error('Для локальной репетиции требуется TEST_DATABASE_URL');
const schema = `kshvi_drill_${randomUUID().replaceAll('-', '')}`;
const root = await mkdtemp(join(tmpdir(), 'kshvi-disaster-drill-'));
let firstPool;
let secondPool;
try {
  firstPool = createPool(url, 2);
  const store = new KshviEventStore({ pool: firstPool, schema });
  await store.init();
  const command = {
    organizationId: 'org1', instanceId: 'i1', branchId: 'b1', aggregateRevision: 0,
    idempotencyKey: 'drill-command-1', type: 'resource.consumed.v1', payload: { resourceId: 'fuel', amount: 2 },
  };
  await appendCommittedCommand(store, command, { afterCommit: () => { throw new Error('Ответ потерян после фиксации'); } }).catch(error => {
    if (!String(error.message).includes('после фиксации')) throw error;
  });
  const repeated = await appendCommittedCommand(store, command);
  if (!(await store.eventCount('i1')) || !repeated.idempotent) throw new Error('Идемпотентный повтор не подтверждён');
  const world = reduceWorld(emptyWorld('scenario-1'), { eventId: repeated.eventId, type: command.type, payload: command.payload, causeIds: [] }, { reducerVersion: 1 });
  await store.saveSnapshot({ organizationId: 'org1', instanceId: 'i1', branchId: 'b1', sequence: 1, state: world, environment: { id: 'env-1', revision: 1, sha256: 'a'.repeat(64) }, reducerVersion: 1 });
  const workerFile = join(root, 'workers.jsonl');
  const effects = [];
  const workers = new WorkerRecoveryService({ stateFile: workerFile });
  await workers.resume('outbox', repeated.sequence, async () => { effects.push(`outbox:${repeated.sequence}`); });
  await firstPool.end();
  firstPool = undefined;

  const restartStarted = performance.now();
  secondPool = createPool(url, 2);
  const restarted = new KshviEventStore({ pool: secondPool, schema });
  const recovered = await restarted.restoreWorld('i1', 'b1');
  if (recovered.sequence !== repeated.sequence) throw new Error('Последнее подтверждённое событие потеряно');
  const restartedWorkers = new WorkerRecoveryService({ stateFile: workerFile });
  const duplicate = await restartedWorkers.resume('outbox', repeated.sequence, async () => { effects.push('duplicate'); });
  if (duplicate || effects.length !== 1) throw new Error('Worker повторил эффект после перезапуска');
  const restartMs = performance.now() - restartStarted;

  const values = { 'scenario.json': 'scenario', 'environment.json': 'environment', 'assignments.json': 'assignments', 'journal.jsonl': 'journal', 'snapshot.json': 'snapshot' };
  await Promise.all(Object.entries(values).map(([name, value]) => writeFile(join(root, name), value)));
  const sources = Object.keys(values).map(name => ({ name, path: join(root, name), category: name.split('.')[0].toUpperCase() }));
  const backups = new BackupService({ rootDirectory: join(root, 'backups') });
  const full = await backups.createFullBackup({ instanceId: 'i1', sources, lastSequence: repeated.sequence, versions: { schema: '1.0.0', reducer: 1 } });
  if (!(await backups.verifyBackup(full.id)).valid) throw new Error('Хеши копии не прошли проверку');
  const restoreStarted = performance.now();
  const restored = await new RestoreService({ backups, isolationRoot: join(root, 'isolated') }).restoreToIsolated({ backupId: full.id, activeLastSequence: repeated.sequence, isolationId: 'drill' });
  const nodeRestoreMs = performance.now() - restoreStarted;
  if (!restored.allowed) throw new Error('Изолированное восстановление запрещено');
  const objectives = assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs, nodeRestoreMs });
  const report = {
    schemaVersion: 1,
    status: 'passed',
    scope: 'LOCAL_FUNCTIONAL_DRILL_NOT_PHYSICAL_NODE_LOSS',
    measuredAt: new Date().toISOString(),
    confirmedEvents: 1,
    duplicateEventsAfterRetry: 0,
    confirmedEventsLost: 0,
    rpo: objectives.rpo,
    restartMs,
    restartTargetMs: 300000,
    nodeRestoreMs,
    nodeRestoreTargetMs: 1800000,
    databasePoolRestarted: true,
    verifiedBackupFiles: restored.verifiedHashes,
    isolatedRestore: true,
    workers: { outbox: { resumedWithoutDuplicate: true } },
    divergence: planRestore({ backupLastSequence: 100, activeLastSequence: 140 }),
    limitations: [
      'Полная потеря физического узла и нагрузка 50 рабочих мест не проверялась.',
      'Проверены локальные PostgreSQL pool restart, идемпотентность, durable worker и файловое восстановление.',
      'Результат не заменяет стендовый протокол NF-12 и AC-16.',
    ],
  };
  if (output) {
    await mkdir(dirname(output), { recursive: true });
    await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  await dropSchema(secondPool, schema);
  await secondPool.end();
  secondPool = undefined;
} finally {
  if (firstPool) await firstPool.end();
  if (secondPool) {
    await dropSchema(secondPool, schema).catch(() => {});
    await secondPool.end();
  }
  await rm(root, { recursive: true, force: true });
}
