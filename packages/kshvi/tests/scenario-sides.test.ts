import type { SymbolDefinition } from '@def-ops/tactical-symbols';
import { expect, it } from 'vitest';
import { createInitialSituationMap } from '../src/scenario/initial-map';
import { defaultScenarioSides, symbolForSide } from '../src/scenario/sides';

const redSide = { id: 'red', name: 'Красные', color: 'red' as const };
const blueSide = { id: 'blue', name: 'Синие', color: 'blue' as const };

it('переносит стороны в исходную карту и перекрашивает только красные знаки синей стороны', () => {
  const sides = defaultScenarioSides();
  expect(sides.map(side => side.color)).toEqual(['red', 'blue']);
  expect(sides.every(side => side.country == null)).toBe(true);
  const map = createInitialSituationMap({
    id: 'map-1', revision: 1,
    environment: { snapshotId: 'a'.repeat(64), manifestSha256: 'b'.repeat(64), bounds: [1, 2, 3, 4] },
    initialOperationalAt: '2030-01-01T10:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
    symbolSet: { id: 'symbols', revision: 1, sha256: 'c'.repeat(64) }, attribution: [], sides,
  });
  expect(map.sides).toEqual(sides);
  const red = { id: 'red-symbol', color: '#b91c1c' } as SymbolDefinition;
  const black = { id: 'black-symbol', color: '#111111' } as SymbolDefinition;
  expect(symbolForSide(red, blueSide).color).toBe('#1d4ed8');
  expect(symbolForSide(red, redSide).color).toBe('#b91c1c');
  expect(symbolForSide(black, blueSide).color).toBe('#111111');
});
