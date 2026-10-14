/**
 * Дороги исторической карты по современной сети: дороги театра (OSM) — подсказка, где на карте искать дороги.
 * 1) Вдоль каждой дороги театра снимаются пиксели карты поперёк линии (окно — на ошибку привязки и сдвиг трассы),
 *    рядом — такие же окна в стороне (фон). Цвет, который вдоль дорог встречается заметно чаще, чем в стороне, —
 *    цвет дороги на этой карте (бумага, лес, надписи есть и там и там — отсеиваются). Так цвета узнаются сами,
 *    без образцов, отдельно для дорог и шоссе.
 * 2) По узнанным цветам каждый отрезок дороги театра — есть на карте (дорога того времени), нет (послевоенная) или
 *    не ясно. Отрезки «нет» можно убрать из театра, остальные остаются линиями.
 * 3) Второй проход распознаёт карту узнанными цветами (как образцы): длинные линии этого цвета вдали от дорог
 *    театра — дороги того времени, которых в театре нет; они ложатся в растр дорог.
 */
import type { LngLat } from '@def-ops/core';
import { decodeMask, hsv, maskRle, tileXY, type LegendRule, type OverlayLegend, type OverlayResult } from './overlay';
import { decodeGrid } from './theatre';
import { TERRAIN_CLASSES, type TheatreData } from './types';

/** Цвет пикселя → корзина: тон по 15°, насыщенность и яркость по пятым; серые — только по яркости. */
export function colorBin(r: number, g: number, b: number): number {
  const [h, s, v] = hsv(r, g, b);
  if (s < 0.12) return 600 + Math.min(9, Math.floor(v * 10));
  return Math.floor(h / 15) * 25 + Math.min(4, Math.floor(s * 5)) * 5 + Math.min(4, Math.floor(v * 5));
}
export const BINS = 610;
/** Корзина → правило легенды (окно тона, насыщенности, яркости). */
export function binRule(bin: number): LegendRule {
  if (bin >= 600) { const v = bin - 600; return { s: [0, 0.12], v: [v / 10, (v + 1) / 10] }; }
  const h = Math.floor(bin / 25), s = Math.floor((bin % 25) / 5), v = bin % 5;
  return { h: [h * 15, (h + 1) * 15], s: [Math.max(0.12, s / 5), (s + 1) / 5], v: [v / 5, (v + 1) / 5] };
}
/** Средний цвет корзины (для показа узнанного цвета). */
export function binColor(bin: number): [number, number, number] {
  const r = binRule(bin);
  const h = r.h ? (r.h[0] + r.h[1]) / 2 : 0, s = r.s ? (r.s[0] + r.s[1]) / 2 : 0, v = r.v ? (r.v[0] + r.v[1]) / 2 : 0.5;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  const [a, b, d] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [Math.round((a + m) * 255), Math.round((b + m) * 255), Math.round((d + m) * 255)];
}

/** Линия сверки: класс (road, highway, water), геометрия, название, номер в исходном списке (дорог или рек). */
export interface NetLine { cls: string; line: LngLat[]; name?: string; idx: number }
/** Дороги театра (или OSM) → линии сверки: шоссе и дороги, без железных. */
export const roadLines = (roads: TheatreData['roads']): NetLine[] =>
  roads.flatMap((r, idx) => (r.kind === 'rail' ? [] : [{ cls: r.kind, line: r.line, name: r.name, idx }]));
/** Реки и каналы → линии сверки класса water. */
export const riverLines = (rivers: { line: LngLat[]; name?: string }[]): NetLine[] =>
  rivers.map((r, idx) => ({ cls: 'water', line: r.line, name: r.name || undefined, idx }));

/** Точка проверки на линии: место на карте (пиксели уровня z), нормаль, расстояние вдоль линии. */
interface Pt { line: number; cls: string; gx: number; gy: number; nx: number; ny: number; d: number; ll: LngLat }

