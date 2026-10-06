/**
 * Импорт тайловых архивов SQLite: офлайн-карты из других программ.
 *
 *  - .sqlitedb (RMaps / Locus Map / OsmAnd): таблица tiles(x, y, z, s, image);
 *    уровень записан как 17 − z («BigPlanet»), если в info не указано
 *    tilenumbering = 'simple'; info.inverted_y — ось Y снизу вверх.
 *  - .mbtiles (MBTiles 1.x): tiles(zoom_level, tile_column, tile_row, tile_data),
 *    ось Y по схеме TMS (снизу вверх); metadata(name, value).
 *
 * Тайлы перекладываются в хранилище без перекодирования (формат — по содержимому).
 */
import { DatabaseSync } from 'node:sqlite';
import { tileBBox, type BBox, type MapSource } from '@def-ops/core';
import { HttpError } from '@def-ops/service-kit';
import type { JobContext } from './jobs';
import { detectFormat, type TileExt, type TileStore } from './tiles';

export interface ArchiveInfo {
  format: 'sqlitedb' | 'mbtiles';
  name?: string;
  attribution?: string;
  description?: string;
  total: number;
}

export interface ArchiveResult {
  tiles: number;
  bytes: number;
  errors: number;
  minzoom: number;
  maxzoom: number;
  bounds: BBox;
  ext: TileExt;
}

function tableColumns(db: DatabaseSync, table: string): string[] {
  try { return (db.prepare(`pragma table_info(${table})`).all() as { name: string }[]).map((r) => r.name.toLowerCase()); } catch { return []; }
}

function kv(db: DatabaseSync, table: string): Record<string, string> {
  const cols = tableColumns(db, table);
  const out: Record<string, string> = {};
  if (cols.includes('name') && cols.includes('value')) {
    for (const r of db.prepare(`select name, value from ${table}`).all() as { name: string; value: unknown }[]) out[String(r.name).toLowerCase()] = String(r.value ?? '');
  } else if (cols.length) {
    // info из RMaps/OsmAnd — одна строка с колонками minzoom, maxzoom, tilenumbering, inverted_y, url…
    const row = db.prepare(`select * from ${table} limit 1`).get() as Record<string, unknown> | undefined;
    if (row) for (const [k, v] of Object.entries(row)) out[k.toLowerCase()] = String(v ?? '');
  }
  return out;
}

/** Открыть архив и определить его формат. Ошибка 422 — если это не тайловый архив. */
export function openArchive(file: string): { db: DatabaseSync; info: ArchiveInfo; meta: Record<string, string> } {
  let db: DatabaseSync;
  try { db = new DatabaseSync(file, { readOnly: true }); db.prepare('select 1').get(); } catch {
    throw new HttpError(422, 'invalid', 'Файл не является базой SQLite (.sqlitedb или .mbtiles)');
  }
  const cols = tableColumns(db, 'tiles');
  if (['x', 'y', 'z', 'image'].every((c) => cols.includes(c))) {
    const meta = kv(db, 'info');
    const total = Number((db.prepare('select count(*) as n from tiles').get() as { n: number }).n);
    return { db, meta, info: { format: 'sqlitedb', total, name: meta.name || undefined, attribution: meta.url ? `источник: ${meta.url}` : undefined } };
  }
  if (['zoom_level', 'tile_column', 'tile_row', 'tile_data'].every((c) => cols.includes(c))) {
    const meta = kv(db, 'metadata');
    const total = Number((db.prepare('select count(*) as n from tiles').get() as { n: number }).n);
    return { db, meta, info: { format: 'mbtiles', total, name: meta.name || undefined, attribution: meta.attribution || undefined, description: meta.description || undefined } };
  }
  db.close();
  throw new HttpError(422, 'invalid', 'В базе нет таблицы тайлов в формате RMaps/Locus (.sqlitedb) или MBTiles');
}

/** Переложить тайлы архива в хранилище карты. */
export async function importArchive(ctx: JobContext, store: TileStore, mapId: string, file: string): Promise<ArchiveResult & { info: ArchiveInfo }> {
  const { db, info, meta } = openArchive(file);
  try {
    ctx.progress({ total: info.total });
    let rows: Iterable<{ z: number; x: number; y: number; data: Uint8Array }>;
    let toXyz: (z: number, x: number, y: number) => [number, number, number];
    if (info.format === 'sqlitedb') {
      const simple = (meta.tilenumbering ?? '').toLowerCase() === 'simple';
      const invY = ['1', 'true', 'yes'].includes((meta.inverted_y ?? '').toLowerCase());
      if (meta.ellipsoid === '1') throw new HttpError(422, 'invalid', 'Архив в проекции эллипсоида (Яндекс) — не поддерживается, нужна сферическая Web Mercator');
      rows = db.prepare('select z, x, y, image as data from tiles').iterate() as Iterable<{ z: number; x: number; y: number; data: Uint8Array }>;
      toXyz = (z, x, y) => {
        const zoom = simple ? z : 17 - z;
        return [zoom, x, invY ? (1 << zoom) - 1 - y : y];
      };
    } else {
      rows = db.prepare('select zoom_level as z, tile_column as x, tile_row as y, tile_data as data from tiles').iterate() as Iterable<{ z: number; x: number; y: number; data: Uint8Array }>;
      toXyz = (z, x, y) => [z, x, (1 << z) - 1 - y]; // TMS → XYZ
    }
    let tiles = 0, bytes = 0, errors = 0, minzoom = 99, maxzoom = -1;
    const exts = new Map<TileExt, number>();
    const range = new Map<number, [number, number, number, number]>();
    let n = 0;
    for (const r of rows) {
      if (++n % 200 === 0) { ctx.check(); await new Promise((res) => setImmediate(res)); }
      const [z, x, y] = toXyz(Number(r.z), Number(r.x), Number(r.y));
      const data = Buffer.from(r.data ?? []);
      const ext = detectFormat(data);
      if (!ext || z < 0 || z > 22 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) {
        errors++;
        ctx.progress({ done: ctx.job.done + 1, errors: ctx.job.errors + 1 });
        continue;
      }
      await store.write(ctx.tenant, mapId, z, x, y, ext, data);
      tiles++; bytes += data.length;
      exts.set(ext, (exts.get(ext) ?? 0) + 1);
      minzoom = Math.min(minzoom, z); maxzoom = Math.max(maxzoom, z);
      const b = range.get(z);
      range.set(z, b ? [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)] : [x, y, x, y]);
      ctx.progress({ done: ctx.job.done + 1 });
    }
    ctx.check();
    if (!tiles) throw new HttpError(422, 'invalid', 'В архиве нет пригодных тайлов');
    // охват — по самому подробному уровню
    const [x0, y0, x1, y1] = range.get(maxzoom)!;
    const nw = tileBBox(x0, y0, maxzoom), se = tileBBox(x1, y1, maxzoom);
    const bounds: BBox = [nw[0], se[1], se[2], nw[3]];
    const ext = [...exts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    return { tiles, bytes, errors, minzoom, maxzoom, bounds, ext, info };
  } finally {
    db.close();
  }
}

/** Карта по архиву: имя, источник, уровни и охват — из содержимого. */
export function mapFromArchive(r: ArchiveResult & { info: ArchiveInfo }): Partial<MapSource> {
  return { minzoom: r.minzoom, maxzoom: r.maxzoom, bounds: r.bounds, format: r.ext };
}
