/** Маршруты сервиса картографии (см. docs/cartography.md). */
import { promises as fs } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import type { MapJob, MapSource } from '@def-ops/core';
import { formatScale, metersPerPixel, parseOziMap, scaleBar, scaleDenominator, tileCount } from '@def-ops/core';
import { Router, HttpError, reply, type Ctx } from '@def-ops/service-kit';
import type { MapRepo } from './repo';
import type { EventBus } from './events';
import type { JobRunner } from './jobs';
import { MIME, type TileStore } from './tiles';
import { downloadXyz, type XyzOptions } from './xyz';
import { planRaster, tileRaster } from './raster';
import { coverageKey, maskedTile, tileRelation, transparentPng } from './coverage';
import { exportPackage, importPackage, mapFromPackage } from './package';
import { importArchive, mapFromArchive } from './archive';
import { PATCHABLE, WORLD, asObject, buildMap, intParam, isUuid, rasterRequest, xyzRequest } from './validate';

export interface CartographyOptions {
  /** Предел тайлов в одном задании (MAX_TILES_PER_JOB). */
  maxTilesPerJob: number;
  /** Предел размера загружаемого скана, байт (MAX_UPLOAD_MB). */
  maxUploadBytes: number;
  /** Предел размера пакета карты, байт (MAX_PACKAGE_MB). */
  maxPackageBytes: number;
  /** Скан больше этого (в RGBA) раскладывается во временный файл, а не в память. */
  rasterMemoryBytes: number;
  /** Разрешённые источники XYZ (пусто — любые). */
  allowedHosts: string[];
  xyz: XyzOptions;
}

export const DEFAULT_OPTIONS: CartographyOptions = {
  maxTilesPerJob: 50_000,
  maxUploadBytes: 200 * 1024 * 1024,
  maxPackageBytes: 20 * 1024 * 1024 * 1024,
  rasterMemoryBytes: 256 * 1024 * 1024,
  allowedHosts: [],
  xyz: {},
};

export interface Deps {
  repo: MapRepo;
  store: TileStore;
  bus: EventBus;
  jobs: JobRunner;
  options?: Partial<CartographyOptions>;
}

const RASTER_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/tiff'];
/** Поля карты, которые PATCH молча пропускает (их меняют только задания). */
const READ_ONLY = ['id', 'kind', 'format', 'tileSize', 'sourceUrl', 'controlPoints', 'georef', 'stats', 'createdAt', 'updatedAt'];

/** Префикс пути, под которым клиент видит сервис (X-Forwarded-Prefix от шлюза, например /api). */
export function publicPrefix(c: Ctx): string {
  const p = (c.req.headers['x-forwarded-prefix'] as string | undefined)?.trim() ?? '';
  return /^(\/[a-zA-Z0-9._~-]+)*$/.test(p) ? p : '';
}

/** Отметка изменения строго позже предыдущей (у тайлов в адресе — версия карты). */
const stamp = (prev?: string) => new Date(Math.max(Date.now(), prev ? Date.parse(prev) + 1 : 0)).toISOString();
const version = (m: MapSource) => Date.parse(m.updatedAt ?? m.createdAt ?? '0').toString(36);