export type NetColor = { bin: number; rgb: [number, number, number]; road: number; side: number };
export interface NetworkCheck {
  /** Узнанные цвета по классам: корзина, доля точек линии, где цвет есть рядом, и доля в стороне. */
  colors: Record<string, NetColor[]>;
  /** Проверено точек и их итог. */
  points: number; covered: number;
  km: { checked: number; present: number; absent: number; unclear: number };
  /** Отрезки, которых на карте нет: номер линии в исходном списке (дорог или рек) и расстояния вдоль неё, км. */
  absent: { line: number; from: number; to: number }[];
  /** Линии с названием, которых на карте нет больше всего (км). */
  absentNamed: { name: string; km: number }[];
  /**
   * Свои линии сверки (дороги OpenStreetMap для охвата карты), если сверялись не дороги театра: номера в absent —
   * по ним; при сохранении подтверждённые куски заменяют дороги театра в охвате карты.
   */
  roads?: TheatreData['roads'];
}

/** Вода по карте: реки и каналы линиями (как дороги) и водоёмы площадями (клетки воды растра местности театра). */
export interface WaterCheck extends NetworkCheck {
  /** Реки и каналы OSM для охвата карты, если сверялись не реки театра (номера в absent — по ним). */
  rivers?: { name: string; line: LngLat[]; major: boolean }[];
  /** Водоёмы театра (связные клетки воды): всего, подтверждены картой, нет на карте; новая вода карты. */
  areas: { total: number; present: number; gone: number; goneCells: number; added: number; addedCells: number };
}

const KM_PER_DEG = 111.32;
const kmBetween = (a: LngLat, b: LngLat) => {
  const k = Math.cos((((a[1] + b[1]) / 2) * Math.PI) / 180);
  return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]) * KM_PER_DEG;
};

/** Связные (по восьми соседям) куски маски: список номеров клеток каждого. */
function components(m: Uint8Array, cols: number, rows: number): number[][] {
  const seen = new Uint8Array(m.length), out: number[][] = [];
  for (let i0 = 0; i0 < m.length; i0++) {
    if (!m[i0] || seen[i0]) continue;
    const comp: number[] = [], st = [i0]; seen[i0] = 1;
    while (st.length) {
      const i = st.pop()!; comp.push(i);
      const c = i % cols, r = (i - c) / cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
        const j = rr * cols + cc;
        if (m[j] && !seen[j]) { seen[j] = 1; st.push(j); }
      }
    }
    out.push(comp);
  }
  return out;
}
/** Маска, расширенная на соседние клетки. */
function dilate(m: Uint8Array, cols: number, rows: number): Uint8Array {
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) if (m[i]) {
    const c = i % cols, r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) { const cc = c + dc, rr = r + dr; if (cc >= 0 && rr >= 0 && cc < cols && rr < rows) out[rr * cols + cc] = 1; }
  }
  return out;
}

/**
 * Проверка сети: точки на линиях (дороги, реки) в области через spacing пикселей уровня z; окно поперёк — ±w пикселей
 * (≈ 200 м) — для узнавания цвета, фон — такие же окна на 3w в обе стороны. Есть ли линия в точке — по узкому
 * окну ±w/2 (≈ 100 м): в плотной сети широкое окно задевает соседние улицы. Цвета узнаются по классам линий.
 */
export class NetworkLearner {
  readonly pts: Pt[] = [];
  readonly w: number;
  readonly classes: string[];
  private readonly byTile = new Map<string, number[]>();
  /** Корзины, встреченные в узком окне каждой точки (±w/2, без повторов): по ним — есть ли линия. */
  private readonly seen: Uint16Array[] = [];
  private readonly ok: Uint8Array;
  private readonly road: Record<string, Float64Array> = {};
  private readonly side: Record<string, Float64Array> = {};
  private readonly n: Record<string, number> = {};
  private readonly nSide: Record<string, number> = {};
  tiles = 0;
  /** Шаг точек, км. */
  readonly stepKm: number;

