import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, rm } from 'node:fs/promises';
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
