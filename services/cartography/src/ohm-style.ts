/**
 * Стиль MapLibre для векторной карты OpenHistoricalMap — по мотивам стиля сайта OHM:
 * бумажный фон, земли, вода, границы, железные дороги, дороги по классам, здания, подписи.
 * Шрифты и значки — локальные (скачиваются вместе с картой). Все `*-opacity` — числа:
 * движок умножает их на прозрачность подложки. Фильтр по дате добавляет клиент
 * (`metadata['def-ops:dated']`).
 */
import type { BBox } from '@def-ops/core';

export interface OhmStyleInput { name: string; tiles: string; glyphs: string; sprite: string; bounds: BBox; attribution: string }

type Layer = Record<string, unknown>;
type Expr = unknown[];

const SRC = 'ohm';
const REGULAR = ['OpenHistorical'];
const ITALIC = ['OpenHistorical Italic'];
const BOLD = ['OpenHistorical Bold'];

const cls = (...v: string[]): Expr => ['in', ['get', 'class'], ['literal', v]];
const isLine: Expr = ['==', ['geometry-type'], 'LineString'];
const isArea: Expr = ['==', ['geometry-type'], 'Polygon'];
const has = (k: string): Expr => ['has', k];
const not = (e: Expr): Expr => ['!', e];
const all = (...e: Expr[]): Expr => ['all', ...e];
/** Ширина по уровню: пары [уровень, ширина]. */
const byZoom = (...stops: [number, unknown][]): Expr => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops.flat()];

const MAJOR = ['motorway', 'trunk', 'motorway_link', 'trunk_link'];
const PRIMARY = ['primary', 'primary_link'];
const SECONDARY = ['secondary', 'tertiary', 'secondary_link', 'tertiary_link'];
const LOCAL = ['unclassified', 'residential', 'living_street', 'road', 'service'];
const PATHS = ['track', 'path', 'footway', 'cycleway', 'bridleway', 'steps', 'pedestrian'];
const ROADS = [...MAJOR, ...PRIMARY, ...SECONDARY, ...LOCAL];

/** Ширина дороги по классу на уровне z (заливка; обводка шире). */
const roadWidth = (k: number): Expr => byZoom(
  [6, ['match', ['get', 'class'], MAJOR, 1 * k, PRIMARY, 0.8 * k, SECONDARY, 0.4 * k, 0.2 * k]],
  [12, ['match', ['get', 'class'], MAJOR, 3 * k, PRIMARY, 2.5 * k, SECONDARY, 1.8 * k, 1 * k]],
  [16, ['match', ['get', 'class'], MAJOR, 14 * k, PRIMARY, 12 * k, SECONDARY, 10 * k, 'service', 4 * k, 7 * k]],
);
/** Порядок дорог: старшие — сверху. */
const roadRank: Expr = ['match', ['get', 'class'], MAJOR, 4, PRIMARY, 3, SECONDARY, 2, 1];
const roadLine = (id: string, filter: Expr, color: unknown, width: Expr, extra: Layer = {}): Layer => ({
  id, type: 'line', source: SRC, 'source-layer': 'roads', filter,
  layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': roadRank, ...(extra.layout as Layer | undefined) },
  paint: { 'line-color': color, 'line-width': width, ...(extra.paint as Layer | undefined) },
});