  constructor(readonly lines: NetLine[], readonly bbox: [number, number, number, number], readonly z: number, o: { spacing?: number; windowM?: number } = {}) {
    this.classes = [...new Set(lines.map((l) => l.cls))];
    for (const c of this.classes) { this.road[c] = new Float64Array(BINS); this.side[c] = new Float64Array(BINS); this.n[c] = 0; this.nSide[c] = 0; }
    const lat = (bbox[1] + bbox[3]) / 2;
    const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
    this.w = Math.max(3, Math.min(20, Math.round((o.windowM ?? 200) / mpp)));
    const spacing = o.spacing ?? Math.max(6, Math.round(this.w * 0.8));
    this.stepKm = (spacing * mpp) / 1000;
    const inBox = (p: LngLat) => p[0] >= bbox[0] && p[0] <= bbox[2] && p[1] >= bbox[1] && p[1] <= bbox[3];
    const P = (p: LngLat): [number, number] => [tileXY.lon2x(p[0], z) * 256, tileXY.lat2y(p[1], z) * 256];
    lines.forEach((rd, li) => {
      let d = 0, carry = 0;
      for (let k = 1; k < rd.line.length; k++) {
        const a = rd.line[k - 1], b = rd.line[k];
        const segKm = kmBetween(a, b);
        const [ax, ay] = P(a), [bx, by] = P(b);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 1e-6) continue;
        const nx = -(by - ay) / len, ny = (bx - ax) / len;
        for (let t = carry; t < len; t += spacing) {
          const u = t / len;
          const ll: LngLat = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
          if (inBox(ll)) {
            const gx = ax + (bx - ax) * u, gy = ay + (by - ay) * u;
            const i = this.pts.length;
            this.pts.push({ line: li, cls: rd.cls, gx, gy, nx, ny, d: d + segKm * u, ll });
            const key = `${Math.floor(gx / 256)},${Math.floor(gy / 256)}`;
            (this.byTile.get(key) ?? this.byTile.set(key, []).get(key)!).push(i);
          }
        }
        // следующая точка — через spacing от последней, уже на следующем отрезке
        carry += Math.max(0, Math.ceil((len - carry) / spacing)) * spacing - len;
        d += segKm;
      }
    });
    this.ok = new Uint8Array(this.pts.length);
  }
  /** Тайлы, в которых есть точки проверки. */
  tileList(): { x: number; y: number }[] {
    return [...this.byTile.keys()].map((k) => { const [x, y] = k.split(',').map(Number); return { x, y }; });
  }
  addTile(rgba: Uint8ClampedArray | Uint8Array, size: number, x: number, y: number) {
    const list = this.byTile.get(`${x},${y}`);
    if (!list) return;
    this.tiles++;
    const k = size / 256, w = this.w;
    const bins = new Set<number>(), inner = new Set<number>();
    const wi = Math.ceil(w / 2);
    const read = (gx: number, gy: number): number => {
      const px = Math.round((gx - x * 256) * k), py = Math.round((gy - y * 256) * k);
      if (px < 0 || py < 0 || px >= size || py >= size) return -1;
      const o = (py * size + px) * 4;
      if (rgba[o + 3] < 128) return -2;
      return colorBin(rgba[o], rgba[o + 1], rgba[o + 2]);
    };
    for (const i of list) {
      const p = this.pts[i];
      bins.clear(); inner.clear();
      let blank = 0, total = 0;
      for (let t = -w; t <= w; t++) {
        const b = read(p.gx + p.nx * t, p.gy + p.ny * t);
        if (b === -1) continue;
        total++;
        if (b === -2) { blank++; continue; }
        bins.add(b);
        if (Math.abs(t) <= wi) inner.add(b);
      }
      if (!total || blank > total / 2) continue; // карты здесь нет
      this.ok[i] = 1;
      this.seen[i] = Uint16Array.from(inner);
      this.n[p.cls]++;
      for (const b of bins) this.road[p.cls][b]++;
      for (const sgn of [-1, 1]) {
        bins.clear();
        let any = false;
        for (let t = -w; t <= w; t += 1) {
          const b = read(p.gx + p.nx * (sgn * 3 * w + t), p.gy + p.ny * (sgn * 3 * w + t));
          if (b >= 0) { bins.add(b); any = true; }
        }
        if (!any) continue;
        this.nSide[p.cls]++;
        for (const b of bins) this.side[p.cls][b]++;
      }
    }
  }
  /** Узнанные цвета класса: чаще у линии, чем в стороне (не меньше 15 % точек и в 2,5 раза чаще). */
  colors(cls: string): NetColor[] {
    const n = this.n[cls] ?? 0, ns = this.nSide[cls] ?? 0;
    if (n < 20 || !ns) return [];
    const out: NetColor[] = [];
    for (let b = 0; b < BINS; b++) {
      const r = this.road[cls][b] / n, s = this.side[cls][b] / ns;
      if (r >= 0.15 && r >= 2.5 * s + 0.05) out.push({ bin: b, rgb: binColor(b), road: +r.toFixed(3), side: +s.toFixed(3) });
    }
    return out.sort((a, b) => b.road - b.side - (a.road - a.side)).slice(0, 6);
  }
  /** Цвета класса без общих с другими классами, где у другого класса цвет заметнее. */
  private own(cls: string): NetColor[] {
    const others = this.classes.filter((c) => c !== cls).map((c) => this.colors(c));
    return this.colors(cls).filter((c) => others.every((list) => { const o = list.find((x) => x.bin === c.bin); return !o || c.road - c.side >= o.road - o.side; }));
  }
  /** Легенда второго прохода — узнанные цвета по классам; порог клетки: линии — 6 %, вода — 30 %. */
  legend(): OverlayLegend {
    const pixels: Record<string, LegendRule[]> = {};
    for (const c of this.classes) { const list = this.own(c); if (list.length) pixels[c] = list.map((x) => binRule(x.bin)); }
    return { id: 'network', name: 'цвета по современной сети', pixels, cells: Object.keys(pixels).map((c) => ({ cls: c, of: [c], min: c === 'water' ? 0.3 : 0.06 })) };
  }
  /** Итог по точкам классов group: есть / нет / не ясно — по соседним точкам той же линии (±smooth). */
  check(group: string[] = this.classes.filter((c) => c !== 'water'), smooth = 4): { state: Int8Array; result: NetworkCheck } {
    const inG = (c: string) => group.includes(c);
    const all = new Set(group.flatMap((c) => this.colors(c)).map((c) => c.bin));
    const hit = new Uint8Array(this.pts.length);
    for (let i = 0; i < this.pts.length; i++) if (this.ok[i] && inG(this.pts[i].cls)) hit[i] = this.seen[i].some((b) => all.has(b)) ? 1 : 0;
    // −1 — карты нет (или другая группа), 0 — нет линии, 1 — есть, 2 — не ясно
    const state = new Int8Array(this.pts.length).fill(-1);
    for (let i = 0; i < this.pts.length; i++) {
      if (!this.ok[i] || !all.size || !inG(this.pts[i].cls)) continue;
      let n = 0, h = 0;
      for (let j = i - smooth; j <= i + smooth; j++) {
        if (j < 0 || j >= this.pts.length || this.pts[j].line !== this.pts[i].line || !this.ok[j]) continue;
        n++; h += hit[j];
      }
      const share = h / n;
      state[i] = share >= 0.5 ? 1 : share <= 0.2 ? 0 : 2;
    }
    const step = (i: number) => {
      const p = this.pts[i], q = this.pts[i + 1];
      // разрыв (линия выходила из области) — не длина проверенной линии
      return q && q.line === p.line ? Math.min(q.d - p.d, this.stepKm * 1.5) : 0;
    };
    const km = { checked: 0, present: 0, absent: 0, unclear: 0 };
    const absent: NetworkCheck['absent'] = [];
    const named = new Map<string, number>();
    let covered = 0, points = 0;
    for (let i = 0; i < this.pts.length; i++) {
      if (inG(this.pts[i].cls)) points++;
      if (state[i] < 0) continue;
      covered++;
      const s = step(i);
      km.checked += s;
      if (state[i] === 1) km.present += s; else if (state[i] === 0) km.absent += s; else km.unclear += s;
    }
    // отрезки «нет» — подряд идущие точки одной линии, не короче 1 км
    for (let i = 0; i < this.pts.length;) {
      if (state[i] !== 0) { i++; continue; }
      let j = i;
      while (j + 1 < this.pts.length && state[j + 1] === 0 && this.pts[j + 1].line === this.pts[i].line) j++;
      const p = this.pts[i], q = this.pts[j];
      const half = (step(Math.max(i - 1, 0)) || step(i)) / 2;
      const from = Math.max(0, p.d - half), to = q.d + (step(j) || half * 2) / 2;
      if (to - from >= 1) {
        const L = this.lines[p.line];
        absent.push({ line: L.idx, from: +from.toFixed(3), to: +to.toFixed(3) });
        if (L.name) named.set(L.name, (named.get(L.name) ?? 0) + (to - from));
      }
      i = j + 1;
    }
    const r1 = (x: number) => +x.toFixed(1);
    return {
      state,
      result: {
        colors: Object.fromEntries(group.map((c) => [c, this.colors(c)])),
        points, covered,
        km: { checked: r1(km.checked), present: r1(km.present), absent: r1(km.absent), unclear: r1(km.unclear) },
        absent,
        absentNamed: [...named].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, k]) => ({ name, km: r1(k) })),
      },
    };
  }
  /** Клетки сетки результата под точками классов group: сеть, итог «есть»/«нет». */
  private cells(ov: OverlayResult, state: Int8Array, group: string[]) {
    const N = ov.cols * ov.rows, [w, s, e, n] = ov.bbox, dl = (e - w) / ov.cols, da = (n - s) / ov.rows;
    const present = new Uint8Array(N), absent = new Uint8Array(N), net = new Uint8Array(N);
    for (let i = 0; i < this.pts.length; i++) {
      if (!group.includes(this.pts[i].cls)) continue;
      const p = this.pts[i].ll, c = Math.floor((p[0] - w) / dl), r = Math.floor((n - p[1]) / da);
      if (c < 0 || r < 0 || c >= ov.cols || r >= ov.rows) continue;
      const j = r * ov.cols + c;
      net[j] = 1;
      if (state[i] === 1 || state[i] === 2) present[j] = 1;
      else if (state[i] === 0) absent[j] = 1;
    }
    for (let i = 0; i < N; i++) if (present[i]) absent[i] = 0;
    return { present, absent, net };
  }
  /**
   * Сводка дорог в результат распознавания (второй проход — ov с масками по узнанным цветам): маски
   * net-present / net-absent — сверяемые дороги по итогу проверки; road / highway — только новые дороги (куски,
   * уходящие от сверяемых дорог дальше соседней клетки).
   */
  merge(ov: OverlayResult, state: Int8Array, check: NetworkCheck): OverlayResult {
    const N = ov.cols * ov.rows;
    const group = this.classes.filter((c) => c !== 'water');
    const { present, absent, net } = this.cells(ov, state, group);
    // окрестность сети в одну клетку: там дорога карты — та же, что сверяемая
    const near = dilate(net, ov.cols, ov.rows);
    const masks: Record<string, string> = { ...ov.masks }, stats: Record<string, number> = { ...ov.stats };
    for (const k of group) {
      if (!ov.masks[k]) continue;
      const m = decodeMask(ov.masks[k], N);
      // клетки самой сети — сверяемая дорога; остальное — связными кусками: кусок, который хоть где-то уходит от сети
      // дальше соседней клетки, — новая дорога целиком (и там, где подходит к сети); весь у сети — сдвиг той же дороги
      for (let i = 0; i < N; i++) if (net[i]) m[i] = 0;
      for (const comp of components(m, ov.cols, ov.rows)) if (comp.every((i) => near[i])) for (const i of comp) m[i] = 0;
      masks[k] = maskRle(m); stats[k] = m.reduce((a, x) => a + x, 0);
    }
    masks['net-present'] = maskRle(present); stats['net-present'] = present.reduce((a, x) => a + x, 0);
    masks['net-absent'] = maskRle(absent); stats['net-absent'] = absent.reduce((a, x) => a + x, 0);
    return { ...ov, legend: 'network', name: 'по современной сети', masks, stats, network: check };
  }
  /**
   * Сводка воды: реки линиями (как дороги: wnet-present / wnet-absent) и водоёмы театра площадями. Водоём — связные
   * клетки воды растра местности театра; подтверждён, если не меньше 30 % его клеток — вода по карте, нет на карте —
   * если меньше 10 % (маска water-gone). Новая вода карты (water-new) — куски от трёх клеток вдали от воды театра и рек.
   * Маска water второго прохода из результата убирается (вместо неё water-new).
   */
  mergeWater(ov: OverlayResult, state: Int8Array, check: NetworkCheck, T: TheatreData, rivers?: WaterCheck['rivers']): OverlayResult {
    const N = ov.cols * ov.rows;
    const { present, absent, net } = this.cells(ov, state, ['water']);
    const mapWater = ov.masks.water ? decodeMask(ov.masks.water, N) : new Uint8Array(N);
    // вода театра на сетке результата (сетка поправки — клетки растра театра в области)
    const modern = new Uint8Array(N);
    const g = T.terrainGrid;
    if (g) {
      const k = decodeGrid(g), wi = TERRAIN_CLASSES.indexOf('water');
      const [gw, , ge, gn] = g.bbox, gdl = (ge - gw) / g.cols, gda = (gn - g.bbox[1]) / g.rows;
      const [w, s, e, n] = ov.bbox, dl = (e - w) / ov.cols, da = (n - s) / ov.rows;
      for (let r = 0; r < ov.rows; r++) for (let c = 0; c < ov.cols; c++) {
        const gc = Math.floor((w + (c + 0.5) * dl - gw) / gdl), gr = Math.floor((gn - (n - (r + 0.5) * da)) / gda);
        if (gc >= 0 && gr >= 0 && gc < g.cols && gr < g.rows && k[gr * g.cols + gc] === wi) modern[r * ov.cols + c] = 1;
      }
    }
    const cov = decodeMask(ov.covered, N);
    const gone = new Uint8Array(N);
    const areas: WaterCheck['areas'] = { total: 0, present: 0, gone: 0, goneCells: 0, added: 0, addedCells: 0 };
    for (const comp of components(modern, ov.cols, ov.rows)) {
      const seen = comp.filter((i) => cov[i]);
      if (!seen.length) continue;
      areas.total++;
      const share = seen.filter((i) => mapWater[i]).length / seen.length;
      // вдоль реки театра вода и так проверена линией: водоём «нет», только если и река там не подтверждена
      if (share >= 0.3 || seen.some((i) => present[i])) areas.present++;
      else if (share < 0.1) { areas.gone++; areas.goneCells += seen.length; for (const i of seen) gone[i] = 1; }
    }
    const nearModern = dilate(new Uint8Array(N).map((_, i) => (modern[i] || net[i] ? 1 : 0)), ov.cols, ov.rows);
    const added = new Uint8Array(N);
    for (const comp of components(mapWater, ov.cols, ov.rows)) {
      if (comp.length < 3 || comp.some((i) => nearModern[i])) continue;
      areas.added++; areas.addedCells += comp.length;
      for (const i of comp) added[i] = 1;
    }
    const masks: Record<string, string> = { ...ov.masks }, stats: Record<string, number> = { ...ov.stats };
    delete masks.water; delete stats.water;
    const put = (k: string, m: Uint8Array) => { masks[k] = maskRle(m); stats[k] = m.reduce((a, x) => a + x, 0); };
    put('wnet-present', present); put('wnet-absent', absent); put('water-gone', gone); put('water-new', added);
    const water: WaterCheck = { ...check, areas, ...(rivers ? { rivers } : {}) };
    return { ...ov, masks, stats, water };
  }
}

