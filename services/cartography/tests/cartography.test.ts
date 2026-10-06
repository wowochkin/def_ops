/**
 * Поведение сервиса картографии. Один и тот же набор тестов выполняется для
 * хранилища в памяти и для PostgreSQL/PostGIS (только если задан DATABASE_URL;
 * схема — временная cartography_test_<случайное>, удаляется после тестов).
 * Тайлы — во временном каталоге; внешний источник XYZ — поддельный сервер.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import tar from 'tar-stream';
import {
  georefFromCorners, mercator, pixelToLngLat, formatScale, scaleDenominator, tileCount, tileOf,
  type LngLat, type MapJob, type MapSource,
} from '@def-ops/core';
import { MemoryRepo, type MapRepo } from '../src/repo';
import { PgRepo } from '../src/pg-repo';
import { USER_AGENT, tilesOf } from '../src/xyz';
import { coverageKey } from '../src/coverage';
import {
  QUADRANTS, alphaStats, fakeTileServer, near, pixel, quadrantImage, startService, waitJob,
  type FakeTileServer, type Running,
} from './helpers';

/** Двоичное тело запроса для fetch. */
const bin = (b: Buffer) => new Uint8Array(b);

type Setup = () => Promise<{ repo: MapRepo; cleanup: () => Promise<void> }>;

/** Углы синтетического скана (район Берлина): ЛВ, ПВ, ПН, ЛН. */
const CORNERS: [LngLat, LngLat, LngLat, LngLat] = [[13.3, 52.55], [13.5, 52.55], [13.5, 52.45], [13.3, 52.45]];
const W = 1200, H = 900;

/** Адрес тайла и пиксель в нём для точки на уровне z (тайл 256). */
function locate(ll: LngLat, z: number, T = 256) {
  const [x, y] = tileOf(ll, z);
  const m = mercator(ll);
  return { z, x, y, px: (m[0] * 2 ** z - x) * T, py: (m[1] * 2 ** z - y) * T };
}

