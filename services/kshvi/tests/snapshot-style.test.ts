import { expect, it } from 'vitest';
import { styleWithBounds } from '../src/environment/snapshot-style';

it('добавляет рамку в ответ старого снимка, не меняя исходный документ', () => {
  const old = {
    version: 8 as const,
    sources: { atlas: { type: 'raster-dem' as const, tiles: ['/snapshot/{z}/{x}/{y}'] } },
    layers: [],
  };
  const result = styleWithBounds(old, [34.7, 48.2, 35.4, 48.6]);
  expect(result.sources.atlas).toMatchObject({ bounds: [34.7, 48.2, 35.4, 48.6] });
  expect(old.sources.atlas).not.toHaveProperty('bounds');
});

it('отклоняет стиль без ожидаемого источника atlas', () => {
  expect(() => styleWithBounds({ version: 8, sources: {}, layers: [] }, [0, 0, 1, 1])).toThrow('источника atlas');
});
