/** Импорт тайловых архивов SQLite: RMaps/Locus (.sqlitedb) и MBTiles. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tileOf, type MapJob } from '@def-ops/core';
import { TileStore } from '../src/tiles';
import { importArchive, openArchive } from '../src/archive';
import type { JobContext } from '../src/jobs';
import { tilePng } from './helpers';

let dir = '';
let store: TileStore;
beforeAll(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-')); store = new TileStore(path.join(dir, 'tiles')); });
afterAll(async () => { await fs.rm(dir, { recursive: true, force: true }); });

function ctx(): JobContext {
  const job: MapJob = { id: 'j', mapId: 'm', type: 'package-import', status: 'running', done: 0, total: 0, skipped: 0, errors: 0, createdAt: '', updatedAt: '' };
  return { job, tenant: 't', signal: new AbortController().signal, progress: (p) => Object.assign(job, p), check: () => undefined };
}

// тайлы Берлина на уровнях 10–12
const berlin = (z: number) => tileOf([13.4, 52.52], z);
const LEVELS = [10, 11, 12];

describe('RMaps / Locus (.sqlitedb)', () => {
  it('уровень 17−z, ось Y сверху вниз; тайлы на своих местах', async () => {
    const file = path.join(dir, 'berlin.sqlitedb');
    const db = new DatabaseSync(file);
    db.exec('create table tiles (x int, y int, z int, s int, image blob, primary key (x, y, z, s)); create table info (maxzoom int, minzoom int)');
    const ins = db.prepare('insert into tiles values (?, ?, ?, 0, ?)');
    for (const z of LEVELS) { const [x, y] = berlin(z); ins.run(x, y, 17 - z, await tilePng(z, x, y)); }
    db.prepare('insert into info values (?, ?)').run(17 - 12, 17 - 10);
    db.close();
    expect(openArchive(file).info.format).toBe('sqlitedb');
    const r = await importArchive(ctx(), store, 'm1', file);
    expect(r).toMatchObject({ tiles: 3, errors: 0, minzoom: 10, maxzoom: 12, ext: 'png' });
    for (const z of LEVELS) {
      const [x, y] = berlin(z);
      const t = await store.find('t', 'm1', z, x, y);
      expect(t, `z${z}`).not.toBeNull();
      expect((await fs.readFile(t!.file)).equals(await tilePng(z, x, y))).toBe(true);
    }
    expect(r.bounds[0]).toBeLessThan(13.4); expect(r.bounds[2]).toBeGreaterThan(13.4);
  });
  it('tilenumbering=simple и inverted_y', async () => {
    const file = path.join(dir, 'osmand.sqlitedb');
    const db = new DatabaseSync(file);
    db.exec("create table tiles (x int, y int, z int, s int, image blob); create table info (minzoom int, maxzoom int, tilenumbering text, inverted_y int)");
    const [x, y] = berlin(11);
    db.prepare('insert into tiles values (?, ?, 11, 0, ?)').run(x, (1 << 11) - 1 - y, await tilePng(11, x, y));
    db.prepare("insert into info values (11, 11, 'simple', 1)").run();
    db.close();
    const r = await importArchive(ctx(), store, 'm2', file);
    expect(r.tiles).toBe(1);
    expect(await store.find('t', 'm2', 11, x, y)).not.toBeNull();
  });
});

describe('MBTiles', () => {
  it('ось TMS, метаданные', async () => {
    const file = path.join(dir, 'berlin.mbtiles');
    const db = new DatabaseSync(file);
    db.exec('create table metadata (name text, value text); create table tiles (zoom_level int, tile_column int, tile_row int, tile_data blob)');
    db.prepare("insert into metadata values ('name', 'Берлин 1945'), ('attribution', 'архив')").run();
    const ins = db.prepare('insert into tiles values (?, ?, ?, ?)');
    for (const z of LEVELS) { const [x, y] = berlin(z); ins.run(z, x, (1 << z) - 1 - y, await tilePng(z, x, y)); }
    ins.run(12, 0, 0, Buffer.from('not an image'));
    db.close();
    const r = await importArchive(ctx(), store, 'm3', file);
    expect(r).toMatchObject({ tiles: 3, errors: 1, minzoom: 10, maxzoom: 12 });
    expect(r.info).toMatchObject({ format: 'mbtiles', name: 'Берлин 1945', attribution: 'архив' });
    for (const z of LEVELS) { const [x, y] = berlin(z); expect(await store.find('t', 'm3', z, x, y)).not.toBeNull(); }
  });
  it('не SQLite и не тайловый архив — 422', async () => {
    const junk = path.join(dir, 'junk.bin');
    await fs.writeFile(junk, Buffer.alloc(2048, 3));
    expect(() => openArchive(junk)).toThrow(/не является базой SQLite/);
    const other = path.join(dir, 'other.sqlite');
    const db = new DatabaseSync(other); db.exec('create table t (a int)'); db.close();
    expect(() => openArchive(other)).toThrow(/нет таблицы тайлов/);
  });
});
