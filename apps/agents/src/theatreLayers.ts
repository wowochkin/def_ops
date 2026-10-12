/**
 * Карта театра без внешних подложек (работает офлайн): растр местности из файла театра — картинкой, реки, шоссе,
 * укреплённые полосы — линиями MapLibre. Подписи и знаки рисует слой SVG поверх карты (MapView).
 */
import type { Map as MlMap, StyleSpecification } from 'maplibre-gl';
import type { TheatreData } from '@def-ops/sim';

const TERRAIN_COLORS: Record<string, [number, number, number]> = {
  o: [236, 232, 214], // открытая
  f: [198, 216, 176], // лес
  m: [184, 210, 200], // болото
  u: [214, 200, 192], // застройка
  h: [226, 214, 182], // высоты
  w: [164, 198, 226], // вода
};

function terrainImage(t: TheatreData): string | null {
  const g = t.terrainGrid;
  if (!g) return null;
  const c = document.createElement('canvas');
  c.width = g.cols; c.height = g.rows;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(g.cols, g.rows);
  let i = 0, n = 0;
  for (const ch of g.rle) {
    if (ch >= '0' && ch <= '9') { n = n * 10 + (ch.charCodeAt(0) - 48); continue; }
    const col = TERRAIN_COLORS[ch] ?? [255, 255, 255];
    for (let k = 0; k < (n || 1); k++, i++) { img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = 255; }
    n = 0;
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function baseStyle(): StyleSpecification {
  return { version: 8, sources: {}, layers: [{ id: 'paper', type: 'background', paint: { 'background-color': '#f4f1e8' } }] };
}

export function addTheatre(map: MlMap, t: TheatreData) {
  const url = terrainImage(t);
  const g = t.terrainGrid;
  if (url && g) {
    const [w, s, e, n] = g.bbox;
    map.addSource('terrain', { type: 'image', url, coordinates: [[w, n], [e, n], [e, s], [w, s]] });
    map.addLayer({ id: 'terrain', type: 'raster', source: 'terrain', paint: { 'raster-resampling': 'nearest', 'raster-opacity': 0.95 } });
  }
  const lines = (items: { line: [number, number][]; props: Record<string, unknown> }[]) => ({
    type: 'FeatureCollection' as const,
    features: items.map((x) => ({ type: 'Feature' as const, properties: x.props, geometry: { type: 'LineString' as const, coordinates: x.line } })),
  });
  map.addSource('rivers', { type: 'geojson', data: lines(t.rivers.map((r) => ({ line: r.line, props: { major: r.major } }))) });
  map.addLayer({ id: 'rivers', type: 'line', source: 'rivers', paint: { 'line-color': '#4f86bf', 'line-width': ['case', ['get', 'major'], 2.2, 0.8] } });
  map.addSource('roads', { type: 'geojson', data: lines(t.roads.filter((r) => r.kind !== 'rail').map((r) => ({ line: r.line, props: { kind: r.kind } }))) });
  map.addLayer({ id: 'roads', type: 'line', source: 'roads', paint: { 'line-color': '#9a8462', 'line-width': 1.4 } });
  map.addSource('forts', { type: 'geojson', data: lines(t.lines.filter((l) => l.fortification).map((l) => ({ line: l.line, props: { lv: l.fortification ?? 1 } }))) });
  map.addLayer({ id: 'forts', type: 'line', source: 'forts', paint: { 'line-color': '#5a6fa8', 'line-width': ['+', 1, ['get', 'lv']], 'line-dasharray': [2, 1.2], 'line-opacity': 0.85 } });
}

/** Пункты для подписей: центры именованных районов театра. */
export function towns(t: TheatreData): { name: string; at: [number, number] }[] {
  return t.areas.map((a) => {
    const n = a.ring.length || 1;
    const c = a.ring.reduce<[number, number]>((s, p) => [s[0] + p[0] / n, s[1] + p[1] / n], [0, 0]);
    return { name: a.name, at: c };
  });
}
