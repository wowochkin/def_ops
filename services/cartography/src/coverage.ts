/**
 * Граница карты (coverage): за контуром тайлы прозрачны — так обрезаются поля и
 * легенда скана или подложка ограничивается районом. Пирамида на диске не
 * меняется: тайл целиком внутри контура отдаётся как есть, целиком снаружи —
 * прозрачным, а пересекающий границу маскируется по контуру (прозрачность) и
 * кэшируется на диске (_masked/{ключ границы}/…). Ключ — хеш контура, поэтому
 * после смены границы старый кэш не используется (и удаляется).
 *
 * Контур задаётся в градусах; ребро контура — прямая в координатах
 * долгота/широта, проверка «внутри» — чёт-нечет, как pointInRing из ядра.
 */
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import type { LngLat } from '@def-ops/core';
import { inverseMercator, pointInRing, tileBBox } from '@def-ops/core';
import { writeAtomic, type TileFile, type TileStore } from './tiles';

export type Relation = 'inside' | 'outside' | 'crossing';

/** Ключ границы для кэша производных тайлов. */
export function coverageKey(ring: LngLat[]): string {
  return createHash('sha1').update(JSON.stringify(ring)).digest('hex').slice(0, 16);
}

/** Отрезок пересекает отрезок (включая касание). */
function segmentsCross(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o = (p: LngLat, q: LngLat, r: LngLat) => Math.sign((q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]));
  const on = (p: LngLat, q: LngLat, r: LngLat) =>
    Math.min(p[0], r[0]) <= q[0] && q[0] <= Math.max(p[0], r[0]) && Math.min(p[1], r[1]) <= q[1] && q[1] <= Math.max(p[1], r[1]);
  const o1 = o(a, b, c), o2 = o(a, b, d), o3 = o(c, d, a), o4 = o(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && on(a, c, b)) || (o2 === 0 && on(a, d, b)) || (o3 === 0 && on(c, a, d)) || (o4 === 0 && on(c, b, d));
}

/** Как тайл z/x/y расположен относительно контура. */
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

/** Обнулить прозрачность пикселей RGBA-тайла за контуром (по центрам пикселей, построчно). */
export function maskTile(raw: Buffer, ring: LngLat[], z: number, x: number, y: number, T: number): Buffer {
  const n = 2 ** z;
  const xs: number[] = [];
  for (let j = 0; j < T; j++) {
    const lat = inverseMercator([0, (y + (j + 0.5) / T) / n])[1];
    // точки пересечения строки с рёбрами контура
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

const transparent = new Map<number, Promise<Buffer>>();
/** Прозрачный PNG T×T. */
export function transparentPng(T: number): Promise<Buffer> {
  let p = transparent.get(T);
  if (!p) {
    p = sharp({ create: { width: T, height: T, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer();
    transparent.set(T, p);
  }
  return p;
}

/** Тайл, обрезанный по контуру (PNG): из кэша или построенный и сохранённый в кэш. */
export async function maskedTile(store: TileStore, tenant: string, mapId: string, ring: LngLat[], t: TileFile, T: number): Promise<{ data: Buffer; file: string }> {
  const file = store.maskedPath(tenant, mapId, coverageKey(ring), t.z, t.x, t.y);
  try { return { data: await fs.readFile(file), file }; } catch { /* ещё не построен */ }
  const { data: raw, info } = await sharp(t.file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = info.width === info.height ? info.width : T;
  const src = info.width === size && info.height === size ? raw : await sharp(t.file).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const data = await sharp(maskTile(src, ring, t.z, t.x, t.y, size), { raw: { width: size, height: size, channels: 4 } }).png().toBuffer();
  await writeAtomic(file, data);
  return { data, file };
}
