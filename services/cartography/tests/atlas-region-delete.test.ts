import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AtlasStore } from '../src/atlas';
import { AtlasJobs } from '../src/atlas-jobs';
import { deleteAtlasRegion } from '../src/atlas-region-delete';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'atlas-region-delete-'));
  const input = join(root, 'input.mbtiles');
  const db = new DatabaseSync(input);
  db.exec('create table metadata(name text,value text);create table tiles(zoom_level integer,tile_column integer,tile_row integer,tile_data blob)');
  db.prepare('insert into metadata values(?,?)').run('format', 'pbf');
  db.prepare('insert into metadata values(?,?)').run('minzoom', '0');
  db.prepare('insert into metadata values(?,?)').run('maxzoom', '0');
  db.prepare('insert into metadata values(?,?)').run('bounds', '12,51,14,53');
  db.prepare('insert into metadata values(?,?)').run('json', JSON.stringify({ vector_layers: [{ id: 'roads' }] }));
  db.prepare('insert into tiles values(0,0,0,?)').run(Buffer.from([1]));
  db.close();
  const store = new AtlasStore(join(root, 'catalog'));
  const map = await store.importFile('tenant', input);
  const jobs = new AtlasJobs(join(root, 'jobs'), store.root);
  return { root, store, jobs, map };
}

it('контролирует SHA-256, изоляцию tenant и безопасный повтор', async () => {
  const { root, store, jobs, map } = await fixture();
  try {
    const wrong = await deleteAtlasRegion(store, jobs, 'tenant', [{ id: map.id, sha256: '0'.repeat(64) }]);
    expect(wrong.deleted).toEqual([]);
    expect(wrong.unchanged).toEqual([{ id: map.id, reason: 'Содержимое изменилось' }]);
    expect(await store.get('tenant', map.id)).toBeTruthy();
    expect(await deleteAtlasRegion(store, jobs, 'other', [{ id: map.id, sha256: map.sha256! }])).toEqual({ deleted: [], unchanged: [] });
    const deleted = await deleteAtlasRegion(store, jobs, 'tenant', [{ id: map.id, sha256: map.sha256! }]);
    expect(deleted).toEqual({ deleted: [map.id], unchanged: [] });
    expect(await store.list('tenant')).toEqual([]);
    expect(await deleteAtlasRegion(store, jobs, 'tenant', [{ id: map.id, sha256: map.sha256! }])).toEqual({ deleted: [], unchanged: [] });
  } finally {
    jobs.stop();
    await rm(root, { recursive: true, force: true });
  }
});


async function completedJob(root: string, map: Awaited<ReturnType<typeof fixture>>['map'], id = '11111111-1111-4111-8111-111111111111') {
  const directory = join(root, 'jobs', createHash('sha256').update('tenant').digest('hex'));
  await mkdir(directory, { recursive: true });
  const job = {
    id, state: 'done', stage: 'Готово', done: 1, total: 1, result: map,
    input: { kind: 'mbtiles', options: { bounds: map.bounds, name: map.name, attribution: map.attribution, minzoom: map.minzoom, maxzoom: map.maxzoom } },
  };
  await writeFile(join(directory, `${id}.json`), JSON.stringify(job));
  return job;
}

it('удаляет завершённые задания удалённой области, но не активную загрузку другой области', async () => {
  const { root, store, jobs, map } = await fixture();
  try {
    const finished = await completedJob(root, map);
    const active = await jobs.start('tenant', { kind: 'geojson', file: join(root, 'missing.geojson'), options: {
      bounds: [0, 0, 1, 1], name: 'Другая область', attribution: 'test', minzoom: 0, maxzoom: 1,
    } });
    expect(await deleteAtlasRegion(store, jobs, 'tenant', [{ id: map.id, sha256: map.sha256! }])).toEqual({ deleted: [map.id], unchanged: [] });
    const remaining = await jobs.list('tenant');
    expect(remaining.map(job => job.id).join(',')).not.toContain(finished.id);
    expect(remaining.some(job => job.id === active.id && job.state === 'running')).toBe(true);
  } finally {
    jobs.stop();
    await rm(root, { recursive: true, force: true });
  }
});

it('очищает журнал только завершённых заданий', async () => {
  const { root, jobs, map } = await fixture();
  try {
    const finished = await completedJob(root, map);
    const active = await jobs.start('tenant', { kind: 'geojson', file: join(root, 'missing.geojson'), options: {
      bounds: [0, 0, 1, 1], name: 'Другая область', attribution: 'test', minzoom: 0, maxzoom: 1,
    } });
    expect(await jobs.pruneFinished('tenant')).toEqual({ deletedJobs: [finished.id] });
    const remaining = await jobs.list('tenant');
    expect(remaining.map(job => job.id).join(',')).not.toContain(finished.id);
    expect(remaining.some(job => job.id === active.id && job.state === 'running')).toBe(true);
  } finally {
    jobs.stop();
    await rm(root, { recursive: true, force: true });
  }
});
