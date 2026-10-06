/**
 * Пакет карты для переноса в закрытый контур: архив tar
 *   map.json                 — описание карты (MapSource);
 *   tiles/{z}/{x}/{y}.{ext}  — тайлы пирамиды как есть (без обрезки по границе:
 *                              граница переносится в map.json).
 * Выгрузка и загрузка идут потоком — архив не собирается целиком ни в памяти, ни
 * на диске. Загружаемый пакет становится новой картой (новый id, kind 'package').
 */
import { once } from 'node:events';
import { promises as fs } from 'node:fs';
import type http from 'node:http';
import tar from 'tar-stream';
import type { MapSource } from '@def-ops/core';
import { HttpError } from '@def-ops/service-kit';
import type { JobContext } from './jobs';
import { detectFormat, type TileStore } from './tiles';
import { asObject, buildMap, rasterRequest, WORLD } from './validate';

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
  res.writeHead(200, {
    'Content-Type': 'application/x-tar',
    'Content-Disposition': `attachment; filename="${ascii}.tar"; filename*=UTF-8''${encodeURIComponent(filename)}.tar`,
    'Cache-Control': 'no-store',
  });
  const pack = tar.pack();
  pack.pipe(res);
  let closed = false;
  res.on('close', () => { closed = true; });
  const add = (name: string, data: Buffer, mtime = new Date()) => new Promise<void>((resolve, reject) =>
    pack.entry({ name, size: data.length, mtime, mode: 0o644 }, data, (e) => (e ? reject(e) : resolve())));
  await add('map.json', Buffer.from(JSON.stringify(packageMeta(map), null, 2)));
  for await (const t of store.walk(tenant, map.id)) {
    if (closed) break;
    let data: Buffer;
    try { data = await fs.readFile(t.file); } catch { continue; }
    await add(`tiles/${t.z}/${t.x}/${t.y}.${t.ext}`, data);
    if (res.writableNeedDrain) await Promise.race([once(res, 'drain'), once(res, 'close')]);
  }
  pack.finalize();
  if (!closed) await Promise.race([once(res, 'finish'), once(res, 'close')]);
}

/** Описание карты из пакета → новая карта организации (проверяется как при создании). */
export function mapFromPackage(raw: unknown, id: string, now: string): MapSource {
  const b = asObject(raw);
  const m = buildMap(b, {
    id, kind: 'package', format: 'png', tileSize: 256, minzoom: 0, maxzoom: 18, bounds: WORLD, coverage: null, opacity: 1,
    sourceUrl: null, controlPoints: null, stats: { tiles: 0, bytes: 0 }, createdAt: now, updatedAt: now,
  });
  m.id = id;
  m.kind = 'package';
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
      const m = h.type === 'file' ? TILE_RE.exec(name) : null;
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
  return { map, tiles, bytes };
}
