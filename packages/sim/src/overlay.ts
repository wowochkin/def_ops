/**
 * Исторический слой по растровой карте (скан, тайловый архив): пиксели классифицируются по «легенде» (тон,
 * насыщенность, яркость), доли классов сводятся на сетку театра → маски клеток (дороги, вода, застройка, лес).
 * Маски ложатся поверх театра: местность того времени, дороги исторической карты (растр roadGrid) вместо
 * современных. Тот же формат, что у tools/theatre/raster_overlay.ts, и та же поправка, что у сборщика
 * (build_theatre.py, рецепт overlays) — поправку из браузера можно отдать сборщику.
 */
import type { LngLat } from '@def-ops/core';
import { decodeGrid, encodeGrid } from './theatre';
import { cutAbsent, type NetworkCheck, type WaterCheck } from './overlay-network';
import { hatchMask, hatchPx } from './overlay-hatch';
import { TERRAIN_CLASSES, type TerrainClass, type TerrainGrid, type TheatreData } from './types';

type Range = [number, number];
export interface LegendRule { h?: Range; s?: Range; v?: Range }
export interface OverlayLegend {
  id: string; name: string; note?: string;
  /** Классы пикселей: пиксель относится к первому подходящему. */
  pixels: Record<string, LegendRule[]>;
  /** Класс клетки: доля пикселей класса (или суммы классов) не меньше порога. */
  cells: { cls: string; of: string[]; min: number }[];
  /**
   * Классы, считаемые по штриховке (болота): чернила — пиксели, подходящие к правилам класса (независимо от порядка
   * классов), клетке засчитываются пиксели окон, прошедших isHatch, а не отдельные пиксели класса.
   */
  hatch?: string[];
}
export interface OverlayResult {
  legend: string; name: string; source: string; zoom: number;
  bbox: [number, number, number, number]; cols: number; rows: number;
  /** RLE «число+0/1» через запятую, строки с севера на юг. */
  covered: string; masks: Record<string, string>; stats: Record<string, number>;
  /** Проверка дорог театра по карте (распознавание по современной сети). */
  network?: NetworkCheck;
  /** Проверка воды театра по карте: реки линиями, водоёмы площадями. */
  water?: WaterCheck;
}

/** HSV: тон 0–360, насыщенность и яркость 0–1. */
export function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx / 255];
}
const inR = (x: number, r?: Range) => !r || (r[0] <= r[1] ? x >= r[0] && x <= r[1] : x >= r[0] || x <= r[1]);
const fits = (rules: LegendRule[], h: number, s: number, v: number) => rules.some((x) => inR(h, x.h) && inR(s, x.s) && inR(v, x.v));
export const pixelClass = (legend: OverlayLegend, names: string[], r: number, g: number, b: number) => {
  const [h, s, v] = hsv(r, g, b);
  return names.findIndex((n) => fits(legend.pixels[n], h, s, v));
};

/**
 * Легенда по образцам цвета, снятым с карты: на каждый образец — окно тона, насыщенности и яркости. hatch — классы,
 * считаемые по штриховке (в легенду попадают только классы с образцами).
 */
export function legendFromSamples(samples: Record<string, [number, number, number][]>, tol = 1, mins: Record<string, number> = {}, hatch: string[] = []): OverlayLegend {
  const pixels: Record<string, LegendRule[]> = {};
  const clamp = (a: number, b: number): Range => [Math.max(0, +a.toFixed(3)), Math.min(1, +b.toFixed(3))];
  for (const [cls, list] of Object.entries(samples)) {
    if (!list.length) continue;
    pixels[cls] = list.map(([r, g, b]) => {
      const [h, s, v] = hsv(r, g, b);
      const dh = 14 * tol, ds = 0.16 * tol, dv = 0.16 * tol;
      // серые и чёрные (тушь, железные дороги): тон не определён — только яркость и малая насыщенность (узко: иначе
      // под условие попадает бумага карты). Бледный цвет с оттенком (серо-голубая вода) — по тону, как цветной
      if (s < 0.06) return { s: clamp(0, s + 0.05), v: clamp(v - dv, v + dv) };
      return { h: [(h - dh + 360) % 360, (h + dh) % 360] as Range, s: clamp(s - ds, s + ds), v: clamp(v - dv, v + dv) };
    });
  }
  const DEF: Record<string, number> = { road: 0.06, highway: 0.06, rail: 0.06, water: 0.3, urban: 0.35, forest: 0.35, marsh: 0.3 };
  const legend: OverlayLegend = { id: 'samples', name: 'по образцам цвета', pixels, cells: Object.keys(pixels).map((c) => ({ cls: c, of: [c], min: mins[c] ?? DEF[c] ?? 0.2 })) };
  const h = hatch.filter((c) => pixels[c]);
  if (h.length) legend.hatch = h;
  return legend;
}

