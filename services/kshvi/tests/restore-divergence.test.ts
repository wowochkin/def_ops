import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { BackupService, type BackupSource } from '../src/admin/backup-service';
import { RestoreService, planRestore } from '../src/admin/restore-service';
import { createDivergenceReport, resolveDivergence } from '../src/admin/divergence-report';
import { assertRecoveryObjectives } from '../src/admin/restore-verification';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('не затирает более поздние подтверждённые события старой копией', () => {
  expect(planRestore({ backupLastSequence: 100, activeLastSequence: 140 })).toEqual({ allowed: false, requiredReport: 'DIVERGENCE', preservedSequence: 140 });
  const report = createDivergenceReport({
    backupLastSequence: 100, activeLastSequence: 140,
    laterEvents: [{ sequence: 101, eventId: 'event-101', hash: 'a'.repeat(64) }, { sequence: 140, eventId: 'event-140', hash: 'b'.repeat(64) }],
  });
  expect(report).toMatchObject({ status: 'PENDING', preservedSequence: 140, laterEventCount: 2 });
  expect(JSON.stringify(report)).not.toContain('payload');
  expect(() => resolveDivergence(report, { decision: 'OVERWRITE_ACTIVE', actorRole: 'ADMIN', reason: 'Стереть поздние события' })).toThrow('поздние события');
  expect(resolveDivergence(report, { decision: 'KEEP_ACTIVE', actorRole: 'DIRECTOR', reason: 'Сохранить подтверждённый журнал' }).status).toBe('RESOLVED');
});

it('восстанавливает только в изолированную область после проверки хешей', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-restore-'));
  roots.push(root);
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
  const full = await backups.createFullBackup({ instanceId: 'instance-1', sources, lastSequence: 100, versions: { schema: '1.0.0', reducer: 1 } });
  const restore = new RestoreService({ backups, isolationRoot: join(root, 'isolated') });
  const result = await restore.restoreToIsolated({ backupId: full.id, activeLastSequence: 100, isolationId: 'verification-1' });
  expect(result.allowed).toBe(true);
  if (!result.allowed) throw new Error('Изолированное восстановление не разрешено');
  expect(result.restoredDirectory).toBe(join(root, 'isolated', 'verification-1'));
  expect(result.verifiedHashes).toBe(5);
  expect(await readFile(join(result.restoredDirectory as string, 'scenario.json'), 'utf8')).toBe('scenario');

  const denied = await restore.restoreToIsolated({ backupId: full.id, activeLastSequence: 140, isolationId: 'must-not-exist' });
  expect(denied).toEqual({ allowed: false, requiredReport: 'DIVERGENCE', preservedSequence: 140 });
  await expect(readFile(join(root, 'isolated', 'must-not-exist', 'scenario.json'), 'utf8')).rejects.toThrow();

  await writeFile(join(root, 'journal.jsonl'), 'journal\n+confirmed');
  const incremental = await backups.createIncrementalBackup({
    instanceId: 'instance-1', baseBackupId: full.id, lastSequence: 101,
    sources: [{ name: 'journal.jsonl', path: join(root, 'journal.jsonl'), category: 'JOURNAL' }], versions: { schema: '1.0.0', reducer: 1 },
  });
  const chain = await restore.restoreToIsolated({ backupId: incremental.id, activeLastSequence: 101, isolationId: 'chain-1' });
  if (!chain.allowed) throw new Error('Восстановление цепочки не разрешено');
  expect(chain.verifiedHashes).toBe(5);
  expect(await readFile(join(chain.restoredDirectory, 'scenario.json'), 'utf8')).toBe('scenario');
  expect(await readFile(join(chain.restoredDirectory, 'journal.jsonl'), 'utf8')).toBe('journal\n+confirmed');
});

it('измеряет RPO 0, перезапуск не более пяти минут и узел не более тридцати минут', () => {
  expect(assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs: 299_999, nodeRestoreMs: 1_799_999 })).toMatchObject({ passed: true, rpo: 0 });
  expect(() => assertRecoveryObjectives({ confirmedEventsLost: 1, restartMs: 1, nodeRestoreMs: 1 })).toThrow('RPO');
  expect(() => assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs: 300_001, nodeRestoreMs: 1 })).toThrow('5 мин');
  expect(() => assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs: 1, nodeRestoreMs: 1_800_001 })).toThrow('30 мин');
});
