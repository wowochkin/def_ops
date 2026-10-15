/**
 * Векторные тайлы OpenHistoricalMap: нарезка признаков в MBTiles и чтение тайлов.
 *
 * Нарезка — @maplibre/geojson-vt (extent 4096, buffer 64, tolerance 3, maxZoom 16) по полосам
 * уровней: z0–7 и z8–9 — одним индексом на весь район (признаков мало: без зданий, улиц, троп),
 * z10–12 и z13–16 — по блокам-тайлам z10: в индекс блока идут только признаки, задевающие блок
 * (с запасом 1/16 блока), индекс отпускается после блока — память ограничена одним блоком,
 * а не всем театром. Упрощение geojson-vt считается в координатах мира и от блока не зависит,
 * поэтому на стыках блоков разрывов нет. Признаки тайла делятся по слою (`layer`) в слои MVT
 * (@maplibre/vt-pbf), тайл сжимается gzip; тайл без признаков не пишется.
 *
 * MBTiles 1.3: metadata(name, value), tiles(zoom_level, tile_column, tile_row, tile_data),
 * tile_row по TMS. Файл пишется прямо по указанному пути (прежний удаляется в начале, при сбое
 * и отмене — тоже); временное имя и замена готовой карты — у вызывающего (buildOhm).
 */
import { promises as fs, statSync } from 'node:fs';
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { gzipSync } from 'node:zlib';
import { GeoJSONVT, type GeoJSONVTTile } from '@maplibre/geojson-vt';
import { fromGeojsonVt } from '@maplibre/vt-pbf';
import { mercator, tileRange, type BBox, type LngLat } from '@def-ops/core';
import type { JobContext } from './jobs';
import { OHM_LAYERS, type OhmFeature, type OhmLayer } from './ohm-features';

export const OHM_MAXZOOM = 16;
/** Полосы уровней: от, до, наибольший minzoom признаков полосы. */
export const BANDS: readonly [number, number, 0 | 8 | 10 | 13][] = [[0, 7, 0], [8, 9, 8], [10, 12, 10], [13, 16, 13]];
/** Уровень блоков нарезки. */
const BLOCK_Z = 10;
/** Запас блока при отборе признаков, доля блока. */
const BLOCK_PAD = 1 / 16;
const VT = { maxZoom: OHM_MAXZOOM, indexMaxZoom: 5, extent: 4096, buffer: 64, tolerance: 3 } as const;
const ATTRIBUTION = '© участники OpenHistoricalMap, CC0';

/** Уровень появления и поля слоёв (`vector_layers` в metadata). */
const LAYER_MINZOOM: Record<OhmLayer, number> = { roads: 0, rail: 0, water: 0, landuse: 8, buildings: 13, boundaries: 0, places: 0, pois: 13 };
const FIELDS: Record<string, string> = {
  class: 'String', id: 'String', minzoom: 'Number', name: 'String', from: 'Number', to: 'Number',
};
const LAYER_FIELDS: Partial<Record<OhmLayer, Record<string, string>>> = {
  roads: { bridge: 'Number', tunnel: 'Number' }, rail: { bridge: 'Number', tunnel: 'Number' }, boundaries: { admin_level: 'Number' },
};

/** Тайл geojson-vt → MVT (слои по `layer`), gzip; без признаков — null. */
export function encodeTile(tile: GeoJSONVTTile | null): Buffer | null {
  if (!tile || !tile.features.length) return null;
  const layers: Record<string, GeoJSONVTTile> = {};
  for (const f of tile.features) {
    const name = String(f.tags?.layer ?? '');
    if (!name) continue;
    (layers[name] ??= { ...tile, features: [] }).features.push(f);
  }
  if (!Object.keys(layers).length) return null;
  return gzipSync(fromGeojsonVt(layers, { version: 2, extent: VT.extent }));
}

/** Рамка признака в координатах тайлов уровня BLOCK_Z: [x0, y0, x1, y1]. */
function blockBox(f: OhmFeature): [number, number, number, number] {
  const n = 1 << BLOCK_Z;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (p: number[]) => {
    const [x, y] = mercator(p as LngLat);
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  };
  const g = f.geometry;
  if (g.type === 'Point') add(g.coordinates);
  else if (g.type === 'LineString') g.coordinates.forEach(add);
  else for (const r of g.coordinates) r.forEach(add);
  return [x0 * n, y0 * n, x1 * n, y1 * n];
}

