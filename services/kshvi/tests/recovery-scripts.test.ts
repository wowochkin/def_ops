import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

async function sources(root: string) {
  const values = { 'scenario.json': 'scenario', 'environment.json': 'environment', 'assignments.json': 'assignments', 'journal.jsonl': '1\n', 'snapshot.json': 'snapshot' };
  await Promise.all(Object.entries(values).map(([name, value]) => writeFile(join(root, name), value)));
  return Object.entries(values).map(([name]) => {
    const category = name.split('.')[0].toUpperCase();
    return `${category === 'JOURNAL' ? 'JOURNAL' : category}=${join(root, name)}`;
  });
}

it('CLI backup/restore создаёт и восстанавливает фактическую копию', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-cli-'));
  roots.push(root);
  const args = await sources(root);
  const output = execFileSync(process.execPath, [
    '--import', 'tsx', resolve('scripts/kshvi-backup.mjs'), '--root', join(root, 'backups'), '--instance', 'i1', '--last-sequence', '1',
    ...args.flatMap(source => ['--source', source]),
  ], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
  const manifest = JSON.parse(output);
  expect(manifest.kind).toBe('FULL');
  const restored = JSON.parse(execFileSync(process.execPath, [
    '--import', 'tsx', resolve('scripts/kshvi-restore.mjs'), '--root', join(root, 'backups'), '--backup-id', manifest.id,
    '--isolation-root', join(root, 'isolated'), '--isolation-id', 'cli-check', '--active-sequence', '1',
  ], { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } }));
  expect(restored).toMatchObject({ allowed: true, verifiedHashes: 5 });
  expect(await readFile(join(root, 'isolated', 'cli-check', 'scenario.json'), 'utf8')).toBe('scenario');
});

const integration = process.env.TEST_DATABASE_URL ? it : it.skip;
integration('disaster drill закрывает pool, восстанавливает БД и workers и не заявляет физическую потерю узла', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kshvi-drill-cli-'));
  roots.push(root);
  const output = join(root, 'drill.json');
  execFileSync(process.execPath, ['--import', 'tsx', resolve('scripts/kshvi-disaster-drill.mjs'), '--output', output], {
    encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' },
  });
  const report = JSON.parse(await readFile(output, 'utf8'));
  expect(report).toMatchObject({
    status: 'passed', scope: 'LOCAL_FUNCTIONAL_DRILL_NOT_PHYSICAL_NODE_LOSS',
    confirmedEventsLost: 0, duplicateEventsAfterRetry: 0, databasePoolRestarted: true,
    workers: { outbox: { resumedWithoutDuplicate: true } },
  });
  expect(report.limitations.join(' ')).toContain('не проверялась');
});
