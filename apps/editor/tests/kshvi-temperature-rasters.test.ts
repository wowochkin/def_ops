import { expect, it } from 'vitest';
import { temperatureRasters } from '../src/modern/kshvi/preparation/temperature-rasters';

it('строит сплошной температурный растр по сетке 3 × 3', () => {
  const bounds = [36, 55, 38, 57] as const;
  const points = [0, 1, 2].flatMap(row => [0, 1, 2].map(col => ({
    lon: 36 + col, lat: 55 + row, value: row + col,
  })));
  const result = temperatureRasters(points, bounds);
  expect(result).toHaveLength(1);
  expect(result[0]!.size).toBe(128);
  expect(result[0]!.pixels.some((value, index) => index % 4 === 3 && value > 0)).toBe(true);
});
