import { createHash } from 'node:crypto';
import type { LngLat } from '@def-ops/core';
import { inverseMercator, pointInRing, tileBBox } from '@def-ops/core';

export type Relation = 'inside' | 'outside' | 'crossing';

export function coverageKey(ring: LngLat[]): string {
  return createHash('sha1').update(JSON.stringify(ring)).digest('hex').slice(0, 16);
}

function segmentsCross(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o = (p: LngLat, q: LngLat, r: LngLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const on = (p: LngLat, q: LngLat, r: LngLat) =>
    Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

export function tileRelation(ring: LngLat[], z: number, x: number, y: number): Relation {
  const [w, s, e, n] = tileBBox(x, y, z);
  let rw = Infinity, rs = Infinity, re = -Infinity, rn = -Infinity;
  for (const [lng, lat] of ring) { rw = Math.min(rw, lng); re = Math.max(re, lng); rs = Math.min(rs, lat); rn = Math.max(rn, lat); }
  if (re < w || rw > e || rn < s || rs > n) return 'outside';
  const corners: LngLat[] = [[w, s], [e, s], [e, n], [w, n]];
  const inRect = (p: LngLat) => p[0] > w && p[0] < e && p[1] > s && p[1] < n;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    if (inRect(a)) return 'crossing';
    for (let k = 0; k < 4; k++) if (segmentsCross(a, b, corners[k], corners[(k + 1) % 4])) return 'crossing';
  }
  return pointInRing([(w + e) / 2, (s + n) / 2], ring) ? 'inside' : 'outside';
}

export function maskTile(raw: Buffer, ring: LngLat[], z: number, x: number, y: number, T: number): Buffer {
  const n = 2 ** z;
  const xs: number[] = [];
  for (let j = 0; j < T; j++) {
    const lat = inverseMercator([0, (y + (j + 0.5) / T) / n])[1];
    xs.length = 0;
    for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) {
      const [xi, yi] = ring[i], [xk, yk] = ring[k];
      if ((yi > lat) !== (yk > lat)) xs.push(((xk - xi) * (lat - yi)) / (yk - yi) + xi);
    }
    xs.sort((a, b) => a - b);
    let c = 0;
    for (let i = 0; i < T; i++) {
      const lng = ((x + (i + 0.5) / T) / n) * 360 - 180;
      while (c < xs.length && xs[c] < lng) c++;
      if (c % 2 === 0) raw[(j * T + i) * 4 + 3] = 0;
    }
  }
  return raw;
}
