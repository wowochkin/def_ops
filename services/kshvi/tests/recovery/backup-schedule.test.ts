import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { BackupService, assertBackupCadence, type BackupSource } from '../../src/admin/backup-service';
import { RestoreService } from '../../src/admin/restore-service';

it('проверяет расписание, хеши и пробное изолированное восстановление копий', async () => {
  await mkdir(resolve('.tmp'), { recursive: true });
  const root = await mkdtemp(resolve('.tmp/kshvi-nf13-'));
  try {
    const values = { 'scenario.json': 'scenario', 'environment.json': 'environment', 'assignments.json': 'assignments', 'journal.jsonl': '{"sequence":1}\n', 'snapshot.json': 'snapshot' };
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
    await writeFile(join(root, 'journal.jsonl'), '{"sequence":1}\n{"sequence":2}\n');
    const incremental = await backups.createIncrementalBackup({ instanceId: 'i1', baseBackupId: full.id, sources: [sources[3]!], lastSequence: 2, versions: { schema: '1.0.0', reducer: 1 } });
    expect((await backups.verifyBackup(incremental.id)).valid).toBe(true);
    expect(() => assertBackupCadence({ preStartFullBackupId: full.id, lastIncrementalAt: '2026-11-22T08:00:00.000Z', now: '2026-11-22T08:05:00.000Z', checkpoint: 'BEFORE_FINISH', checkpointBackupId: incremental.id })).not.toThrow();
    expect(() => assertBackupCadence({ preStartFullBackupId: full.id, lastIncrementalAt: '2026-11-22T08:00:00.000Z', now: '2026-11-22T08:05:00.001Z', checkpoint: 'NONE' })).toThrow('5 мин');
    const restored = await new RestoreService({ backups, isolationRoot: join(root, 'isolated') }).restoreToIsolated({ backupId: incremental.id, activeLastSequence: 2, isolationId: 'nf13' });
    expect(restored).toMatchObject({ allowed: true, verifiedHashes: 5, lastSequence: 2 });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
