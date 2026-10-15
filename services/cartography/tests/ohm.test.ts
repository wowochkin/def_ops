/** OpenHistoricalMap: участки Overpass (запрос, проверка ответа, повторы, кэш), шрифты и значки, объекты по слоям. */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { ohmCells, type BBox, type MapJob, type OverpassJson } from '@def-ops/core';
import { CancelledError, type JobContext } from '../src/jobs';
import { USER_AGENT } from '../src/xyz';
import {
  cellQuery, downloadCells, ensureAssets, overpassCheck, OhmCellCache, OHM_DEFAULTS, OHM_FONTS, OHM_RANGES, OHM_SPRITES, responseLimitText, type OhmOptions,
} from '../src/ohm';
import { classify, isArea, ohmDescription, OhmCollector, OHM_LAYERS, type OhmFeature } from '../src/ohm-features';
import type { Polygon } from 'geojson';
import { A, B, defaultCell, fakeAsset, fakeOverpass, tempDir, type FakeOverpass } from './helpers';

function ctx(): { ctx: JobContext; ac: AbortController } {
  const ac = new AbortController();
  const job: MapJob = { id: 'j', mapId: 'm', type: 'ohm-download', status: 'running', done: 0, total: 0, skipped: 0, errors: 0, createdAt: '', updatedAt: '' };
  const c: JobContext = {
    job, tenant: 't', signal: ac.signal, progress: (p) => Object.assign(job, p),
    check: () => { if (ac.signal.aborted) throw new CancelledError(); },
  };
  return { ctx: c, ac };
}

const BOX: BBox = [13.0, 52.0, 13.75, 52.25];
const CELLS = ohmCells(BOX);

let fake: FakeOverpass;
let dir = '';
let opts: OhmOptions;
beforeEach(async () => {
  fake = await fakeOverpass();
  dir = await tempDir('ohm-');
  opts = { overpassUrl: fake.url + '/api/interpreter', assetsUrl: fake.url + '/map-styles', pauseMs: 80, retries: 2, backoffMs: 20, timeoutMs: 2000 };
});
afterEach(async () => {
  await fake.close();
  await fs.rm(dir, { recursive: true, force: true });
});

async function openCache(): Promise<OhmCellCache> {
  const c = new OhmCellCache(path.join(dir, '_ohm'));
  await c.open(BOX, 0.25, CELLS.length);
  return c;
}
const cellOf = (q?: string) => CELLS.findIndex((b) => cellQuery(b) === q);

describe('запрос и ответ Overpass', () => {
  it('cellQuery — рамка юг, запад, север, восток', () => {
    expect(CELLS).toHaveLength(3);
    expect(cellQuery([11, 50.9, 11.25, 51.15])).toBe(
      '[out:json][timeout:180];(node(50.9,11,51.15,11.25)(if:count_tags()>0);way(50.9,11,51.15,11.25););out body geom;rel(50.9,11,51.15,11.25);out body;',
    );
  });

  it('overpassCheck: годен, повтор, ошибка сразу', () => {
    const ok = overpassCheck(200, '{"elements":[]}');
    expect(ok).toEqual({ ok: true, json: { elements: [] } });
    const remark = overpassCheck(200, '{"remark":"runtime error: Query timed out in \\"query\\" at line 1 after 181 seconds.","elements":[{"type":"node","id":1}]}');
    expect(remark).toMatchObject({ ok: false, retry: true });
    expect(!remark.ok && remark.message).toMatch(/runtime error/);
    expect(overpassCheck(200, '<html><body>busy</body></html>')).toMatchObject({ ok: false, retry: true });
    expect(overpassCheck(429, '')).toMatchObject({ ok: false, retry: true });
    expect(overpassCheck(504, '')).toMatchObject({ ok: false, retry: true });
    expect(overpassCheck(400, 'Error: line 1: parse error')).toMatchObject({ ok: false, retry: false });
    expect(overpassCheck(200, '{"foo":1}')).toMatchObject({ ok: false, retry: true });
  });
});