/**
 * Убрать из дорог театра отрезки, которых на карте нет (absent из проверки сети): линия режется по расстоянию
 * вдоль неё, остатки короче 0,3 км не сохраняются.
 */
export function cutAbsent<R extends { line: LngLat[] }>(roads: R[], absent: NetworkCheck['absent']): { roads: R[]; km: number } {
  const by = new Map<number, { from: number; to: number }[]>();
  for (const a of absent) (by.get(a.line) ?? by.set(a.line, []).get(a.line)!).push(a);
  const out: R[] = [];
  let cut = 0;
  roads.forEach((rd, li) => {
    const gaps = by.get(li);
    if (!gaps) { out.push(rd); return; }
    gaps.sort((a, b) => a.from - b.from);
    // точка на расстоянии d вдоль линии
    const cum = [0];
    for (let k = 1; k < rd.line.length; k++) cum.push(cum[k - 1] + kmBetween(rd.line[k - 1], rd.line[k]));
    const at = (d: number): LngLat => {
      let k = 1;
      while (k < cum.length - 1 && cum[k] < d) k++;
      const u = cum[k] > cum[k - 1] ? Math.max(0, Math.min(1, (d - cum[k - 1]) / (cum[k] - cum[k - 1]))) : 0;
      const a = rd.line[k - 1], b = rd.line[k];
      return [+(a[0] + (b[0] - a[0]) * u).toFixed(6), +(a[1] + (b[1] - a[1]) * u).toFixed(6)];
    };
    const piece = (from: number, to: number) => {
      if (to - from < 0.3) return;
      const line: LngLat[] = [at(from)];
      for (let k = 0; k < cum.length; k++) if (cum[k] > from && cum[k] < to) line.push(rd.line[k]);
      line.push(at(to));
      out.push({ ...rd, line });
    };
    let pos = 0;
    const total = cum[cum.length - 1];
    for (const g of gaps) {
      const from = Math.max(pos, g.from), to = Math.min(total, g.to);
      if (to <= from) continue;
      piece(pos, from);
      cut += to - from;
      pos = to;
    }
    piece(pos, total);
  });
  return { roads: out, km: +cut.toFixed(1) };
}

