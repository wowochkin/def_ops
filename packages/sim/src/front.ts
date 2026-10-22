/**
 * Линия фронта по положению и силе формирований: поле влияния каждой стороны
 * (сила × гауссово затухание с расстоянием), линия фронта — изолиния, где
 * влияние сторон равно (марширующие квадраты). Там, где влияния обеих сторон
 * ничтожны (глубокий тыл, пустые районы), линия не строится.
 */
import type { LngLat } from '@def-ops/core';
import { dist, type XY } from './geo';
import type { Theatre } from './theatre';
import type { Formation } from './types';

export interface FrontOptions {
  /** Радиус влияния формирования, км (σ гауссова затухания). */
  sigmaKm?: number;
  /** Шаг сетки поля, км. */
  stepKm?: number;
  /** Порог: доля максимума влияния, ниже которой обе стороны «отсутствуют». */
  minShare?: number;
  /**
   * Показатель степени силы во влиянии (0..1). При 1 перевес в силе «вдавливает»
   * линию прямо в позиции слабого; положение формирований важнее их силы,
   * поэтому по умолчанию 0,3: линия между сторонами, смещена к слабой.
   */
  strengthExponent?: number;
  /**
   * Как складывается влияние соединений стороны: sum — суммой (армии и корпуса нынешней модели), max — наибольшим
   * (дивизии агентной модели: суммой сотни дивизий одной стороны «вдавливали» линию за позиции другой, на десятки км).
   */
  combine?: 'sum' | 'max';
}

export function frontLine(theatre: Theatre, formations: Formation[], sides: [string, string], weight: (f: Formation) => number, o: FrontOptions = {}): LngLat[][] {
  const sigma = o.sigmaKm ?? 12, step = o.stepKm ?? Math.max(theatre.cellKm * 2, 2), minShare = o.minShare ?? 0.02, ex = o.strengthExponent ?? 0.3;
  const [w, s, e, n] = theatre.data.bbox;
  const p0 = theatre.proj.toXY([w, s]), p1 = theatre.proj.toXY([e, n]);
  const cols = Math.ceil((p1[0] - p0[0]) / step) + 1, rows = Math.ceil((p1[1] - p0[1]) / step) + 1;
  const units = formations.filter((f) => !f.destroyed).map((f) => ({ side: f.side, p: theatre.proj.toXY(f.position), w: Math.pow(Math.max(0, weight(f)), ex) }));
  const A = new Float64Array(cols * rows), B = new Float64Array(cols * rows);
  const reach = sigma * 3, max = o.combine === 'max';
  for (const u of units) {
    const arr = u.side === sides[0] ? A : u.side === sides[1] ? B : null;
    if (!arr) continue;
    const c0 = Math.max(0, Math.floor((u.p[0] - reach - p0[0]) / step)), c1 = Math.min(cols - 1, Math.ceil((u.p[0] + reach - p0[0]) / step));
    const r0 = Math.max(0, Math.floor((u.p[1] - reach - p0[1]) / step)), r1 = Math.min(rows - 1, Math.ceil((u.p[1] + reach - p0[1]) / step));
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      const d = dist([p0[0] + c * step, p0[1] + r * step], u.p);
      const v = u.w * Math.exp(-(d * d) / (2 * sigma * sigma));
      arr[r * cols + c] = max ? Math.max(arr[r * cols + c], v) : arr[r * cols + c] + v;
    }
  }
  let maxI = 0;
  for (let i = 0; i < A.length; i++) maxI = Math.max(maxI, A[i], B[i]);
  const thr = maxI * minShare;
  // поле: >0 — сторона 0, <0 — сторона 1; NaN — нет ни тех, ни других
  const F = new Float64Array(cols * rows);
  for (let i = 0; i < F.length; i++) F[i] = A[i] < thr && B[i] < thr ? NaN : Math.log((A[i] + thr * 0.01) / (B[i] + thr * 0.01));
  const at = (c: number, r: number): XY => [p0[0] + c * step, p0[1] + r * step];
  const segs: [XY, XY][] = [];
  const edge = (pa: XY, va: number, pb: XY, vb: number): XY => { const t = va / (va - vb); return [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]; };
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const v = [F[r * cols + c], F[r * cols + c + 1], F[(r + 1) * cols + c + 1], F[(r + 1) * cols + c]];
    if (v.some(Number.isNaN)) continue;
    const p = [at(c, r), at(c + 1, r), at(c + 1, r + 1), at(c, r + 1)];
    const cuts: XY[] = [];
    for (let k = 0; k < 4; k++) {
      const a = v[k], b = v[(k + 1) % 4];
      if ((a > 0) !== (b > 0)) cuts.push(edge(p[k], a, p[(k + 1) % 4], b));
    }
    if (cuts.length === 2) segs.push([cuts[0], cuts[1]]);
    else if (cuts.length === 4) { segs.push([cuts[0], cuts[1]]); segs.push([cuts[2], cuts[3]]); }
  }
  return joinSegments(segs, step * 0.01).filter((l) => l.length >= 3).map((l) => l.map((q) => theatre.proj.toLL(q)));
}

