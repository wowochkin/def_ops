/**
 * Исторический слой по растровой карте (скан, тайловый архив): пиксели классифицируются по «легенде» (тон,
 * насыщенность, яркость), доли классов сводятся на сетку театра → маски клеток (дороги, вода, застройка, лес).
 * Маски ложатся поверх театра: местность того времени, дороги исторической карты (растр roadGrid) вместо
 * современных. Тот же формат, что у tools/theatre/raster_overlay.ts, и та же поправка, что у сборщика
 * (build_theatre.py, рецепт overlays) — поправку из браузера можно отдать сборщику.
 */
import type { LngLat } from '@def-ops/core';
import { decodeGrid, encodeGrid } from './theatre';
import { TERRAIN_CLASSES, type TerrainClass, type TerrainGrid, type TheatreData } from './types';

type Range = [number, number];
export interface LegendRule { h?: Range; s?: Range; v?: Range }
export interface OverlayLegend {
  id: string; name: string; note?: string;
  /** Классы пикселей: пиксель относится к первому подходящему. */
  pixels: Record<string, LegendRule[]>;
  /** Класс клетки: доля пикселей класса (или суммы классов) не меньше порога. */
  cells: { cls: string; of: string[]; min: number }[];
}
export interface OverlayResult {
  legend: string; name: string; source: string; zoom: number;
  bbox: [number, number, number, number]; cols: number; rows: number;
  /** RLE «число+0/1» через запятую, строки с севера на юг. */
  covered: string; masks: Record<string, string>; stats: Record<string, number>;
}

/** HSV: тон 0–360, насыщенность и яркость 0–1. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx / 255];
}
const inR = (x: number, r?: Range) => !r || (r[0] <= r[1] ? x >= r[0] && x <= r[1] : x >= r[0] || x <= r[1]);
export const pixelClass = (legend: OverlayLegend, names: string[], r: number, g: number, b: number) => {
  const [h, s, v] = hsv(r, g, b);
  return names.findIndex((n) => legend.pixels[n].some((x) => inR(h, x.h) && inR(s, x.s) && inR(v, x.v)));
};

/** Легенда по образцам цвета, снятым с карты: на каждый образец — окно тона, насыщенности и яркости. */
export function legendFromSamples(samples: Record<string, [number, number, number][]>, tol = 1, mins: Record<string, number> = {}): OverlayLegend {
  const pixels: Record<string, LegendRule[]> = {};
  const clamp = (a: number, b: number): Range => [Math.max(0, +a.toFixed(3)), Math.min(1, +b.toFixed(3))];
  for (const [cls, list] of Object.entries(samples)) {
    if (!list.length) continue;
    pixels[cls] = list.map(([r, g, b]) => {
      const [h, s, v] = hsv(r, g, b);
      const dh = 14 * tol, ds = 0.16 * tol, dv = 0.16 * tol;
      // серые и чёрные (тушь, железные дороги): тон не определён — только яркость и малая насыщенность
      if (s < 0.12) return { s: clamp(0, s + ds), v: clamp(v - dv, v + dv) };
      return { h: [(h - dh + 360) % 360, (h + dh) % 360] as Range, s: clamp(s - ds, s + ds), v: clamp(v - dv, v + dv) };
    });
  }
  const DEF: Record<string, number> = { road: 0.06, highway: 0.06, rail: 0.06, water: 0.3, urban: 0.35, forest: 0.35, marsh: 0.3 };
  return { id: 'samples', name: 'по образцам цвета', pixels, cells: Object.keys(pixels).map((c) => ({ cls: c, of: [c], min: mins[c] ?? DEF[c] ?? 0.2 })) };
}

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const y2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
export const tileXY = { lon2x, lat2y, x2lon, y2lat };

/** Тайлы, покрывающие область на уровне z. */
export function tilesFor(b: [number, number, number, number], z: number): { x: number; y: number }[] {
  const x0 = Math.floor(lon2x(b[0], z) + 1e-9), x1 = Math.floor(lon2x(b[2], z) - 1e-9), y0 = Math.floor(lat2y(b[3], z) + 1e-9), y1 = Math.floor(lat2y(b[1], z) - 1e-9);
  const out: { x: number; y: number }[] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push({ x, y });
  return out;
}

