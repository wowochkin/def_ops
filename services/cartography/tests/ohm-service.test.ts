/**
 * Карта OpenHistoricalMap сквозь службу: задание загрузки и нарезки, продолжение и обновление,
 * отмена и перезапуск (файловое хранилище), отдача тайлов, стиля, шрифтов и значков, пакет,
 * удаление; запросы к внешним источникам через прокси.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import path from 'node:path';
import { promises as fs, existsSync, readdirSync, readlinkSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import tar from 'tar-stream';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { tileOf, tileRange, type BBox, type LngLat, type MapJob, type MapSource, type OverpassJson } from '@def-ops/core';
import { persistent } from '@def-ops/service-kit';
import { MemoryRepo, type MapRepo } from '../src/repo';
import type { OhmOptions } from '../src/ohm';
import { httpClient, netMessage } from '../src/net';
import { A, B, fakeAsset, fakeOverpass, startService, tempDir, waitJob, type FakeOverpass, type Running } from './helpers';

const BBOX: BBox = [13.25, 52.4, 13.75, 52.65];
const BUILDING: LngLat = [13.393, 52.5167];
const TOTAL = 2 + tileRange(BBOX, 10).count + 1;
const bin = (b: Buffer) => new Uint8Array(b);

let fake: FakeOverpass;
let run: Running;
let opts: OhmOptions;
const extra: (() => Promise<void>)[] = [];

const cellsAB = (b: BBox): OverpassJson => (b[0] === 13.25 ? A : B);

beforeEach(async () => {
  fake = await fakeOverpass();
  fake.cells = cellsAB;
  opts = { overpassUrl: fake.url + '/api/interpreter', assetsUrl: fake.url + '/map-styles', pauseMs: 100, retries: 2, backoffMs: 20, timeoutMs: 2000 };
  run = await startService(new MemoryRepo(), { ohm: opts });
});
afterEach(async () => {
  for (const f of extra.splice(0)) await f();
  await run.close();
  await fake.close();
});

/* ---------------------------------- запросы ---------------------------------- */
const call = async (method: string, p: string, body?: unknown, tenant = 'orgA', headers: Record<string, string> = {}, r: Running = run) => {
  const res = await fetch(r.base + p, {
    method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let parsed: any = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
  return { status: res.status, body: parsed, headers: res.headers };
};
const get = (p: string, t?: string, r?: Running) => call('GET', p, undefined, t, {}, r);
const post = (p: string, b: unknown, t?: string, r?: Running) => call('POST', p, b, t, {}, r);
const raw = (p: string, init: RequestInit = {}, tenant = 'orgA', r: Running = run) =>
  fetch(r.base + p, { ...init, headers: { 'X-Tenant-Id': tenant, ...(init.headers as Record<string, string>) } });
const job = (id: string, t = 'orgA', r: Running = run) => waitJob(async (j) => (await get(`/cartography/jobs/${j}`, t, r)).body as MapJob, id, 30_000);
const overpassHits = () => fake.hits.filter((h) => h.path === '/api/interpreter');
const cellOf = (q?: string) => (q?.includes(',13.25,') ? 0 : 1);
const mapDir = (id: string, t = 'orgA', r: Running = run) => path.join(r.tilesDir, t, id);

async function tile(id: string, ll: LngLat, z: number, t = 'orgA', ext = 'pbf', r: Running = run) {
  const [x, y] = tileOf(ll, z);
  const res = await raw(`/cartography/maps/${id}/tiles/${z}/${x}/${y}.${ext}`, {}, t, r);
  const data = Buffer.from(await res.arrayBuffer()); // fetch уже распаковал gzip
  return { status: res.status, type: res.headers.get('content-type'), encoding: res.headers.get('content-encoding'), data };
}
const vt = (data: Buffer) => new VectorTile(new PbfReader(new Uint8Array(data)));

async function until(cond: () => Promise<boolean> | boolean, ms = 10_000) {
  const end = Date.now() + ms;
  while (!(await cond())) {
    if (Date.now() > end) throw new Error('условие не наступило');
    await new Promise((r) => setTimeout(r, 20));
  }
}

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await files(p))); else out.push(p);
  }
  return out;
}