export function buildRouter(d: Deps): Router {
  const { repo, store, bus, jobs } = d;
  const o: CartographyOptions = { ...DEFAULT_OPTIONS, ...d.options };
  const r = new Router();

  const load = async (c: Ctx): Promise<MapSource> => {
    const id = c.params.id;
    const m = isUuid(id) ? await repo.getMap(c.tenant, id.toLowerCase()) : null;
    if (!m) throw new HttpError(404, 'not_found', 'Карта не найдена');
    return m;
  };
  const changed = (tenant: string, m: MapSource, type: 'map.created' | 'map.updated' | 'map.deleted') => bus.publish({ type, tenant, mapId: m.id });

  /** После задания: пересчитать объём, сбросить кэш обрезки, обновить описание. */
  const refreshMap = async (tenant: string, mapId: string, patch: (m: MapSource) => Partial<MapSource> = () => ({})) => {
    const cur = await repo.getMap(tenant, mapId);
    if (!cur) return null;
    await store.clearMasked(tenant, mapId);
    const next: MapSource = { ...cur, ...patch(cur), stats: await store.stats(tenant, mapId), updatedAt: stamp(cur.updatedAt) };
    const out = await repo.updateMap(tenant, next);
    if (out) changed(tenant, out, 'map.updated');
    return out;
  };

  const tooMany = (n: number) => reply(422, { error: {
    code: 'too_many_tiles',
    message: `Получается ${n.toLocaleString('ru-RU')} тайлов — больше предела ${o.maxTilesPerJob.toLocaleString('ru-RU')} (MAX_TILES_PER_JOB). Уменьшите район или диапазон уровней`,
    tiles: n, limit: o.maxTilesPerJob,
  } });

  const checkLength = (c: Ctx, limit: number, what: string) => {
    const len = Number(c.req.headers['content-length']);
    if (Number.isFinite(len) && len > limit) throw new HttpError(413, 'payload_too_large', `${what} больше ${Math.round(limit / 1048576)} МБ`);
  };

  /* ------------------------------------- карты ------------------------------------- */
  r.get('/cartography/maps', (c) => repo.listMaps(c.tenant));

  r.post('/cartography/maps', async (c) => {
    const b = asObject(await c.json());
    const now = stamp();
    const kind = b.kind === undefined ? 'xyz' : b.kind;
    if (kind !== 'xyz' && kind !== 'raster') throw new HttpError(422, 'invalid', '«kind»: xyz или raster (package — только импортом пакета)');
    const m = buildMap(b, {
      id: crypto.randomUUID(), kind, format: 'png', tileSize: 256, minzoom: 0, maxzoom: 18, bounds: WORLD,
      coverage: null, opacity: 1, sourceUrl: null, controlPoints: null, stats: { tiles: 0, bytes: 0 }, createdAt: now, updatedAt: now,
    });
    const out = await repo.createMap(c.tenant, m);
    changed(c.tenant, out, 'map.created');
    return reply(201, out);
  });

  /** Пакет карты (tar) из другой установки → новая карта. Тело — сам архив, читается потоком. */
  r.post('/cartography/maps/import-package', async (c) => {
    checkLength(c, o.maxPackageBytes, 'Пакет');
    const id = crypto.randomUUID();
    const job = await jobs.create(c.tenant, id, 'package-import');
    let created: MapSource | null = null;
    let error: unknown;
    const res = await jobs.runNow(c.tenant, job, async (ctx) => {
      try {
        const out = await importPackage(ctx, c.req, store, id, async (raw) => {
          created = await repo.createMap(c.tenant, mapFromPackage(raw, id, stamp()));
          changed(c.tenant, created, 'map.created');
          return created;
        }, o.maxPackageBytes);
        created = await refreshMap(c.tenant, id);
        return { message: `Загружено тайлов: ${out.tiles}` + (ctx.job.errors ? `, отброшено: ${ctx.job.errors}` : '') };
      } catch (e) { error = e; throw e; }
    });
    if (res.status === 'done' && created) return reply(201, { map: created, job: res });
    // неудача — частично загруженная карта не остаётся
    await store.removeMap(c.tenant, id);
    if (created && (await repo.deleteMap(c.tenant, id))) changed(c.tenant, created, 'map.deleted');
    if (error instanceof HttpError) throw error;
    if (res.status === 'cancelled') throw new HttpError(409, 'cancelled', 'Импорт пакета отменён');
    throw new HttpError(422, 'invalid', `Пакет не загружен: ${res.message ?? 'ошибка'}`);
  });

  /**
   * Тайловый архив SQLite из других программ: .sqlitedb (RMaps / Locus Map / OsmAnd)
   * или .mbtiles. Тело — сам файл; ?name=&date=&attribution= — подпись карты,
   * ?file= — имя файла (имя карты, если в архиве его нет).
   * Уровни, охват и формат определяются по содержимому. Ответ — когда импорт закончен.
   */
  r.post('/cartography/maps/import-archive', async (c) => {
    checkLength(c, o.maxPackageBytes, 'Архив');
    const { file, stream } = await store.uploadTarget();
    const drop = () => fs.rm(file, { force: true });
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _e, cb) {
        size += chunk.length;
        if (size > o.maxPackageBytes) cb(new HttpError(413, 'payload_too_large', `Архив больше ${Math.round(o.maxPackageBytes / 1048576)} МБ (MAX_PACKAGE_MB)`));
        else cb(null, chunk);
      },
    });
    try { await pipeline(c.req, limit, stream); } catch (e) {
      await drop();
      throw e instanceof HttpError ? e : new HttpError(400, 'upload_failed', `Архив не получен: ${(e as Error).message}`);
    }
    if (!size) { await drop(); throw new HttpError(400, 'bad_request', 'Пустое тело запроса: ожидается файл .sqlitedb или .mbtiles'); }

    const id = crypto.randomUUID();
    const now = stamp();
    const q = (k: string) => c.query.get(k)?.trim() || undefined;
    let created: MapSource | null = null;
    let error: unknown;
    const job = await jobs.create(c.tenant, id, 'package-import');
    const res = await jobs.runNow(c.tenant, job, async (ctx) => {
      try {
        created = await repo.createMap(c.tenant, buildMap({ name: q('name') ?? q('file') ?? 'Импортированная карта', date: q('date') ?? null, attribution: q('attribution') }, {
          id, kind: 'package', format: 'png', tileSize: 256, minzoom: 0, maxzoom: 18, bounds: WORLD,
          coverage: null, opacity: 1, sourceUrl: null, controlPoints: null, stats: { tiles: 0, bytes: 0 }, createdAt: now, updatedAt: now,
        }));
        changed(c.tenant, created, 'map.created');
        const r = await importArchive(ctx, store, id, file);
        created = await refreshMap(c.tenant, id, (m) => ({
          ...mapFromArchive(r),
          // имя: заданное явно → записанное в архиве → имя файла
          name: q('name') ?? r.info.name ?? m.name,
          attribution: q('attribution') ?? r.info.attribution ?? m.attribution,
          description: m.description ?? r.info.description ?? `Импорт ${r.info.format === 'mbtiles' ? 'MBTiles' : 'RMaps/Locus (.sqlitedb)'}`,
        }));
        return { message: `Загружено тайлов: ${r.tiles}${r.errors ? `, отброшено: ${r.errors}` : ''}` };
      } catch (e) { error = e; throw e; }
    });
    await drop();
    if (res.status === 'done' && created) return reply(201, { map: created, job: res });
    await store.removeMap(c.tenant, id);
    if (created && (await repo.deleteMap(c.tenant, id))) changed(c.tenant, created, 'map.deleted');
    if (error instanceof HttpError) throw error;
    if (res.status === 'cancelled') throw new HttpError(409, 'cancelled', 'Импорт архива отменён');
    throw new HttpError(422, 'invalid', `Архив не загружен: ${res.message ?? 'ошибка'}`);
  });

  /** Разбор привязки OziExplorer (.map, текст в теле): опорные точки в WGS 84 для нарезки скана. */
  r.post('/cartography/parse/ozi-map', async (c) => {
    const parts: Buffer[] = [];
    let n = 0;
    for await (const ch of c.req) { n += (ch as Buffer).length; if (n > 1 << 20) throw new HttpError(413, 'payload_too_large', 'Файл .map больше 1 МБ'); parts.push(ch as Buffer); }
    const buf = Buffer.concat(parts);
    // .map обычно в Windows-1251; если UTF-8 не читается — декодируем как 1251
    let text = buf.toString('utf8');
    if (text.includes('\uFFFD')) text = new TextDecoder('windows-1251').decode(buf);
    try { return parseOziMap(text); } catch (e) { throw new HttpError(422, 'invalid', (e as Error).message); }
  });

  r.get('/cartography/maps/:id', (c) => load(c));

  r.patch('/cartography/maps/:id', async (c) => {
    const cur = await load(c);
    const b = asObject(await c.json());
    const unknown = Object.keys(b).filter((k) => !PATCHABLE.includes(k) && !READ_ONLY.includes(k));
    if (unknown.length) throw new HttpError(422, 'invalid', `Нельзя изменить: ${unknown.join(', ')} (можно: ${PATCHABLE.join(', ')})`);
    const patch = Object.fromEntries(Object.entries(b).filter(([k]) => PATCHABLE.includes(k)));
    const next = buildMap(patch, cur);
    next.updatedAt = stamp(cur.updatedAt);
    const covChanged = JSON.stringify(cur.coverage ?? null) !== JSON.stringify(next.coverage ?? null);
    const out = await repo.updateMap(c.tenant, next);
    if (!out) throw new HttpError(404, 'not_found', 'Карта не найдена');
    if (covChanged) await store.clearMasked(c.tenant, out.id);
    changed(c.tenant, out, 'map.updated');
    return out;
  });

  r.delete('/cartography/maps/:id', async (c) => {
    const m = await load(c);
    await jobs.cancelMap(c.tenant, m.id);
    if (!(await repo.deleteMap(c.tenant, m.id))) throw new HttpError(404, 'not_found', 'Карта не найдена');
    await store.removeMap(c.tenant, m.id);
    changed(c.tenant, m, 'map.deleted');
    return reply(204, null);
  });

  /* ------------------------------------- тайлы ------------------------------------- */
  /**
   * Тайл карты. Нет тайла — 204 (MapLibre рисует пустое место). Есть граница:
   * снаружи — прозрачный PNG, на границе — обрезанный PNG (из кэша), внутри — как
   * хранится. Расширение в адресе не важно: тип — в Content-Type.
   */
  r.get('/cartography/maps/:id/tiles/:z/:x/:y', async (c) => {
    const m = await load(c);
    const yy = /^(\d+)\.(png|jpg|jpeg|webp)$/.exec(c.params.y);
    if (!yy) throw new HttpError(404, 'not_found', 'Адрес тайла: tiles/{z}/{x}/{y}.png|jpg|webp');
    const z = intParam(c.params.z, 'z', 0, 22), x = intParam(c.params.x, 'x', 0, 2 ** z - 1), y = intParam(yy[1], 'y', 0, 2 ** z - 1);
    const t = await store.find(c.tenant, m.id, z, x, y, m.format);
    if (!t) return reply(204, null, { 'Cache-Control': 'public, max-age=60' });
    const cache = c.query.has('v') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600';
    const rel = m.coverage ? tileRelation(m.coverage, z, x, y) : 'inside';
    const base = `${t.size.toString(36)}-${Math.round(t.mtimeMs).toString(36)}`;
    const etag = rel === 'outside' ? `"o${m.tileSize}"` : rel === 'crossing' ? `"m${coverageKey(m.coverage!)}-${base}"` : `"${base}"`;
    const headers = { ETag: etag, 'Cache-Control': cache };
    const inm = c.req.headers['if-none-match'];
    if (inm && inm.split(',').map((s) => s.trim().replace(/^W\//, '')).includes(etag)) return reply(304, null, headers);
    if (rel === 'outside') return reply(200, await transparentPng(m.tileSize), { ...headers, 'Content-Type': 'image/png' });
    if (rel === 'crossing') {
      const { data } = await maskedTile(store, c.tenant, m.id, m.coverage!, t, m.tileSize);
      return reply(200, data, { ...headers, 'Content-Type': 'image/png' });
    }
    let data: Buffer;
    try { data = await fs.readFile(t.file); } catch { return reply(204, null); }
    return reply(200, data, { ...headers, 'Content-Type': MIME[t.ext] });
  });

  const tilesUrl = (c: Ctx, m: MapSource) =>
    `${publicPrefix(c)}/cartography/maps/${m.id}/tiles/{z}/{x}/{y}.${m.format}?v=${version(m)}`;
  const center = (m: MapSource): [number, number] => [(m.bounds[0] + m.bounds[2]) / 2, (m.bounds[1] + m.bounds[3]) / 2];

  /** TileJSON 3.0. Адрес тайлов — путь от корня сайта с учётом префикса шлюза. */
  r.get('/cartography/maps/:id/tilejson', async (c) => {
    const m = await load(c);
    return {
      tilejson: '3.0.0', name: m.name, description: m.description ?? '', attribution: m.attribution ?? '', version: '1.0.0', scheme: 'xyz',
      tiles: [tilesUrl(c, m)], minzoom: m.minzoom, maxzoom: m.maxzoom, bounds: m.bounds,
      center: [...center(m), Math.min(m.maxzoom, Math.max(m.minzoom, Math.round((m.minzoom + m.maxzoom) / 2)))],
      format: m.format, tileSize: m.tileSize,
    };
  });

  /** Минимальный стиль MapLibre: один растровый источник, без шрифтов и спрайтов (офлайн). */
  r.get('/cartography/maps/:id/style', async (c) => {
    const m = await load(c);
    const src = `map-${m.id}`;
    return {
      version: 8, name: m.name, center: center(m), zoom: m.minzoom,
      metadata: { 'def-ops:mapId': m.id, 'def-ops:date': m.date ?? null },
      sources: { [src]: { type: 'raster', tiles: [tilesUrl(c, m)], tileSize: m.tileSize, minzoom: m.minzoom, maxzoom: m.maxzoom, bounds: m.bounds, attribution: m.attribution ?? '' } },
      layers: [{ id: src, type: 'raster', source: src, paint: { 'raster-opacity': m.opacity ?? 1 } }],
    };
  });

  /* ------------------------------------ импорт ------------------------------------ */
  r.post('/cartography/maps/:id/import/xyz', async (c) => {
    const m = await load(c);
    const req = xyzRequest(await c.json(), o.allowedHosts);
    const total = tileCount(req.bounds, req.minzoom, req.maxzoom);
    if (total > o.maxTilesPerJob) return tooMany(total);
    const job = await jobs.create(c.tenant, m.id, 'xyz-download', total);
    jobs.enqueue(c.tenant, job, async (ctx) => {
      const cur = await repo.getMap(ctx.tenant, m.id);
      if (!cur) throw new Error('Карта удалена');
      const empty = !cur.stats?.tiles;
      const out = await downloadXyz(ctx, store, cur, req, o.xyz);
      await refreshMap(ctx.tenant, m.id, (x) => ({
        kind: 'xyz', sourceUrl: req.url,
        format: empty && out.format ? out.format : x.format,
        // пустая карта получает охват запроса; иначе охват расширяется
        bounds: empty ? req.bounds : [Math.min(x.bounds[0], req.bounds[0]), Math.min(x.bounds[1], req.bounds[1]), Math.max(x.bounds[2], req.bounds[2]), Math.max(x.bounds[3], req.bounds[3])],
        minzoom: empty ? req.minzoom : Math.min(x.minzoom, req.minzoom),
        maxzoom: empty ? req.maxzoom : Math.max(x.maxzoom, req.maxzoom),
      }));
      return { message: out.message, failed: out.failed };
    });
    return reply(202, job);
  });

  /**
   * Скан карты: тело — само изображение (Content-Type image/png|jpeg|webp|tiff),
   * привязка — параметр ?georef=<JSON RasterTileRequest>. Ответ 202: задание и итог
   * привязки (невязки видны сразу, до нарезки).
   */
  r.post('/cartography/maps/:id/import/raster', async (c) => {
    const m = await load(c);
    const g = c.query.get('georef');
    if (!g) throw new HttpError(400, 'bad_request', 'Нужна привязка: ?georef=<JSON с controlPoints или corners>');
    let parsed: unknown;
    try { parsed = JSON.parse(g); } catch { throw new HttpError(400, 'bad_json', 'georef — некорректный JSON'); }
    const req = rasterRequest(parsed);
    const ct = String(c.req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (!RASTER_TYPES.includes(ct)) throw new HttpError(415, 'unsupported_media_type', 'Тело — изображение: image/png, image/jpeg, image/webp или image/tiff');
    checkLength(c, o.maxUploadBytes, 'Изображение');

    const { file, stream } = await store.uploadTarget();
    const drop = () => fs.rm(file, { force: true });
    let size = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _e, cb) {
        size += chunk.length;
        if (size > o.maxUploadBytes) cb(new HttpError(413, 'payload_too_large', `Изображение больше ${Math.round(o.maxUploadBytes / 1048576)} МБ (MAX_UPLOAD_MB)`));
        else cb(null, chunk);
      },
    });
    try { await pipeline(c.req, limit, stream); } catch (e) {
      await drop();
      throw e instanceof HttpError ? e : new HttpError(400, 'upload_failed', `Изображение не получено: ${(e as Error).message}`);
    }
    if (!size) { await drop(); throw new HttpError(400, 'bad_request', 'Пустое тело запроса: ожидается изображение'); }

    let plan;
    try { plan = await planRaster(file, req, m); } catch (e) {
      await drop();
      throw new HttpError(422, 'invalid', (e as Error).message);
    }
    if (plan.total > o.maxTilesPerJob) { await drop(); return tooMany(plan.total); }
    const job = await jobs.create(c.tenant, m.id, 'raster-tile', plan.total);
    jobs.enqueue(c.tenant, job, async (ctx) => {
      const { written } = await tileRaster(ctx, store, m.id, plan, { memoryLimitBytes: o.rasterMemoryBytes });
      await refreshMap(ctx.tenant, m.id, () => ({
        kind: 'raster', format: plan.format, controlPoints: plan.controlPoints, georef: plan.summary,
        bounds: plan.bounds, minzoom: plan.minzoom, maxzoom: plan.maxzoom,
      }));
      const s = plan.summary;
      return {
        message: `Нарезано тайлов: ${written}; невязка привязки ${s.rmsMeters.toFixed(1)} м`,
        result: { georef: s, bounds: plan.bounds, minzoom: plan.minzoom, maxzoom: plan.maxzoom },
      };
    }, drop);
    return reply(202, { job, georef: plan.summary, bounds: plan.bounds, minzoom: plan.minzoom, maxzoom: plan.maxzoom, format: plan.format });
  });

  /** Пакет карты (tar: map.json + tiles/…) для переноса в закрытый контур. */
  r.get('/cartography/maps/:id/package', async (c) => {
    const m = await load(c);
    await exportPackage(c.res, store, c.tenant, m, m.name);
  });

  /* ------------------------------------ задания ------------------------------------ */
  const fresh = (tenant: string, j: MapJob) => jobs.get(tenant, j.id) ?? j;

  r.get('/cartography/jobs', async (c) => {
    const mapId = c.query.get('mapId');
    if (mapId !== null && !isUuid(mapId)) return [];
    return (await repo.listJobs(c.tenant, mapId?.toLowerCase())).map((j) => fresh(c.tenant, j));
  });

  r.get('/cartography/jobs/:id', async (c) => {
    const id = c.params.id;
    const live = isUuid(id) ? jobs.get(c.tenant, id.toLowerCase()) : null;
    const j = live ?? (isUuid(id) ? await repo.getJob(c.tenant, id.toLowerCase()) : null);
    if (!j) throw new HttpError(404, 'not_found', 'Задание не найдено');
    return j;
  });

  r.post('/cartography/jobs/:id/cancel', async (c) => {
    const id = c.params.id.toLowerCase();
    if (!isUuid(id)) throw new HttpError(404, 'not_found', 'Задание не найдено');
    const j = await jobs.cancel(c.tenant, id);
    if (j) return reply(202, j);
    const done = await repo.getJob(c.tenant, id);
    if (!done) throw new HttpError(404, 'not_found', 'Задание не найдено');
    throw new HttpError(409, 'conflict', `Задание уже завершено (${done.status})`);
  });

  /* ------------------------------------ события ------------------------------------ */
  /** Поток событий картографии (SSE); ?mapId= — только по одной карте. */
  r.get('/cartography/events', (c) => {
    const only = c.query.get('mapId');
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    c.res.write(': connected\n\n');
    const off = bus.subscribe(c.tenant, (e) => {
      if (only && e.mapId !== only) return;
      c.res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => c.res.write(': ping\n\n'), 25000);
    c.req.on('close', () => { off(); clearInterval(ping); });
  });

  /* ------------------------------------ масштаб ------------------------------------ */
  /** Масштаб карты на широте и уровне (для других систем): м/пиксель, «1:25 000», линейка. */
  r.get('/cartography/scale', (c) => {
    const num = (k: string, min: number, max: number, def?: number) => {
      const v = c.query.get(k);
      if (v === null || v === '') {
        if (def === undefined) throw new HttpError(400, 'bad_request', `Не указан параметр ${k}`);
        return def;
      }
      const n = Number(v);
      if (!Number.isFinite(n) || n < min || n > max) throw new HttpError(400, 'bad_request', `${k}: число от ${min} до ${max}`);
      return n;
    };
    const lat = num('lat', -85.06, 85.06), zoom = num('zoom', 0, 24);
    const tileSize = num('tileSize', 256, 512, 512);
    if (tileSize !== 256 && tileSize !== 512) throw new HttpError(400, 'bad_request', 'tileSize: 256 или 512');
    const maxPx = num('maxPx', 20, 1000, 120);
    const denominator = scaleDenominator(lat, zoom, tileSize);
    return { metersPerPixel: metersPerPixel(lat, zoom, tileSize), denominator, label: formatScale(denominator), bar: scaleBar(lat, zoom, maxPx, tileSize) };
  });

  return r;
}