/** Сетка поправки: клетки растра местности театра в пределах области (по краям клеток). */
export function overlayGrid(T: TheatreData, area?: [number, number, number, number]): { bbox: [number, number, number, number]; cols: number; rows: number } {
  const g = T.terrainGrid;
  const b = area ?? T.bbox;
  if (!g) {
    const dLat = T.cellKm / 110.57, dLng = T.cellKm / (111.32 * Math.cos((((b[1] + b[3]) / 2) * Math.PI) / 180));
    return { bbox: b, cols: Math.max(1, Math.round((b[2] - b[0]) / dLng)), rows: Math.max(1, Math.round((b[3] - b[1]) / dLat)) };
  }
  const [w, s, e, n] = g.bbox, dx = (e - w) / g.cols, dy = (n - s) / g.rows;
  const c0 = Math.max(0, Math.floor((b[0] - w) / dx)), c1 = Math.min(g.cols, Math.ceil((b[2] - w) / dx));
  const r0 = Math.max(0, Math.floor((n - b[3]) / dy)), r1 = Math.min(g.rows, Math.ceil((n - b[1]) / dy));
  const r6 = (x: number) => +x.toFixed(6);
  return { bbox: [r6(w + c0 * dx), r6(n - r1 * dy), r6(w + c1 * dx), r6(n - r0 * dy)], cols: Math.max(1, c1 - c0), rows: Math.max(1, r1 - r0) };
}

/** Накопитель: тайлы (RGBA) → доли классов по клеткам сетки → маски. */
export class OverlayAccumulator {
  readonly names: string[];
  private readonly counts: Float64Array[];
  private readonly total: Float64Array;
  tiles = 0;
  constructor(readonly legend: OverlayLegend, readonly grid: { bbox: [number, number, number, number]; cols: number; rows: number }) {
    this.names = Object.keys(legend.pixels);
    this.counts = this.names.map(() => new Float64Array(grid.cols * grid.rows));
    this.total = new Float64Array(grid.cols * grid.rows);
  }
  /** Тайл x, y уровня z: RGBA size×size. preview — куда отметить классы пикселей (RGBA того же размера). */
  addTile(rgba: Uint8ClampedArray | Uint8Array, size: number, x: number, y: number, z: number, preview?: Uint8ClampedArray) {
    const { bbox: [w, s, e, n], cols, rows } = this.grid;
    const dLng = (e - w) / cols, dLat = (n - s) / rows;
    this.tiles++;
    for (let py = 0; py < size; py++) {
      const lat = y2lat(y + (py + 0.5) / size, z);
      const r = Math.floor((n - lat) / dLat);
      if (r < 0 || r >= rows) continue;
      for (let px = 0; px < size; px++) {
        const lng = x2lon(x + (px + 0.5) / size, z);
        const c = Math.floor((lng - w) / dLng);
        if (c < 0 || c >= cols) continue;
        const o = (py * size + px) * 4;
        if (rgba[o + 3] < 128) continue; // прозрачное — карты нет
        const cell = r * cols + c;
        this.total[cell]++;
        const k = pixelClass(this.legend, this.names, rgba[o], rgba[o + 1], rgba[o + 2]);
        if (k >= 0) { this.counts[k][cell]++; if (preview) { const col = PREVIEW[this.names[k]] ?? [200, 0, 200]; preview[o] = col[0]; preview[o + 1] = col[1]; preview[o + 2] = col[2]; preview[o + 3] = 255; } }
      }
    }
  }
  result(meta: { source: string; zoom: number }): OverlayResult {
    const N = this.grid.cols * this.grid.rows;
    const masks: Record<string, Uint8Array> = {};
    for (const c of this.legend.cells) masks[c.cls] ??= new Uint8Array(N);
    for (let i = 0; i < N; i++) {
      if (!this.total[i]) continue;
      for (const c of this.legend.cells) {
        const f = c.of.reduce((sum, nm) => sum + (this.names.includes(nm) ? this.counts[this.names.indexOf(nm)][i] : 0), 0) / this.total[i];
        if (f >= c.min) masks[c.cls][i] = 1;
      }
    }
    const covered = new Uint8Array(N).map((_, i) => (this.total[i] > 0 ? 1 : 0));
    return {
      legend: this.legend.id, name: this.legend.name, source: meta.source, zoom: meta.zoom, bbox: this.grid.bbox, cols: this.grid.cols, rows: this.grid.rows,
      covered: maskRle(covered), masks: Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, maskRle(m)])),
      stats: Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, m.reduce((a, x) => a + x, 0)])),
    };
  }
}
export const PREVIEW: Record<string, [number, number, number]> = { urban: [210, 80, 70], built: [210, 80, 70], suburb: [230, 150, 130], dark: [40, 40, 40], road: [240, 140, 40], highway: [200, 40, 40], rail: [60, 60, 60], forest: [60, 140, 70], water: [50, 100, 220], marsh: [120, 180, 170] };

