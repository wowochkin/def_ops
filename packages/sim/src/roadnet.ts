/**
 * Дорожная сеть театра для показа движения: расчёт ведёт войска по сетке клеток (клетка с дорогой — быстро), а на
 * карте знак должен идти по самой дороге. Граф дорог строится из линий театра (дороги, шоссе, улицы; вершины,
 * общие для линий, — перекрёстки); участок пути по клеткам с дорогой заменяется кратчайшим путём по графу между
 * точками, где войска вошли на дорогу и сошли с неё. Где линий дорог нет (дороги только растром), путь остаётся
 * по клеткам, сглаженным.
 */
import type { LngLat } from '@def-ops/core';
import type { XY } from './geo';
import type { Theatre } from './theatre';

interface Snap { u: number; v: number; p: XY }

export class RoadNet {
  readonly nodes: XY[] = [];
  readonly adj: { to: number; w: number }[][] = [];
  private readonly segs: [number, number][] = [];
  private readonly buckets = new Map<string, number[]>();
  private readonly B: number;

  constructor(readonly T: Theatre) {
    this.B = Math.max(0.5, T.cellKm * 2);
    // отрезки линий дорог (км); перекрёстки в данных театра не всегда общие вершины — достраиваются:
    // пересечения отрезков и концы линий, не доходящие до соседней улицы, режут отрезки
    const seg: [XY, XY][] = [];
    const ends: XY[] = [];
    for (const r of T.data.roads) {
      if (r.kind === 'rail' || r.line.length < 2) continue;
      const xy = r.line.map((p) => T.proj.toXY(p));
      for (let k = 1; k < xy.length; k++) if (xy[k][0] !== xy[k - 1][0] || xy[k][1] !== xy[k - 1][1]) seg.push([xy[k - 1], xy[k]]);
      ends.push(xy[0], xy[xy.length - 1]);
    }
    const bk = new Map<string, number[]>();
    const cells = (a: XY, b: XY, pad = 0) => {
      const out: string[] = [];
      for (let x = Math.floor((Math.min(a[0], b[0]) - pad) / this.B); x <= Math.floor((Math.max(a[0], b[0]) + pad) / this.B); x++)
        for (let y = Math.floor((Math.min(a[1], b[1]) - pad) / this.B); y <= Math.floor((Math.max(a[1], b[1]) + pad) / this.B); y++) out.push(`${x},${y}`);
      return out;
    };
    seg.forEach(([a, b], i) => { for (const k of cells(a, b)) { const l = bk.get(k); if (l) l.push(i); else bk.set(k, [i]); } });
    const cuts: number[][] = seg.map(() => []);
    const extra: [XY, XY][] = [];
    // пересечения
    for (const list of bk.values()) for (let x = 0; x < list.length; x++) for (let y = x + 1; y < list.length; y++) {
      const i = list[x], j = list[y];
      const [p, p2] = seg[i], [q, q2] = seg[j];
      const r0 = p2[0] - p[0], r1 = p2[1] - p[1], s0 = q2[0] - q[0], s1 = q2[1] - q[1];
      const den = r0 * s1 - r1 * s0;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((q[0] - p[0]) * s1 - (q[1] - p[1]) * s0) / den, u = ((q[0] - p[0]) * r1 - (q[1] - p[1]) * r0) / den;
      if (t > 1e-6 && t < 1 - 1e-6 && u >= -1e-6 && u <= 1 + 1e-6) cuts[i].push(t);
      if (u > 1e-6 && u < 1 - 1e-6 && t >= -1e-6 && t <= 1 + 1e-6) cuts[j].push(u);
    }
    // концы линий у соседней улицы (недотянутые перекрёстки)
    const gap = Math.max(0.02, Math.min(0.08, T.cellKm * 0.25));
    for (const e of ends) {
      let best: { i: number; t: number; d: number } | null = null;
      for (const k of cells(e, e, gap)) for (const i of bk.get(k) ?? []) {
        const [a, b] = seg[i], dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((e[0] - a[0]) * dx + (e[1] - a[1]) * dy) / L));
        const d = Math.hypot(a[0] + dx * t - e[0], a[1] + dy * t - e[1]);
        if (d > 1e-6 && d <= gap && (!best || d < best.d)) best = { i, t, d };
      }
      if (!best) continue;
      const [a, b] = seg[best.i];
      const q: XY = [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t];
      if (best.t > 1e-6 && best.t < 1 - 1e-6) cuts[best.i].push(best.t);
      extra.push([e, q]);
    }
    const ids = new Map<string, number>();
    const node = (p: XY) => {
      const k = `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
      let i = ids.get(k);
      if (i == null) { i = this.nodes.length; ids.set(k, i); this.nodes.push(p); this.adj.push([]); }
      return i;
    };
    const edge = (a: XY, b: XY) => {
      const u = node(a), v = node(b);
      if (u === v) return;
      const w = Math.hypot(b[0] - a[0], b[1] - a[1]);
      this.adj[u].push({ to: v, w }); this.adj[v].push({ to: u, w });
      const s = this.segs.length;
      this.segs.push([u, v]);
      for (const k of cells(a, b)) { const l = this.buckets.get(k); if (l) l.push(s); else this.buckets.set(k, [s]); }
    };
    seg.forEach(([a, b], i) => {
      const ts = [0, ...cuts[i].sort((x, y) => x - y), 1];
      for (let k = 1; k < ts.length; k++) if (ts[k] - ts[k - 1] > 1e-9) edge([a[0] + (b[0] - a[0]) * ts[k - 1], a[1] + (b[1] - a[1]) * ts[k - 1]], [a[0] + (b[0] - a[0]) * ts[k], a[1] + (b[1] - a[1]) * ts[k]]);
    });
    for (const [a, b] of extra) edge(a, b);
  }

  get empty() { return this.segs.length === 0; }

  /** Ближайшая точка дороги не дальше maxKm. */
  snap(p: XY, maxKm: number): Snap | null {
    let best: Snap | null = null, bd = maxKm;
    const r = Math.ceil(maxKm / this.B), cx = Math.floor(p[0] / this.B), cy = Math.floor(p[1] / this.B);
    const seen = new Set<number>();
    for (let x = cx - r; x <= cx + r; x++) for (let y = cy - r; y <= cy + r; y++) for (const s of this.buckets.get(`${x},${y}`) ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      const [u, v] = this.segs[s], a = this.nodes[u], b = this.nodes[v];
      const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L));
      const q: XY = [a[0] + dx * t, a[1] + dy * t];
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < bd) { bd = d; best = { u, v, p: q }; }
    }
    return best;
  }

  /** Кратчайший путь по дорогам между двумя точками дороги (не длиннее maxKm); null — не нашли. */
  between(a: Snap, b: Snap, maxKm: number): XY[] | null {
    if ((a.u === b.u && a.v === b.v) || (a.u === b.v && a.v === b.u)) return [a.p, b.p];
    const N = this.nodes.length;
    const g = new Map<number, number>(), came = new Map<number, number>();
    const d = (i: number, p: XY) => Math.hypot(this.nodes[i][0] - p[0], this.nodes[i][1] - p[1]);
    const heap = new Heap();
    const push = (i: number, gi: number, from: number) => {
      if (gi >= (g.get(i) ?? Infinity) || gi > maxKm) return;
      g.set(i, gi); came.set(i, from);
      heap.push(i, gi + d(i, b.p));
    };
    push(a.u, d(a.u, a.p), -1); push(a.v, d(a.v, a.p), -1);
    let best = Infinity, end = -1;
    const done = new Set<number>();
    while (heap.size && done.size < N) {
      const f = heap.peek(), i = heap.pop();
      if (f >= best) break;
      if (done.has(i)) continue;
      done.add(i);
      const gi = g.get(i)!;
      if (i === b.u || i === b.v) { const tot = gi + d(i, b.p); if (tot < best) { best = tot; end = i; } }
      for (const e of this.adj[i]) push(e.to, gi + e.w, i);
    }
    if (end < 0) return null;
    const out: XY[] = [b.p];
    for (let i = end; i !== -1; i = came.get(i)!) out.push(this.nodes[i]);
    out.push(a.p);
    return out.reverse();
  }
}

const nets = new WeakMap<Theatre, RoadNet>();
export const roadNet = (T: Theatre) => { let n = nets.get(T); if (!n) { n = new RoadNet(T); nets.set(T, n); } return n; };

/**
 * Путь для показа: участки по клеткам с дорогой — по линиям дорог (кратчайший путь по графу), остальное — по
 * клеткам. Начало и конец — как в расчёте.
 */
export function visualPath(T: Theatre, trail: LngLat[]): LngLat[] {
  if (trail.length < 2) return trail;
  const net = roadNet(T);
  const xy = trail.map((p) => T.proj.toXY(p));
  // точки пути через полклетки
  const step = T.cellKm / 2;
  const pts: XY[] = [xy[0]];
  for (let i = 1; i < xy.length; i++) {
    const a = xy[i - 1], b = xy[i], L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step));
    for (let k = 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  if (net.empty) return douglas(smooth(pts), Math.max(0.01, T.cellKm * 0.08)).map((p) => T.proj.toLL(p));
  const reach = T.cellKm * 0.9;
  const tol = Math.max(0.01, T.cellKm * 0.08);
  // весь ход — улицами, если начало и конец у дороги и путь по ним не длиннее полутора расчётных
  let trailKm = 0;
  for (let i = 1; i < xy.length; i++) trailKm += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  // начало и конец могут быть внутри квартала (положение — центр участка): выход к ближайшей улице, не дальше
  // трети пути и километра
  const edgeKm = Math.max(reach, Math.min(1, trailKm * 0.35));
  const sa = net.snap(xy[0], edgeKm), sb = net.snap(xy[xy.length - 1], edgeKm);
  if (sa && sb) {
    const whole = net.between(sa, sb, trailKm * 1.5);
    if (whole) return douglas(dedupe([xy[0], ...whole, xy[xy.length - 1]]), tol).map((p) => T.proj.toLL(p));
  }
  const snaps = pts.map((p) => { const i = T.indexOf(T.proj.toLL(p)); return i >= 0 && T.road[i] ? net.snap(p, reach) : null; });
  // куски: по линиям дорог — как есть; вне линий (поле, дороги только растром) — по клеткам, сглаженные
  const out: XY[] = [];
  let free: XY[] = [pts[0]];
  const flush = () => { out.push(...(free.length >= 3 ? smooth(free) : free)); free = []; };
  for (let i = 1; i < pts.length;) {
    if (!snaps[i]) { free.push(pts[i]); i++; continue; }
    flush();
    // участок по дороге: от первой до последней точки подряд с дорогой
    // короткий разрыв (срезанный угол квартала, до клетки) участок по дороге не прерывает
    let j = i;
    for (;;) {
      if (j + 1 < pts.length && snaps[j + 1]) { j++; continue; }
      const k = [2, 3].map((g) => j + g).find((x) => x < pts.length && snaps[x]);
      if (k == null) break;
      j = k;
    }
    let runKm = 0;
    for (let k = i + 1; k <= j; k++) runKm += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    const road = j > i ? net.between(snaps[i]!, snaps[j]!, runKm * 1.8 + T.cellKm * 2) : null;
    if (road) out.push(...road); else for (let k = i; k <= j; k++) out.push(snaps[k]?.p ?? pts[k]);
    i = j + 1;
    if (i < pts.length) free = [out[out.length - 1]];
  }
  flush();
  out.push(xy[xy.length - 1]);
  // упростить с допуском в десятки метров: путь тот же, кадров меньше
  return douglas(dedupe(out), Math.max(0.01, T.cellKm * 0.08)).map((p) => T.proj.toLL(p));
}

/** Сглаживание ломаной по клеткам (Чайкин, концы на месте). */
function smooth(p: XY[]): XY[] {
  if (p.length < 3) return p;
  let a = dedupe(p);
  for (let it = 0; it < 2; it++) {
    const o: XY[] = [a[0]];
    for (let i = 0; i < a.length - 1; i++) {
      const [x0, y0] = a[i], [x1, y1] = a[i + 1];
      o.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
    }
    o.push(a[a.length - 1]);
    a = o;
  }
  return a;
}

/** Убрать повторы и точки на прямой. */
function dedupe(p: XY[]): XY[] {
  const o: XY[] = [];
  for (const q of p) {
    const l = o[o.length - 1];
    if (l && Math.hypot(q[0] - l[0], q[1] - l[1]) < 1e-3) continue;
    if (o.length >= 2) {
      const a = o[o.length - 2];
      const cross = (l[0] - a[0]) * (q[1] - a[1]) - (l[1] - a[1]) * (q[0] - a[0]);
      const dot = (l[0] - a[0]) * (q[0] - l[0]) + (l[1] - a[1]) * (q[1] - l[1]);
      if (Math.abs(cross) < 1e-6 && dot > 0) { o[o.length - 1] = q; continue; }
      // разворот назад (шпора: дошли до узла и вернулись) — вершину убрать
      const L1 = Math.hypot(l[0] - a[0], l[1] - a[1]), L2 = Math.hypot(q[0] - l[0], q[1] - l[1]);
      if (dot < -0.85 * L1 * L2) { o.pop(); if (o.length >= 1 && Math.hypot(q[0] - o[o.length - 1][0], q[1] - o[o.length - 1][1]) < 1e-3) continue; o.push(q); continue; }
    }
    o.push(q);
  }
  return o;
}

/** Упрощение ломаной (Дуглас — Пекер), tol — км. */
function douglas(p: XY[], tol: number): XY[] {
  if (p.length < 3) return p;
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-9;
    let worst = -1, wd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / L;
      if (d > wd) { wd = d; worst = i; }
    }
    if (worst > 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
  }
  return p.filter((_, i) => keep[i]);
}

/** Двоичная куча по приоритету. */
class Heap {
  private ids: number[] = []; private pr: number[] = [];
  get size() { return this.ids.length; }
  peek() { return this.pr[0]; }
  push(id: number, p: number) {
    const ids = this.ids, pr = this.pr;
    let i = ids.length; ids.push(id); pr.push(p);
    while (i > 0) { const q = (i - 1) >> 1; if (pr[q] <= p) break; ids[i] = ids[q]; pr[i] = pr[q]; i = q; }
    ids[i] = id; pr[i] = p;
  }
  pop(): number {
    const ids = this.ids, pr = this.pr, top = ids[0], lid = ids.pop()!, lp = pr.pop()!;
    if (ids.length) {
      let i = 0;
      for (;;) { let c = 2 * i + 1; if (c >= ids.length) break; if (c + 1 < ids.length && pr[c + 1] < pr[c]) c++; if (pr[c] >= lp) break; ids[i] = ids[c]; pr[i] = pr[c]; i = c; }
      ids[i] = lid; pr[i] = lp;
    }
    return top;
  }
}
