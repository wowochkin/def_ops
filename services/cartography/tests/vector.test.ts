/** OpenHistoricalMap: нарезка признаков в векторные тайлы MBTiles, чтение тайлов, стиль. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { promises as fs, existsSync, statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { gunzipSync } from 'node:zlib';
import { PbfReader } from 'pbf';
import { VectorTile } from '@mapbox/vector-tile';
import { validateStyleMin, type StyleSpecification } from '@maplibre/maplibre-gl-style-spec';
import { tileOf, tileRange, type BBox, type LngLat, type MapJob } from '@def-ops/core';
import { CancelledError, type JobContext } from '../src/jobs';
import { OHM_LAYERS, type OhmFeature, type OhmLayer } from '../src/ohm-features';
import { OHM_FONTS, OHM_ICONS } from '../src/ohm';
import { encodeTile, tileFeatures, VectorTiles, OHM_MAXZOOM, BANDS } from '../src/vector';
import { ohmStyle } from '../src/ohm-style';
import { tempDir } from './helpers';

const ATTR = '© участники OpenHistoricalMap, CC0';
const AREA: BBox = [12.0, 52.0, 14.0, 52.7];

function ctx(onCheck?: (n: number) => void): JobContext {
  const job: MapJob = { id: 'j', mapId: 'm', type: 'ohm-download', status: 'running', done: 5, total: 0, skipped: 0, errors: 0, createdAt: '', updatedAt: '' };
  let n = 0;
  return { job, tenant: 't', signal: new AbortController().signal, progress: (p) => Object.assign(job, p), check: () => onCheck?.(n++) };
}

const rect = (w: number, s: number, e: number, n: number): LngLat[][] => [[[w, s], [e, s], [e, n], [w, n], [w, s]]];
const FEATURES: OhmFeature[] = [
  { type: 'Feature', properties: { layer: 'buildings', class: 'yes', minzoom: 13, id: 'w1', from: 1706 },
    geometry: { type: 'Polygon', coordinates: rect(13.3925, 52.5165, 13.3935, 52.517) } },
  { type: 'Feature', properties: { layer: 'roads', class: 'residential', minzoom: 10, id: 'w2' },
    geometry: { type: 'LineString', coordinates: [[13.38, 52.51], [13.40, 52.52]] } },
  { type: 'Feature', properties: { layer: 'roads', class: 'primary', minzoom: 0, id: 'w3', name: 'R1' },
    geometry: { type: 'LineString', coordinates: [[12.05, 52.05], [13.95, 52.05]] } },
  { type: 'Feature', properties: { layer: 'landuse', class: 'forest', minzoom: 8, id: 'w4', from: 1900 },
    geometry: { type: 'Polygon', coordinates: rect(13.20, 52.30, 13.65, 52.45) } },
];

let dir = '';
let file = '';
let result: Awaited<ReturnType<typeof tileFeatures>>;
let db: DatabaseSync;
let c: JobContext;

beforeAll(async () => {
  dir = await tempDir('vector-');
  file = path.join(dir, 'ohm.mbtiles');
  c = ctx();
  result = await tileFeatures(c, FEATURES, AREA, file, { name: 'OHM', description: 'OpenHistoricalMap: 4 объекта' });
  db = new DatabaseSync(file, { readOnly: true });
});
afterAll(async () => {
  db?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

function raw(z: number, x: number, y: number): Uint8Array | null {
  const r = db.prepare('select tile_data as d from tiles where zoom_level = ? and tile_column = ? and tile_row = ?').get(z, x, (1 << z) - 1 - y) as { d: Uint8Array } | undefined;
  return r ? r.d : null;
}
function tileAt(ll: LngLat, z: number): VectorTile | null {
  const [x, y] = tileOf(ll, z);
  const d = raw(z, x, y);
  return d ? new VectorTile(new PbfReader(gunzipSync(d))) : null;
}
function feats(t: VectorTile | null, layer: OhmLayer) {
  const l = t?.layers[layer];
  return l ? Array.from({ length: l.length }, (_, i) => l.feature(i)) : [];
}
const ofClass = (t: VectorTile | null, layer: OhmLayer, cls: string) => feats(t, layer).filter((f) => f.properties.class === cls);

describe('нарезка в MBTiles', () => {
  it('константы', () => {
    expect(OHM_MAXZOOM).toBe(16);
    expect(BANDS).toEqual([[0, 7, 0], [8, 9, 8], [10, 12, 10], [13, 16, 13]]);
  });

  it('здание — с z13, не на z12', () => {
    const p: LngLat = [13.393, 52.5167];
    expect(tileAt(p, 12)?.layers.buildings).toBeUndefined();
    for (const z of [13, 16]) {
      const b = feats(tileAt(p, z), 'buildings');
      expect(b).toHaveLength(1);
      expect(b[0].properties.from).toBe(1706);
      expect(b[0].properties.class).toBe('yes');
    }
  });

  it('улица — с z10, не на z9', () => {
    const p: LngLat = [13.39, 52.515];
    expect(ofClass(tileAt(p, 9), 'roads', 'residential')).toHaveLength(0);
    expect(ofClass(tileAt(p, 10), 'roads', 'residential')).toHaveLength(1);
  });

  it('магистраль через весь район — во всех блоках z10, без повторов в тайле', () => {
    const z10x = new Set<number>();
    for (const p of [[12.1, 52.05], [13.0, 52.05], [13.9, 52.05]] as LngLat[]) {
      expect(ofClass(tileAt(p, 12), 'roads', 'primary')).toHaveLength(1);
      z10x.add(tileOf(p, 10)[0]);
    }
    expect(z10x.size).toBe(3);
    expect(ofClass(tileAt([13.0, 52.05], 5), 'roads', 'primary')).toHaveLength(1);
    const rows = db.prepare('select tile_data as d from tiles').all() as { d: Uint8Array }[];
    for (const r of rows) {
      const t = new VectorTile(new PbfReader(gunzipSync(r.d)));
      expect(ofClass(t, 'roads', 'primary').length).toBeLessThanOrEqual(1);
    }
  });

  it('лес шире блока — с z8, заливает тайлы внутри себя целиком', () => {
    expect(tileAt([13.42, 52.37], 7)?.layers.landuse).toBeUndefined();
    expect(feats(tileAt([13.42, 52.37], 8), 'landuse')).toHaveLength(1);
    expect(tileOf([13.30, 52.37], 10)[0]).toBe(549);
    expect(tileOf([13.42, 52.37], 10)[0]).toBe(550);
    for (const p of [[13.30, 52.37], [13.42, 52.37]] as LngLat[]) {
      const f = feats(tileAt(p, 12), 'landuse');
      expect(f).toHaveLength(1);
      expect(f[0].type).toBe(3);
      expect(f[0].properties.from).toBe(1900);
      const ring = f[0].loadGeometry();
      expect(ring).toHaveLength(1);
      const xs = ring[0].map((q) => q.x), ys = ring[0].map((q) => q.y);
      expect(Math.min(...xs)).toBeLessThan(0);
      expect(Math.max(...xs)).toBeGreaterThan(4096);
      expect(Math.min(...ys)).toBeLessThan(0);
      expect(Math.max(...ys)).toBeGreaterThan(4096);
    }
  });

  it('metadata, TMS, тайлы только в районе, итог', () => {
    const m = Object.fromEntries((db.prepare('select name, value from metadata').all() as { name: string; value: string }[]).map((r) => [r.name, r.value]));
    expect(m.format).toBe('pbf');
    expect(m.minzoom).toBe('0');
    expect(m.maxzoom).toBe('16');
    expect(m.attribution).toBe(ATTR);
    expect(m.name).toBe('OHM');
    expect(m.description).toBe('OpenHistoricalMap: 4 объекта');
    expect(m.bounds).toBe('12,52,14,52.7');
    expect(m.center.split(',')).toHaveLength(3);
    expect(JSON.parse(m.json).vector_layers.map((l: { id: string }) => l.id)).toEqual(OHM_LAYERS);

    const [bx, by] = tileOf([13.393, 52.5167], 13);
    expect(raw(13, bx, by)).not.toBeNull();
    // по XYZ-строке (без переворота) тайла нет
    expect((db.prepare('select count(*) as n from tiles where zoom_level = 13 and tile_column = ? and tile_row = ?').get(bx, by) as { n: number }).n).toBe(0);

    const all = db.prepare('select zoom_level as z, tile_column as x, tile_row as y from tiles').all() as { z: number; x: number; y: number }[];
    for (const t of all) {
      const r = tileRange(AREA, t.z);
      const y = (1 << t.z) - 1 - t.y;
      expect(t.x >= r.x0 && t.x <= r.x1 && y >= r.y0 && y <= r.y1, `${t.z}/${t.x}/${y}`).toBe(true);
    }
    const count = (db.prepare('select count(*) as n from tiles').get() as { n: number }).n;
    expect(result.tiles).toBe(count);
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.layers).toEqual({ roads: 2, rail: 0, water: 0, landuse: 1, buildings: 1, boundaries: 0, places: 0, pois: 0 });
    // ход: +1 за полосы z0–9 и +1 на каждый блок z10 — от прежнего done
    expect(c.job.done).toBe(5 + 1 + tileRange(AREA, 10).count);
    expect(existsSync(file + '.tmp')).toBe(false);
  });

  it('encodeTile', () => {
    expect(encodeTile(null)).toBeNull();
    const [x, y] = tileOf([13.393, 52.5167], 13);
    const d = raw(13, x, y)!;
    expect(d[0]).toBe(0x1f);
    expect(d[1]).toBe(0x8b);
  });

  it('VectorTiles: тайл как в базе, нет — null, stats, close', async () => {
    const copy = path.join(dir, 'copy.mbtiles');
    await fs.copyFile(file, copy);
    const vt = new VectorTiles();
    const [x, y] = tileOf([13.393, 52.5167], 13);
    const got = vt.get(copy, 13, x, y);
    expect(got).not.toBeNull();
    expect(Buffer.compare(got!, Buffer.from(raw(13, x, y)!))).toBe(0);
    expect(vt.get(copy, 13, 0, 0)).toBeNull();
    expect(vt.stats(copy)).toEqual({ tiles: result.tiles, bytes: statSync(copy).size });
    vt.close(copy);
    await fs.rm(copy);
    expect(existsSync(copy)).toBe(false);
    vt.closeAll();
  });

  it('отмена после первого блока — файл не создан', async () => {
    const f = path.join(dir, 'cancel.mbtiles');
    const cc = ctx((n) => { if (n >= 1) throw new CancelledError(); });
    await expect(tileFeatures(cc, FEATURES, AREA, f, { name: 'x', description: 'x' })).rejects.toBeInstanceOf(CancelledError);
    expect(existsSync(f)).toBe(false);
    expect(existsSync(f + '.tmp')).toBe(false);
  });
});

describe('стиль OHM', () => {
  const style = ohmStyle({
    name: 'OHM', tiles: '/api/cartography/maps/x/tiles/{z}/{x}/{y}.pbf?v=1', glyphs: '/api/cartography/fonts/{fontstack}/{range}.pbf',
    sprite: '/api/cartography/sprites/ohm', bounds: [11, 50.9, 15.6, 54.45], attribution: ATTR,
  });
  const layers = style.layers as { id: string; type: string; 'source-layer'?: string; minzoom?: number; layout?: Record<string, unknown>; paint?: Record<string, unknown> }[];

  it('проходит проверку спецификации', () => {
    expect(validateStyleMin(style as unknown as StyleSpecification)).toEqual([]);
  });

  it('слои источника, шрифты, значки, прозрачность', () => {
    expect(new Set(layers.map((l) => l['source-layer']).filter(Boolean))).toEqual(new Set(OHM_LAYERS));
    const fonts = new Set<string>(), icons = new Set<string>();
    const walk = (v: unknown, into: Set<string>) => {
      if (typeof v === 'string') into.add(v);
      else if (Array.isArray(v)) for (const x of v) walk(x, into);
    };
    for (const l of layers) {
      if (l.layout?.['text-font']) walk(l.layout['text-font'], fonts);
      const ic = l.layout?.['icon-image'];
      if (ic !== undefined) {
        // строки-литералы выражения, похожие на имена значков
        const s = new Set<string>();
        walk(ic, s);
        for (const v of s) if (/-\d+$/.test(v)) icons.add(v);
        expect(s.size).toBeGreaterThan(0);
      }
      for (const [k, v] of Object.entries(l.paint ?? {})) if (k.endsWith('-opacity')) expect(typeof v, `${l.id} ${k}`).toBe('number');
    }
    expect(fonts.size).toBeGreaterThan(0);
    for (const f of fonts) expect(OHM_FONTS).toContain(f);
    expect(icons.size).toBeGreaterThan(0);
    for (const i of icons) expect(OHM_ICONS).toContain(i);
  });

  it('здания — с z13, источник до z16, признак «на дату»', () => {
    const b = layers.filter((l) => l['source-layer'] === 'buildings');
    expect(b.length).toBeGreaterThan(0);
    for (const l of b) expect(l.minzoom).toBe(13);
    expect((style.sources.ohm as { maxzoom: number }).maxzoom).toBe(16);
    expect((style.sources.ohm as { type: string }).type).toBe('vector');
    expect(style.metadata['def-ops:dated']).toBe(true);
    expect(style.version).toBe(8);
    expect(style.layers[0]).toMatchObject({ type: 'background' });
  });
});
