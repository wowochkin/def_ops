import { promises as fs } from 'node:fs';
import sharp from 'sharp';
import type { LngLat } from '@def-ops/core';
import { coverageKey, maskTile } from '@def-ops/raster-tiles';
import { writeAtomic, type TileFile, type TileStore } from './tiles';

export { coverageKey, maskTile, tileRelation, type Relation } from '@def-ops/raster-tiles';

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