/* ------------------------- дороги OpenStreetMap для охвата карты ------------------------- */

/** Классы OSM для сверки: шоссе — магистрали и главные, дороги — второстепенные и местные (без улиц и полевых). */
export const OSM_HIGHWAY = ['motorway', 'trunk', 'primary'];
export const OSM_ROAD = ['secondary', 'tertiary', 'unclassified'];

/** Запрос Overpass: дороги в рамке [w, s, e, n] с геометрией. */
export function osmRoadsQuery(b: [number, number, number, number]): string {
  return `[out:json][timeout:180];way["highway"~"^(${[...OSM_HIGHWAY, ...OSM_ROAD].join('|')})$"](${b[1]},${b[0]},${b[3]},${b[2]});out tags geom;`;
}

/** Упрощение ломаной (Дуглас — Пекер), допуск в градусах. */
function simplify(pts: LngLat[], tol: number): LngLat[] {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st: [number, number][] = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop()!;
    const [ax, ay] = pts[a], [bx, by] = pts[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let m = -1, md = tol;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; m = i; } }
    if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

type OsmJson = { elements?: { type: string; tags?: Record<string, string>; geometry?: { lat: number; lon: number }[] }[] };
/** Линия OSM → куски внутри рамки, упрощённые (~10 м). */
function clipRuns(geom: { lat: number; lon: number }[], b: [number, number, number, number]): LngLat[][] {
  const inB = (p: LngLat) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
  const out: LngLat[][] = [];
  let run: LngLat[] = [];
  const flush = () => { if (run.length >= 2) out.push(simplify(run, 0.0001).map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)] as LngLat)); run = []; };
  for (const g of geom) { const p: LngLat = [g.lon, g.lat]; if (inB(p)) run.push(p); else flush(); }
  flush();
  return out;
}

