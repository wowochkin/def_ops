import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { emptyWorld, reduceWorld } from '@def-ops/kshvi';
import { expect, it } from 'vitest';
import { KshviEventStore } from '../src/store/event-store';
import { appendCommittedCommand } from '../src/admin/recovery-coordinator';
import { BackupService, type BackupSource } from '../src/admin/backup-service';
import { RestoreService, planRestore } from '../src/admin/restore-service';
import { assertRecoveryObjectives } from '../src/admin/restore-verification';
import { command, withKshviDatabase } from './helpers/database';

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;

integration('локальная аварийная репетиция формирует измеримый recovery-протокол', async () => {
  await withKshviDatabase(async store => {
    const input = command('recovery-drill-1');
    await expect(appendCommittedCommand(store, input, { afterCommit: () => { throw new Error('Соединение потеряно после фиксации'); } })).rejects.toThrow('после фиксации');
    const repeated = await appendCommittedCommand(store, input);
    expect(await store.eventCount('i1')).toBe(1);
    const world = reduceWorld(emptyWorld('scenario-1'), { eventId: repeated.eventId, type: input.type, payload: input.payload, causeIds: [] }, { reducerVersion: 1 });
    await store.saveSnapshot({ organizationId: 'org1', instanceId: 'i1', branchId: 'b1', sequence: 1, state: world, environment: { id: 'env-1', revision: 1, sha256: 'a'.repeat(64) }, reducerVersion: 1 });

    const restartStarted = performance.now();
    const restarted = new KshviEventStore({ pool: store.pool, schema: store.schema });
    expect((await restarted.restoreWorld('i1', 'b1')).sequence).toBe(1);
    const restartMs = performance.now() - restartStarted;

    const root = await mkdtemp(join(tmpdir(), 'kshvi-recovery-drill-'));
    try {
      const values = { 'scenario.json': 'scenario', 'environment.json': 'environment', 'assignments.json': 'assignments', 'journal.jsonl': 'journal', 'snapshot.json': 'snapshot' };
      await Promise.all(Object.entries(values).map(([name, value]) => writeFile(join(root, name), value)));
      const sources: BackupSource[] = [
        { name: 'scenario.json', path: join(root, 'scenario.json'), category: 'SCENARIO' },
        { name: 'environment.json', path: join(root, 'environment.json'), category: 'ENVIRONMENT' },
        { name: 'assignments.json', path: join(root, 'assignments.json'), category: 'ASSIGNMENTS' },
        { name: 'journal.jsonl', path: join(root, 'journal.jsonl'), category: 'JOURNAL' },
        { name: 'snapshot.json', path: join(root, 'snapshot.json'), category: 'SNAPSHOT' },
      ];
      const backups = new BackupService({ rootDirectory: join(root, 'backups') });
      const full = await backups.createFullBackup({ instanceId: 'i1', sources, lastSequence: 1, versions: { schema: '1.0.0', reducer: 1 } });
      expect((await backups.verifyBackup(full.id)).valid).toBe(true);
      const restoreStarted = performance.now();
      const restored = await new RestoreService({ backups, isolationRoot: join(root, 'isolated') }).restoreToIsolated({ backupId: full.id, activeLastSequence: 1, isolationId: 'drill' });
      const nodeRestoreMs = performance.now() - restoreStarted;
      expect(restored).toMatchObject({ allowed: true, verifiedHashes: 5 });
      if (!restored.allowed) throw new Error('Изолированное восстановление репетиции не разрешено');
      const divergence = planRestore({ backupLastSequence: 100, activeLastSequence: 140 });
      const objectives = assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs, nodeRestoreMs });
      const evidence = {
        schemaVersion: 1,
        status: 'passed',
        scope: 'LOCAL_POSTGRESQL_FUNCTIONAL_DRILL',
        measuredAt: new Date().toISOString(),
        command: 'TEST_DATABASE_URL=… npx vitest run services/kshvi/tests/recovery-drill.test.ts',
        confirmedEvents: 1,
        duplicateEventsAfterRetry: 0,
        confirmedEventsLost: 0,
        rpo: objectives.rpo,
        restartMs,
        restartTargetMs: 300_000,
        nodeRestoreMs,
        nodeRestoreTargetMs: 1_800_000,
        verifiedBackupFiles: restored.verifiedHashes,
        isolatedRestore: true,
        divergence,
        limitations: [
          'Проверены транзакционный PostgreSQL, повтор команды и файловое восстановление на локальном узле.',
          'Полная потеря физического узла, нагрузка 50 рабочих мест и сетевые задержки этой репетицией не проверялись.',
          'Измерения не заменяют стендовый протокол NF-12 и AC-16 на эталонном наборе данных.',
        ],
      };
      if (process.env.KSHVI_RECOVERY_EVIDENCE === '1') {
        const output = resolve('docs/release/kshvi/recovery-drill.json');
        await mkdir(resolve('docs/release/kshvi'), { recursive: true });
        await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
