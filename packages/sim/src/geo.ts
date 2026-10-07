/**
 * Плоская система координат театра в километрах (равнопромежуточная проекция
 * вокруг центра). Для районов размером в сотни километров погрешность — доли
 * процента, этого достаточно для темпов и расстояний.
 */
import type { LngLat } from '@def-ops/core';

export type XY = [number, number];

export interface LocalProjection {
  toXY(ll: LngLat): XY;
  toLL(p: XY): LngLat;
}

export function localProjection(center: LngLat): LocalProjection {
  const kx = 111.32 * Math.cos((center[1] * Math.PI) / 180), ky = 110.57;
  return {
    toXY: (ll) => [(ll[0] - center[0]) * kx, (ll[1] - center[1]) * ky],
    toLL: (p) => [center[0] + p[0] / kx, center[1] + p[1] / ky],
  };
}

export const dist = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]);
export const lerp = (a: XY, b: XY, t: number): XY => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export function pointInPolygon(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > p[1]) !== (yj > p[1]) && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function centroid(ring: XY[]): XY {
  let x = 0, y = 0;
  for (const p of ring) { x += p[0]; y += p[1]; }
  return [x / ring.length, y / ring.length];
}

/** Длина ломаной, км. */
export function pathLength(path: XY[]): number {
  let s = 0;
  for (let i = 1; i < path.length; i++) s += dist(path[i - 1], path[i]);
  return s;
}

/** Точка на ломаной на расстоянии d от начала и остаток пути. */
export function alongPath(path: XY[], d: number): { point: XY; rest: XY[] } {
  if (path.length < 2 || d <= 0) return { point: path[0], rest: path };
  let left = d;
  for (let i = 1; i < path.length; i++) {
    const seg = dist(path[i - 1], path[i]);
    if (left <= seg) {
      const p = lerp(path[i - 1], path[i], seg ? left / seg : 0);
      return { point: p, rest: [p, ...path.slice(i)] };
    }
    left -= seg;
  }
  const last = path[path.length - 1];
  return { point: last, rest: [last] };
}
