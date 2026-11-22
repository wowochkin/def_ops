import { mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { BackupService, assertBackupCadence, type BackupSource } from '../src/admin/backup-service';
import { RestoreService, planRestore } from '../src/admin/restore-service';
import { assertRecoveryObjectives } from '../src/admin/restore-verification';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-restore-security-'));
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
  const journalEvents = [{ sequence: 1, eventId: 'event-1', hash: 'a'.repeat(64), branchId: 'main' }];
  const full = await backups.createFullBackup({ instanceId: 'i1', sources, lastSequence: 1, journalEvents, versions: { schema: '1.0.0', reducer: 1 } });
  return { root, backups, full, journalEvents };
}

describe('безопасность манифеста и путей восстановления', () => {
  it('отклоняет traversal в изменённом манифесте и не создаёт файл вне isolated root', async () => {
    const { root, backups, full } = await fixture();
    const manifestPath = join(root, 'backups', full.id, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.files[0].name = '../../escaped.json';
    await writeFile(manifestPath, JSON.stringify(manifest));
    const restore = new RestoreService({ backups, isolationRoot: join(root, 'isolated') });
    await expect(restore.restoreToIsolated({ backupId: full.id, activeLastSequence: 1, isolationId: 'safe' })).rejects.toThrow(/имя|схем/);
    await expect(readFile(join(root, 'escaped.json'), 'utf8')).rejects.toThrow();
  });

  it('отклоняет невалидную schema и символические ссылки источника', async () => {
    const { root, backups, full } = await fixture();
    const manifestPath = join(root, 'backups', full.id, 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    delete manifest.files[0].assembledSha256;
    await writeFile(manifestPath, JSON.stringify(manifest));
    await expect(backups.readManifest(full.id)).rejects.toThrow('схем');

    const valid = await fixture();
    await writeFile(join(valid.root, 'outside.json'), 'scenario');
    await unlink(join(valid.root, 'backups', valid.full.id, 'files', 'scenario.json'));
    await symlink(join(valid.root, 'outside.json'), join(valid.root, 'backups', valid.full.id, 'files', 'scenario.json'));
    const restore = new RestoreService({ backups: valid.backups, isolationRoot: join(valid.root, 'isolated') });
    await expect(restore.restoreToIsolated({ backupId: valid.full.id, activeLastSequence: 1, isolationId: 'safe' })).rejects.toThrow('символическ');
  });

  it('отклоняет символическую ссылку на isolated root', async () => {
    const { root, backups, full } = await fixture();
    const outside = join(root, 'outside-isolation');
    await symlink(root, join(root, 'isolation-link'), 'dir');
    const restore = new RestoreService({ backups, isolationRoot: join(root, 'isolation-link') });
    await expect(restore.restoreToIsolated({ backupId: full.id, activeLastSequence: 1, isolationId: 'safe' })).rejects.toThrow(/изолирован/i);
    expect(outside).toBeTruthy();
  });
});

describe('полное сравнение журналов и численные проверки', () => {
  const eventA = { sequence: 1, eventId: 'event-a', hash: 'a'.repeat(64), branchId: 'main' };
  it('обнаруживает другой event ID/hash/branch при равной sequence и создаёт DivergenceReport', () => {
    const changedId = planRestore({ backupLastSequence: 1, activeLastSequence: 1, backupJournal: [eventA], activeJournal: [{ ...eventA, eventId: 'event-b' }] });
    expect(changedId.allowed).toBe(false);
    if (changedId.allowed) throw new Error('Расхождение не обнаружено');
    expect(changedId.divergenceReport.differences).toContainEqual(expect.objectContaining({ code: 'EVENT_ID_MISMATCH', sequence: 1 }));
    const changedHash = planRestore({ backupLastSequence: 1, activeLastSequence: 1, backupJournal: [eventA], activeJournal: [{ ...eventA, hash: 'b'.repeat(64) }] });
    expect(changedHash.allowed).toBe(false);
    const changedBranch = planRestore({ backupLastSequence: 1, activeLastSequence: 1, backupJournal: [eventA], activeJournal: [{ ...eventA, branchId: 'alternate' }] });
    expect(changedBranch.allowed).toBe(false);
    expect(planRestore({ backupLastSequence: 1, activeLastSequence: 1, backupJournal: [eventA], activeJournal: [eventA] }).allowed).toBe(true);
  });

  it('отклоняет NaN дат и временных целей', () => {
    expect(() => assertBackupCadence({ preStartFullBackupId: 'full', lastIncrementalAt: 'invalid', now: '2026-11-22T08:00:00.000Z', checkpoint: 'NONE' })).toThrow('дата');
    expect(() => assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs: Number.NaN, nodeRestoreMs: 1 })).toThrow('число');
    expect(() => assertRecoveryObjectives({ confirmedEventsLost: 0, restartMs: 1, nodeRestoreMs: Number.NaN })).toThrow('число');
  });
});