/** Слить легенды: классы пикселей и клеток — у первой легенды, где они есть; hatch — объединение; id и имя — первой. */
export function combineLegends(...ls: OverlayLegend[]): OverlayLegend {
  const pixels: Record<string, LegendRule[]> = {};
  const cells: OverlayLegend['cells'] = [];
  const hatch: string[] = [];
  for (const l of ls) {
    for (const [k, r] of Object.entries(l.pixels)) if (!(k in pixels)) pixels[k] = r;
    for (const c of l.cells) if (!cells.some((x) => x.cls === c.cls)) cells.push(c);
    for (const k of l.hatch ?? []) if (!hatch.includes(k)) hatch.push(k);
  }
  const out: OverlayLegend = { id: ls[0]?.id ?? 'combined', name: ls[0]?.name ?? '', pixels, cells };
  if (ls[0]?.note) out.note = ls[0].note;
  if (hatch.length) out.hatch = hatch;
  return out;
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
    // класс каждого пикселя тайла (−1 — ни один, −2 — прозрачно: карты нет)
    const cls = new Int8Array(size * size);
    for (let i = 0; i < size * size; i++) {
      const o = i * 4;
      cls[i] = rgba[o + 3] < 128 ? -2 : pixelClass(this.legend, this.names, rgba[o], rgba[o + 1], rgba[o + 2]);
    }
    // линейные классы — только длинные тонкие линии: отдельные буквы надписей, цифры, значки и пятна того же цвета
    // отбрасываются (иначе тёмные образцы дорог собирают все надписи карты)
    const cellPx = Math.max(4, (size * Math.abs(lat2y(n, z) - lat2y(n - dLat, z))));
    const minExtent = Math.max(14, Math.round(cellPx * 1.5)), maxWidth = Math.max(4, cellPx * 0.35);
    for (let k = 0; k < this.names.length; k++) if (LINEAR.includes(this.names[k])) dropBlobs(cls, size, k, minExtent, maxWidth);
    // классы по штриховке: чернила — по правилам класса независимо от порядка (вода того же цвета остаётся водой),
    // клетке засчитываются пиксели окон-болот, а пиксели класса вне окон — нет
    const hatched = (this.legend.hatch ?? []).map((nm) => this.names.indexOf(nm)).filter((k) => k >= 0);
    const hatchWin = hatched.map((k) => {
      const ink = new Int8Array(size * size), rules = this.legend.pixels[this.names[k]];
      for (let i = 0; i < size * size; i++) {
        const o = i * 4;
        if (rgba[o + 3] < 128) { ink[i] = -2; continue; }
        const [h, s, v] = hsv(rgba[o], rgba[o + 1], rgba[o + 2]);
        ink[i] = fits(rules, h, s, v) ? 1 : 0;
      }
      return hatchMask(ink, size, hatchPx(y2lat(y + 0.5, z), z), 1);
    });
    for (let py = 0; py < size; py++) {
      const lat = y2lat(y + (py + 0.5) / size, z);
      const r = Math.floor((n - lat) / dLat);
      if (r < 0 || r >= rows) continue;
      for (let px = 0; px < size; px++) {
        const lng = x2lon(x + (px + 0.5) / size, z);
        const c = Math.floor((lng - w) / dLng);
        if (c < 0 || c >= cols) continue;
        const i = py * size + px, o = i * 4;
        if (cls[i] === -2) continue;
        const cell = r * cols + c;
        this.total[cell]++;
        const k = cls[i];
        let mark = k >= 0 && !hatched.includes(k) ? k : -1;
        if (mark >= 0) this.counts[k][cell]++;
        for (let j = 0; j < hatched.length; j++) if (hatchWin[j][i]) { this.counts[hatched[j]][cell]++; if (mark < 0) mark = hatched[j]; }
        if (mark >= 0 && preview) { const col = PREVIEW[this.names[mark]] ?? [200, 0, 200]; preview[o] = col[0]; preview[o + 1] = col[1]; preview[o + 2] = col[2]; preview[o + 3] = 255; }
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
    // линейные классы — до осевой линии в одну клетку: толстая линия скана задевает соседние клетки, и дорога
    // выходила полосой в 2–3 клетки «лесенкой»
    for (const cls of LINEAR) if (masks[cls]) { thinMask(masks[cls], this.grid.cols, this.grid.rows); dropSpecks(masks[cls], this.grid.cols, this.grid.rows, 3); }
    const covered = new Uint8Array(N).map((_, i) => (this.total[i] > 0 ? 1 : 0));
    return {
      legend: this.legend.id, name: this.legend.name, source: meta.source, zoom: meta.zoom, bbox: this.grid.bbox, cols: this.grid.cols, rows: this.grid.rows,
      covered: maskRle(covered), masks: Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, maskRle(m)])),
      stats: Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, m.reduce((a, x) => a + x, 0)])),
    };
  }
}
/**
 * Убрать из класса k пиксели связных кусков (по восьми соседям), которые не похожи на линию: короче minExtent
 * пикселей (буква, цифра, значок) — если не упираются в край тайла (линия продолжится в соседнем), — или с
 * заливкой: заметная доля «сплошных» пикселей, у которых всё окно (толще линии, maxWidth) того же класса. Сеть тонких
 * дорог любой длины и разветвлённости сплошных пикселей не имеет и остаётся целиком. Снятые пиксели — «ни один».
 */