function createMbtiles(file: string, bbox: BBox, meta: { name: string; description: string }): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec(`pragma journal_mode = off; pragma synchronous = off;
    create table metadata (name text, value text);
    create table tiles (zoom_level integer, tile_column integer, tile_row integer, tile_data blob);
    create unique index tile_index on tiles (zoom_level, tile_column, tile_row);`);
  const [w, s, e, n] = bbox;
  const cz = Math.max(0, Math.min(OHM_MAXZOOM, Math.round(Math.log2(360 / (e - w)))));
  const vectorLayers = OHM_LAYERS.map((id) => ({ id, fields: { ...FIELDS, ...LAYER_FIELDS[id] }, minzoom: LAYER_MINZOOM[id], maxzoom: OHM_MAXZOOM }));
  const rows: [string, string][] = [
    ['name', meta.name], ['format', 'pbf'], ['type', 'baselayer'], ['version', '1.3'],
    ['minzoom', '0'], ['maxzoom', String(OHM_MAXZOOM)],
    ['bounds', `${w},${s},${e},${n}`], ['center', `${+((w + e) / 2).toFixed(6)},${+((s + n) / 2).toFixed(6)},${cz}`],
    ['attribution', ATTRIBUTION], ['description', meta.description],
    ['json', JSON.stringify({ vector_layers: vectorLayers })],
  ];
  const ins = db.prepare('insert into metadata (name, value) values (?, ?)');
  for (const r of rows) ins.run(...r);
  return db;
}

const collection = (features: OhmFeature[]): GeoJSON.FeatureCollection => ({ type: 'FeatureCollection', features });

/**
 * Нарезать признаки района в MBTiles `file` (z0–16). Ход: +1 за полосы z0–9 и +1 на каждый
 * блок z10 — от `ctx.job.done` на входе; между блоками — ctx.check().
 */
