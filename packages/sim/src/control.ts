/**
 * Контроль территории и снабжение.
 *
 * Контроль: каждая клетка театра принадлежит стороне с большим «влиянием»
 * (сила формирований с гауссовым затуханием по расстоянию) — та же модель, что
 * у линии фронта. Снабжение: подвоз идёт от источников стороны (станции
 * снабжения, переправы, тыловые районы) только по своей территории; время
 * подвоза — по дорогам для автотранспорта. Формирование, к которому подвоз не
 * доходит, отрезано: не пополняется и не может отойти к своим.
 */
import type { LngLat } from '@def-ops/core';
import type { Theatre } from './theatre';
import type { Formation, Rules, SideProfile } from './types';

export interface ControlMap {
  /** Индекс стороны с перевесом влияния; −1 — ничья (влияния нет). */
  owner: Int8Array;
  sides: string[];
}

export function controlMap(T: Theatre, units: Formation[], sides: string[], weight: (f: Formation) => number, sigmaKm = 12, exponent = 0.3): ControlMap {
  const N = T.cols * T.rows;
  const infl = sides.map(() => new Float64Array(N));
  const reach = sigmaKm * 3, rc = Math.ceil(reach / T.cellKm);
  for (const u of units) {
    const k = sides.indexOf(u.side);
    if (k < 0) continue;
    const w = Math.pow(Math.max(0, weight(u)), exponent);
    const i0 = T.indexOf(u.position);
    if (i0 < 0) continue;
    const c0 = i0 % T.cols, r0 = Math.floor(i0 / T.cols);
    for (let r = Math.max(0, r0 - rc); r <= Math.min(T.rows - 1, r0 + rc); r++) for (let c = Math.max(0, c0 - rc); c <= Math.min(T.cols - 1, c0 + rc); c++) {
      const d = Math.hypot(c - c0, r - r0) * T.cellKm;
      if (d > reach) continue;
      infl[k][r * T.cols + c] += w * Math.exp(-(d * d) / (2 * sigmaKm * sigmaKm));
    }
  }
  const owner = new Int8Array(N).fill(-1);
  for (let i = 0; i < N; i++) {
    let best = -1, bv = 1e-9;
    for (let k = 0; k < sides.length; k++) if (infl[k][i] > bv) { bv = infl[k][i]; best = k; }
    owner[i] = best;
  }
  return { owner, sides };
}

/**
 * Проходимость для подвоза стороны: клетка закрыта, если ближайший противник
 * ближе zocKm и ближе любого своего формирования (зона влияния противника).
 * Окружение получается, когда кольцо таких зон смыкается вокруг формирования.
 */
export function supplyPassable(T: Theatre, units: Formation[], side: string, zocKm: number | ((f: Formation) => number), territory?: { owner: ArrayLike<number>; side: number }): Uint8Array {
  const N = T.cols * T.rows;
  const zoc = typeof zocKm === 'number' ? () => zocKm : zocKm;
  const own = units.filter((u) => u.side === side).map((u) => T.proj.toXY(u.position));
  const enemy = units.filter((u) => u.side !== side).map((u) => ({ p: T.proj.toXY(u.position), r: zoc(u) }));
  const out = new Uint8Array(N).fill(1);
  // территория противника закрыта для подвоза целиком (сплошная полоса), а не только зоны его формирований
  if (territory) for (let i = 0; i < N; i++) { const o = territory.owner[i]; if (o >= 0 && o !== territory.side) out[i] = 0; }
  for (let i = 0; i < N; i++) {
    if (!out[i]) continue;
    const p = T.cellCenter(i % T.cols, Math.floor(i / T.cols));
    let de = Infinity, inZone = false;
    for (const e of enemy) { const d = Math.hypot(e.p[0] - p[0], e.p[1] - p[1]); if (d < de) de = d; if (d < e.r) inZone = true; }
    if (!inZone) continue;
    let dOwn = Infinity;
    for (const o of own) { const d = Math.hypot(o[0] - p[0], o[1] - p[1]); if (d < dOwn) dOwn = d; }
    if (dOwn > de) out[i] = 0;
  }
  return out;
}

export interface SupplyField {
  /** Часы подвоза до клетки по своей территории (Infinity — не доходит). */
  hours: Float64Array;
}

/** Поле времени подвоза для стороны: от источников в обход зон влияния противника. */
export function supplyField(T: Theatre, side: string, sources: LngLat[], units: Formation[], profile: SideProfile, rules: Rules, time: string, zocKm: number | ((f: Formation) => number), territory?: { owner: ArrayLike<number>; side: number }): SupplyField {
  const pass = supplyPassable(T, units, side, zocKm, territory);
  const src = sources.map((p) => T.indexOf(p)).filter((i) => i >= 0 && pass[i]);
  const hours = T.distanceField(src, 'motor', profile, rules, time, (i) => pass[i] === 1);
  return { hours };
}

/**
 * Исходная территория: клетка — стороне ближайшего формирования или опорной точки
 * (источники подвоза — тыл стороны). Дальше территория меняется только движением войск.
 */
export function initialTerritory(T: Theatre, points: { side: number; at: LngLat }[]): Int8Array {
  const N = T.cols * T.rows;
  const out = new Int8Array(N).fill(-1);
  const ps = points.map((p) => ({ side: p.side, xy: T.proj.toXY(p.at) }));
  for (let i = 0; i < N; i++) {
    const c = T.cellCenter(i % T.cols, Math.floor(i / T.cols));
    let best = -1, bd = Infinity;
    for (const p of ps) { const d = (p.xy[0] - c[0]) ** 2 + (p.xy[1] - c[1]) ** 2; if (d < bd) { bd = d; best = p.side; } }
    out[i] = best;
  }
  return out;
}

/**
 * Занятие территории: клетки в радиусе radiusKm от пути формирования за ход (отрезок
 * от прежнего положения к новому) переходят к его стороне, если рядом нет противника.
 */
export function claimTerritory(T: Theatre, owner: Int8Array, moves: { side: number; from: LngLat; to: LngLat }[], enemyNear: (side: number, cell: [number, number]) => boolean, radiusKm: number) {
  const rc = Math.ceil(radiusKm / T.cellKm) + 1;
  for (const m of moves) {
    const a = T.proj.toXY(m.from), b = T.proj.toXY(m.to);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const steps = Math.max(1, Math.ceil(len / T.cellKm));
    for (let k = 0; k <= steps; k++) {
      const q: [number, number] = [a[0] + ((b[0] - a[0]) * k) / steps, a[1] + ((b[1] - a[1]) * k) / steps];
      const i0 = T.indexOf(T.proj.toLL(q));
      if (i0 < 0) continue;
      const c0 = i0 % T.cols, r0 = Math.floor(i0 / T.cols);
      for (let r = r0 - rc; r <= r0 + rc; r++) for (let c = c0 - rc; c <= c0 + rc; c++) {
        if (!T.inside(c, r)) continue;
        const i = r * T.cols + c;
        if (owner[i] === m.side) continue;
        const p = T.cellCenter(c, r);
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > radiusKm) continue;
        if (!enemyNear(m.side, p)) owner[i] = m.side;
      }
    }
  }
}