export function dropBlobs(cls: Int8Array, size: number, k: number, minExtent: number, maxWidth: number) {
  // сплошные пиксели: окно (2r+1)² целиком класса k — по суммам по площади
  const r = Math.max(1, Math.ceil(maxWidth / 2)), W = size + 1;
  const sum = new Int32Array(W * W);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) sum[(y + 1) * W + x + 1] = (cls[y * size + x] === k ? 1 : 0) + sum[y * W + x + 1] + sum[(y + 1) * W + x] - sum[y * W + x];
  const full = (2 * r + 1) ** 2;
  const solid = (x: number, y: number) => {
    if (x < r || y < r || x + r >= size || y + r >= size) return false;
    const x0 = x - r, y0 = y - r, x1 = x + r + 1, y1 = y + r + 1;
    return sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0] === full;
  };
  const seen = new Uint8Array(size * size), stack: number[] = [], comp: number[] = [];
  for (let i0 = 0; i0 < cls.length; i0++) {
    if (cls[i0] !== k || seen[i0]) continue;
    comp.length = 0; stack.length = 0; stack.push(i0); seen[i0] = 1;
    let x0 = size, x1 = -1, y0 = size, y1 = -1, core = 0;
    while (stack.length) {
      const i = stack.pop()!; comp.push(i);
      const x = i % size, y = (i - x) / size;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (solid(x, y)) core++;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
        const j = yy * size + xx;
        if (!seen[j] && cls[j] === k) { seen[j] = 1; stack.push(j); }
      }
    }
    const extent = Math.max(x1 - x0, y1 - y0) + 1;
    const edge = x0 === 0 || y0 === 0 || x1 === size - 1 || y1 === size - 1;
    const long = extent >= minExtent || (edge && extent >= minExtent / 2);
    const filled = core > comp.length * 0.05;
    if (!long || filled) for (const i of comp) cls[i] = -1;
  }
}

