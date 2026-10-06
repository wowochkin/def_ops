/** Двумерная векторная арифметика. Все вычисления ядра идут в «мировых пикселях». */
export type Vec2 = [number, number];

export const add = (a: Vec2, b: Vec2): Vec2 => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Vec2, k: number): Vec2 => [a[0] * k, a[1] * k];
export const dot = (a: Vec2, b: Vec2): number => a[0] * b[0] + a[1] * b[1];
export const cross = (a: Vec2, b: Vec2): number => a[0] * b[1] - a[1] * b[0];
export const len = (a: Vec2): number => Math.hypot(a[0], a[1]);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l] : [1, 0];
};
/** Левая нормаль (в экранной системе с осью Y вниз — «левая» относительно направления движения). */
export const perp = (a: Vec2): Vec2 => [a[1], -a[0]];
export const rotate = (a: Vec2, ang: number): Vec2 => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return [a[0] * c - a[1] * s, a[0] * s + a[1] * c];
};
export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Пересечение отрезков ab и cd. Возвращает параметры (t,u) или null. */
export function segIntersect(a: Vec2, b: Vec2, c: Vec2, d: Vec2): [number, number] | null {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return null;
  const ca = sub(c, a);
  const t = cross(ca, s) / den;
  const u = cross(ca, r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return [t, u];
}
