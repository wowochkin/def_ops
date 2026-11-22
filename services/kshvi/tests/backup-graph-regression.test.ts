import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { BackupService, type BackupSource, type JournalEventIdentity } from '../src/admin/backup-service';
import { BackupRegimen } from '../src/admin/backup-regimen';
import { RestoreService } from '../src/admin/restore-service';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-backup-graph-'));
  roots.push(root);
  const values = { 'scenario.json': 'scenario', 'environment.json': 'environment', 'assignments.json': 'assignments', 'journal.jsonl': '1\n', 'snapshot.json': 's1' };
  await Promise.all(Object.entries(values).map(([name, value]) => writeFile(join(root, name), value)));
  const sources: BackupSource[] = [
    { name: 'scenario.json', path: join(root, 'scenario.json'), category: 'SCENARIO' },
    { name: 'environment.json', path: join(root, 'environment.json'), category: 'ENVIRONMENT' },
    { name: 'assignments.json', path: join(root, 'assignments.json'), category: 'ASSIGNMENTS' },
    { name: 'journal.jsonl', path: join(root, 'journal.jsonl'), category: 'JOURNAL' },
    { name: 'snapshot.json', path: join(root, 'snapshot.json'), category: 'SNAPSHOT' },
  ];
  const journalEvents: JournalEventIdentity[] = [
    { sequence: 1, eventId: 'event-1', hash: 'a'.repeat(64), branchId: 'main' },
    { sequence: 2, eventId: 'event-2', hash: 'b'.repeat(64), branchId: 'main' },
    { sequence: 3, eventId: 'event-3', hash: 'c'.repeat(64), branchId: 'main' },
  ];
  let now = new Date('2026-11-22T08:00:00.000Z');
  let sequence = 1;
  const backups = new BackupService({ rootDirectory: join(root, 'backups'), now: () => now });
  const regimen = new BackupRegimen({
    backups, instanceId: 'i1', now: () => now, snapshotIntervalMs: 60_000,
    input: async () => ({ sources, lastSequence: sequence, journalEvents: journalEvents.filter(event => event.sequence <= sequence), versions: { schema: '1.0.0', reducer: 1 } }),
  });
  await regimen.prestart();
  return { root, sources, backups, regimen, setTime: (value: string) => { now = new Date(value); }, setSequence: (value: number) => { sequence = value; } };
}

it('snapshot-only и одновременные копии восстанавливают весь журнал до lastSequence', async () => {
  const { root, backups, regimen, setTime, setSequence } = await fixture();
  setTime('2026-11-22T08:02:00.000Z');
  setSequence(2);
  await writeFile(join(root, 'journal.jsonl'), '1\n2\n');
  await writeFile(join(root, 'snapshot.json'), 's2');
  const early = await regimen.tick();
  const earlySnapshot = early.find(manifest => manifest.files.some(file => file.category === 'SNAPSHOT'));
  expect(earlySnapshot).toBeTruthy();
  const restore = new RestoreService({ backups, isolationRoot: join(root, 'isolated') });
  const earlyRestore = await restore.restoreToIsolated({ backupId: earlySnapshot!.id, activeLastSequence: 2, isolationId: 'early' });
  if (!earlyRestore.allowed) throw new Error('Snapshot-цепочка отклонена');
  expect(earlyRestore.lastSequence).toBe(2);
  expect(await readFile(join(earlyRestore.restoredDirectory, 'journal.jsonl'), 'utf8')).toBe('1\n2\n');

  setTime('2026-11-22T08:05:00.000Z');
  setSequence(3);
  await writeFile(join(root, 'journal.jsonl'), '1\n2\n3\n');
  await writeFile(join(root, 'snapshot.json'), 's3');
  const simultaneous = await regimen.tick();
  const latestSnapshot = simultaneous.find(manifest => manifest.files.some(file => file.category === 'SNAPSHOT'));
  expect(latestSnapshot).toBeTruthy();
  const latestRestore = await restore.restoreToIsolated({ backupId: latestSnapshot!.id, activeLastSequence: 3, isolationId: 'latest' });
  if (!latestRestore.allowed) throw new Error('Одновременная цепочка отклонена');
  expect(await readFile(join(latestRestore.restoredDirectory, 'journal.jsonl'), 'utf8')).toBe('1\n2\n3\n');
});

it('запрещает snapshot с завышенной последовательностью без журнального инкремента той же точки', async () => {
  const { root, sources, backups, regimen } = await fixture();
  const full = regimen.manifests()[0];
  await writeFile(join(root, 'journal.jsonl'), '1\n2\n');
  await expect(backups.createIncrementalBackup({
    instanceId: 'i1', baseBackupId: full.id, lastSequence: 2,
    sources: sources.filter(source => source.category === 'SNAPSHOT'), versions: { schema: '1.0.0', reducer: 1 },
  })).rejects.toThrow('журнал');
});