/** Убрать из маски связные (по восьми соседям) обрывки короче minCells клеток: слова надписей, не связанные с сетью линий. */
export function dropSpecks(m: Uint8Array, cols: number, rows: number, minCells: number): number {
  const seen = new Uint8Array(m.length), comp: number[] = [], stack: number[] = [];
  let removed = 0;
  for (let i0 = 0; i0 < m.length; i0++) {
    if (!m[i0] || seen[i0]) continue;
    comp.length = 0; stack.length = 0; stack.push(i0); seen[i0] = 1;
    while (stack.length) {
      const i = stack.pop()!; comp.push(i);
      const c = i % cols, r = (i - c) / cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (m[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    if (comp.length < minCells) { for (const i of comp) m[i] = 0; removed += comp.length; }
  }
  return removed;
}

/** Классы-линии: маска утончается до осевой. */
export const LINEAR = ['road', 'highway', 'rail'];

/**
 * Утончение маски до осевой линии (Чжан — Суэн): с краёв снимаются клетки, пока не останется линия в одну клетку;
 * связность (по восьми соседям) и концы линий сохраняются. Маска меняется на месте; возвращает, сколько клеток снято.
 */
export function thinMask(m: Uint8Array, cols: number, rows: number): number {
  const at = (c: number, r: number) => (c >= 0 && r >= 0 && c < cols && r < rows ? m[r * cols + c] : 0);
  let removed = 0, changed = true;
  const del: number[] = [];
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      del.length = 0;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (!m[r * cols + c]) continue;
        // соседи P2..P9 по часовой стрелке, начиная с верхнего
        const p = [at(c, r - 1), at(c + 1, r - 1), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1), at(c - 1, r + 1), at(c - 1, r), at(c - 1, r - 1)];
        const b = p.reduce((x, v) => x + v, 0);
        if (b < 2 || b > 6) continue;
        let a = 0;
        for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) a++;
        if (a !== 1) continue;
        if (step === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        del.push(r * cols + c);
      }
      for (const i of del) m[i] = 0;
      if (del.length) { changed = true; removed += del.length; }
    }
  }
  return removed;
}