/** Готовая карта OHM района BBOX. */
async function ready(t = 'orgA'): Promise<{ map: MapSource; job: MapJob }> {
  const r = await post('/cartography/maps/ohm', { name: 'Берлин OHM', bbox: BBOX }, t);
  expect(r.status).toBe(202);
  const j = await job(r.body.job.id, t);
  expect(j.status, j.message).toBe('done');
  return { map: (await get(`/cartography/maps/${r.body.map.id}`, t)).body, job: j };
}

async function untar(buf: Buffer): Promise<Map<string, Buffer>> {
  const ex = tar.extract();
  const out = new Map<string, Buffer>();
  const done = (async () => {
    for await (const e of ex) {
      const parts: Buffer[] = [];
      for await (const c of e) parts.push(c as Buffer);
      out.set(e.header.name, Buffer.concat(parts));
    }
  })();
  ex.end(buf);
  await done;
  return out;
}

async function pack(entries: [string, Buffer][]): Promise<Buffer> {
  const p = tar.pack();
  for (const [name, data] of entries) p.entry({ name }, data);
  p.finalize();
  const parts: Buffer[] = [];
  for await (const c of p) parts.push(c as Buffer);
  return Buffer.concat(parts);
}

/* ---------------------------------- тесты ---------------------------------- */
describe('карта OHM: задание', { timeout: 60_000 }, () => {
  it('создание и итог: карта, задание, кэш удалён, шрифты и значки', async () => {
    const r = await post('/cartography/maps/ohm', { name: 'Берлин OHM', bbox: BBOX });
    expect(r.status).toBe(202);
    expect(r.body.map).toMatchObject({ kind: 'vector', format: 'pbf', name: 'Берлин OHM' });
    expect(r.body.job).toMatchObject({ type: 'ohm-download', mapId: r.body.map.id, total: TOTAL });
    const j = await job(r.body.job.id);
    expect(j).toMatchObject({ status: 'done', total: TOTAL, done: TOTAL, skipped: 0 });
    expect(j.message).toMatch(/^Объектов 10, тайлов \d+, /);

    const m = (await get(`/cartography/maps/${r.body.map.id}`)).body as MapSource;
    expect(m).toMatchObject({ kind: 'vector', format: 'pbf', tileSize: 512, minzoom: 0, maxzoom: 16, bounds: BBOX, attribution: '© участники OpenHistoricalMap, CC0' });
    expect(m.ohm).toMatchObject({ bbox: BBOX, cells: 2, features: 10 });
    expect(m.ohm!.layers.roads).toBe(3);
    expect(Date.parse(m.ohm!.fetchedAt)).toBeGreaterThan(0);
    expect(m.stats!.tiles).toBeGreaterThan(0);
    expect(m.stats!.bytes).toBeGreaterThan(0);
    expect(m.description).toContain('10 объектов');
    expect(j.message).toContain(`тайлов ${m.stats!.tiles},`);

    const hits = overpassHits();
    expect(hits).toHaveLength(2);
    expect(hits[1].t - hits[0].t).toBeGreaterThanOrEqual(100);
    expect(existsSync(path.join(mapDir(m.id), '_ohm'))).toBe(false);
    expect(existsSync(path.join(mapDir(m.id), 'ohm.mbtiles'))).toBe(true);
    expect(await files(path.join(run.tilesDir, '.ohm-assets'))).toHaveLength(16);

    // список карт — из хранилища (без подсчёта тайлов)
    expect((await get('/cartography/maps')).body.find((x: MapSource) => x.id === m.id).stats).toEqual(m.stats);
  });

  it('отдача: тайлы pbf, стиль, TileJSON, шрифты, значки', async () => {
    const { map } = await ready();
    const t13 = await tile(map.id, BUILDING, 13);
    expect(t13.status).toBe(200);
    expect(t13.type).toBe('application/x-protobuf');
    expect(t13.encoding).toBe('gzip');
    expect(vt(t13.data).layers.buildings.length).toBe(1);
    const t12 = await tile(map.id, BUILDING, 12);
    if (t12.status === 200) expect(vt(t12.data).layers.buildings).toBeUndefined();
    else expect(t12.status).toBe(204);
    expect((await tile(map.id, [14.5, 53.2], 13)).status).toBe(204);
    expect((await tile(map.id, BUILDING, 13, 'orgA', 'png')).status).toBe(404);

    const st = await call('GET', `/cartography/maps/${map.id}/style`, undefined, 'orgA', { 'X-Forwarded-Prefix': '/api' });
    expect(st.status).toBe(200);
    expect(st.body.glyphs).toBe('/api/cartography/fonts/{fontstack}/{range}.pbf');
    expect(st.body.sprite).toBe('/api/cartography/sprites/ohm');
    expect(st.body.sources.ohm.tiles[0].startsWith(`/api/cartography/maps/${map.id}/tiles/{z}/{x}/{y}.pbf?v=`)).toBe(true);
    expect(validateStyleMin(st.body as StyleSpecification)).toEqual([]);
    const tj = (await get(`/cartography/maps/${map.id}/tilejson`)).body;
    expect(tj.format).toBe('pbf');
    expect(tj.tiles[0]).toContain('.pbf?v=');

    const font = await raw('/cartography/fonts/OpenHistorical%20Bold/1024-1279.pbf');
    expect(font.status).toBe(200);
    expect(Buffer.from(await font.arrayBuffer())).toEqual(fakeAsset('OpenHistorical Bold/1024-1279.pbf'));
    const empty = await raw('/cartography/fonts/OpenHistorical/60000-60255.pbf');
    expect(empty.status).toBe(200);
    expect((await empty.arrayBuffer()).byteLength).toBe(0);
    for (const p of ['Arial/0-255.pbf', 'OpenHistorical/0-300.pbf', '..%2F..%2Fx/0-255.pbf'])
      expect((await raw(`/cartography/fonts/${p}`)).status, p).toBe(404);
    const sprite = await raw('/cartography/sprites/ohm@2x.png');
    expect(sprite.status).toBe(200);
    expect(sprite.headers.get('content-type')).toBe('image/png');
    expect(Buffer.from(await sprite.arrayBuffer())).toEqual(fakeAsset('ohm@2x.png'));
    expect((await raw('/cartography/sprites/x.png')).status).toBe(404);
  });

  it('проверки: векторная карта только через /maps/ohm, рамка, граница, растровая карта', async () => {
    expect((await post('/cartography/maps', { name: 'В', kind: 'vector' })).status).toBe(422);
    expect((await post('/cartography/maps', { name: 'В', format: 'pbf' })).status).toBe(422);
    expect((await post('/cartography/maps/ohm', { bbox: BBOX })).status).toBe(422);
    expect((await post('/cartography/maps/ohm', { name: 'В', bbox: [13.75, 52.4, 13.25, 52.65] })).status).toBe(422);
    const big = await post('/cartography/maps/ohm', { name: 'В', bbox: [0, 0, 10, 30] });
    expect(big.status).toBe(422);
    expect(big.body.error.message).toContain('1000');
    expect((await get('/cartography/maps')).body).toEqual([]);

    const { map } = await ready();
    const patch = await call('PATCH', `/cartography/maps/${map.id}`, { coverage: [[13.3, 52.45], [13.5, 52.45], [13.4, 52.55]] });
    expect(patch.status).toBe(422);
    expect((await call('PATCH', `/cartography/maps/${map.id}`, { name: 'Берлин 1945' })).status).toBe(200);

    const xyz = await post('/cartography/maps', { name: 'Растр' });
    expect(xyz.status).toBe(201);
    expect((await post(`/cartography/maps/${xyz.body.id}/ohm`, {})).status).toBe(422);
  });

  it('частичный ответ Overpass: задание failed, кэш — только участок 1; «продолжить» — только участок 2', async () => {
    fake.script.set(1, ['remark', 'remark', 'remark']);
    const r = await post('/cartography/maps/ohm', { name: 'Берлин OHM', bbox: BBOX });
    const j = await job(r.body.job.id);
    expect(j.status).toBe('failed');
    expect(j.message).toContain('участок 2 из 2');
    const cells = path.join(mapDir(r.body.map.id), '_ohm', 'cells');
    expect(existsSync(path.join(cells, '0.json.gz'))).toBe(true);
    expect(existsSync(path.join(cells, '1.json.gz'))).toBe(false);
    expect((await tile(r.body.map.id, BUILDING, 13)).status).toBe(204); // карта ещё пустая

    fake.hits.length = 0;
    const c = await post(`/cartography/maps/${r.body.map.id}/ohm`, {});
    expect(c.status).toBe(202);
    expect(c.body).toMatchObject({ type: 'ohm-download', total: TOTAL });
    const j2 = await job(c.body.id);
    expect(j2).toMatchObject({ status: 'done', skipped: 1 });
    expect(overpassHits().map((h) => cellOf(h.query))).toEqual([1]);
    expect((await get(`/cartography/maps/${r.body.map.id}`)).body.ohm.features).toBe(10);
  });

  it('отмена «обновить»: прежняя карта байт в байт; «продолжить» — с недостающего участка; новый файл читается заново', async () => {
    const { map } = await ready();
    const before = await tile(map.id, BUILDING, 13);
    expect(before.status).toBe(200);
    const fetchedAt = map.ohm!.fetchedAt;

    // «обновить» с другими данными: у здания появилось имя
    const named: OverpassJson = { elements: A.elements!.map((e) => (e.id === 11 && e.type === 'way' ? { ...e, tags: { ...e.tags, name: 'Zeughaus' } } : e)) };
    fake.cells = (b) => (b[0] === 13.25 ? named : B);
    fake.delay = 400;
    fake.hits.length = 0;
    const r = await post(`/cartography/maps/${map.id}/ohm`, { refresh: true });
    expect(r.status).toBe(202);
    expect((await post(`/cartography/maps/${map.id}/ohm`, {})).status).toBe(409); // у карты уже идёт задание
    await until(() => existsSync(path.join(mapDir(map.id), '_ohm', 'cells', '0.json.gz')));
    expect((await post(`/cartography/jobs/${r.body.id}/cancel`, {})).status).toBe(202);
    expect((await job(r.body.id)).status).toBe('cancelled');

    const mid = (await get(`/cartography/maps/${map.id}`)).body as MapSource;
    expect(mid.kind).toBe('vector');
    expect(mid.ohm!.fetchedAt).toBe(fetchedAt);
    expect((await tile(map.id, BUILDING, 13)).data.equals(before.data)).toBe(true);

    fake.delay = 0;
    fake.hits.length = 0;
    const c = await post(`/cartography/maps/${map.id}/ohm`, {});
    const j = await job(c.body.id);
    expect(j).toMatchObject({ status: 'done', skipped: 1 });
    expect(overpassHits().map((h) => cellOf(h.query))).toEqual([1]);
    const after = (await get(`/cartography/maps/${map.id}`)).body as MapSource;
    expect(Date.parse(after.ohm!.fetchedAt)).toBeGreaterThan(Date.parse(fetchedAt));
    // читатель прежнего файла закрыт перед заменой: отдаётся новая нарезка
    const t = await tile(map.id, BUILDING, 13);
    expect(t.data.equals(before.data)).toBe(false);
    expect(vt(t.data).layers.buildings.feature(0).properties.name).toBe('Zeughaus');
  });

  it('перезапуск службы в файловом режиме посреди загрузки: задание failed, «продолжить» — с недостающего участка', async () => {
    const dir = await tempDir('ohm-file-');
    extra.push(() => fs.rm(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'a', 'cartography.json');
    const repo: MapRepo = await persistent(new MemoryRepo(), file);
    const run1 = await startService(repo, { ohm: opts }, path.join(dir, 'a', 'tiles'));
    fake.delay = 400;
    const r = await post('/cartography/maps/ohm', { name: 'Берлин OHM', bbox: BBOX }, 'orgA', run1);
    expect(r.status).toBe(202);
    const id = r.body.map.id as string, jobId = r.body.job.id as string;
    await until(async () => {
      let saved: any;
      try { saved = JSON.parse(await fs.readFile(file, 'utf8')); } catch { return false; }
      return saved.jobs?.orgA?.[jobId]?.status === 'running' && existsSync(path.join(mapDir(id, 'orgA', run1), '_ohm', 'cells', '0.json.gz'));
    });
    // «снимок упавшей машины»: файл описаний и папка тайлов как есть
    await fs.mkdir(path.join(dir, 'b'));
    await fs.copyFile(file, path.join(dir, 'b', 'cartography.json'));
    await fs.cp(path.join(dir, 'a', 'tiles'), path.join(dir, 'b', 'tiles'), { recursive: true });
    await run1.close();

    fake.delay = 0;
    fake.hits.length = 0;
    const repo2: MapRepo = await persistent(new MemoryRepo(), path.join(dir, 'b', 'cartography.json'));
    const run2 = await startService(repo2, { ohm: opts }, path.join(dir, 'b', 'tiles'));
    extra.unshift(() => run2.close());
    expect(await repo2.failInterrupted('Прервано перезапуском сервиса; запустите заново')).toBe(1);
    expect((await get(`/cartography/jobs/${jobId}`, 'orgA', run2)).body.status).toBe('failed');
    expect((await get('/cartography/maps', 'orgA', run2)).body.map((m: MapSource) => m.id)).toEqual([id]);

    const c = await post(`/cartography/maps/${id}/ohm`, {}, 'orgA', run2);
    expect(c.status).toBe(202);
    const j = await job(c.body.id, 'orgA', run2);
    expect(j).toMatchObject({ status: 'done', skipped: 1 });
    expect(overpassHits().map((h) => cellOf(h.query))).toEqual([1]);
    expect((await tile(id, BUILDING, 13, 'orgA', 'pbf', run2)).status).toBe(200);
  });

  it('пакет: map.json, ohm.mbtiles, шрифты и значки → другая организация байт в байт', async () => {
    const { map } = await ready();
    const ex = await raw(`/cartography/maps/${map.id}/package`);
    expect(ex.status).toBe(200);
    const tarBuf = Buffer.from(await ex.arrayBuffer());
    const entries = await untar(tarBuf);
    expect(entries.has('map.json')).toBe(true);
    expect(JSON.parse(entries.get('map.json')!.toString('utf8')).kind).toBe('vector');
    expect(entries.get('ohm.mbtiles')!.equals(await fs.readFile(path.join(mapDir(map.id), 'ohm.mbtiles')))).toBe(true);
    expect([...entries.keys()].filter((k) => k.startsWith('assets/fonts/'))).toHaveLength(12);
    expect(entries.get('assets/fonts/OpenHistorical/0-255.pbf')).toEqual(fakeAsset('OpenHistorical/0-255.pbf'));
    expect([...entries.keys()].filter((k) => k.startsWith('assets/sprites/'))).toHaveLength(4);
    expect(entries.has('assets/sprites/ohm.json')).toBe(true);

    await fs.rm(path.join(run.tilesDir, '.ohm-assets'), { recursive: true, force: true });
    const im = await raw('/cartography/maps/import-package', { method: 'POST', body: bin(tarBuf), headers: { 'Content-Type': 'application/x-tar' } }, 'orgB');
    expect(im.status).toBe(201);
    const { map: m2 } = await im.json() as { map: MapSource };
    expect(m2).toMatchObject({ kind: 'vector', format: 'pbf', tileSize: 512, maxzoom: 16, bounds: BBOX });
    expect(m2.ohm!.features).toBe(10);
    expect(m2.stats).toEqual(map.stats);
    const a = await tile(map.id, BUILDING, 13), b = await tile(m2.id, BUILDING, 13, 'orgB');
    expect(b.status).toBe(200);
    expect(b.data.equals(a.data)).toBe(true);
    const font = await raw('/cartography/fonts/OpenHistorical/0-255.pbf');
    expect(font.status).toBe(200);
    expect(Buffer.from(await font.arrayBuffer())).toEqual(fakeAsset('OpenHistorical/0-255.pbf'));

    // векторная карта без ohm.mbtiles — 422, карта не остаётся
    const only = await pack([['map.json', entries.get('map.json')!]]);
    const bad = await raw('/cartography/maps/import-package', { method: 'POST', body: bin(only) }, 'orgB');
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.message).toContain('ohm.mbtiles');
    expect((await get('/cartography/maps', 'orgB')).body.map((x: MapSource) => x.id)).toEqual([m2.id]);
  });

  it('удаление: папка карты с ohm.mbtiles удаляется, задание карты отменяется', async () => {
    const { map } = await ready();
    expect((await tile(map.id, BUILDING, 13)).status).toBe(200); // читатель открыт
    fake.delay = 400;
    const r = await post(`/cartography/maps/${map.id}/ohm`, { refresh: true });
    await until(() => overpassHits().length > 2);
    expect((await call('DELETE', `/cartography/maps/${map.id}`)).status).toBe(204);
    expect((await job(r.body.id)).status).toBe('cancelled');
    expect(existsSync(mapDir(map.id))).toBe(false);
    expect((await get(`/cartography/maps/${map.id}`)).status).toBe(404);
  });
});

