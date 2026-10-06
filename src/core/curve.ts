/**
 * Кривые: сглаживание опорных точек (центростремительный Catmull-Rom),
 * параметризация по длине дуги, эквидистанты, поиск ближайшей точки.
 */
import { type Vec2, add, sub, mul, dist, norm, perp, lerp, dot, segIntersect } from './vec';

/** Плотная выборка сплайна через опорные точки. step — шаг в мировых пикселях. */
export function smoothPath(pts: Vec2[], closed = false, step = 0.6): Vec2[] {
  const n = pts.length;
  if (n < 2) return pts.slice();
  if (n === 2 && !closed) return densify(pts, step);
  const out: Vec2[] = [];
  const get = (i: number): Vec2 => {
    if (closed) return pts[((i % n) + n) % n];
    if (i < 0) return add(pts[0], sub(pts[0], pts[1])); // отражение для концов
    if (i >= n) return add(pts[n - 1], sub(pts[n - 1], pts[n - 2]));
    return pts[i];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const segLen = dist(p1, p2);
    const k = Math.max(2, Math.ceil(segLen / step));
    for (let j = 0; j < k; j++) out.push(catmullRom(p0, p1, p2, p3, j / k));
  }
  out.push(closed ? pts[0] : pts[n - 1]);
  return out;
}

function densify(pts: Vec2[], step: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const k = Math.max(1, Math.ceil(dist(pts[i], pts[i + 1]) / step));
    for (let j = 0; j < k; j++) out.push(lerp(pts[i], pts[i + 1], j / k));
  }
  out.push(pts[pts.length - 1]);
  return out;
}

/** Ломаная без сглаживания, но с равномерной плотностью точек. */
export function polylinePath(pts: Vec2[], closed = false, step = 2): Vec2[] {
  if (pts.length < 2) return pts.slice();
  return densify(closed ? [...pts, pts[0]] : pts, step);
}

/** Центростремительный Catmull-Rom (alpha = 0.5): без петель и выбросов на неравных отрезках. */
function catmullRom(p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number): Vec2 {
  const a = 0.5;
  const t01 = Math.pow(Math.max(dist(p0, p1), 1e-6), a);
  const t12 = Math.pow(Math.max(dist(p1, p2), 1e-6), a);
  const t23 = Math.pow(Math.max(dist(p2, p3), 1e-6), a);
  const m1 = add(sub(p2, p1), mul(sub(mul(sub(p1, p0), 1 / t01), mul(sub(p2, p0), 1 / (t01 + t12))), t12));
  const m2 = add(sub(p2, p1), mul(sub(mul(sub(p3, p2), 1 / t23), mul(sub(p3, p1), 1 / (t12 + t23))), t12));
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return [
    h00 * p1[0] + h10 * m1[0] + h01 * p2[0] + h11 * m2[0],
    h00 * p1[1] + h10 * m1[1] + h01 * p2[1] + h11 * m2[1],
  ];
}

/** Ломаная с параметризацией по длине дуги. */
export class Path {
  readonly pts: Vec2[];
  readonly cum: number[];
  readonly length: number;
  readonly closed: boolean;

  constructor(pts: Vec2[], closed = false) {
    // убираем совпадающие соседние точки
    const clean: Vec2[] = [];
    for (const p of pts) if (!clean.length || dist(clean[clean.length - 1], p) > 1e-6) clean.push(p);
    if (clean.length === 1) clean.push([clean[0][0] + 1e-3, clean[0][1]]);
    this.pts = clean;
    this.closed = closed;
    this.cum = [0];
    for (let i = 1; i < clean.length; i++) this.cum.push(this.cum[i - 1] + dist(clean[i - 1], clean[i]));
    this.length = this.cum[this.cum.length - 1];
  }