function behaviour(name: string, setup: Setup, skip = false) {
  describe.skipIf(skip)(`картография: ${name}`, { timeout: 30_000 }, () => {
    let run: Running;
    let fake: FakeTileServer;
    let done: () => Promise<void> = async () => undefined;

    beforeAll(async () => {
      const { repo, cleanup } = await setup();
      run = await startService(repo, { maxTilesPerJob: 2000, xyz: { retries: 2, backoffMs: 20, timeoutMs: 2000, concurrency: 3 } });
      fake = await fakeTileServer();
      done = async () => { await fake.close(); await run.close(); await cleanup(); };
    });
    afterAll(() => done());

    const call = async (method: string, p: string, body?: unknown, tenant = 'orgA', headers: Record<string, string> = {}) => {
      const r = await fetch(run.base + p, {
        method, headers: { 'Content-Type': 'application/json', 'X-Tenant-Id': tenant, ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await r.text();
      let parsed: any = null;
      try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
      return { status: r.status, body: parsed, headers: r.headers };
    };
    const get = (p: string, t?: string) => call('GET', p, undefined, t);
    const post = (p: string, b: unknown, t?: string) => call('POST', p, b, t);
    const raw = (p: string, init: RequestInit = {}, tenant = 'orgA') =>
      fetch(run.base + p, { ...init, headers: { 'X-Tenant-Id': tenant, ...(init.headers as Record<string, string>) } });
    const job = (id: string, t = 'orgA') => waitJob(async (j) => (await get(`/cartography/jobs/${j}`, t)).body as MapJob, id);
    const tileBytes = async (mapId: string, z: number, x: number, y: number, t = 'orgA', headers: Record<string, string> = {}) => {
      const r = await raw(`/cartography/maps/${mapId}/tiles/${z}/${x}/${y}.png`, { headers }, t);
      return { status: r.status, type: r.headers.get('content-type'), etag: r.headers.get('etag'), cache: r.headers.get('cache-control'), data: Buffer.from(await r.arrayBuffer()) };
    };
    const newMap = async (over: Record<string, unknown> = {}, t = 'orgA') => {
      const r = await post('/cartography/maps', { name: 'Берлин', ...over }, t);
      expect(r.status).toBe(201);
      return r.body as MapSource;
    };

    /* ------------------------------------- карты ------------------------------------- */
    it('карты: создание, проверка, изменение, изоляция организаций, удаление', async () => {
      const m = await newMap({ name: 'План Берлина 1945', description: 'Скан', attribution: 'etomesto.ru', date: '1945', tileSize: 512, bounds: [13.2, 52.4, 13.6, 52.6], opacity: 0.8 });
      expect(m).toMatchObject({ name: 'План Берлина 1945', kind: 'xyz', format: 'png', tileSize: 512, minzoom: 0, maxzoom: 18, coverage: null, opacity: 0.8, stats: { tiles: 0, bytes: 0 } });
      expect(m.id).toMatch(/^[0-9a-f-]{36}$/);

      const bad = async (b: unknown) => (await post('/cartography/maps', b)).status;
      expect(await bad({ description: 'без названия' })).toBe(422);
      expect(await bad({ name: 'x', bounds: [13.6, 52.4, 13.2, 52.6] })).toBe(422);
      expect(await bad({ name: 'x', minzoom: 12, maxzoom: 10 })).toBe(422);
      expect(await bad({ name: 'x', maxzoom: 23 })).toBe(422);
      expect(await bad({ name: 'x', coverage: [[13, 52], [13.1, 52]] })).toBe(422);
      expect(await bad({ name: 'x', tileSize: 300 })).toBe(422);
      expect(await bad({ name: 'x', kind: 'package' })).toBe(422);
      expect(await bad([1])).toBe(400);

      const p = await call('PATCH', `/cartography/maps/${m.id}`, {
        name: 'План Берлина', coverage: [[13.3, 52.45], [13.5, 52.45], [13.5, 52.55], [13.3, 52.55], [13.3, 52.45]], opacity: 0.5, minzoom: 10, maxzoom: 16, id: 'игнорируется',
      });
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject({ id: m.id, name: 'План Берлина', opacity: 0.5, minzoom: 10, maxzoom: 16, tileSize: 512 });
      expect(p.body.coverage).toHaveLength(4); // замыкающая точка снята
      expect(Date.parse(p.body.updatedAt)).toBeGreaterThan(Date.parse(m.updatedAt!));
      expect((await call('PATCH', `/cartography/maps/${m.id}`, { stats: { tiles: 1 }, secret: 1 })).status).toBe(422);
      expect((await call('PATCH', `/cartography/maps/${m.id}`, { maxzoom: 5 })).status).toBe(422);
      expect((await call('PATCH', `/cartography/maps/${m.id}`, { coverage: null })).body.coverage).toBeNull();

      // другая организация карту не видит
      expect((await get(`/cartography/maps/${m.id}`, 'orgB')).status).toBe(404);
      expect((await get('/cartography/maps', 'orgB')).body).toEqual([]);
      expect((await call('PATCH', `/cartography/maps/${m.id}`, { name: 'чужая' }, 'orgB')).status).toBe(404);
      expect((await call('DELETE', `/cartography/maps/${m.id}`, undefined, 'orgB')).status).toBe(404);
      expect((await get('/cartography/maps')).body.map((x: MapSource) => x.id)).toContain(m.id);

      expect((await call('DELETE', `/cartography/maps/${m.id}`)).status).toBe(204);
      expect((await get(`/cartography/maps/${m.id}`)).status).toBe(404);
      expect((await get('/cartography/maps/не-uuid')).status).toBe(404);
    });

    it('события (SSE) — только своей организации', async () => {
      const ctl = new AbortController();
      const got: string[] = [];
      const stream = await fetch(run.base + '/cartography/events', { headers: { 'X-Tenant-Id': 'orgA' }, signal: ctl.signal });
      expect(stream.headers.get('content-type')).toContain('text/event-stream');
      const reader = stream.body!.getReader();
      const dec = new TextDecoder();
      const reading = (async () => {
        let buf = '';
        try {
          for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            buf += dec.decode(value);
            for (const m of buf.matchAll(/event: (\S+)\ndata: (.+)\n\n/g)) got.push(`${m[1]}:${JSON.parse(m[2]).tenant}`);
            buf = buf.slice(buf.lastIndexOf('\n\n') + 2);
            if (got.length >= 3) break;
          }
        } catch { /* поток закрыт */ }
      })();
      await new Promise((r) => setTimeout(r, 50));
      await newMap({}, 'orgB'); // чужое событие не приходит
      const m = await newMap();
      await call('PATCH', `/cartography/maps/${m.id}`, { name: 'Другое' });
      await call('DELETE', `/cartography/maps/${m.id}`);
      await Promise.race([reading, new Promise((r) => setTimeout(r, 2000))]);
      ctl.abort();
      expect(got).toEqual(['map.created:orgA', 'map.updated:orgA', 'map.deleted:orgA']);
    });

    /* ---------------------------------- загрузка XYZ ---------------------------------- */
    const BBOX: [number, number, number, number] = [13.35, 52.49, 13.42, 52.53];

    it('XYZ: загрузка с источника, 404 — пропуск, повтор при сбое, User-Agent и Referer', async () => {
      const m = await newMap({ name: 'XYZ' });
      fake.hits.length = 0;
      fake.missing = (z, x, y) => z === 13 && (x + y) % 3 === 0;
      const first = [...tilesOf({ bounds: BBOX, minzoom: 12, maxzoom: 12 })][0];
      fake.flaky.set(first.join('/'), 1); // первый тайл z12 — один сбой 500, затем успех
      const req = { url: `${fake.url}/tiles/{z}/{x}/{y}.png`, bounds: BBOX, minzoom: 10, maxzoom: 13, rate: 20, headers: { Referer: 'https://etomesto.ru/' } };
      const total = tileCount(BBOX, 10, 13);
      const missing = [...tilesOf(req)].filter(([z, x, y]) => fake.missing(z, x, y)).length;
      expect(missing).toBeGreaterThan(0);

      const r = await post(`/cartography/maps/${m.id}/import/xyz`, req);
      expect(r.status).toBe(202);
      expect(r.body).toMatchObject({ mapId: m.id, type: 'xyz-download', total });
      const j = await job(r.body.id);
      expect(j).toMatchObject({ status: 'done', done: total, total, skipped: missing, errors: 0 });
      expect(j.message).toContain(`Загружено ${total - missing}`);
      expect(fake.hits.length).toBe(total + 1); // + повтор после сбоя
      expect(fake.hits.every((h) => h.ua === USER_AGENT && h.referer === 'https://etomesto.ru/')).toBe(true);

      const after = (await get(`/cartography/maps/${m.id}`)).body as MapSource;
      expect(after).toMatchObject({ kind: 'xyz', format: 'png', sourceUrl: req.url, bounds: BBOX, minzoom: 10, maxzoom: 13 });
      expect(after.stats!.tiles).toBe(total - missing);
      expect(after.stats!.bytes).toBeGreaterThan(0);

      // тайл на диске — байт в байт как у источника
      const [z, x, y] = [...tilesOf(req)].find(([zz, xx, yy]) => zz === 13 && !fake.missing(zz, xx, yy))!;
      const t = await tileBytes(m.id, z, x, y);
      expect(t.status).toBe(200);
      expect(t.type).toBe('image/png');
      const src = await fetch(`${fake.url}/tiles/${z}/${x}/${y}.png`);
      expect(t.data.equals(Buffer.from(await src.arrayBuffer()))).toBe(true);

      // продолжение: уже загруженные не запрашиваются, отсутствующие на источнике — снова 404
      fake.hits.length = 0;
      const again = await job((await post(`/cartography/maps/${m.id}/import/xyz`, req)).body.id);
      expect(again).toMatchObject({ status: 'done', done: total, skipped: total, errors: 0 });
      expect(fake.hits.length).toBe(missing);
      fake.missing = () => false;

      const list = (await get(`/cartography/jobs?mapId=${m.id}`)).body as MapJob[];
      expect(list.map((x) => x.id)).toEqual([again.id, j.id]);
      expect((await get(`/cartography/jobs/${j.id}`, 'orgB')).status).toBe(404);
      expect((await get(`/cartography/jobs?mapId=${m.id}`, 'orgB')).body).toEqual([]);
      expect((await post(`/cartography/jobs/${j.id}/cancel`, {})).status).toBe(409);
    });

    it('XYZ: ограничение частоты запросов', async () => {
      const m = await newMap({ name: 'Частота' });
      fake.hits.length = 0;
      const bounds: [number, number, number, number] = [13.35, 52.49, 13.40, 52.52];
      const total = tileCount(bounds, 14, 14);
      expect(total).toBeGreaterThanOrEqual(8);
      const j = await job((await post(`/cartography/maps/${m.id}/import/xyz`, { url: `${fake.url}/tiles/{z}/{x}/{y}.png`, bounds, minzoom: 14, maxzoom: 14, rate: 5 })).body.id);
      expect(j.status).toBe('done');
      const ts = fake.hits.map((h) => h.t).sort((a, b) => a - b);
      expect(ts.length).toBe(total);
      expect(ts.at(-1)! - ts[0]).toBeGreaterThanOrEqual(((total - 1) / 5) * 1000 * 0.85);
      // в любом окне 1 с — не больше rate (+1 на границе окна)
      for (const t0 of ts) expect(ts.filter((t) => t >= t0 && t < t0 + 1000).length).toBeLessThanOrEqual(6);
    });

    it('XYZ: предел тайлов — 422 с подсчётом; проверка запроса', async () => {
      const m = await newMap({ name: 'Предел' });
      const url = `${fake.url}/tiles/{z}/{x}/{y}.png`;
      const r = await post(`/cartography/maps/${m.id}/import/xyz`, { url, bounds: BBOX, minzoom: 0, maxzoom: 18 });
      expect(r.status).toBe(422);
      expect(r.body.error.code).toBe('too_many_tiles');
      expect(r.body.error.tiles).toBe(tileCount(BBOX, 0, 18));
      expect(r.body.error.limit).toBe(2000);
      const bad = async (b: Record<string, unknown>) => (await post(`/cartography/maps/${m.id}/import/xyz`, { url, bounds: BBOX, minzoom: 10, maxzoom: 11, ...b })).status;
      expect(await bad({ url: 'ftp://example.org/{z}/{x}/{y}.png' })).toBe(422);
      expect(await bad({ url: 'https://example.org/tiles.png' })).toBe(422);
      expect(await bad({ url: 'http://127.0.0.1:1/{s}/{z}/{x}/{-y}.png', subdomains: ['a', 'b'] })).toBe(202);
      expect(await bad({ headers: { Cookie: 'a=b' } })).toBe(422);
      expect(await bad({ bounds: [200, 0, 210, 1] })).toBe(422);
      expect(await bad({ minzoom: 12, maxzoom: 11 })).toBe(422);
      expect(await bad({ rate: 0 })).toBe(422);
      expect(await bad({ rate: 100 })).toBe(422);
      expect((await post('/cartography/maps/00000000-0000-0000-0000-000000000000/import/xyz', { url, bounds: BBOX, minzoom: 1, maxzoom: 1 })).status).toBe(404);
      await run.jobs.idle();
    });

    it('XYZ: источник недоступен — задание завершается ошибкой', async () => {
      const m = await newMap({ name: 'Недоступен' });
      const r = await post(`/cartography/maps/${m.id}/import/xyz`, { url: 'http://127.0.0.1:1/{z}/{x}/{y}.png', bounds: BBOX, minzoom: 8, maxzoom: 8 });
      const j = await job(r.body.id);
      expect(j).toMatchObject({ status: 'failed', errors: 1 });
      expect(j.message).toContain('127.0.0.1:1');
    });

    it('XYZ: отмена задания', async () => {
      const m = await newMap({ name: 'Отмена' });
      fake.delay = 150;
      try {
        const r = await post(`/cartography/maps/${m.id}/import/xyz`, { url: `${fake.url}/tiles/{z}/{x}/{y}.png`, bounds: BBOX, minzoom: 15, maxzoom: 15, rate: 20 });
        expect(r.status).toBe(202);
        const until = Date.now() + 5000;
        while (((await get(`/cartography/jobs/${r.body.id}`)).body as MapJob).done < 2 && Date.now() < until) await new Promise((s) => setTimeout(s, 30));
        expect((await post(`/cartography/jobs/${r.body.id}/cancel`, {}, 'orgB')).status).toBe(404);
        const c = await post(`/cartography/jobs/${r.body.id}/cancel`, {});
        expect(c.status).toBe(202);
        const j = await job(r.body.id);
        expect(j.status).toBe('cancelled');
        expect(j.done).toBeLessThan(j.total);
      } finally { fake.delay = 0; }
    });

    /* --------------------------------- растр и граница --------------------------------- */
    let scan: MapSource;

    it('растр по углам: нарезка, цвета четвертей, прозрачность вне скана, нижние уровни', async () => {
      const m = await newMap({ name: 'Скан', attribution: 'Тест' });
      const img = await quadrantImage(W, H);
      const georef = encodeURIComponent(JSON.stringify({ corners: CORNERS }));
      // проверки запроса
      expect((await raw(`/cartography/maps/${m.id}/import/raster`, { method: 'POST', body: bin(img), headers: { 'Content-Type': 'image/png' } })).status).toBe(400);
      expect((await raw(`/cartography/maps/${m.id}/import/raster?georef=${georef}`, { method: 'POST', body: bin(img), headers: { 'Content-Type': 'text/plain' } })).status).toBe(415);
      const notImage = await raw(`/cartography/maps/${m.id}/import/raster?georef=${georef}`, { method: 'POST', body: bin(Buffer.from('не картинка')), headers: { 'Content-Type': 'image/png' } });
      expect(notImage.status).toBe(422);
      const few = encodeURIComponent(JSON.stringify({ controlPoints: [{ px: 0, py: 0, lngLat: [13, 52] }] }));
      expect((await raw(`/cartography/maps/${m.id}/import/raster?georef=${few}`, { method: 'POST', body: bin(img), headers: { 'Content-Type': 'image/png' } })).status).toBe(422);

      const r = await raw(`/cartography/maps/${m.id}/import/raster?georef=${georef}`, { method: 'POST', body: bin(img), headers: { 'Content-Type': 'image/png' } });
      expect(r.status).toBe(202);
      const out = await r.json();
      expect(out.georef).toMatchObject({ kind: 'projective', width: W, height: H, nativeZoom: 13 });
      expect(out.georef.rmsMeters).toBeLessThan(0.01);
      expect(out).toMatchObject({ minzoom: 10, maxzoom: 13, format: 'png' });
      const j = await job(out.job.id);
      expect(j.status).toBe('done');
      expect(j.done).toBe(j.total);
      expect(j.result?.georef?.nativeZoom).toBe(13);

      scan = (await get(`/cartography/maps/${m.id}`)).body;
      expect(scan).toMatchObject({ kind: 'raster', format: 'png', minzoom: 10, maxzoom: 13 });
      expect(scan.controlPoints).toHaveLength(4);
      expect(scan.georef?.width).toBe(W);
      expect(scan.bounds[0]).toBeCloseTo(13.3, 6);
      expect(scan.bounds[3]).toBeCloseTo(52.55, 6);
      expect(scan.stats!.tiles).toBeGreaterThan(20);
      // на диске нет временных файлов загрузки
      expect(await fs.readdir(path.join(run.tilesDir, '.uploads'))).toEqual([]);

      // цвет в центре каждой четверти
      const g = georefFromCorners(W, H, CORNERS);
      for (const [px, py, want] of [[250, 225, QUADRANTS.tl], [950, 225, QUADRANTS.tr], [250, 675, QUADRANTS.bl], [950, 675, QUADRANTS.br]] as const) {
        const at = locate(pixelToLngLat(g, px, py), 13);
        const t = await tileBytes(m.id, at.z, at.x, at.y);
        expect(t.status).toBe(200);
        expect(t.type).toBe('image/png');
        const c = await pixel(t.data, at.px, at.py);
        expect(near(c, [...want, 255])).toBe(true);
      }
      // у западного края: снаружи прозрачно, внутри — цвет скана
      const outside = locate([13.2995, 52.52], 13), inside = locate([13.3005, 52.52], 13);
      expect([outside.x, outside.y]).toEqual([inside.x, inside.y]);
      const edge = await tileBytes(m.id, outside.z, outside.x, outside.y);
      expect((await pixel(edge.data, outside.px, outside.py))[3]).toBe(0);
      expect(near(await pixel(edge.data, inside.px, inside.py), [...QUADRANTS.tl, 255], 20)).toBe(true);
      // тайл вдали от скана — нет (204)
      const far = locate([14.5, 52.5], 13);
      expect((await tileBytes(m.id, far.z, far.x, far.y)).status).toBe(204);
      // нижний уровень собран из дочерних
      const low = locate(pixelToLngLat(g, 250, 225), 10);
      const lt = await tileBytes(m.id, low.z, low.x, low.y);
      expect(lt.status).toBe(200);
      expect(near(await pixel(lt.data, low.px, low.py), [...QUADRANTS.tl, 255], 25)).toBe(true);
    });

    it('тайлы: ETag и 304, кэширование, TileJSON и стиль с префиксом шлюза', async () => {
      const at = locate(pixelToLngLat(georefFromCorners(W, H, CORNERS), 250, 225), 13);
      const t = await tileBytes(scan.id, at.z, at.x, at.y);
      expect(t.etag).toBeTruthy();
      expect(t.cache).toContain('max-age=');
      const nm = await raw(`/cartography/maps/${scan.id}/tiles/${at.z}/${at.x}/${at.y}.png`, { headers: { 'If-None-Match': t.etag! } });
      expect(nm.status).toBe(304);
      expect(nm.headers.get('etag')).toBe(t.etag);
      const v = await tileBytes(scan.id, at.z, at.x, at.y + 0);
      expect(v.data.equals(t.data)).toBe(true);
      expect((await raw(`/cartography/maps/${scan.id}/tiles/${at.z}/${at.x}/${at.y}.png?v=1`)).headers.get('cache-control')).toContain('immutable');
      expect((await raw(`/cartography/maps/${scan.id}/tiles/30/0/0.png`)).status).toBe(400);
      expect((await raw(`/cartography/maps/${scan.id}/tiles/2/5/0.png`)).status).toBe(400);
      expect((await raw(`/cartography/maps/${scan.id}/tiles/2/0/0.gif`)).status).toBe(404);
      expect((await tileBytes(scan.id, at.z, at.x, at.y, 'orgB')).status).toBe(404);

      const tj = (await call('GET', `/cartography/maps/${scan.id}/tilejson`, undefined, 'orgA', { 'X-Forwarded-Prefix': '/api' })).body;
      expect(tj).toMatchObject({ tilejson: '3.0.0', name: 'Скан', attribution: 'Тест', minzoom: 10, maxzoom: 13, scheme: 'xyz', tileSize: 256 });
      expect(tj.tiles[0]).toMatch(new RegExp(`^/api/cartography/maps/${scan.id}/tiles/\\{z\\}/\\{x\\}/\\{y\\}\\.png\\?v=[0-9a-z]+$`));
      expect(tj.center).toHaveLength(3);
      const direct = (await get(`/cartography/maps/${scan.id}/tilejson`)).body;
      expect(direct.tiles[0].startsWith(`/cartography/maps/${scan.id}/tiles/`)).toBe(true);
      const style = (await call('GET', `/cartography/maps/${scan.id}/style`, undefined, 'orgA', { 'X-Forwarded-Prefix': '/api' })).body;
      expect(style.version).toBe(8);
      expect(style.glyphs).toBeUndefined();
      expect(style.sprite).toBeUndefined();
      const sources = Object.values(style.sources) as { type: string; tiles: string[]; tileSize: number }[];
      expect(sources).toHaveLength(1);
      expect(sources[0]).toMatchObject({ type: 'raster', tileSize: 256 });
      expect(sources[0].tiles[0]).toBe(tj.tiles[0]);
      expect(style.layers).toHaveLength(1);
      expect(style.layers[0]).toMatchObject({ type: 'raster', paint: { 'raster-opacity': 1 } });
    });

    it('граница карты: снаружи прозрачно, на границе — маска, внутри — как хранится; сброс кэша при смене', async () => {
      const T = 256;
      const west: LngLat[] = [[13.29, 52.44], [13.4, 52.44], [13.4, 52.56], [13.29, 52.56]];
      const east: LngLat[] = [[13.4, 52.44], [13.51, 52.44], [13.51, 52.56], [13.4, 52.56]];
      const out = locate([13.47, 52.52], 13), cross = locate([13.4, 52.52], 13), inn = locate([13.33, 52.52], 13);
      const before = await tileBytes(scan.id, cross.z, cross.x, cross.y);
      expect((await alphaStats(before.data)).opaque).toBe(T * T);

      expect((await call('PATCH', `/cartography/maps/${scan.id}`, { coverage: west })).status).toBe(200);
      const o = await tileBytes(scan.id, out.z, out.x, out.y);
      expect(o.status).toBe(200);
      expect(o.type).toBe('image/png');
      expect((await alphaStats(o.data)).transparent).toBe(T * T);

      const c1 = await tileBytes(scan.id, cross.z, cross.x, cross.y);
      const s1 = await alphaStats(c1.data);
      expect(s1.transparent).toBeGreaterThan(0);
      expect(s1.opaque).toBeGreaterThan(0);
      const w = locate([13.398, 52.52], 13), e = locate([13.402, 52.52], 13);
      expect((await pixel(c1.data, w.px, w.py))[3]).toBe(255);
      expect((await pixel(c1.data, e.px, e.py))[3]).toBe(0);
      const keyWest = coverageKey(west);
      const cached = run.store.maskedPath('orgA', scan.id, keyWest, cross.z, cross.x, cross.y);
      expect((await fs.stat(cached)).isFile()).toBe(true);
      // повтор — из кэша, байт в байт
      expect((await tileBytes(scan.id, cross.z, cross.x, cross.y)).data.equals(c1.data)).toBe(true);

      const stored = await run.store.find('orgA', scan.id, inn.z, inn.x, inn.y);
      const i = await tileBytes(scan.id, inn.z, inn.x, inn.y);
      expect(i.data.equals(await fs.readFile(stored!.file))).toBe(true);

      // граница сменилась — кэш сброшен, маска другая
      expect((await call('PATCH', `/cartography/maps/${scan.id}`, { coverage: east })).status).toBe(200);
      await expect(fs.stat(cached)).rejects.toThrow();
      const c2 = await tileBytes(scan.id, cross.z, cross.x, cross.y);
      expect(c2.etag).not.toBe(c1.etag);
      expect((await pixel(c2.data, w.px, w.py))[3]).toBe(0);
      expect((await pixel(c2.data, e.px, e.py))[3]).toBe(255);
      expect((await alphaStats((await tileBytes(scan.id, inn.z, inn.x, inn.y)).data)).transparent).toBe(T * T);

      // без границы — снова исходные тайлы
      await call('PATCH', `/cartography/maps/${scan.id}`, { coverage: null });
      expect((await tileBytes(scan.id, cross.z, cross.x, cross.y)).data.equals(before.data)).toBe(true);
    });

    it('растр по опорным точкам (JPEG, уровень ниже родного): невязки', async () => {
      const m = await newMap({ name: 'Скан по точкам' });
      const g0 = georefFromCorners(W, H, CORNERS);
      const pts = [[100, 100], [1100, 120], [1050, 800], [150, 850], [600, 450]].map(([px, py]) => ({ px, py, lngLat: pixelToLngLat(g0, px, py) }));
      pts[4].lngLat = [pts[4].lngLat[0] + 0.0004, pts[4].lngLat[1]]; // ошибка ~27 м в одной точке
      const georef = encodeURIComponent(JSON.stringify({ controlPoints: pts, kind: 'affine', maxzoom: 12 }));
      const r = await raw(`/cartography/maps/${m.id}/import/raster?georef=${georef}`, { method: 'POST', body: bin(await quadrantImage(W, H, 'jpeg')), headers: { 'Content-Type': 'image/jpeg' } });
      expect(r.status).toBe(202);
      const out = await r.json();
      expect(out.georef.kind).toBe('affine');
      expect(out.georef.residuals).toHaveLength(5);
      expect(out.georef.rmsMeters).toBeGreaterThan(1);
      expect(out.georef.rmsMeters).toBeLessThan(30);
      expect(Math.max(...out.georef.residuals)).toBe(out.georef.residuals[4]);
      expect(out).toMatchObject({ maxzoom: 12, minzoom: 9 });
      const j = await job(out.job.id);
      expect(j.status).toBe('done');
      expect(j.result?.georef?.rmsMeters).toBeCloseTo(out.georef.rmsMeters, 6);
      const map = (await get(`/cartography/maps/${m.id}`)).body as MapSource;
      expect(map.controlPoints).toHaveLength(5);
      expect(map.georef?.residuals).toHaveLength(5);
      const at = locate(pixelToLngLat(g0, 950, 675), 12);
      expect(near(await pixel((await tileBytes(m.id, at.z, at.x, at.y)).data, at.px, at.py), [...QUADRANTS.br, 255], 25)).toBe(true);
    });

    /* ------------------------------------- пакеты ------------------------------------- */
    it('пакет: выгрузка → загрузка в другую организацию, тайлы байт в байт', async () => {
      await call('PATCH', `/cartography/maps/${scan.id}`, { coverage: [[13.3, 52.45], [13.5, 52.45], [13.4, 52.55]] });
      const ex = await raw(`/cartography/maps/${scan.id}/package`);
      expect(ex.status).toBe(200);
      expect(ex.headers.get('content-type')).toBe('application/x-tar');
      expect(ex.headers.get('content-disposition')).toContain('attachment');
      const tarBuf = Buffer.from(await ex.arrayBuffer());
      expect((await raw(`/cartography/maps/${scan.id}/package`, {}, 'orgB')).status).toBe(404);

      const im = await raw('/cartography/maps/import-package', { method: 'POST', body: bin(tarBuf), headers: { 'Content-Type': 'application/x-tar' } }, 'orgB');
      expect(im.status).toBe(201);
      const { map, job: j } = await im.json() as { map: MapSource; job: MapJob };
      const orig = (await get(`/cartography/maps/${scan.id}`)).body as MapSource;
      expect(map.id).not.toBe(scan.id);
      expect(map).toMatchObject({ kind: 'package', name: 'Скан', minzoom: 10, maxzoom: 13, format: 'png', coverage: orig.coverage, bounds: orig.bounds });
      expect(map.stats).toEqual(orig.stats);
      expect(map.georef?.width).toBe(W);
      expect(j).toMatchObject({ type: 'package-import', status: 'done', done: orig.stats!.tiles, total: orig.stats!.tiles });

      const a: string[] = [], b: string[] = [];
      for await (const t of run.store.walk('orgA', scan.id)) a.push(`${t.z}/${t.x}/${t.y}.${t.ext}:${(await fs.readFile(t.file)).toString('base64')}`);
      for await (const t of run.store.walk('orgB', map.id)) b.push(`${t.z}/${t.x}/${t.y}.${t.ext}:${(await fs.readFile(t.file)).toString('base64')}`);
      expect(b).toEqual(a);
      // и через HTTP (с обрезкой по границе — одинаково)
      const at = locate([13.4, 52.5], 13);
      expect((await tileBytes(map.id, at.z, at.x, at.y, 'orgB')).data.equals((await tileBytes(scan.id, at.z, at.x, at.y)).data)).toBe(true);

      // изоляция
      expect((await get(`/cartography/maps/${map.id}`)).status).toBe(404);
      expect((await tileBytes(map.id, at.z, at.x, at.y)).status).toBe(404);
      expect((await get('/cartography/maps', 'orgB')).body.map((x: MapSource) => x.id)).toContain(map.id);
      expect((await get(`/cartography/jobs/${j.id}`, 'orgB')).body.status).toBe('done');
    });

    it('пакет: не архив или без map.json — 422, карта не остаётся', async () => {
      const junk = await raw('/cartography/maps/import-package', { method: 'POST', body: bin(Buffer.alloc(4096, 7)) }, 'orgC');
      expect(junk.status).toBe(422);
      const pack = tar.pack();
      pack.entry({ name: 'tiles/1/0/0.png' }, await quadrantImage(16, 16));
      pack.finalize();
      const parts: Buffer[] = [];
      for await (const c of pack) parts.push(c as Buffer);
      const noMeta = await raw('/cartography/maps/import-package', { method: 'POST', body: bin(Buffer.concat(parts)) }, 'orgC');
      expect(noMeta.status).toBe(422);
      expect((await noMeta.json()).error.message).toContain('map.json');
      expect((await get('/cartography/maps', 'orgC')).body).toEqual([]);
      expect(await fs.readdir(path.join(run.tilesDir, 'orgC')).catch(() => [])).toEqual([]);
    });

    /* ------------------------------------ прочее ------------------------------------ */
    it('масштаб: обёртка над ядром', async () => {
      const s = (await get('/cartography/scale?lat=52.5&zoom=12&tileSize=512')).body;
      const den = scaleDenominator(52.5, 12, 512);
      expect(s.denominator).toBeCloseTo(den, 6);
      expect(s.label).toBe(formatScale(den));
      expect(s.metersPerPixel).toBeGreaterThan(0);
      expect(s.bar.meters).toBeGreaterThan(0);
      expect(s.bar.ticks.length).toBeGreaterThan(1);
      expect((await get('/cartography/scale?zoom=12')).status).toBe(400);
      expect((await get('/cartography/scale?lat=52&zoom=12&tileSize=300')).status).toBe(400);
    });

    it('удаление карты удаляет тайлы с диска', async () => {
      const dir = run.store.mapDir('orgA', scan.id);
      expect((await fs.stat(dir)).isDirectory()).toBe(true);
      expect((await call('DELETE', `/cartography/maps/${scan.id}`)).status).toBe(204);
      await expect(fs.stat(dir)).rejects.toThrow();
      // задание остаётся в истории
      expect(((await get(`/cartography/jobs?mapId=${scan.id}`)).body as MapJob[]).length).toBeGreaterThan(0);
    });
  });
}

behaviour('в памяти', async () => ({ repo: new MemoryRepo(), cleanup: async () => undefined }));

const url = process.env.DATABASE_URL;
behaviour('PostgreSQL + PostGIS', async () => {
  const repo = await new PgRepo({ url, schema: `cartography_test_${Math.random().toString(36).slice(2, 10)}` }).init(10_000);
  return { repo, cleanup: async () => { await repo.drop(); await repo.close(); } };
}, !url);