/* ------------------------------ исправления ревью ------------------------------ */
/** Открытые процессом дескрипторы файла (Linux, /proc/self/fd). */
function openFds(file: string): number {
  let n = 0;
  for (const fd of readdirSync('/proc/self/fd')) {
    try { if (readlinkSync(`/proc/self/fd/${fd}`) === file) n++; } catch { /* закрыт */ }
  }
  return n;
}

describe('карта OHM: границы векторной карты', { timeout: 60_000 }, () => {
  it('загрузка XYZ и скана в векторную карту — 422, карта не меняется', async () => {
    const { map } = await ready();
    const xyz = await post(`/cartography/maps/${map.id}/import/xyz`, { url: `${fake.url}/tiles/{z}/{x}/{y}.png`, bounds: BBOX, minzoom: 10, maxzoom: 10 });
    expect(xyz.status).toBe(422);
    const georef = encodeURIComponent(JSON.stringify({ corners: [[13.3, 52.55], [13.5, 52.55], [13.5, 52.45], [13.3, 52.45]] }));
    const ras = await raw(`/cartography/maps/${map.id}/import/raster?georef=${georef}`, { method: 'POST', body: bin(Buffer.from([0x89, 0x50, 0x4e, 0x47])), headers: { 'Content-Type': 'image/png' } });
    expect(ras.status).toBe(422);
    const after = (await get(`/cartography/maps/${map.id}`)).body as MapSource;
    expect(after).toMatchObject({ kind: 'vector', format: 'pbf' });
    expect((await get(`/cartography/jobs?mapId=${map.id}`)).body).toHaveLength(1);
  });

  it('PATCH векторной карты: рамка и уровни не меняются (422), имя — можно', async () => {
    const { map } = await ready();
    for (const p of [{ bounds: [13.3, 52.45, 13.5, 52.55] }, { minzoom: 2 }, { maxzoom: 12 }])
      expect((await call('PATCH', `/cartography/maps/${map.id}`, p)).status, JSON.stringify(p)).toBe(422);
    expect((await call('PATCH', `/cartography/maps/${map.id}`, { name: 'Берлин', opacity: 0.5 })).status).toBe(200);
    expect((await get(`/cartography/maps/${map.id}`)).body).toMatchObject({ bounds: BBOX, minzoom: 0, maxzoom: 16 });
  });

  it('несколько запросов «продолжить» сразу — одно задание, остальные — 409', async () => {
    // хранилище с медленным чтением заданий: проверки двух запросов перекрываются
    class SlowRepo extends MemoryRepo {
      override async listJobs(tenant: string, mapId?: string) {
        const out = await super.listJobs(tenant, mapId);
        await new Promise((r) => setTimeout(r, 50)); // ответ запаздывает: другой запрос успевает прочитать то же
        return out;
      }
    }
    const slow = await startService(new SlowRepo(), { ohm: opts });
    extra.push(() => slow.close());
    const r0 = await post('/cartography/maps/ohm', { name: 'Берлин OHM', bbox: BBOX }, 'orgA', slow);
    expect((await job(r0.body.job.id, 'orgA', slow)).status).toBe('done');
    const id = r0.body.map.id as string;
    fake.delay = 200;
    const rs = await Promise.all(Array.from({ length: 3 }, () => post(`/cartography/maps/${id}/ohm`, {}, 'orgA', slow)));
    expect(rs.map((r) => r.status).sort()).toEqual([202, 409, 409]);
    const started = rs.find((r) => r.status === 202)!;
    expect((await job(started.body.id, 'orgA', slow)).status).toBe('done');
    expect((await get(`/cartography/jobs?mapId=${id}`, 'orgA', slow)).body).toHaveLength(2);
  });

  it.skipIf(process.platform !== 'linux')('прерванная выгрузка пакета: файл MBTiles закрыт, служба отвечает', async () => {
    const { map } = await ready();
    const file = path.join(mapDir(map.id), 'ohm.mbtiles');
    // большой файл, чтобы выгрузка не успела закончиться до обрыва
    await fs.appendFile(file, Buffer.alloc(64 * 1024 * 1024, 1));
    // журнал службы: обрыв клиента — не ошибка службы, выгрузка завершается тихо
    const logged: string[] = [];
    const write = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((s: string | Uint8Array, ...rest: unknown[]) => { logged.push(String(s)); return (write as (...a: unknown[]) => boolean)(s, ...rest); }) as typeof process.stdout.write;
    extra.push(async () => { process.stdout.write = write; });
    const ac = new AbortController();
    const res = await raw(`/cartography/maps/${map.id}/package`, { signal: ac.signal });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    await reader.read();
    ac.abort();
    await reader.cancel().catch(() => undefined);
    await until(() => openFds(file) === 0, 5000);
    await until(() => logged.some((l) => l.includes('/package') && l.includes('"level":"info"')), 5000); // обработчик завершился
    expect(logged.filter((l) => l.includes('"level":"error"'))).toEqual([]);
    expect((await get(`/cartography/maps/${map.id}`)).status).toBe(200);
  });

  it('пакет: ohm.mbtiles до map.json — 422, файлы не пишутся; негодные шрифты и значки не пишутся', async () => {
    const { map } = await ready();
    const entries = await untar(Buffer.from(await (await raw(`/cartography/maps/${map.id}/package`)).arrayBuffer()));
    const before = await pack([['ohm.mbtiles', entries.get('ohm.mbtiles')!], ['map.json', entries.get('map.json')!]]);
    const bad = await raw('/cartography/maps/import-package', { method: 'POST', body: bin(before) }, 'orgB');
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.message).toContain('map.json');
    expect((await get('/cartography/maps', 'orgB')).body).toEqual([]);
    expect(await fs.readdir(path.join(run.tilesDir, 'orgB')).catch(() => [])).toEqual([]);

    await fs.rm(path.join(run.tilesDir, '.ohm-assets'), { recursive: true, force: true });
    const junk = await pack([
      ['map.json', entries.get('map.json')!], ['ohm.mbtiles', entries.get('ohm.mbtiles')!],
      ['assets/fonts/OpenHistorical/0-255.pbf', Buffer.from('<html>не шрифт</html>')],
      ['assets/fonts/OpenHistorical/256-511.pbf', entries.get('assets/fonts/OpenHistorical/256-511.pbf')!],
      ['assets/sprites/ohm.png', Buffer.from('не PNG')],
      ['assets/sprites/ohm.json', Buffer.from('{не JSON')],
      ['assets/sprites/ohm@2x.json', entries.get('assets/sprites/ohm@2x.json')!],
    ]);
    const ok = await raw('/cartography/maps/import-package', { method: 'POST', body: bin(junk) }, 'orgB');
    expect(ok.status).toBe(201);
    const assets = path.join(run.tilesDir, '.ohm-assets');
    expect(existsSync(path.join(assets, 'fonts', 'OpenHistorical', '0-255.pbf'))).toBe(false);
    expect(existsSync(path.join(assets, 'sprites', 'ohm.png'))).toBe(false);
    expect(existsSync(path.join(assets, 'sprites', 'ohm.json'))).toBe(false);
    expect(await fs.readFile(path.join(assets, 'fonts', 'OpenHistorical', '256-511.pbf'))).toEqual(fakeAsset('OpenHistorical/256-511.pbf'));
    expect(await fs.readFile(path.join(assets, 'sprites', 'ohm@2x.json'))).toEqual(fakeAsset('ohm@2x.json'));
  });
});

