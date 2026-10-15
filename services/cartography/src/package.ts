/**
 * Пакет карты для переноса в закрытый контур: архив tar
 *   map.json                 — описание карты (MapSource);
 *   tiles/{z}/{x}/{y}.{ext}  — тайлы пирамиды как есть (без обрезки по границе:
 *                              граница переносится в map.json).
 * Векторная карта (OpenHistoricalMap) вместо тайлов несёт
 *   ohm.mbtiles                          — векторные тайлы одним файлом;
 *   assets/fonts/{стек}/{диапазон}.pbf   — шрифты стиля;
 *   assets/sprites/{имя}                 — значки стиля.
 * Выгрузка и загрузка идут потоком — архив не собирается целиком ни в памяти, ни
 * на диске. Загружаемый пакет становится новой картой (новый id, kind 'package';
 * векторная остаётся 'vector').
 */
import { once } from 'node:events';
import { promises as fs, createReadStream, createWriteStream, existsSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import tar from 'tar-stream';
import { validBBox, type MapSource } from '@def-ops/core';
import { HttpError } from '@def-ops/service-kit';
import type { JobContext } from './jobs';
import { detectFormat, writeAtomic, type TileStore } from './tiles';
import { asObject, buildMap, ohmCellsLimit, rasterRequest, WORLD } from './validate';
import { OHM_FONTS, OHM_RANGES, OHM_SPRITES, ohmAssetsDir, ohmFile } from './ohm';

/** Не больше этого на один тайл в пакете. */
const MAX_TILE_BYTES = 8 * 1024 * 1024;
const MAX_META_BYTES = 4 * 1024 * 1024;

/** Описание карты для пакета (без служебного). */
export function packageMeta(m: MapSource): MapSource {
  return structuredClone(m);
}

/** Выгрузить пакет карты в ответ (поток). */
export async function exportPackage(res: http.ServerResponse, store: TileStore, tenant: string, map: MapSource, filename: string): Promise<void> {
  const ascii = filename.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'map';
  const vector = map.kind === 'vector';
  const mbtiles = vector ? ohmFile(store, tenant, map.id) : '';
  const st = vector ? await fs.stat(mbtiles).catch(() => null) : null;
  if (vector && !st) throw new HttpError(409, 'conflict', 'Карта ещё не загружена: нет векторных тайлов');
  res.writeHead(200, {
    'Content-Type': 'application/x-tar',
    'Content-Disposition': `attachment; filename="${ascii}.tar"; filename*=UTF-8''${encodeURIComponent(filename)}.tar`,
    'Cache-Control': 'no-store',
  });
  const pack = tar.pack();
  pack.on('error', () => { /* обрыв клиента: архив бросается, ошибкой службы это не считается */ });
  pack.pipe(res);
  let closed = false;
  // клиент оборвал выгрузку: поток файла и архив уничтожаются, ожидания завершаются
  const aborted = new Promise<void>((resolve) => res.once('close', () => {
    closed = !res.writableFinished;
    if (closed) pack.destroy();
    resolve();
  }));
  const settle = (p: Promise<void>) => Promise.race([p.catch((e) => { if (!closed) throw e; }), aborted.then(() => { if (!closed) return p; })]);
  const add = (name: string, data: Buffer, mtime = new Date()) => settle(new Promise<void>((resolve, reject) =>
    pack.entry({ name, size: data.length, mtime, mode: 0o644 }, data, (e) => (e ? reject(e) : resolve()))));
  // время в заголовках — от данных, а не от момента выгрузки: пакет одной карты всегда одинаков байт в байт
  await add('map.json', Buffer.from(JSON.stringify(packageMeta(map), null, 2)), new Date(map.updatedAt ?? 0));
  if (vector && !closed) {
    // MBTiles — потоком, размер — из stat; обрыв — поток файла закрывается сразу
    const rs = createReadStream(mbtiles, { end: st!.size - 1 });
    void aborted.then(() => { if (closed) rs.destroy(); });
    await settle(new Promise<void>((resolve, reject) => {
      const entry = pack.entry({ name: 'ohm.mbtiles', size: st!.size, mtime: new Date(Math.floor(st!.mtimeMs)), mode: 0o644 }, (e) => (e ? reject(e) : resolve()));
      pipeline(rs, entry).catch(reject);
    }));
    rs.destroy();
    for (const [name, file] of assetFiles(ohmAssetsDir(store))) {
      if (closed) break;
      let data: Buffer;
      try { data = await fs.readFile(file); } catch { continue; }
      await add(name, data, new Date(0));
    }
  }
  for await (const t of (vector ? [] : store.walk(tenant, map.id))) {
    if (closed) break;
    let data: Buffer;
    try { data = await fs.readFile(t.file); } catch { continue; }
    await add(`tiles/${t.z}/${t.x}/${t.y}.${t.ext}`, data, new Date(Math.floor(t.mtimeMs)));
    if (res.writableNeedDrain) await Promise.race([once(res, 'drain'), once(res, 'close')]);
  }
  if (closed) return;
  pack.finalize();
  if (!closed) await Promise.race([once(res, 'finish'), once(res, 'close')]);
}

/** Шрифты и значки стиля OHM: имя в пакете → файл. */
function assetFiles(dir: string): [string, string][] {
  const out: [string, string][] = [];
  for (const stack of OHM_FONTS) for (const range of OHM_RANGES) out.push([`assets/fonts/${stack}/${range}.pbf`, path.join(dir, 'fonts', stack, `${range}.pbf`)]);
  for (const name of OHM_SPRITES) out.push([`assets/sprites/${name}`, path.join(dir, 'sprites', name)]);
  return out;
}

/**
 * Сведения OHM карты из пакета (проверка формы); не годятся — null. Район больше предела участков
 * (по нему пойдут «продолжить» и «обновить») — 422.
 */
function ohmMeta(v: unknown): MapSource['ohm'] {
  const o = v as NonNullable<MapSource['ohm']>;
  if (!o || typeof o !== 'object' || !validBBox(o.bbox) || !Number.isInteger(o.cells) || !Number.isInteger(o.features)
    || !o.layers || typeof o.layers !== 'object' || typeof o.fetchedAt !== 'string' || o.fetchedAt.length > 64) return null;
  ohmCellsLimit(o.bbox);
  const layers: Record<string, number> = {};
  for (const [k, n] of Object.entries(o.layers)) if (/^[a-z_]{1,32}$/.test(k) && Number.isInteger(n)) layers[k] = n;
  return { bbox: [...o.bbox], cells: o.cells, features: o.features, layers, fetchedAt: o.fetchedAt };
}

/** Описание карты из пакета → новая карта организации (проверяется как при создании). */
export function mapFromPackage(raw: unknown, id: string, now: string): MapSource {
  const b = asObject(raw);
  const vector = b.kind === 'vector';
  const m = buildMap(b, {
    id, kind: vector ? 'vector' : 'package', format: vector ? 'pbf' : 'png', tileSize: vector ? 512 : 256, minzoom: 0, maxzoom: vector ? 16 : 18,
    bounds: WORLD, coverage: null, opacity: 1,
    sourceUrl: null, controlPoints: null, stats: { tiles: 0, bytes: 0 }, createdAt: now, updatedAt: now,
  });
  m.id = id;
  m.kind = 'package';
  if (vector) {
    // векторная карта: свой вид и формат, без границы; сведения OHM — как в пакете
    Object.assign(m, { kind: 'vector', format: 'pbf', tileSize: 512, coverage: null, ohm: ohmMeta(b.ohm) });
  }
  m.createdAt = now;
  m.updatedAt = now;
  if (typeof b.sourceUrl === 'string' && b.sourceUrl.length <= 2000) m.sourceUrl = b.sourceUrl;
  if (Array.isArray(b.controlPoints)) {
    try { m.controlPoints = rasterRequest({ controlPoints: b.controlPoints }).controlPoints; } catch { /* невалидные точки не переносим */ }
  }
  const g = b.georef as MapSource['georef'];
  if (g && typeof g === 'object' && typeof g.rmsMeters === 'number' && Array.isArray(g.residuals)) m.georef = g;
  return m;
}

const TILE_RE = /^(?:\.\/)?tiles\/(\d{1,2})\/(\d{1,8})\/(\d{1,8})\.(png|jpg|jpeg|webp)$/;

/**
 * Загрузить пакет из тела запроса (поток). onMap вызывается, когда прочитан
 * map.json (exportPackage кладёт его первым). Тайлы пишутся по мере чтения.
 */
export async function importPackage(
  ctx: JobContext, req: http.IncomingMessage, store: TileStore, mapId: string,
  onMap: (raw: unknown) => Promise<MapSource>, maxBytes: number,
): Promise<{ map: MapSource; tiles: number; bytes: number }> {
  const extract = tar.extract();
  let received = 0;
  const onData = (c: Buffer) => {
    received += c.length;
    if (received > maxBytes) extract.destroy(new HttpError(413, 'payload_too_large', `Пакет больше ${Math.round(maxBytes / 1048576)} МБ (MAX_PACKAGE_MB)`));
  };
  const onAbort = () => extract.destroy(new Error('Задание отменено'));
  req.on('data', onData);
  req.on('error', (e) => extract.destroy(e));
  ctx.signal.addEventListener('abort', onAbort, { once: true });
  req.pipe(extract);

  let map: MapSource | null = null;
  let tiles = 0, bytes = 0;
  let mbtiles = false;
  const mbFile = ohmFile(store, ctx.tenant, mapId);
  const assets = new Map(assetFiles(ohmAssetsDir(store)));
  try {
    for await (const entry of extract) {
      const h = entry.header;
      const read = async (limit: number) => {
        if ((h.size ?? 0) > limit) throw new HttpError(422, 'invalid', `${h.name}: слишком большой файл в пакете`);
        const parts: Buffer[] = [];
        for await (const c of entry) parts.push(c as Buffer);
        return Buffer.concat(parts);
      };
      const name = h.name.replace(/^\.\//, '');
      if (h.type === 'file' && name === 'map.json') {
        if (map) throw new HttpError(422, 'invalid', 'В пакете два map.json');
        let meta: unknown;
        try { meta = JSON.parse((await read(MAX_META_BYTES)).toString('utf8')); } catch (e) {
          if (e instanceof HttpError) throw e;
          throw new HttpError(422, 'invalid', 'map.json: некорректный JSON');
        }
        map = await onMap(meta);
        const declared = (meta as MapSource).stats?.tiles;
        if (Number.isInteger(declared) && declared! > 0) ctx.progress({ total: declared });
        continue;
      }
      if (h.type === 'file' && name === 'ohm.mbtiles' && !map)
        throw new HttpError(422, 'invalid', 'В пакете ohm.mbtiles идёт раньше map.json: map.json должен быть первым');
      if (h.type === 'file' && name === 'ohm.mbtiles' && map?.kind === 'vector') {
        if (mbtiles) throw new HttpError(422, 'invalid', 'В пакете два ohm.mbtiles');
        // векторные тайлы — потоком в папку карты (под общим пределом размера пакета)
        const tmp = `${mbFile}.import`;
        await fs.mkdir(path.dirname(mbFile), { recursive: true });
        try {
          await pipeline(entry, createWriteStream(tmp));
          const n = checkMbtiles(tmp);
          await fs.rename(tmp, mbFile);
          tiles = n;
          bytes = (await fs.stat(mbFile)).size;
        } finally { await fs.rm(tmp, { force: true }); }
        mbtiles = true;
        continue;
      }
      const asset = h.type === 'file' && map?.kind === 'vector' ? assets.get(name) : undefined;
      if (asset) {
        // общие для всех карт и организаций: есть — не трогаются; негодный файл не пишется
        if ((h.size ?? 0) > MAX_ASSET_BYTES) { entry.resume(); ctx.progress({ errors: ctx.job.errors + 1 }); continue; }
        const data = await read(MAX_ASSET_BYTES);
        if (!validAsset(name, data)) { ctx.progress({ errors: ctx.job.errors + 1 }); continue; }
        if (!existsSync(asset)) await writeAtomic(asset, data);
        continue;
      }
      const m = h.type === 'file' && map?.kind !== 'vector' ? TILE_RE.exec(name) : null;
      if (!m) { entry.resume(); continue; } // посторонние файлы и каталоги пропускаются
      const z = Number(m[1]), x = Number(m[2]), y = Number(m[3]);
      const data = await read(MAX_TILE_BYTES);
      const ext = detectFormat(data);
      if (z > 22 || x >= 2 ** z || y >= 2 ** z || !ext) {
        ctx.progress({ done: ctx.job.done + 1, errors: ctx.job.errors + 1 });
        continue;
      }
      await store.write(ctx.tenant, mapId, z, x, y, ext, data);
      tiles++;
      bytes += data.length;
      ctx.progress({ done: ctx.job.done + 1, total: Math.max(ctx.job.total, ctx.job.done + 1) });
    }
  } finally {
    req.off('data', onData);
    ctx.signal.removeEventListener('abort', onAbort);
    req.unpipe(extract);
  }
  ctx.check();
  if (!map) throw new HttpError(422, 'invalid', 'В пакете нет map.json — это не пакет карты');
  if (map.kind === 'vector') {
    if (!mbtiles) throw new HttpError(422, 'invalid', 'В пакете векторной карты нет ohm.mbtiles');
    ctx.progress({ done: tiles, total: tiles });
  }
  return { map, tiles, bytes };
}

/** Шрифт или значки из пакета — не больше этого. */
const MAX_ASSET_BYTES = 4 * 1024 * 1024;

/**
 * Файл стиля из пакета годен по форме: шрифт — сообщение PBF из одного поля 1 (набор глифов
 * стека) на весь файл, значки — PNG (сигнатура) или объект JSON.
 */
export function validAsset(name: string, data: Buffer): boolean {
  if (!data.length || data.length > MAX_ASSET_BYTES) return false;
  if (name.endsWith('.pbf')) {
    if (data[0] !== 0x0a) return false;
    let len = 0, shift = 0, i = 1;
    for (; i < data.length && i <= 5; i++) {
      len += (data[i] & 0x7f) * 2 ** shift;
      shift += 7;
      if (!(data[i] & 0x80)) { i++; break; }
    }
    return i + len === data.length;
  }
  if (name.endsWith('.png')) return detectFormat(data) === 'png';
  try {
    const v = JSON.parse(data.toString('utf8'));
    return !!v && typeof v === 'object' && !Array.isArray(v);
  } catch { return false; }
}

/**
 * MBTiles векторных тайлов (format = pbf; metadata и tiles — таблицы, а не представления, триггеры
 * или виртуальные таблицы): число тайлов; иначе — 422.
 */
function checkMbtiles(file: string): number {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(file, { readOnly: true });
    const tables = db.prepare("select name from sqlite_master where type = 'table' and name in ('metadata', 'tiles') and sql not like 'create virtual%' collate nocase").all() as { name: string }[];
    if (tables.length !== 2) throw new Error('tables');
    const f = db.prepare("select value from metadata where name = 'format'").get() as { value: string } | undefined;
    if (f?.value !== 'pbf') throw new Error('format');
    return (db.prepare('select count(*) as n from tiles').get() as { n: number }).n;
  } catch {
    throw new HttpError(422, 'invalid', 'ohm.mbtiles: не MBTiles с векторными тайлами');
  } finally {
    db?.close();
  }
}