describe('downloadCells', () => {
  it('по участку за запрос, пауза между запросами, User-Agent, кэш и ход задания', async () => {
    const cache = await openCache();
    const { ctx: c } = ctx();
    const r = await downloadCells(c, CELLS, cache, opts);
    expect(fake.hits).toHaveLength(3);
    for (let i = 0; i < 3; i++) {
      expect(fake.hits[i].ua).toBe(USER_AGENT);
      expect(fake.hits[i].query).toBe(cellQuery(CELLS[i]));
      if (i) expect(fake.hits[i].t - fake.hits[i - 1].t).toBeGreaterThanOrEqual(80);
    }
    for (let i = 0; i < 3; i++) await fs.access(path.join(dir, '_ohm', 'cells', `${i}.json.gz`));
    expect(r).toEqual({ fetched: 3, cached: 0, elements: 6 });
    expect(c.job.done).toBe(3);
    expect(c.job.message).toBe('участок 3 из 3, объектов 6');
    expect((await cache.read(1)).elements).toHaveLength(2);
  });

  it('429 — повтор, задание идёт дальше', async () => {
    fake.script.set(1, ['429', '429']);
    const r = await downloadCells(ctx().ctx, CELLS, await openCache(), opts);
    expect(fake.hits).toHaveLength(5);
    expect(r.fetched).toBe(3);
  });

  it('400 — ошибка сразу, без повтора', async () => {
    fake.script.set(1, ['400']);
    const cache = await openCache();
    await expect(downloadCells(ctx().ctx, CELLS, cache, opts)).rejects.toThrow(/участок 2 из 3/);
    expect(fake.hits.map((h) => cellOf(h.query))).toEqual([0, 1]);
    expect(await cache.has(0)).toBe(true);
    expect(await cache.has(1)).toBe(false);
  });

  it.each(['remark', 'html'] as const)('частичный ответ (%s) не ложится в кэш; «продолжить» — только недостающие', async (fault) => {
    fake.script.set(1, [fault, fault, fault]);
    const cache = await openCache();
    const err = await downloadCells(ctx().ctx, CELLS, cache, opts).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/участок 2 из 3/);
    if (fault === 'remark') expect((err as Error).message).toMatch(/runtime error/);
    expect(await cache.has(0)).toBe(true);
    expect(await cache.has(1)).toBe(false);
    expect(await cache.has(2)).toBe(false);
    expect(fake.hits.map((h) => cellOf(h.query))).toEqual([0, 1, 1, 1]);

    // сервер исправлен — тот же кэш
    fake.hits.length = 0;
    const again = await openCache();
    const { ctx: c } = ctx();
    const r = await downloadCells(c, CELLS, again, opts);
    expect(fake.hits.map((h) => cellOf(h.query))).toEqual([1, 2]);
    expect(r).toMatchObject({ fetched: 2, cached: 1, elements: 6 });
    // участок из кэша — пропущен, а не сделан: ход done + skipped не больше числа участков
    expect(c.job.skipped).toBe(1);
    expect(c.job.done).toBe(2);
    expect(c.job.done + c.job.skipped).toBe(CELLS.length);
  });

  it.each([false, true])('ответ больше предела (потоком: %s) — участок не скачан, без повтора, понятное сообщение', async (chunked) => {
    const big: OverpassJson = { elements: [{ type: 'node', id: 1, lat: 52.1, lon: 13.3, tags: { place: 'city', name: 'Б'.repeat(6000) } }] };
    fake.cells = (b) => (b[0] === CELLS[1][0] ? big : defaultCell(b));
    fake.chunked = chunked;
    const cache = await openCache();
    const err = await downloadCells(ctx().ctx, CELLS, cache, { ...opts, maxResponseBytes: 4096 }).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/^участок 2 из 3: ответ Overpass больше 4 КиБ/);
    expect(fake.hits.map((h) => cellOf(h.query))).toEqual([0, 1]);
    expect(await cache.has(0)).toBe(true);
    expect(await cache.has(1)).toBe(false);
  });

  it('предел ответа по умолчанию — 256 МиБ', () => {
    expect(OHM_DEFAULTS.maxResponseBytes).toBe(256 * 1024 * 1024);
    expect(responseLimitText(256 * 1024 * 1024)).toBe('256 МиБ');
  });

  it('отмена во время паузы — CancelledError, участка нет', async () => {
    const { ctx: c, ac } = ctx();
    const cache = await openCache();
    const base = fake.cells;
    fake.cells = (b) => { setTimeout(() => ac.abort(), 20); return base(b); };
    await expect(downloadCells(c, CELLS, cache, opts)).rejects.toBeInstanceOf(CancelledError);
    expect(fake.hits).toHaveLength(1);
    expect(await cache.has(0)).toBe(true);
    expect(await cache.has(1)).toBe(false);
  });

  it('повреждённый участок в кэше удаляется и скачивается заново; ответы участков — в onCell по порядку', async () => {
    const cache = await openCache();
    await cache.write(0, fake.cells(CELLS[0]));
    await fs.mkdir(path.join(dir, '_ohm', 'cells'), { recursive: true });
    await fs.writeFile(path.join(dir, '_ohm', 'cells', '1.json.gz'), Buffer.from('не gzip'));
    const seen: [number, number][] = [];
    const { ctx: c } = ctx();
    const r = await downloadCells(c, CELLS, cache, opts, (i, json: OverpassJson) => seen.push([i, json.elements?.length ?? 0]));
    expect(fake.hits.map((h) => cellOf(h.query))).toEqual([1, 2]);
    expect(r).toMatchObject({ fetched: 2, cached: 1, elements: 6 });
    expect(c.job.skipped).toBe(1);
    expect((await cache.read(1)).elements).toHaveLength(2);
    expect(seen).toEqual([[0, 2], [1, 2], [2, 2]]);
  });

  it('кэш другой рамки очищается', async () => {
    const cache = await openCache();
    await cache.write(0, { elements: [] });
    expect(await (await openCache()).has(0)).toBe(true);
    const other = new OhmCellCache(path.join(dir, '_ohm'));
    await other.open([13.0, 52.0, 13.5, 52.25], 0.25, 2);
    expect(await other.has(0)).toBe(false);
  });
});