/**
 * Линия фронта по территории (rules.territory): граница клеток сторон 0 и 1
 * (марширующие квадраты по центрам клеток), сглаженная срезанием углов.
 */
export function territoryLine(theatre: Theatre, owner: ArrayLike<number>, smooth = 2): LngLat[][] {
  const { cols, rows } = theatre;
  const F = (c: number, r: number) => { const o = owner[r * cols + c]; return o === 0 ? 1 : o === 1 ? -1 : NaN; };
  const segs: [XY, XY][] = [];
  const mid = (a: XY, b: XY): XY => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  for (let r = 0; r < rows - 1; r++) for (let c = 0; c < cols - 1; c++) {
    const v = [F(c, r), F(c + 1, r), F(c + 1, r + 1), F(c, r + 1)];
    if (v.some(Number.isNaN)) continue;
    const p = [theatre.cellCenter(c, r), theatre.cellCenter(c + 1, r), theatre.cellCenter(c + 1, r + 1), theatre.cellCenter(c, r + 1)];
    const cuts: XY[] = [];
    for (let k = 0; k < 4; k++) if ((v[k] > 0) !== (v[(k + 1) % 4] > 0)) cuts.push(mid(p[k], p[(k + 1) % 4]));
    if (cuts.length === 2) segs.push([cuts[0], cuts[1]]);
    else if (cuts.length === 4) { segs.push([cuts[0], cuts[1]]); segs.push([cuts[2], cuts[3]]); }
  }
  const chaikin = (l: XY[]): XY[] => {
    if (l.length < 3) return l;
    const out: XY[] = [l[0]];
    for (let i = 0; i < l.length - 1; i++) {
      const a = l[i], b = l[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(l[l.length - 1]);
    return out;
  };
  return joinSegments(segs, theatre.cellKm * 0.01).filter((l) => l.length >= 3).map((l) => {
    let q = l;
    for (let k = 0; k < smooth; k++) q = chaikin(q);
    return q.map((x) => theatre.proj.toLL(x));
  });
}

/**
 * Территория для рисунка линии фронта: острова стороны (связные по четырём соседям куски, оторванные от её основной —
 * самой большой — территории и не касающиеся края карты) отдаются окружающей стороне, если keep их не оставляет. Без
 * этого линия обводит кольцом каждый клочок разметки, оставшийся между коридорами наступающих; котлы keep оставляет.
 */
export function mergeIslands(cols: number, rows: number, terr: ArrayLike<number>, keep: (side: number, cells: number[]) => boolean): number[] {
  const out = Array.from(terr);
  for (const si of [0, 1]) {
    const comp = new Int32Array(cols * rows).fill(-1);
    const parts: { cells: number[]; edge: boolean }[] = [];
    for (let k = 0; k < out.length; k++) {
      if (out[k] !== si || comp[k] >= 0) continue;
      const part = { cells: [k], edge: false };
      comp[k] = parts.length;
      for (let j = 0; j < part.cells.length; j++) {
        const q = part.cells[j], c = q % cols, r = (q - c) / cols;
        if (c === 0 || r === 0 || c === cols - 1 || r === rows - 1) part.edge = true;
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const cc = c + dc, rr = r + dr;
          if (cc < 0 || rr < 0 || cc >= cols || rr >= rows) continue;
          const n = rr * cols + cc;
          if (out[n] === si && comp[n] < 0) { comp[n] = parts.length; part.cells.push(n); }
        }
      }
      parts.push(part);
    }
    if (parts.length < 2) continue;
    const main = parts.reduce((b, x, j) => (x.cells.length > parts[b].cells.length ? j : b), 0);
    parts.forEach((p, j) => { if (j !== main && !p.edge && !keep(si, p.cells)) for (const q of p.cells) out[q] = 1 - si; });
  }
  return out;
}

/** Собрать отрезки в ломаные по совпадающим концам. */
function joinSegments(segs: [XY, XY][], eps: number): XY[][] {
  const key = (p: XY) => `${Math.round(p[0] / eps)}:${Math.round(p[1] / eps)}`;
  const ends = new Map<string, number[]>();
  segs.forEach((s, i) => { for (const p of s) { const k = key(p); ends.set(k, [...(ends.get(k) ?? []), i]); } });
  const used = new Uint8Array(segs.length);
  const lines: XY[][] = [];
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: XY[] = [segs[i][0], segs[i][1]];
    for (const dir of [1, -1]) {
      for (;;) {
        const tip = dir === 1 ? line[line.length - 1] : line[0];
        const next = (ends.get(key(tip)) ?? []).find((j) => !used[j]);
        if (next === undefined) break;
        used[next] = 1;
        const [a, b] = segs[next];
        const other = key(a) === key(tip) ? b : a;
        if (dir === 1) line.push(other); else line.unshift(other);
      }
    }
    lines.push(line);
  }
  return lines;
}