export const PREVIEW: Record<string, [number, number, number]> = { urban: [210, 80, 70], built: [210, 80, 70], suburb: [230, 150, 130], dark: [40, 40, 40], road: [240, 140, 40], highway: [200, 40, 40], rail: [60, 60, 60], forest: [60, 140, 70], water: [50, 100, 220], marsh: [120, 180, 170], 'net-present': [70, 70, 70], 'net-absent': [70, 120, 220], 'wnet-present': [20, 120, 150], 'wnet-absent': [200, 40, 170], 'water-gone': [200, 40, 170], 'water-new': [60, 170, 240], 'marsh-present': [70, 130, 120], 'marsh-new': [40, 200, 160], 'marsh-gone': [190, 120, 40] };

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
  /** Убрать отрезки дорог театра, которых на карте нет (по проверке сети, ov.network). */
  dropAbsent?: boolean;
  /**
   * Вода по проверке сети (ov.water): реки и каналы, которых на карте нет, вырезаются (реки OSM — заменяют малые реки
   * театра в охвате); водоёмы, которых на карте нет, становятся сушей (класс — по соседним клеткам); новая вода карты
   * (маска water-new) — водой.
   */
  waterNet?: boolean;
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
      else if (o.waterNet && on1('water-new', j)) k[i] = I('water');
      else if (o.waterNet && on1('water-gone', j) && k[i] === I('water')) k[i] = landAround(k, g.cols, g.rows, i, I('water'));
      else if (!set && o.demoteModernUrban && k[i] === I('urban') && !on1(o.keepUrban, j)) k[i] = I(o.demoteModernUrban);
      if (k[i] !== before) { const key = `${TERRAIN_CLASSES[before]}→${TERRAIN_CLASSES[k[i]]}`; changes[key] = (changes[key] ?? 0) + 1; }
    }
    const hw = on1(o.highway, j), rd = on1(o.road, j);
    if (hw || rd) { roads[i] = hw ? 'h' : roads[i] === 'h' ? 'h' : 'r'; anyRoad = true; changes['клеток с дорогой карты'] = (changes['клеток с дорогой карты'] ?? 0) + 1; }
  }
  let lines = T.roads;
  // сверка шла по дорогам OpenStreetMap для охвата карты: дороги театра в охвате (кроме железных) заменяются
  // подтверждёнными кусками дорог OSM (отрезки «нет на карте» вырезаны)
  if (ov.network?.roads) {
    const mid = (line: LngLat[]) => line[Math.floor(line.length / 2)];
    const before = lines.length;
    const kept = cutAbsent(ov.network.roads, o.dropAbsent ? ov.network.absent : []);
    lines = [...lines.filter((x) => x.kind === 'rail' || cellAt(mid(x.line)[0], mid(x.line)[1]) < 0), ...kept.roads];
    changes['дорог театра в охвате заменено'] = before - lines.filter((x) => !kept.roads.includes(x)).length;
    changes['дорог OSM подтверждено картой (кусков)'] = kept.roads.length;
    if (o.dropAbsent) changes['км дорог OSM нет на карте'] = kept.km;
  }
  // отрезки, которых на карте нет (номера линий в проверке — по T.roads, поэтому раньше прочих правок)
  else if (o.dropAbsent && ov.network?.absent.length) {
    const c = cutAbsent(T.roads, ov.network.absent);
    lines = c.roads;
    changes['км дорог театра убрано (нет на карте)'] = c.km;
  }
  if (o.replaceModernRoads) {
    const covered = (line: LngLat[]) => { const m = line[Math.floor(line.length / 2)]; return cellAt(m[0], m[1]) >= 0; };
    const before = lines.length;
    lines = lines.filter((x) => x.kind === 'rail' || (x.kind === 'highway' && o.replaceModernRoads !== 'all') || !covered(x.line));
    changes['современных дорог убрано'] = before - lines.length;
  }
  let rivers = T.rivers;
  if (o.waterNet && ov.water) {
    const wc = ov.water;
    if (wc.rivers) {
      // реки OSM: малые реки театра в охвате заменяются подтверждёнными картой; большие (с переправами) остаются
      const mid = (line: LngLat[]) => line[Math.floor(line.length / 2)];
      const kept = cutAbsent(wc.rivers, wc.absent);
      const before = rivers.length;
      rivers = [...rivers.filter((x) => x.major || cellAt(mid(x.line)[0], mid(x.line)[1]) < 0), ...kept.roads];
      changes['малых рек театра в охвате заменено'] = before - rivers.filter((x) => !kept.roads.includes(x)).length;
      changes['км рек и каналов OSM нет на карте'] = kept.km;
    } else if (wc.absent.length) {
      const c = cutAbsent(rivers, wc.absent);
      rivers = c.roads;
      changes['км рек и каналов театра убрано (нет на карте)'] = c.km;
    }
  }
  const theatre: TheatreData = {
    ...T, roads: lines, rivers,
    ...(k ? { terrainGrid: { ...g, rle: encodeGrid(k) } } : {}),
    ...(anyRoad ? { roadGrid: { bbox: g.bbox, cols: g.cols, rows: g.rows, rle: codesRle(roads), source: `дороги исторических карт (${ov.name})` } as TerrainGrid } : {}),
    sources: [...(T.sources ?? []), `Историческая поправка: ${ov.name}, ${ov.source}, уровень ${ov.zoom}; изменения: ${JSON.stringify(changes)}`],
  };
  return { theatre, changes };
}