describe('ensureAssets', () => {
  it('12 шрифтов и 4 файла значков; второй раз — без запросов', async () => {
    const a = path.join(dir, '.ohm-assets');
    expect(await ensureAssets(a, opts)).toEqual({ fetched: 16 });
    expect(fake.hits).toHaveLength(16);
    expect(OHM_FONTS.length * OHM_RANGES.length + OHM_SPRITES.length).toBe(16);
    expect(await fs.readFile(path.join(a, 'fonts', 'OpenHistorical Bold', '1024-1279.pbf'))).toEqual(fakeAsset('OpenHistorical Bold/1024-1279.pbf'));
    expect(await fs.readFile(path.join(a, 'sprites', 'ohm@2x.png'))).toEqual(fakeAsset('ohm@2x.png'));
    expect(await fs.readFile(path.join(a, 'sprites', 'ohm.json'))).toEqual(fakeAsset('ohm.json'));
    fake.hits.length = 0;
    expect(await ensureAssets(a, opts)).toEqual({ fetched: 0 });
    expect(fake.hits).toHaveLength(0);
  });
});

/* ------------------------------- объекты ------------------------------- */

function check(list: OhmFeature[]) {
  expect(list).toHaveLength(10);
  const byLayer: Record<string, number> = {};
  for (const f of list) byLayer[f.properties.layer] = (byLayer[f.properties.layer] ?? 0) + 1;
  expect(byLayer).toEqual({ places: 1, pois: 1, roads: 3, rail: 1, buildings: 1, landuse: 1, water: 1, boundaries: 1 });
  const id = (s: string) => list.filter((f) => f.properties.id === s);

  expect(id('w10')).toHaveLength(1);
  expect(id('w10')[0].geometry.type).toBe('LineString');
  expect(id('w10')[0].properties).toMatchObject({ layer: 'roads', class: 'primary', bridge: 1, from: 1647, minzoom: 0, name: 'Unter den Linden' });
  expect(id('w10')[0].geometry.coordinates).toEqual([[13.45, 52.52], [13.55, 52.52]]);
  expect(id('w18')[0].properties).toMatchObject({ class: 'footway', minzoom: 13 });
  expect(id('w19')[0].properties).toMatchObject({ class: 'residential', minzoom: 10 });
  for (const w of ['w18', 'w19']) { expect(id(w)[0].properties.from).toBeUndefined(); expect(id(w)[0].properties.to).toBeUndefined(); }
  expect(id('w20')[0].properties).toMatchObject({ layer: 'rail', class: 'rail', minzoom: 0, from: 1842 });

  const bld = id('w11')[0];
  expect(bld.geometry.type).toBe('Polygon');
  expect(bld.properties).toMatchObject({ layer: 'buildings', class: 'yes', minzoom: 13, from: 1706 });
  expect(bld.properties.to).toBeCloseTo(1945.989, 3);

  const forest = id('r100/0')[0];
  expect(forest.geometry.type).toBe('Polygon');
  const rings = (forest.geometry as Polygon).coordinates;
  expect(rings).toHaveLength(2);
  expect(rings[0]).toHaveLength(5);
  expect(rings[0][0]).toEqual(rings[0][4]);
  expect(forest.properties).toMatchObject({ layer: 'landuse', class: 'forest', minzoom: 8 });
  expect(forest.properties.from).toBeCloseTo(1900.3288, 4);

  const water = id('r101/0')[0];
  expect(water.properties).toMatchObject({ layer: 'water', class: 'water', minzoom: 0, name: 'Rummelsburger See' });
  expect((water.geometry as Polygon).coordinates[0][0]).toEqual([13.60, 52.45]);

  const bnd = list.filter((f) => f.properties.layer === 'boundaries')[0];
  expect(bnd.geometry.type).toBe('LineString');
  expect(bnd.properties.id).toBe('w16/0');
  expect(bnd.properties).toMatchObject({ class: 'country', admin_level: 2, minzoom: 0 });
  expect(bnd.properties.from).toBeCloseTo(1938.1945, 4);
  expect(bnd.properties.to).toBeCloseTo(1945.3479, 4);

  const berlin = id('n1')[0];
  expect(berlin.geometry).toEqual({ type: 'Point', coordinates: [13.40, 52.52] });
  expect(berlin.properties).toMatchObject({ layer: 'places', class: 'city', minzoom: 0, name: 'Berlin', from: 1237 });
  expect(id('n3')[0].properties).toMatchObject({ layer: 'pois', class: 'place_of_worship', minzoom: 13 });
}

