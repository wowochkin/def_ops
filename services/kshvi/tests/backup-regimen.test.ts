import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { BackupService, type BackupSource } from '../src/admin/backup-service';
import { BackupRegimen } from '../src/admin/backup-regimen';
import { WorkerRecoveryService } from '../src/admin/worker-recovery';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('выполняет prestart, периодические increments/snapshots и контрольные копии', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-regimen-'));
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
  let now = new Date('2026-11-22T08:00:00.000Z');
  let sequence = 1;
  const backups = new BackupService({ rootDirectory: join(root, 'backups'), now: () => now });
  const regimen = new BackupRegimen({
    backups, instanceId: 'i1', now: () => now, snapshotIntervalMs: 60_000,
    input: async () => ({ sources, lastSequence: sequence, versions: { schema: '1.0.0', reducer: 1 } }),
  });
  await regimen.prestart();
  now = new Date('2026-11-22T08:01:00.000Z');
  await writeFile(join(root, 'snapshot.json'), 's2');
  expect((await regimen.tick()).map(manifest => manifest.kind)).toEqual(['INCREMENTAL']);
  now = new Date('2026-11-22T08:04:59.000Z');
  expect((await regimen.tick()).every(manifest => manifest.files.every(file => file.category !== 'JOURNAL'))).toBe(true);
  now = new Date('2026-11-22T08:05:00.000Z');
  sequence = 2;
  await writeFile(join(root, 'journal.jsonl'), '1\n2\n');
  await writeFile(join(root, 'snapshot.json'), 's3');
  const increments = await regimen.tick();
  expect(increments.length).toBeGreaterThan(0);
  const journalIncrement = increments.find(manifest => manifest.files.some(file => file.category === 'JOURNAL'));
  expect(journalIncrement).toBeTruthy();
  expect(await readFile(join(root, 'backups', journalIncrement!.id, 'files', 'journal.jsonl'), 'utf8')).toBe('2\n');
  const checkpoint = await regimen.checkpoint('BEFORE_JUMP');
  expect(checkpoint.files.map(file => file.category)).toEqual(expect.arrayContaining(['JOURNAL', 'SNAPSHOT']));
  expect(regimen.manifests().some(manifest => manifest.kind === 'FULL')).toBe(true);
  expect(regimen.manifests().filter(manifest => manifest.kind === 'INCREMENTAL').length).toBeGreaterThanOrEqual(3);
});

it('возобновляет workers без повторного эффекта после durable перезапуска', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-worker-recovery-'));
  roots.push(root);
  const stateFile = join(root, 'workers.jsonl');
  const effects: string[] = [];
  const first = new WorkerRecoveryService({ stateFile });
  await first.resume('outbox', 10, async () => { effects.push('outbox:10'); return 'APPLIED'; });
  await first.resume('outbox', 10, async () => { effects.push('duplicate'); return 'APPLIED'; });
  const restarted = new WorkerRecoveryService({ stateFile });
  await restarted.resume('outbox', 10, async () => { effects.push('duplicate-after-restart'); return 'APPLIED'; });
  await restarted.resume('outbox', 11, async () => { effects.push('outbox:11'); return 'APPLIED'; });
  expect(effects).toEqual(['outbox:10', 'outbox:11']);
});
