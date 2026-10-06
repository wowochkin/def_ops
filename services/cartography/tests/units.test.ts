/** Модули сервиса картографии по отдельности: скан из файла и из памяти, граница, хранилища, проверки. */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { LngLat, MapJob, MapSource } from '@def-ops/core';
import { tileOf } from '@def-ops/core';
import { openRaster, planRaster, tileRaster } from '../src/raster';
import { maskTile, tileRelation } from '../src/coverage';
import { TileStore, detectFormat } from '../src/tiles';
import { MemoryRepo, type MapRepo } from '../src/repo';
import { PgRepo } from '../src/pg-repo';
import { tileTemplate } from '../src/validate';
import type { JobContext } from '../src/jobs';
import { quadrantImage, tempDir } from './helpers';

const CORNERS: [LngLat, LngLat, LngLat, LngLat] = [[13.3, 52.55], [13.5, 52.55], [13.5, 52.45], [13.3, 52.45]];

const ctxFor = (tenant: string): JobContext => {
  const job: MapJob = { id: 'j', mapId: 'm', type: 'raster-tile', status: 'running', done: 0, total: 0, skipped: 0, errors: 0, createdAt: '', updatedAt: '' };
  return { job, tenant, signal: new AbortController().signal, progress: (p) => Object.assign(job, p), check: () => undefined };
};