export function ohmStyle(o: OhmStyleInput): {
  version: 8; name: string; glyphs: string; sprite: string; metadata: Record<string, unknown>;
  sources: Record<string, unknown>; layers: Record<string, unknown>[];
} {
  const layers: Layer[] = [
    { id: 'background', type: 'background', paint: { 'background-color': '#f2efe4' } },

    // земли
    {
      id: 'landuse', type: 'fill', source: SRC, 'source-layer': 'landuse',
      paint: {
        'fill-color': ['match', ['get', 'class'],
          ['forest', 'wood'], '#c7d9b0',
          ['farmland', 'meadow', 'grass', 'grassland', 'heath', 'scrub', 'orchard', 'vineyard', 'allotments', 'farmyard', 'wetland'], '#eef0d5',
          ['residential', 'industrial', 'commercial', 'retail', 'military', 'railway', 'quarry'], '#e3d9cc',
          'cemetery', '#d5dcc6',
          ['park', 'garden'], '#d8e8c0',
          '#e9e6d6'],
        'fill-opacity': 0.9,
      },
    },

    // вода
    { id: 'water-area', type: 'fill', source: SRC, 'source-layer': 'water', filter: isArea, paint: { 'fill-color': '#a9c9e6' } },
    {
      id: 'water-line', type: 'line', source: SRC, 'source-layer': 'water', filter: isLine,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#a9c9e6',
        'line-width': byZoom(
          [6, ['match', ['get', 'class'], ['river', 'canal'], 0.8, 0.3]],
          [12, ['match', ['get', 'class'], ['river', 'canal'], 3, 1]],
          [16, ['match', ['get', 'class'], ['river', 'canal'], 12, 3]],
        ),
      },
    },

    // границы
    {
      id: 'boundary-admin', type: 'line', source: SRC, 'source-layer': 'boundaries', filter: cls('admin'),
      paint: { 'line-color': '#8c6d9e', 'line-width': byZoom([8, 0.6], [16, 1.5]), 'line-dasharray': [3, 2], 'line-opacity': 0.7 },
    },
    {
      id: 'boundary-country', type: 'line', source: SRC, 'source-layer': 'boundaries', filter: cls('country'),
      paint: { 'line-color': '#8c6d9e', 'line-width': byZoom([0, 1], [8, 2], [16, 4]), 'line-dasharray': [5, 2, 1, 2] },
    },

    // железные дороги: серая линия с белыми шпалами
    {
      id: 'rail', type: 'line', source: SRC, 'source-layer': 'rail',
      paint: { 'line-color': ['match', ['get', 'class'], 'rail', '#8a8a8a', '#a0a0a0'], 'line-width': byZoom([6, 1], [12, 2.5], [16, 5]) },
    },
    {
      id: 'rail-ties', type: 'line', source: SRC, 'source-layer': 'rail', minzoom: 10, filter: not(has('tunnel')),
      paint: { 'line-color': '#ffffff', 'line-width': byZoom([10, 1], [16, 3]), 'line-dasharray': [1, 3] },
    },

    // дороги: обводка (тоннели — пунктиром, мосты — тёмная), заливка по классам, тропы — пунктир
    roadLine('road-casing', all(cls(...ROADS), not(has('bridge')), not(has('tunnel'))), '#c2ab8c', roadWidth(1.4)),
    roadLine('road-casing-tunnel', all(cls(...ROADS), has('tunnel')), '#a59a8c', roadWidth(1.4), { paint: { 'line-dasharray': [1, 1] } }),
    roadLine('road-casing-bridge', all(cls(...ROADS), has('bridge')), '#5c5146', roadWidth(1.6)),
    roadLine('road', cls(...ROADS),
      ['match', ['get', 'class'], MAJOR, '#e8a36b', PRIMARY, '#f2c97c', SECONDARY, '#fbe5a8', '#ffffff'], roadWidth(1),
      { paint: { 'line-opacity': 1 } }),
    roadLine('road-path', cls(...PATHS), '#9c7f5f', byZoom([13, 0.8], [16, 1.8]), { paint: { 'line-dasharray': [2, 1.5] }, layout: { 'line-cap': 'butt' } }),

    // здания
    {
      id: 'buildings', type: 'fill', source: SRC, 'source-layer': 'buildings', minzoom: 13,
      paint: { 'fill-color': '#d4c6b4', 'fill-outline-color': '#b8a690' },
    },

    // подписи дорог вдоль линии
    {
      id: 'road-label', type: 'symbol', source: SRC, 'source-layer': 'roads', minzoom: 12, filter: has('name'),
      layout: {
        'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': REGULAR,
        'text-size': byZoom([12, 10], [16, 13]), 'text-max-angle': 30,
      },
      paint: { 'text-color': '#5b4a3a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
    },

    // значимые места: значок и подпись (у замков, памятников — только подпись)
    {
      id: 'poi-icon', type: 'symbol', source: SRC, 'source-layer': 'pois', minzoom: 13,
      filter: cls('place_of_worship', 'station', 'townhall'),
      layout: {
        'icon-image': ['match', ['get', 'class'], 'place_of_worship', 'place_of_worship-18', 'station', 'railstation-18', 'townhall-18'],
        'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': REGULAR, 'text-size': 11,
        'text-anchor': 'top', 'text-offset': [0, 0.9], 'text-optional': true,
      },
      paint: { 'text-color': '#4a3f35', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },
    {
      id: 'poi-label', type: 'symbol', source: SRC, 'source-layer': 'pois', minzoom: 13,
      filter: not(cls('place_of_worship', 'station', 'townhall')),
      layout: { 'text-field': ['coalesce', ['get', 'name'], ''], 'text-font': ITALIC, 'text-size': 11 },
      paint: { 'text-color': '#6b4f3a', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },

    // пункты: город и посёлок — значок и полужирная подпись, прочие — обычная
    {
      id: 'place-minor', type: 'symbol', source: SRC, 'source-layer': 'places', filter: all(not(cls('city', 'town')), has('name')),
      layout: {
        'text-field': ['get', 'name'], 'text-font': REGULAR,
        'text-size': byZoom([8, ['match', ['get', 'class'], 'village', 11, 9]], [16, ['match', ['get', 'class'], 'village', 16, 13]]),
      },
      paint: { 'text-color': '#3d3328', 'text-halo-color': '#f7f4ea', 'text-halo-width': 1.5 },
    },
    {
      id: 'place-major', type: 'symbol', source: SRC, 'source-layer': 'places', filter: all(cls('city', 'town'), has('name')),
      layout: {
        'icon-image': ['match', ['get', 'class'], 'city', 'capital-18', 'city-18'],
        'icon-size': byZoom([4, 0.6], [12, 1]),
        'text-field': ['get', 'name'], 'text-font': BOLD,
        'text-size': byZoom([4, ['match', ['get', 'class'], 'city', 12, 10]], [12, ['match', ['get', 'class'], 'city', 20, 15]]),
        'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-optional': true,
      },
      paint: { 'text-color': '#2e251c', 'text-halo-color': '#f7f4ea', 'text-halo-width': 1.6 },
    },

    // подписи воды
    {
      id: 'water-line-label', type: 'symbol', source: SRC, 'source-layer': 'water', minzoom: 10, filter: all(isLine, has('name')),
      layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ITALIC, 'text-size': byZoom([10, 10], [16, 14]) },
      paint: { 'text-color': '#4a78a8', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },
    {
      id: 'water-area-label', type: 'symbol', source: SRC, 'source-layer': 'water', minzoom: 10, filter: all(isArea, has('name')),
      layout: { 'text-field': ['get', 'name'], 'text-font': ITALIC, 'text-size': byZoom([10, 10], [16, 14]) },
      paint: { 'text-color': '#4a78a8', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    },
  ];

  return {
    version: 8,
    name: o.name,
    glyphs: o.glyphs,
    sprite: o.sprite,
    metadata: { 'def-ops:dated': true },
    sources: {
      [SRC]: { type: 'vector', tiles: [o.tiles], minzoom: 0, maxzoom: 16, bounds: o.bounds, attribution: o.attribution },
    },
    layers,
  };
}
