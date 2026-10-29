/**
 * Зоны влияния сторон для карты («Командование»): пространство, которое сторона держит своими войсками, — вокруг
 * соединений (сила × гауссово затухание с расстоянием, как у линии фронта) и бледно — по свою сторону расчётной
 * линии фронта (территория), тем бледнее, чем дальше от неё. Значение — перевес влияния одной стороны над другой: где
 * влияние сторон сравнимо (передний край, бои, окружения) — спорно, без цвета. Противника передают только обнаруженного разведкой (туман войны), и его земле
 * без обнаруженных войск цвета нет.
 *
 * Сетка — на весь театр, столбцы равномерны по долготе, строки — по меркатору (сверху вниз): картинка по углам
 * театра ложится на карту без искажения. Значение клетки — от −100 (противник) до 100 (свои), 0 — без цвета.
 * Это изображение для карты, на расчёт не влияет.
 */
import type { LngLat } from '@def-ops/core';
import { dist } from './geo';
import { detected, detectKm } from './reports';
import { onMap, type SimContext } from './step';
import type { Snapshot } from './history';
import type { Theatre } from './theatre';
import type { SimState } from './types';

export interface ZoneInput {
  /** Свои соединения на карте: место и вес (сила, обычно (численность/10 тыс.)^0,3). */
  own: { at: LngLat; w: number }[];
  /** Обнаруженный разведкой противник. */
  enemy: { at: LngLat; w: number }[];
  /** Территория (SimState.territory): владелец клетки театра — индекс стороны; own / enemy — индексы сторон. */
  territory?: { owner: ArrayLike<number>; own: number; enemy: number };
  /**
   * Поле зрения разведки, км от своих соединений: на земле противника в его пределах — его цвет и без обнаруженных
   * войск (земля за фронтом видна); дальше — только у обнаруженных. Infinity — туман войны снят.
   */
  recon?: number;
  /** Спорные места: бои за ход, отрезанные соединения — там без цвета. */
  contested?: LngLat[];
  /** Радиус влияния соединения, км (σ). По умолчанию — 10 клеток театра, от 2 до 20 км. */
  sigmaKm?: number;
}

export interface ZoneGrid {
  /** [запад, юг, восток, север] — углы картинки. */
  bbox: [number, number, number, number];
  cols: number;
  rows: number;
  /** Строки сверху вниз (с севера), в строке — с запада; −100..100. */
  v: number[] | Int8Array;
}

/** Наибольшее значение клетки. */
export const ZONE_MAX = 100;
/** Наибольшая сторона сетки, клеток. */
const MAX_SIDE = 200;
/** Насыщение влияния: 1 − exp(−x/K). Одно соединение у себя — около 0,86. */
const K = 0.5;
/** Цвет земли у самой линии фронта (доля полного); в глубину — бледнее. */
const FLOOR = 0.85;
/** Насколько войска одной стороны бледнят цвет земли другой (котёл, вклинение, войска у самого фронта). */
const CROSS = 0.4;
/** Слабее этого — без цвета. */
const MIN = 0.03;

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const latOf = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

