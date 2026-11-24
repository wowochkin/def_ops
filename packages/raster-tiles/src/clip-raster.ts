import sharp from 'sharp';
import type { BBox, LngLat } from '@def-ops/core';
import { maskTile, tileRelation } from './coverage';

export type RasterFormat = 'png' | 'jpg' | 'webp';

export async function clipRasterTile(input: {
  bytes: Buffer;
  format: RasterFormat;
  bounds: Readonly<BBox>;
  z: number;
  x: number;
  y: number;
}): Promise<{ bytes: Buffer; format: RasterFormat } | null> {
  const [west, south, east, north] = input.bounds;
  const boxes: BBox[] = west <= east
    ? [[west, south, east, north]]
    : [[west, south, 180, north], [-180, south, east, north]];
  const rings = boxes.map(([w, s, e, n]): LngLat[] => [[w, s], [e, s], [e, n], [w, n]]);
  const relations = rings.map(ring => tileRelation(ring, input.z, input.x, input.y));
  if (relations.includes('inside')) return { bytes: input.bytes, format: input.format };
  if (!relations.includes('crossing')) return null;
  const decoded = await sharp(input.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const size = decoded.info.width === decoded.info.height ? decoded.info.width : 256;
  const raw = decoded.info.width === size && decoded.info.height === size
    ? decoded.data
    : await sharp(input.bytes).resize(size, size, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const combined = Buffer.alloc(raw.length);
  for (const [index, relation] of relations.entries()) {
    if (relation !== 'crossing') continue;
    const masked = maskTile(Buffer.from(raw), rings[index]!, input.z, input.x, input.y, size);
    for (let offset = 0; offset < masked.length; offset += 4) {
      if (masked[offset + 3]) masked.copy(combined, offset, offset, offset + 4);
    }
  }
  return {
    bytes: await sharp(combined, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer(),
    format: 'png',
  };
}