/**
 * Ответ Overpass → дороги в формате театра: линии обрезаются рамкой (куски внутри неё), упрощаются (~10 м),
 * название — номер дороги (ref) или имя.
 */
export function osmToRoads(json: OsmJson, b: [number, number, number, number]): TheatreData['roads'] {
  const out: TheatreData['roads'] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || !el.tags?.highway) continue;
    const kind = OSM_HIGHWAY.includes(el.tags.highway) ? 'highway' : OSM_ROAD.includes(el.tags.highway) ? 'road' : null;
    if (!kind) continue;
    const name = el.tags.ref || el.tags.name;
    for (const line of clipRuns(el.geometry, b)) out.push({ kind, line, ...(name ? { name } : {}) });
  }
  return out;
}

/** Классы водотоков OSM для сверки: реки и каналы (ручьи — нет: на картах 1:100 000 их почти не видно). */
export const OSM_WATERWAY = ['river', 'canal'];
/** Запрос Overpass: дороги и водотоки в рамке — одним запросом. */
export function osmNetworkQuery(b: [number, number, number, number]): string {
  const bb = `${b[1]},${b[0]},${b[3]},${b[2]}`;
  return `[out:json][timeout:180];(way["highway"~"^(${[...OSM_HIGHWAY, ...OSM_ROAD].join('|')})$"](${bb});way["waterway"~"^(${OSM_WATERWAY.join('|')})$"](${bb}););out tags geom;`;
}
/** Ответ Overpass → реки и каналы в формате театра (major — нет: большие реки театра остаются свои). */
export function osmToRivers(json: OsmJson, b: [number, number, number, number]): { name: string; line: LngLat[]; major: boolean }[] {
  const out: { name: string; line: LngLat[]; major: boolean }[] = [];
  for (const el of json.elements ?? []) {
    if (el.type !== 'way' || !el.geometry || !el.tags?.waterway || !OSM_WATERWAY.includes(el.tags.waterway)) continue;
    for (const line of clipRuns(el.geometry, b)) out.push({ name: el.tags.name ?? (el.tags.waterway === 'canal' ? 'канал' : ''), line, major: false });
  }
  return out;
}

/** Отрезки «нет на карте» линиями (для показа): куски дорог по расстояниям вдоль линии из проверки. */
export function absentLines(roads: TheatreData['roads'], absent: NetworkCheck['absent']): LngLat[][] {
  const out: LngLat[][] = [];
  for (const a of absent) {
    const rd = roads[a.line];
    if (!rd) continue;
    const line: LngLat[] = [];
    let d = 0;
    for (let k = 1; k < rd.line.length; k++) {
      const p = rd.line[k - 1], q = rd.line[k], L = kmBetween(p, q);
      const u0 = L ? (a.from - d) / L : 0, u1 = L ? (a.to - d) / L : 0;
      if (u1 >= 0 && u0 <= 1) {
        const lo = Math.max(0, u0), hi = Math.min(1, u1);
        const P = (u: number): LngLat => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
        if (!line.length) line.push(P(lo));
        line.push(P(hi));
      }
      d += L;
    }
    if (line.length >= 2) out.push(line);
  }
  return out;
}