describe('OhmCollector', () => {
  it('отношения из путей двух участков, недостающий член, дубликаты на стыке', () => {
    const c = new OhmCollector();
    expect(c.add(A)).toBe(12);
    expect(c.add(B)).toBe(4);
    expect(c.counts).toEqual({ nodes: 2, ways: 10, relations: 4 });
    check(c.features());
  });

  it('порядок участков не важен', () => {
    const c = new OhmCollector();
    c.add(B); c.add(A);
    expect(c.counts).toEqual({ nodes: 2, ways: 10, relations: 4 });
    check(c.features());
  });

  it('хранит только нужное: у путей нет nodes и bounds (память)', () => {
    const c = new OhmCollector();
    const way = { type: 'way', id: 7, tags: { highway: 'track' }, nodes: [1, 2], bounds: { minlat: 52, minlon: 13, maxlat: 52.1, maxlon: 13.1 },
      geometry: [{ lat: 52, lon: 13 }, { lat: 52.1, lon: 13.1 }] };
    c.add({ elements: [way] } as unknown as OverpassJson);
    const kept = (c as unknown as { ways: Map<number, Record<string, unknown>> }).ways.get(7)!;
    expect(Object.keys(kept).sort()).toEqual(['geometry', 'id', 'tags', 'type']);
    expect(c.features()).toHaveLength(1);
  });

  it('границы: путь в отношениях разных лет — один признак на слитый промежуток, геометрия общая', () => {
    const c = new OhmCollector();
    const rel = (id: number, from: string, to: string, ways = [16]) => ({
      type: 'relation' as const, id, tags: { type: 'boundary', boundary: 'administrative', admin_level: '2', name: `Г${id}`, start_date: from, end_date: to },
      members: ways.map((ref) => ({ type: 'way' as const, ref, role: 'outer' })),
    });
    c.add({ elements: [
      { type: 'way', id: 16, geometry: [{ lon: 13.30, lat: 52.45 }, { lon: 13.35, lat: 52.47 }] },
      { type: 'way', id: 17, geometry: [{ lon: 13.35, lat: 52.47 }, { lon: 13.40, lat: 52.48 }] },
      rel(200, '1900', '1918', [16, 17]), rel(201, '1918', '1937'), rel(202, '1945', '1990'),
      // другой уровень — свой признак
      { type: 'relation', id: 203, tags: { type: 'boundary', boundary: 'administrative', admin_level: '6', start_date: '1920', end_date: '1950' }, members: [{ type: 'way', ref: 16, role: 'outer' }] },
    ] });
    const bnd = c.features().filter((f) => f.properties.layer === 'boundaries');
    const w16 = bnd.filter((f) => f.properties.id.startsWith('w16') && f.properties.admin_level === 2);
    expect(w16).toHaveLength(2);
    expect(w16[0].properties.from).toBeCloseTo(1900, 4);
    expect(w16[0].properties.to).toBeCloseTo(1937.989, 3);
    expect(w16[1].properties.from).toBeCloseTo(1945, 4);
    expect(w16[1].properties.to).toBeCloseTo(1990.989, 3);
    expect(w16[0].geometry).toBe(w16[1].geometry); // координаты не копируются
    expect(w16[0].properties.name).toBeUndefined(); // имена отношений разные
    expect(bnd.filter((f) => f.properties.id.startsWith('w16') && f.properties.admin_level === 6)).toHaveLength(1);
    expect(bnd.filter((f) => f.properties.id.startsWith('w17'))).toHaveLength(1);
    expect(bnd.find((f) => f.properties.id.startsWith('w17'))!.properties.name).toBe('Г200');
    expect(bnd).toHaveLength(4);
  });

  it('границы: открытый конец поглощает промежутки', () => {
    const c = new OhmCollector();
    const rel = (id: number, tags: Record<string, string>) => ({
      type: 'relation' as const, id, tags: { type: 'boundary', boundary: 'administrative', admin_level: '4', ...tags }, members: [{ type: 'way' as const, ref: 1, role: 'outer' }],
    });
    c.add({ elements: [
      { type: 'way', id: 1, geometry: [{ lon: 13, lat: 52 }, { lon: 13.1, lat: 52.1 }] },
      rel(1, { start_date: '1900', end_date: '1910' }), rel(2, { end_date: '1880' }), rel(3, { start_date: '1950' }), rel(4, { start_date: '1870', end_date: '1960' }),
    ] });
    const bnd = c.features().filter((f) => f.properties.layer === 'boundaries');
    expect(bnd).toHaveLength(1);
    expect(bnd[0].properties.from).toBeUndefined();
    expect(bnd[0].properties.to).toBeUndefined();
  });

  it('значимое место — только с именем', () => {
    const c = new OhmCollector();
    c.add({ elements: [{ type: 'node', id: 5, lat: 52, lon: 13, tags: { historic: 'castle' } }] });
    expect(c.features()).toEqual([]);
  });
});