export function maskRle(m: Uint8Array): string {
  const out: string[] = [];
  for (let i = 0; i < m.length;) { let j = i; while (j < m.length && m[j] === m[i]) j++; out.push(`${j - i > 1 ? j - i : ''}${m[i] ? 1 : 0}`); i = j; }
  return out.join(',');
}
export function decodeMask(rle: string, n: number): Uint8Array {
  const out = new Uint8Array(n);
  let i = 0;
  for (const t of rle.split(',')) { if (!t) continue; const k = t.length > 1 ? Number(t.slice(0, -1)) : 1; if (t.endsWith('1')) out.fill(1, i, i + k); i += k; }
  if (i !== n) throw new Error(`маска: ${i} клеток вместо ${n}`);
  return out;
}

export interface OverlayApply {
  /** Маска дорог (→ roadGrid «r») и шоссе (→ «h»). */
  road?: string; highway?: string;
  /** Убрать современные дороги в охвате карты: только дороги или и шоссе. */
  replaceModernRoads?: false | 'road' | 'all';
  water?: string; urban?: string; forest?: string; marsh?: string;
  /** Современная застройка, которой на карте нет, → этот класс (обычно open); keepUrban — маска, где застройку оставить. */
  demoteModernUrban?: TerrainClass; keepUrban?: string;
  /** Только внутри рамки (поля листа с легендой не трогать). */
  clip?: [number, number, number, number];
}