/* ---------------------------------- прокси ---------------------------------- */
describe('запросы к источникам через прокси', () => {
  it('HTTP_PROXY: запрос идёт через прокси; NO_PROXY — напрямую', async () => {
    const seen: string[] = [];
    const proxy = http.createServer((req, res) => { seen.push(`${req.headers.host} ${req.url}`); res.writeHead(200).end('через прокси'); });
    // туннель CONNECT: ответ «соединение установлено», дальше — тот же сервер на сокете туннеля
    proxy.on('connect', (req, socket) => {
      seen.push(`CONNECT ${req.url}`);
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      proxy.emit('connection', socket);
    });
    await new Promise<void>((r) => proxy.listen(0, '127.0.0.1', () => r()));
    const purl = `http://127.0.0.1:${(proxy.address() as AddressInfo).port}`;
    try {
      const c = httpClient({ HTTP_PROXY: purl, NO_PROXY: '' });
      expect(c.proxy).toBe(purl);
      const r = await c.fetch('http://ohm.example/api/interpreter');
      expect(await r.text()).toBe('через прокси');
      expect(seen).toEqual(['CONNECT ohm.example:80', 'ohm.example /api/interpreter']);

      const direct = httpClient({ HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '127.0.0.1' });
      expect(await (await direct.fetch(`${purl}/x`)).text()).toBe('через прокси');
      expect(seen).toHaveLength(3);
      expect(seen[2]).toMatch(/^127\.0\.0\.1:\d+ \/x$/);
      expect(httpClient({}).proxy).toBeNull();
      // пустой NO_PROXY не прячет no_proxy
      const lower = httpClient({ HTTP_PROXY: 'http://127.0.0.1:1', NO_PROXY: '', no_proxy: '127.0.0.1' });
      expect(await (await lower.fetch(`${purl}/y`)).text()).toBe('через прокси');
    } finally {
      await new Promise<void>((r) => proxy.close(() => r()));
    }
  });

  it('сообщение об ошибке: код причины и прокси (без учётных данных)', async () => {
    const closed = http.createServer();
    await new Promise<void>((r) => closed.listen(0, '127.0.0.1', () => r()));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));

    const e1 = await httpClient({}).fetch(`http://127.0.0.1:${port}/`).catch((e) => e);
    expect(netMessage(e1, null)).toContain('ECONNREFUSED');
    expect(netMessage(e1, null)).not.toContain('прокси');

    const c = httpClient({ HTTPS_PROXY: `http://user:secret@127.0.0.1:${port}`, NO_PROXY: '' });
    const e2 = await c.fetch('https://ohm.example/').catch((e) => e);
    const msg = netMessage(e2, c.proxy);
    expect(msg).toContain('ECONNREFUSED');
    expect(msg).toContain(`через прокси 127.0.0.1:${port}`);
    expect(msg).not.toContain('secret');
  });
});
