import { expect, it } from 'vitest';
import sharp from 'sharp';
import { tileOf } from '@def-ops/core';
import { clipRasterTile } from '../src';

const bounds = [34.727193, 48.299639, 35.42196, 48.633668] as const;

it('сохраняет пиксели внутри рамки и удаляет внешние на масштабах 8–13', async () => {
  const bytes = await sharp({ create: { width: 256, height: 256, channels: 4, background: { r: 20, g: 40, b: 60, alpha: 1 } } }).png().toBuffer();
  for (let z = 8; z <= 13; z++) {
    const outside = bounds[0] - 0.01;
    const inside = bounds[0] + 0.01;
    const lat = (bounds[1] + bounds[3]) / 2;
    const [x, y] = tileOf([outside, lat], z);
    const result = await clipRasterTile({ bytes, format: 'png', bounds: [...bounds], z, x, y });
    expect(result).not.toBeNull();
    expect(result!.format).toBe('png');
    const { data, info } = await sharp(result!.bytes).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alpha = (lon: number) => {
      const px = Math.floor(((lon + 180) / 360 * 2 ** z - x) * info.width);
      const py = Math.floor(((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z - y) * info.height);
      return data[(py * info.width + px) * 4 + 3];
    };
    expect(alpha(outside), `z${z}: снаружи`).toBe(0);
    expect(alpha(inside), `z${z}: внутри`).toBe(255);
  }
});
