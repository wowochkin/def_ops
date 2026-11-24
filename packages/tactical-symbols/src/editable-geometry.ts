import type { SymbolDefinition } from './model';
import { symbolFeatures, type SymbolFeature } from './render-maplibre';
import { symbolSet } from './registry';

type Point = readonly [number, number];

function valid(points: readonly Point[]): boolean {
  return points.every(point => point.length === 2 && point.every(Number.isFinite));
}

export function lineFeature(symbol: SymbolDefinition, coordinates: readonly Point[], id = symbol.id, setVersion = symbolSet.version): SymbolFeature {
  if (coordinates.length < 2) throw new Error('Линия требует не менее две точки');
  if (!valid(coordinates)) throw new Error('Координаты линии должны быть конечными числами');
  return symbolFeatures([{ id, setVersion, symbol, geometry: { type: 'LineString', coordinates } }]).features[0]!;
}

export function areaFeature(symbol: SymbolDefinition, ring: readonly Point[], id = symbol.id, setVersion = symbolSet.version): SymbolFeature {
  if (ring.length < 4) throw new Error('Замкнутое кольцо области требует не менее четырёх позиций');
  if (!valid(ring)) throw new Error('Координаты области должны быть конечными числами');
  const first = ring[0]!, last = ring.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Кольцо области должно быть замкнуто');
  return symbolFeatures([{ id, setVersion, symbol, geometry: { type: 'Polygon', coordinates: [ring] } }]).features[0]!;
}