export async function tileFeatures(
  ctx: JobContext, features: OhmFeature[], bbox: BBox, file: string, meta: { name: string; description: string },
): Promise<{ tiles: number; bytes: number; layers: Record<OhmLayer, number> }> {
  const layers = Object.fromEntries(OHM_LAYERS.map((l) => [l, 0])) as Record<OhmLayer, number>;
  for (const f of features) layers[f.properties.layer] = (layers[f.properties.layer] ?? 0) + 1;

  await fs.rm(file, { force: true });
  const db = createMbtiles(file, bbox, meta);
  let tiles = 0;
  try {
    const ins = db.prepare('insert or replace into tiles (zoom_level, tile_column, tile_row, tile_data) values (?, ?, ?, ?)');
    const put = (z: number, x: number, y: number, data: Buffer | null) => {
      if (!data) return;
      ins.run(z, x, (1 << z) - 1 - y, data);
      tiles++;
    };
    const tx = (fn: () => void) => {
      db.exec('begin');
      try { fn(); db.exec('commit'); } catch (e) { db.exec('rollback'); throw e; }
    };
    let done = ctx.job.done;

    // z0–9: одним индексом на весь район
    for (const [z0, z1, mz] of BANDS) {
      if (z0 >= BLOCK_Z) continue;
      const sel = features.filter((f) => f.properties.minzoom <= mz);
      if (!sel.length) continue;
      const index = new GeoJSONVT(collection(sel), VT);
      tx(() => {
        for (let z = z0; z <= z1; z++) {
          const r = tileRange(bbox, z);
          for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) put(z, x, y, encodeTile(index.getTile(z, x, y)));
        }
      });
    }
    const br = tileRange(bbox, BLOCK_Z);
    const nb = br.count;
    ctx.progress({ done: ++done, message: `нарезка: блок 0 из ${nb}, тайлов ${tiles}` });

    // z10–16: по блокам z10; признаки раскладываются по блокам, которые задевают
    const buckets = new Map<number, number[]>();
    const cols = br.x1 - br.x0 + 1;
    features.forEach((f, i) => {
      const [fx0, fy0, fx1, fy1] = blockBox(f);
      const bx0 = Math.max(br.x0, Math.floor(fx0 - BLOCK_PAD)), bx1 = Math.min(br.x1, Math.floor(fx1 + BLOCK_PAD));
      const by0 = Math.max(br.y0, Math.floor(fy0 - BLOCK_PAD)), by1 = Math.min(br.y1, Math.floor(fy1 + BLOCK_PAD));
      for (let by = by0; by <= by1; by++) for (let bx = bx0; bx <= bx1; bx++) {
        const k = (by - br.y0) * cols + (bx - br.x0);
        const b = buckets.get(k);
        if (b) b.push(i); else buckets.set(k, [i]);
      }
    });

    let b = 0;
    for (let by = br.y0; by <= br.y1; by++) for (let bx = br.x0; bx <= br.x1; bx++) {
      ctx.check();
      b++;
      const k = (by - br.y0) * cols + (bx - br.x0);
      const idx = buckets.get(k);
      buckets.delete(k);
      if (idx) {
        const sel = idx.map((i) => features[i]);
        for (const [z0, z1, mz] of BANDS) {
          if (z0 < BLOCK_Z) continue;
          const part = sel.filter((f) => f.properties.minzoom <= mz);
          if (!part.length) continue;
          let index: GeoJSONVT | null = new GeoJSONVT(collection(part), VT);
          tx(() => {
            for (let z = z0; z <= z1; z++) {
              const r = tileRange(bbox, z);
              const k2 = 1 << (z - BLOCK_Z);
              const x0 = Math.max(r.x0, bx * k2), x1 = Math.min(r.x1, bx * k2 + k2 - 1);
              const y0 = Math.max(r.y0, by * k2), y1 = Math.min(r.y1, by * k2 + k2 - 1);
              for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) put(z, x, y, encodeTile(index!.getTile(z, x, y)));
            }
          });
          index = null; // индекс блока отпускается
        }
      }
      ctx.progress({ done: ++done, message: `нарезка: блок ${b} из ${nb}, тайлов ${tiles}` });
      await new Promise((r) => setImmediate(r)); // служба остаётся отзывчивой
    }
    db.close();
  } catch (e) {
    if (db.isOpen) db.close();
    await fs.rm(file, { force: true });
    throw e;
  }
  return { tiles, bytes: statSync(file).size, layers };
}

/** Чтение тайлов векторных карт: открытые базы кэшируются по пути, только чтение. */
export class VectorTiles {
  private open = new Map<string, { db: DatabaseSync; tile: StatementSync }>();

  private db(file: string): { db: DatabaseSync; tile: StatementSync } | null {
    let o = this.open.get(file);
    if (!o) {
      let db: DatabaseSync;
      try { db = new DatabaseSync(file, { readOnly: true }); } catch { return null; }
      o = { db, tile: db.prepare('select tile_data as d from tiles where zoom_level = ? and tile_column = ? and tile_row = ?') };
      this.open.set(file, o);
    }
    return o;
  }

  /** Тайл как хранится (gzip); нет — null. */
  get(file: string, z: number, x: number, y: number): Buffer | null {
    if (z < 0 || z > 30 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return null;
    const r = this.db(file)?.tile.get(z, x, (1 << z) - 1 - y) as { d: Uint8Array } | undefined;
    return r ? Buffer.from(r.d.buffer, r.d.byteOffset, r.d.byteLength) : null;
  }

  stats(file: string): { tiles: number; bytes: number } {
    const o = this.db(file);
    const tiles = o ? (o.db.prepare('select count(*) as n from tiles').get() as { n: number }).n : 0;
    let bytes = 0;
    try { bytes = statSync(file).size; } catch { /* нет файла */ }
    return { tiles, bytes };
  }

  close(file: string): void {
    const o = this.open.get(file);
    if (!o) return;
    this.open.delete(file);
    if (o.db.isOpen) o.db.close();
  }

  closeAll(): void {
    for (const f of [...this.open.keys()]) this.close(f);
  }
}