/** Поправка по исторической карте → театр (как apply_overlays сборщика). Возвращает новый театр и что изменилось. */
export function applyOverlay(T: TheatreData, ov: OverlayResult, o: OverlayApply): { theatre: TheatreData; changes: Record<string, number> } {
  const N0 = ov.cols * ov.rows;
  const cov = decodeMask(ov.covered, N0);
  const masks = Object.fromEntries(Object.entries(ov.masks).map(([k, m]) => [k, decodeMask(m, N0)]));
  const changes: Record<string, number> = {};
  const [ow, os, oe, on] = ov.bbox;
  const cellAt = (lng: number, lat: number) => {
    if (o.clip && !(lng >= o.clip[0] && lng <= o.clip[2] && lat >= o.clip[1] && lat <= o.clip[3])) return -1;
    const c = Math.floor(((lng - ow) / (oe - ow)) * ov.cols), r = Math.floor(((on - lat) / (on - os)) * ov.rows);
    if (c < 0 || r < 0 || c >= ov.cols || r >= ov.rows) return -1;
    const j = r * ov.cols + c;
    return cov[j] ? j : -1;
  };
  const on1 = (name: string | undefined, j: number) => !!name && !!masks[name]?.[j];
  // сетка результата — растр местности театра (или сама сетка поправки, если растра нет)
  const g: TerrainGrid = T.terrainGrid ?? { bbox: ov.bbox, cols: ov.cols, rows: ov.rows, rle: `${ov.cols * ov.rows}${'o'}` };
  const [w, s, e, n] = g.bbox, dl = (e - w) / g.cols, da = (n - s) / g.rows;
  const k = T.terrainGrid ? decodeGrid(g) : null;
  const I = (c: TerrainClass) => TERRAIN_CLASSES.indexOf(c);
  // прежний растр дорог — пересчитать на ту же сетку
  const roads = new Array<string>(g.cols * g.rows).fill('n');
  if (T.roadGrid) {
    const rg = T.roadGrid, codes = rleCodes(rg.rle, rg.cols * rg.rows), [rw, rs, re, rn] = rg.bbox;
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const lng = w + (c + 0.5) * dl, lat = n - (r + 0.5) * da;
      const gc = Math.floor(((lng - rw) / (re - rw)) * rg.cols), gr = Math.floor(((rn - lat) / (rn - rs)) * rg.rows);
      if (gc >= 0 && gr >= 0 && gc < rg.cols && gr < rg.rows) roads[r * g.cols + c] = codes[gr * rg.cols + gc];
    }
  }
  let anyRoad = !!T.roadGrid;
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const j = cellAt(w + (c + 0.5) * dl, n - (r + 0.5) * da);
    if (j < 0) continue;
    const i = r * g.cols + c;
    if (k) {
      const before = k[i];
      const set = ([['water', o.water], ['urban', o.urban], ['forest', o.forest], ['marsh', o.marsh]] as [TerrainClass, string | undefined][]).find(([, m]) => on1(m, j));
      if (set && !(set[0] !== 'water' && k[i] === I('water'))) k[i] = I(set[0]);
      else if (!set && o.demoteModernUrban && k[i] === I('urban') && !on1(o.keepUrban, j)) k[i] = I(o.demoteModernUrban);
      if (k[i] !== before) { const key = `${TERRAIN_CLASSES[before]}→${TERRAIN_CLASSES[k[i]]}`; changes[key] = (changes[key] ?? 0) + 1; }
    }
    const hw = on1(o.highway, j), rd = on1(o.road, j);
    if (hw || rd) { roads[i] = hw ? 'h' : roads[i] === 'h' ? 'h' : 'r'; anyRoad = true; changes['клеток с дорогой карты'] = (changes['клеток с дорогой карты'] ?? 0) + 1; }
  }
  let lines = T.roads;
  if (o.replaceModernRoads) {
    const covered = (line: LngLat[]) => { const m = line[Math.floor(line.length / 2)]; return cellAt(m[0], m[1]) >= 0; };
    const before = lines.length;
    lines = lines.filter((x) => x.kind === 'rail' || (x.kind === 'highway' && o.replaceModernRoads !== 'all') || !covered(x.line));
    changes['современных дорог убрано'] = before - lines.length;
  }
  const theatre: TheatreData = {
    ...T, roads: lines,
    ...(k ? { terrainGrid: { ...g, rle: encodeGrid(k) } } : {}),
    ...(anyRoad ? { roadGrid: { bbox: g.bbox, cols: g.cols, rows: g.rows, rle: codesRle(roads), source: `дороги исторических карт (${ov.name})` } as TerrainGrid } : {}),
    sources: [...(T.sources ?? []), `Историческая поправка: ${ov.name}, ${ov.source}, уровень ${ov.zoom}; изменения: ${JSON.stringify(changes)}`],
  };
  return { theatre, changes };
}

function rleCodes(rle: string, n: number): string[] {
  const out: string[] = [];
  let k = 0;
  for (const ch of rle) {
    if (ch >= '0' && ch <= '9') { k = k * 10 + (ch.charCodeAt(0) - 48); continue; }
    for (let i = 0; i < (k || 1); i++) out.push(ch);
    k = 0;
  }
  if (out.length !== n) throw new Error(`растр: ${out.length} клеток вместо ${n}`);
  return out;
}
function codesRle(a: string[]): string {
  let s = '';
  for (let i = 0; i < a.length;) { let j = i; while (j < a.length && a[j] === a[i]) j++; s += (j - i > 1 ? j - i : '') + a[i]; i = j; }
  return s;
}