describe('описание карты', () => {
  it('число объектов и участков со склонением', () => {
    expect(ohmDescription(94373, 285)).toBe('OpenHistoricalMap: 94\u00a0373 объекта, 285 участков');
    expect(ohmDescription(1, 1)).toBe('OpenHistoricalMap: 1 объект, 1 участок');
  });
});

describe('classify / isArea', () => {
  it('по таблице слоёв', () => {
    expect(OHM_LAYERS).toEqual(['roads', 'rail', 'water', 'landuse', 'buildings', 'boundaries', 'places', 'pois']);
    expect(classify({ highway: 'primary_link' }, 'line')).toEqual({ layer: 'roads', class: 'primary_link', minzoom: 0 });
    expect(classify({ railway: 'abandoned' }, 'line')).toBeNull();
    expect(classify({ amenity: 'grave_yard' }, 'area')).toEqual({ layer: 'landuse', class: 'cemetery', minzoom: 8 });
    expect(classify({ waterway: 'stream' }, 'line')).toMatchObject({ layer: 'water', class: 'stream', minzoom: 10 });
    expect(classify({ place: 'village' }, 'point')).toEqual({ layer: 'places', class: 'village', minzoom: 8 });
    expect(classify({ historic: 'castle' }, 'point')).toEqual({ layer: 'pois', class: 'castle', minzoom: 13 });
    expect(classify({ railway: 'halt' }, 'point')).toEqual({ layer: 'pois', class: 'station', minzoom: 13 });
    expect(classify({ landuse: 'reservoir' }, 'area')).toEqual({ layer: 'water', class: 'water', minzoom: 0 });
    expect(classify({ boundary: 'administrative', admin_level: '6' }, 'line')).toEqual({ layer: 'boundaries', class: 'admin', minzoom: 8 });
    expect(classify({ building: 'no' }, 'area')).toBeNull();
    expect(isArea({ highway: 'pedestrian', area: 'yes' })).toBe(false);
    expect(isArea({ building: 'yes' })).toBe(true);
    expect(isArea({ highway: 'residential' })).toBe(false);
  });
});
