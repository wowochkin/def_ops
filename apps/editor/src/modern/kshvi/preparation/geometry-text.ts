import type { MapGeometry, MapMarker, Position } from '../../../../../../packages/kshvi/src/scenario/initial-map';

export type EditableGeometryKind = 'POINT' | 'LINE' | 'AREA';

export function parseGeometryText(value: string, kind: EditableGeometryKind): MapGeometry {
  const coordinates = value.split(/[;\n]/).map(item => item.trim()).filter(Boolean).map(item => {
    const parts = item.split(/\s*,\s*|\s+/).filter(Boolean).map(Number);
    if (parts.length !== 2 || parts.some(part => !Number.isFinite(part))) throw new Error('Каждая точка задаётся как «долгота, широта»');
    return parts as unknown as Position;
  });
  if (kind === 'POINT') {
    if (coordinates.length !== 1) throw new Error('Точка требует ровно одну пару координат');
    return { type: 'Point', coordinates: coordinates[0]! };
  }
  if (kind === 'LINE') {
    if (coordinates.length < 2) throw new Error('Маршрут требует не менее двух точек');
    return { type: 'LineString', coordinates };
  }
  if (coordinates.length < 4) throw new Error('Область требует не менее четырёх позиций замкнутого кольца');
  const first = coordinates[0]!, last = coordinates.at(-1)!;
  if (first[0] !== last[0] || first[1] !== last[1]) throw new Error('Последняя точка области должна совпадать с первой');
  return { type: 'Polygon', coordinates: [coordinates] };
}

export function geometryText(geometry: MapGeometry): string {
  const positions = geometry.type === 'Point' ? [geometry.coordinates] : geometry.type === 'LineString' ? geometry.coordinates : geometry.coordinates[0]!;
  return positions.map(([lon, lat]) => `${lon}, ${lat}`).join('; ');
}

export function markerGeometryKind(marker: MapMarker): EditableGeometryKind {
  return marker.geometry?.type === 'LineString' ? 'LINE' : marker.geometry?.type === 'Polygon' ? 'AREA' : 'POINT';
}