describe('скан: из памяти и из временного файла — одинаково', () => {
  it('чтение окон и нарезка совпадают байт в байт', async () => {
    const dir = await tempDir();
    try {
      const file = path.join(dir, 'scan.png');
      await fs.writeFile(file, await quadrantImage(600, 450));
      const mem = await openRaster(file, 600, 450, 1 << 30);
      const disk = await openRaster(file, 600, 450, 0);
      expect((await disk.read(10, 20, 50, 40)).equals(await mem.read(10, 20, 50, 40))).toBe(true);
      expect((await disk.read(0, 100, 600, 3)).equals(await mem.read(0, 100, 600, 3))).toBe(true);
      await mem.close();
      await disk.close();
      expect(await fs.readdir(dir)).toEqual(['scan.png']); // временный RGBA удалён

      const plan = await planRaster(file, { corners: CORNERS }, { tileSize: 256, format: 'png' });
      const a = new TileStore(path.join(dir, 'a')), b = new TileStore(path.join(dir, 'b'));
      await tileRaster(ctxFor('t'), a, 'm', plan, { memoryLimitBytes: 1 << 30 });
      const ctx = ctxFor('t');
      await tileRaster(ctx, b, 'm', plan, { memoryLimitBytes: 0 });
      expect(ctx.job.done).toBe(plan.total);
      const list = async (s: TileStore) => {
        const out: string[] = [];
        for await (const t of s.walk('t', 'm')) out.push(`${t.z}/${t.x}/${t.y}:${(await fs.readFile(t.file)).toString('base64')}`);
        return out;
      };
      const la = await list(a);
      expect(la.length).toBeGreaterThan(5);
      expect(await list(b)).toEqual(la);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  });
});

describe('граница карты', () => {
  const ring: LngLat[] = [[13.3, 52.45], [13.5, 52.45], [13.5, 52.55], [13.3, 52.55]];
  it('положение тайла относительно контура', () => {
    const [x, y] = tileOf([13.4, 52.5], 14);
    expect(tileRelation(ring, 14, x, y)).toBe('inside');
    const [ox, oy] = tileOf([14.4, 52.5], 14);
    expect(tileRelation(ring, 14, ox, oy)).toBe('outside');
    const [cx, cy] = tileOf([13.3, 52.5], 14);
    expect(tileRelation(ring, 14, cx, cy)).toBe('crossing');
    // контур целиком внутри одного крупного тайла
    const [bx, by] = tileOf([13.4, 52.5], 5);
    expect(tileRelation(ring, 5, bx, by)).toBe('crossing');
  });
  it('маска: прозрачность за контуром', () => {
    const [x, y] = tileOf([13.3, 52.5], 14);
    const raw = Buffer.alloc(16 * 16 * 4, 255);
    maskTile(raw, ring, 14, x, y, 16);
    const alpha = [...raw.filter((_, i) => i % 4 === 3)];
    expect(alpha.filter((a) => a === 0).length).toBeGreaterThan(0);
    expect(alpha.filter((a) => a === 255).length).toBeGreaterThan(0);
  });
});

describe('проверки', () => {
  it('шаблон адреса и список разрешённых источников', () => {
    expect(tileTemplate('https://a.tile.example.org/{z}/{x}/{y}.png')).toBeTruthy();
    expect(tileTemplate('https://t.example.org/tiles?q={quadkey}')).toBeTruthy();
    expect(() => tileTemplate('https://etomesto.ru/{z}/{x}/{y}.png', ['example.org'])).toThrow('не разрешена');
    expect(tileTemplate('https://img.etomesto.ru/{z}/{x}/{y}.png', ['etomesto.ru'])).toBeTruthy();
    expect(() => tileTemplate('javascript:{z}{x}{y}')).toThrow();
  });
  it('формат по сигнатуре', async () => {
    expect(detectFormat(await quadrantImage(8, 8))).toBe('png');
    expect(detectFormat(await quadrantImage(8, 8, 'jpeg'))).toBe('jpg');
    expect(detectFormat(Buffer.from('<html>'))).toBeNull();
  });
});

function repoSuite(name: string, open: () => Promise<{ repo: MapRepo; cleanup: () => Promise<void> }>, skip = false) {
  describe.skipIf(skip)(`хранилище: ${name}`, () => {
    it('незавершённые задания после перезапуска помечаются неудавшимися; изоляция', async () => {
      const { repo, cleanup } = await open();
      try {
        const now = new Date().toISOString();
        const base = { mapId: crypto.randomUUID(), type: 'xyz-download' as const, done: 0, total: 1, skipped: 0, errors: 0, createdAt: now, updatedAt: now };
        const a: MapJob = { ...base, id: crypto.randomUUID(), status: 'running' };
        const b: MapJob = { ...base, id: crypto.randomUUID(), status: 'done', createdAt: new Date(Date.now() + 1).toISOString() };
        await repo.saveJob('t1', a);
        await repo.saveJob('t1', b);
        expect((await repo.listJobs('t1')).map((j) => j.id)).toEqual([b.id, a.id]);
        expect(await repo.listJobs('t2')).toEqual([]);
        expect(await repo.failInterrupted('прервано')).toBe(1);
        expect(await repo.getJob('t1', a.id)).toMatchObject({ status: 'failed', message: 'прервано' });
        expect(await repo.getJob('t1', b.id)).toMatchObject({ status: 'done' });
        expect(await repo.getJob('t2', a.id)).toBeNull();

        const m: MapSource = {
          id: crypto.randomUUID(), name: 'Б', kind: 'xyz', format: 'png', tileSize: 256, minzoom: 0, maxzoom: 5,
          bounds: [13, 52, 14, 53], coverage: [[13, 52], [14, 52], [13.5, 53]], createdAt: now, updatedAt: now,
        };
        await repo.createMap('t1', m);
        await repo.createMap('t1', { ...m, id: crypto.randomUUID(), name: 'А', coverage: null });
        expect((await repo.listMaps('t1')).map((x) => x.name)).toEqual(['А', 'Б']);
        expect(await repo.getMap('t2', m.id)).toBeNull();
        expect(await repo.updateMap('t2', m)).toBeNull();
        expect(await repo.deleteMap('t2', m.id)).toBe(false);
        expect((await repo.updateMap('t1', { ...m, name: 'В' }))?.name).toBe('В');
        expect((await repo.getMap('t1', m.id))?.coverage).toEqual(m.coverage);
        if (repo instanceof PgRepo) {
          // охват и граница — ещё и геометрия PostGIS
          const r = await repo.pool.query(`select public.st_astext(bounds) b, public.st_npoints(coverage) n from ${repo.schema}.maps where id = $1`, [m.id]);
          expect(r.rows[0].b).toBe('POLYGON((13 52,13 53,14 53,14 52,13 52))');
          expect(r.rows[0].n).toBe(4);
        }
        expect(await repo.deleteMap('t1', m.id)).toBe(true);
        expect(await repo.getMap('t1', m.id)).toBeNull();
      } finally { await cleanup(); }
    });
  });
}

repoSuite('в памяти', async () => ({ repo: new MemoryRepo(), cleanup: async () => undefined }));
const url = process.env.DATABASE_URL;
repoSuite('PostgreSQL + PostGIS', async () => {
  const repo = await new PgRepo({ url, schema: `cartography_unit_${Math.random().toString(36).slice(2, 10)}` }).init(10_000);
  return { repo, cleanup: async () => { await repo.drop(); await repo.close(); } };
}, !url);