export function influenceZones(T: Theatre, inp: ZoneInput): ZoneGrid {
  const [w, s, e, n] = T.data.bbox;
  const sigma = inp.sigmaKm ?? Math.min(20, Math.max(2, T.cellKm * 10));
  const latC = (s + n) / 2;
  const wKm = dist(T.proj.toXY([w, latC]), T.proj.toXY([e, latC])), hKm = dist(T.proj.toXY([w, s]), T.proj.toXY([w, n]));
  const step = Math.max(T.cellKm, Math.max(wKm, hKm) / MAX_SIDE);
  const cols = Math.max(2, Math.ceil(wKm / step)), rows = Math.max(2, Math.ceil(hKm / step));
  const yN = mercY(n), yS = mercY(s);
  const N = cols * rows;
  const X = new Float64Array(N), Y = new Float64Array(N);
  const lngOf = (c: number) => w + ((c + 0.5) / cols) * (e - w);
  const latR = Array.from({ length: rows }, (_, r) => latOf(yN - ((r + 0.5) / rows) * (yN - yS)));
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const p = T.proj.toXY([lngOf(c), latR[r]]);
    X[r * cols + c] = p[0]; Y[r * cols + c] = p[1];
  }
  const colOf = (ll: LngLat) => Math.floor(((ll[0] - w) / (e - w)) * cols);
  const rowOf = (ll: LngLat) => Math.floor(((yN - mercY(ll[1])) / (yN - yS)) * rows);
  /** Обойти клетки в пределах reach км от точки. */
  const around = (ll: LngLat, reach: number, f: (i: number, d: number) => void) => {
    const c0 = colOf(ll), r0 = rowOf(ll), k = Math.ceil(reach / step) + 1;
    const p = T.proj.toXY(ll);
    for (let r = Math.max(0, r0 - k); r <= Math.min(rows - 1, r0 + k); r++) for (let c = Math.max(0, c0 - k); c <= Math.min(cols - 1, c0 + k); c++) {
      const i = r * cols + c, d = Math.hypot(X[i] - p[0], Y[i] - p[1]);
      if (d <= reach) f(i, d);
    }
  };
  const field = (units: ZoneInput['own']) => {
    const F = new Float64Array(N);
    for (const u of units) around(u.at, sigma * 3, (i, d) => { F[i] += u.w * Math.exp(-(d * d) / (2 * sigma * sigma)); });
    return F;
  };
  const A = field(inp.own), B = field(inp.enemy);

  // спорные места — без цвета
  const calm = new Float64Array(N).fill(1);
  const cr = Math.max(T.cellKm, sigma / 3.5);
  for (const at of inp.contested ?? []) around(at, cr * 3, (i, d) => { calm[i] *= 1 - Math.exp(-(d * d) / (2 * cr * cr)); });
  const sat = (x: number) => 1 - Math.exp(-x / K);
  const v = new Array<number>(N).fill(0);
  const put = (i: number, x: number) => { const y = x * calm[i]; v[i] = Math.abs(y) < MIN ? 0 : Math.round(Math.max(-1, Math.min(1, y)) * ZONE_MAX); };

  const t = inp.territory;
  if (!t) {
    // территория не ведётся — по перевесу влияния: цвет сильной стороны, тем бледнее, чем ближе влияние сторон
    for (let i = 0; i < N; i++) {
      const a = sat(A[i]), b = sat(B[i]);
      put(i, a + b > 0 ? Math.sign(a - b) * Math.max(a, b) * Math.sqrt(Math.abs(a - b) / (a + b)) : 0);
    }
    return { bbox: [w, s, e, n], cols, rows, v };
  }
  // территория: сторона — по свою сторону расчётной линии фронта; у самой линии — узкий шов без цвета; в глубину —
  // бледнее (у своих войск — ярче); земля противника — только в поле зрения своей разведки (recon) или у обнаруженных
  const side = new Int8Array(N);
  for (let i = 0; i < N; i++) {
    const k = T.indexOf(T.proj.toLL([X[i], Y[i]]));
    const o = k < 0 ? -1 : t.owner[k];
    side[i] = o === t.own ? 1 : o === t.enemy ? -1 : 0;
  }
  const D = frontDistance(side, cols, rows, step);
  const seen = new Uint8Array(N);
  if (inp.recon === Infinity) seen.fill(1);
  else if (inp.recon) for (const u of inp.own) around(u.at, inp.recon, (i) => { seen[i] = 1; });
  const deep = sigma * 2, seam = Math.max(T.cellKm, sigma / 5);
  for (let i = 0; i < N; i++) {
    if (!side[i]) continue;
    const d = D[i], near = Number.isFinite(d) ? FLOOR * Math.exp(-(d * d) / (2 * deep * deep)) : 0;
    const edge = Number.isFinite(d) ? 1 - Math.exp(-(d * d) / (2 * seam * seam)) : 1;
    const a = sat(A[i]), b = sat(B[i]);
    // своя земля: свои войска или близость к фронту; противник рядом (котёл, вклинение) — бледнее
    if (side[i] === 1) put(i, Math.max(a, near) * (1 - CROSS * b) * edge);
    else put(i, -Math.max(b, seen[i] ? near : 0) * (1 - CROSS * a) * edge);
  }
  return { bbox: [w, s, e, n], cols, rows, v };
}

