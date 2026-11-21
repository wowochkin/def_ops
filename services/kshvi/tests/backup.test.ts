import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupService, assertBackupCadence, type BackupSource } from '../src/admin/backup-service';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture(): Promise<{ root: string; sources: BackupSource[]; journalPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-backup-'));
  roots.push(root);
  const files = {
    'scenario.json': '{"revision":3}',
    'environment.json': '{"sha256":"environment"}',
    'assignments.json': '[{"id":"role-1"}]',
    'journal.jsonl': '{"sequence":1}\n',
    'snapshot.json': '{"sequence":1}',
  };
  await Promise.all(Object.entries(files).map(async ([name, content]) => { await writeFile(join(root, name), content); }));
  const sources: BackupSource[] = [
    { name: 'scenario.json', path: join(root, 'scenario.json'), category: 'SCENARIO' },
    { name: 'environment.json', path: join(root, 'environment.json'), category: 'ENVIRONMENT' },
    { name: 'assignments.json', path: join(root, 'assignments.json'), category: 'ASSIGNMENTS' },
    { name: 'journal.jsonl', path: join(root, 'journal.jsonl'), category: 'JOURNAL' },
    { name: 'snapshot.json', path: join(root, 'snapshot.json'), category: 'SNAPSHOT' },
  ];
  return { root, sources, journalPath: join(root, 'journal.jsonl') };
}

describe('полные и инкрементальные копии', () => {
  it('копирует сценарий, среду и назначения, проверяет SHA-256 и обнаруживает повреждение', async () => {
    const { root, sources } = await fixture();
    const service = new BackupService({ rootDirectory: join(root, 'backups'), now: () => new Date('2026-11-22T08:00:00.000Z') });
    const full = await service.createFullBackup({ instanceId: 'instance-1', sources, lastSequence: 100, versions: { schema: '1.0.0', reducer: 1 } });
    expect(full.kind).toBe('FULL');
    expect(full.files).toHaveLength(5);
    expect(full.files.every(file => /^[a-f0-9]{64}$/.test(file.sha256))).toBe(true);
    expect(await service.verifyBackup(full.id)).toMatchObject({ valid: true, checkedFiles: 5 });
    expect(JSON.parse(await readFile(join(root, 'backups', full.id, 'manifest.json'), 'utf8')).lastSequence).toBe(100);

    await writeFile(join(root, 'backups', full.id, 'files', 'scenario.json'), '{"revision":4}');
    expect(await service.verifyBackup(full.id)).toMatchObject({ valid: false });
    expect((await service.verifyBackup(full.id)).issues).toContainEqual(expect.objectContaining({ code: 'HASH_MISMATCH', name: 'scenario.json' }));
  });

  it('создаёт инкремент журнала от полной копии и контролирует интервал не более пяти минут', async () => {
    const { root, sources, journalPath } = await fixture();
    const service = new BackupService({ rootDirectory: join(root, 'backups') });
    const full = await service.createFullBackup({ instanceId: 'instance-1', sources, lastSequence: 100, versions: { schema: '1.0.0', reducer: 1 } });
    await writeFile(journalPath, '{"sequence":1}\n{"sequence":2}\n');
    const incremental = await service.createIncrementalBackup({
      instanceId: 'instance-1', baseBackupId: full.id, lastSequence: 140,
      sources: [{ name: 'journal.jsonl', path: journalPath, category: 'JOURNAL' }], versions: { schema: '1.0.0', reducer: 1 },
    });
    expect(incremental).toMatchObject({ kind: 'INCREMENTAL', baseBackupId: full.id, lastSequence: 140 });
    expect(await service.verifyBackup(incremental.id)).toMatchObject({ valid: true, checkedFiles: 1 });
    expect(await readFile(join(root, 'backups', incremental.id, 'files', 'journal.jsonl'), 'utf8')).toBe('{"sequence":2}\n');
    expect(incremental.files[0].offset).toBeGreaterThan(0);
    expect(incremental.files[0].assembledSize).toBeGreaterThan(incremental.files[0].size);
    expect(() => assertBackupCadence({ preStartFullBackupId: full.id, lastIncrementalAt: '2026-11-22T08:00:00.000Z', now: '2026-11-22T08:05:00.000Z', checkpoint: 'NONE' })).not.toThrow();
    expect(() => assertBackupCadence({ preStartFullBackupId: full.id, lastIncrementalAt: '2026-11-22T08:00:00.000Z', now: '2026-11-22T08:05:00.001Z', checkpoint: 'NONE' })).toThrow('5 мин');
    expect(() => assertBackupCadence({ preStartFullBackupId: full.id, lastIncrementalAt: '2026-11-22T08:00:00.000Z', now: '2026-11-22T08:04:00.000Z', checkpoint: 'BEFORE_JUMP' })).toThrow('контрольная копия');
    expect(() => assertBackupCadence({ preStartFullBackupId: null, lastIncrementalAt: null, now: '2026-11-22T08:04:00.000Z', checkpoint: 'NONE' })).toThrow('предстартовая');
  });
});