  private locate(s: number): [number, number] {
    const { cum } = this;
    if (this.closed) s = ((s % this.length) + this.length) % this.length;
    else s = Math.max(0, Math.min(this.length, s));
    let lo = 0, hi = cum.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (cum[mid] <= s) lo = mid; else hi = mid;
    }
    const segLen = cum[hi] - cum[lo];
    return [lo, segLen > 0 ? (s - cum[lo]) / segLen : 0];
  }

  pointAt(s: number): Vec2 {
    if (!this.closed && s < 0) return add(this.pts[0], mul(this.tangentAt(0), s));
    if (!this.closed && s > this.length) return add(this.pts[this.pts.length - 1], mul(this.tangentAt(this.length), s - this.length));
    const [i, f] = this.locate(s);
    return lerp(this.pts[i], this.pts[Math.min(i + 1, this.pts.length - 1)], f);
  }

  /** Единичная касательная, усреднённая по окну, чтобы нормали были гладкими. */
  tangentAt(s: number, win = 1.5): Vec2 {
    const a = this.closed ? s - win : Math.max(0, s - win);
    const b = this.closed ? s + win : Math.min(this.length, s + win);
    if (b - a < 1e-9) {
      const p = this.pts;
      return norm(sub(p[p.length - 1], p[0]));
    }
    return norm(sub(this.pointAtClamped(b), this.pointAtClamped(a)));
  }

  private pointAtClamped(s: number): Vec2 {
    const [i, f] = this.locate(s);
    return lerp(this.pts[i], this.pts[Math.min(i + 1, this.pts.length - 1)], f);
  }

  normalAt(s: number, win?: number): Vec2 {
    return perp(this.tangentAt(s, win));
  }

  /** Подпуть между s0 и s1 (s0 > s1 — в обратном направлении). */
  slice(s0: number, s1: number): Vec2[] {
    const out: Vec2[] = [this.pointAt(s0)];
    if (this.closed) {
      // для замкнутых — идём по кратчайшей дуге в заданном направлении
      const L = this.length;
      const dir = s1 >= s0 ? 1 : -1;
      const span = Math.abs(s1 - s0);
      const step = Math.max(0.5, span / 400);
      for (let d = step; d < span; d += step) out.push(this.pointAt(s0 + dir * d));
      out.push(this.pointAt(((s1 % L) + L) % L));
      return out;
    }
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    const inner: Vec2[] = [];
    for (let i = 0; i < this.pts.length; i++) if (this.cum[i] > lo && this.cum[i] < hi) inner.push(this.pts[i]);
    if (s1 < s0) inner.reverse();
    out.push(...inner, this.pointAt(s1));
    return out;
  }

  /** Ближайшая к p точка пути: длина дуги и расстояние. */
  nearest(p: Vec2): { s: number; d: number; point: Vec2 } {
    let best = { s: 0, d: Infinity, point: this.pts[0] as Vec2 };
    for (let i = 0; i < this.pts.length - 1; i++) {
      const a = this.pts[i], b = this.pts[i + 1];
      const ab = sub(b, a);
      const l2 = dot(ab, ab);
      const t = l2 > 0 ? Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2)) : 0;
      const q = lerp(a, b, t);
      const d = dist(p, q);
      if (d < best.d) best = { s: this.cum[i] + t * (this.cum[i + 1] - this.cum[i]), d, point: q };
    }
    return best;
  }

  /** Эквидистанта: смещение влево (offset > 0) или вправо. */
  offset(off: number | ((s: number) => number), win = 1.5): Vec2[] {
    const f = typeof off === 'number' ? () => off : off;
    return this.pts.map((p, i) => add(p, mul(this.normalAt(this.cum[i], win), f(this.cum[i]))));
  }
}

/** Удаляет петли самопересечения у эквидистанты (внутренняя сторона крутых изгибов). */
export function removeLoops(pts: Vec2[], window = 400): Vec2[] {
  const out = pts.slice();
  for (let i = 0; i < out.length - 3; i++) {
    const maxJ = Math.min(out.length - 1, i + window);
    for (let j = maxJ - 1; j > i + 1; j--) {
      const hit = segIntersect(out[i], out[i + 1], out[j], out[j + 1]);
      if (hit) {
        const x = lerp(out[i], out[i + 1], hit[0]);
        out.splice(i + 1, j - i, x);
        break;
      }
    }
  }
  return out;
}

export function pathD(pts: Vec2[], closed = false, prec = 2): string {
  if (!pts.length) return '';
  const f = (v: number) => +v.toFixed(prec);
  let d = `M${f(pts[0][0])} ${f(pts[0][1])}`;
  for (let i = 1; i < pts.length; i++) d += `L${f(pts[i][0])} ${f(pts[i][1])}`;
  return closed ? d + 'Z' : d;
}

export function bbox(pts: Vec2[]): [number, number, number, number] {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) {
    if (x < x0) x0 = x; if (y < y0) y0 = y;
    if (x > x1) x1 = x; if (y > y1) y1 = y;
  }
  return [x0, y0, x1, y1];
}