/** Класс суши для клетки бывшей воды: самый частый среди соседей (не вода), иначе открытая местность. */
function landAround(k: Uint8Array | number[], cols: number, rows: number, i: number, water: number): number {
  const c = i % cols, r = (i - c) / cols, count = new Map<number, number>();
  for (let rad = 1; rad <= 3 && !count.size; rad++)
    for (let dr = -rad; dr <= rad; dr++) for (let dc = -rad; dc <= rad; dc++) {
      const cc = c + dc, rr = r + dr;
      if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
      const v = k[rr * cols + cc];
      if (v !== water) count.set(v, (count.get(v) ?? 0) + 1);
    }
  return count.size ? [...count].sort((a, b) => b[1] - a[1])[0][0] : TERRAIN_CLASSES.indexOf('open');
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

/** Сравнение дорог исторической карты и театра в охвате карты (по клеткам поправки). */
export interface RoadComparison {
  bbox: [number, number, number, number]; cols: number; rows: number;
  /** 0 — нет дороги, 1 — есть и там и там, 2 — только на карте, 3 — только в театре. */
  cells: Uint8Array;
  stats: { covered: number; map: number; theatre: number; both: number; mapOnly: number; theatreOnly: number };
  /** Клетка ≈ км (для перевода клеток в длину дорог). */
  cellKm: number;
  /** Дороги театра (линии с названием), которых на карте почти нет: послевоенные или неверно распознанные. */
  absent: { name: string; kind: string; km: number; share: number }[];
}

export function compareRoads(T: TheatreData, ov: OverlayResult, o: { road?: string; highway?: string }): RoadComparison {
  const N = ov.cols * ov.rows;
  const cov = decodeMask(ov.covered, N);
  const m = new Uint8Array(N);
  for (const k of [o.road, o.highway]) if (k && ov.masks[k]) { const x = decodeMask(ov.masks[k], N); for (let i = 0; i < N; i++) if (x[i]) m[i] = 1; }
  const [w, s, e, n] = ov.bbox, dl = (e - w) / ov.cols, da = (n - s) / ov.rows;
  const cellOf = (lng: number, lat: number) => { const c = Math.floor((lng - w) / dl), r = Math.floor((n - lat) / da); return c < 0 || r < 0 || c >= ov.cols || r >= ov.rows ? -1 : r * ov.cols + c; };
  const t = new Uint8Array(N);
  const absent: RoadComparison['absent'] = [];
  const kmPerDeg = 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180);
  for (const rd of T.roads) {
    if (rd.kind === 'rail') continue;
    const seen = new Set<number>();
    for (let k = 1; k < rd.line.length; k++) {
      const [a, b] = [rd.line[k - 1], rd.line[k]];
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b[0] - a[0]) / dl, Math.abs(b[1] - a[1]) / da) * 3));
      for (let q = 0; q <= steps; q++) { const i = cellOf(a[0] + ((b[0] - a[0]) * q) / steps, a[1] + ((b[1] - a[1]) * q) / steps); if (i >= 0 && cov[i]) { t[i] = 1; seen.add(i); } }
    }
    if (rd.name && seen.size >= 3) {
      // дорога «есть на карте», если рядом (в соседней клетке) есть дорога карты
      let miss = 0;
      for (const i of seen) { const c = i % ov.cols, r = Math.floor(i / ov.cols); let near = false; for (let dr = -1; dr <= 1 && !near; dr++) for (let dc = -1; dc <= 1 && !near; dc++) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < ov.cols && rr < ov.rows && m[rr * ov.cols + cc]) near = true; } if (!near) miss++; }
      const share = miss / seen.size;
      if (share >= 0.7) absent.push({ name: rd.name, kind: rd.kind, km: +(seen.size * Math.min(dl * kmPerDeg, da * 110.57)).toFixed(1), share: +share.toFixed(2) });
    }
  }
  if (T.roadGrid) {
    const g = T.roadGrid, [gw, gs, ge, gn] = g.bbox, codes = rleCodes(g.rle, g.cols * g.rows);
    for (let r = 0; r < ov.rows; r++) for (let c = 0; c < ov.cols; c++) {
      const i = r * ov.cols + c; if (!cov[i]) continue;
      const lng = w + (c + 0.5) * dl, lat = n - (r + 0.5) * da;
      const gc = Math.floor(((lng - gw) / (ge - gw)) * g.cols), gr = Math.floor(((gn - lat) / (gn - gs)) * g.rows);
      if (gc >= 0 && gr >= 0 && gc < g.cols && gr < g.rows && codes[gr * g.cols + gc] !== 'n') t[i] = 1;
    }
  }
  const cells = new Uint8Array(N);
  const st = { covered: 0, map: 0, theatre: 0, both: 0, mapOnly: 0, theatreOnly: 0 };
  for (let i = 0; i < N; i++) {
    if (!cov[i]) continue;
    st.covered++;
    if (m[i]) st.map++;
    if (t[i]) st.theatre++;
    cells[i] = m[i] && t[i] ? 1 : m[i] ? 2 : t[i] ? 3 : 0;
    if (cells[i] === 1) st.both++; else if (cells[i] === 2) st.mapOnly++; else if (cells[i] === 3) st.theatreOnly++;
  }
  absent.sort((a, b) => b.km - a.km);
  return { bbox: ov.bbox, cols: ov.cols, rows: ov.rows, cells, stats: st, cellKm: Math.sqrt(dl * kmPerDeg * da * 110.57), absent: absent.slice(0, 8) };
}