/** Расстояние до границы своей и чужой территории, км (двухпроходная фаска по сетке); границы нет — Infinity. */
function frontDistance(own: Int8Array, cols: number, rows: number, step: number): Float64Array {
  const N = cols * rows, D = new Float64Array(N).fill(Infinity);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c, o = own[i];
    if (!o) continue;
    const nb = [[c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1]];
    if (nb.some(([x, y]) => x >= 0 && y >= 0 && x < cols && y < rows && own[y * cols + x] === -o)) D[i] = 0;
  }
  const d1 = step, d2 = step * Math.SQRT2;
  const relax = (i: number, j: number, d: number) => { if (D[j] + d < D[i]) D[i] = D[j] + d; };
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (c > 0) relax(i, i - 1, d1);
    if (r > 0) { relax(i, i - cols, d1); if (c > 0) relax(i, i - cols - 1, d2); if (c < cols - 1) relax(i, i - cols + 1, d2); }
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c;
    if (c < cols - 1) relax(i, i + 1, d1);
    if (r < rows - 1) { relax(i, i + cols, d1); if (c < cols - 1) relax(i, i + cols + 1, d2); if (c > 0) relax(i, i + cols - 1, d2); }
  }
  return D;
}

/** Значение зоны в точке (−1..1); вне сетки — 0. */
export function zoneAt(z: ZoneGrid, ll: LngLat): number {
  const [w, s, e, n] = z.bbox;
  const c = Math.floor(((ll[0] - w) / (e - w)) * z.cols), r = Math.floor(((mercY(n) - mercY(ll[1])) / (mercY(n) - mercY(s))) * z.rows);
  if (c < 0 || r < 0 || c >= z.cols || r >= z.rows) return 0;
  return z.v[r * z.cols + c] / ZONE_MAX;
}



/** Вес соединения во влиянии: (численность / 10 тыс.)^0,3, от 0,4 до 2 — положение важнее силы, как у линии фронта. */
const weight = (personnel: number) => Math.min(2, Math.max(0.4, Math.pow(Math.max(0, personnel) / 10_000, 0.3)));

/**
 * Зоны влияния для стороны side по состоянию игры: свои — все соединения на карте, противник — обнаруженный
 * разведкой (reveal — все: посредник снял туман войны), территория — если правила её ведут; спорные места —
 * contested (бои хода) и отрезанные свои соединения.
 */
export function sideZones(ctx: SimContext, state: SimState, side: string, o: { reveal?: boolean; contested?: LngLat[] } = {}): ZoneGrid {
  const T = ctx.theatre;
  const live = state.formations.filter((f) => onMap(f, state.time));
  const own = live.filter((f) => f.side === side), foe = live.filter((f) => f.side !== side);
  const seen = o.reveal ? null : detected(T, own.map((f) => ({ id: f.id, at: f.position })), foe.map((f) => ({ id: f.id, at: f.position })), detectKm(ctx));
  const sides = ctx.scenario.sides.map((x) => x.id);
  const enemySide = sides.find((x) => x !== side);
  return influenceZones(T, {
    own: own.map((f) => ({ at: f.position, w: weight(f.personnel) })),
    enemy: foe.filter((f) => !seen || seen.has(f.id)).map((f) => ({ at: f.position, w: weight(f.personnel) })),
    ...(state.territory && enemySide ? { territory: { owner: state.territory, own: sides.indexOf(side), enemy: sides.indexOf(enemySide) } } : {}),
    recon: o.reveal ? Infinity : detectKm(ctx),
    contested: [...(o.contested ?? []), ...own.filter((f) => f.cutOff).map((f) => f.position)],
  });
}

/**
 * Зоны влияния для стороны side по снимку переигровки: свои — живые соединения стороны, противник — все остальные
 * живые (туман войны снят: переигровку смотрит сторонний наблюдатель), территория — из снимка; спорные места —
 * отрезанные соединения стороны.
 */
export function snapshotZones(ctx: SimContext, sn: Snapshot, side: string): ZoneGrid {
  const live = sn.units.filter((u) => !u.destroyed);
  const own = live.filter((u) => ctx.scenario.formations.find((f) => f.id === u.id)?.side === side);
  const foe = live.filter((u) => !own.includes(u));
  const sides = ctx.scenario.sides.map((x) => x.id);
  const enemySide = sides.find((x) => x !== side);
  return influenceZones(ctx.theatre, {
    own: own.map((u) => ({ at: u.at, w: weight(u.personnel) })),
    enemy: foe.map((u) => ({ at: u.at, w: weight(u.personnel) })),
    ...(sn.territory && enemySide ? { territory: { owner: sn.territory, own: sides.indexOf(side), enemy: sides.indexOf(enemySide) } } : {}),
    recon: Infinity,
    contested: own.filter((u) => u.cutOff).map((u) => u.at),
  });
}
