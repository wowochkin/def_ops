import type { StyleSpecification } from 'maplibre-gl';
import type { AudienceLayer } from '../../../../../../packages/kshvi/src/exposition/browser-entry';
import type { AudienceProjectionView } from './AudienceProjector';

const EMPTY: Record<string, unknown> = { type: 'FeatureCollection', features: [] };

function geography(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && 'geojson' in value) {
    const data = value.geojson;
    if (data && typeof data === 'object') return data as Record<string, unknown>;
  }
  if (value && typeof value === 'object' && 'type' in value && value.type === 'FeatureCollection') {
    return value as Record<string, unknown>;
  }
  return EMPTY;
}

function symbolGeography(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) return EMPTY;
  return {
    type: 'FeatureCollection',
    features: value.flatMap((item, index) => {
      if (!item || typeof item !== 'object' || !('position' in item) || !Array.isArray(item.position) || item.position.length !== 2) return [];
      return [{
        type: 'Feature',
        properties: {
          id: 'id' in item ? item.id : `symbol-${index}`,
          label: 'label' in item ? item.label : '',
          side: 'side' in item ? item.side : '',
        },
        geometry: { type: 'Point', coordinates: item.position },
      }];
    }),
  };
}

/** Только локальные GeoJSON-источники: внешняя тайловая подложка и статическая SVG-схема не используются. */
export function createExpositionMapStyle(
  map: AudienceProjectionView['map'],
  layers: readonly AudienceLayer[],
): StyleSpecification {
  const enabled = new Set(layers);
  const style: StyleSpecification = {
    version: 8,
    sources: {},
    layers: [{ id: 'exposition-background', type: 'background', paint: { 'background-color': '#17231e' } }],
  };
  if (enabled.has('terrain')) {
    style.sources['exposition-terrain'] = { type: 'geojson', data: geography(map.terrain) as never };
    style.layers.push(
      { id: 'exposition-terrain-fill', type: 'fill', source: 'exposition-terrain', filter: ['==', ['geometry-type'], 'Polygon'], paint: {
        'fill-color': ['match', ['get', 'kind'], 'forest', '#294a36', 'water', '#284b60', '#40543f'],
        'fill-opacity': 0.88, 'fill-outline-color': '#76917a',
      } },
      { id: 'exposition-terrain-line', type: 'line', source: 'exposition-terrain', filter: ['==', ['geometry-type'], 'LineString'], paint: {
        'line-color': ['match', ['get', 'kind'], 'water', '#6095b5', 'ridge', '#d1c28b', '#76917a'],
        'line-width': ['match', ['get', 'kind'], 'water', 5, 3],
      } },
    );
  }
  if (enabled.has('routes')) {
    style.sources['exposition-routes'] = { type: 'geojson', data: geography(map.routes) as never };
    style.layers.push({ id: 'exposition-routes-line', type: 'line', source: 'exposition-routes', paint: {
      'line-color': '#7bb7d8', 'line-width': 4, 'line-dasharray': [2, 1],
    } });
  }
  if (enabled.has('logistics')) {
    style.sources['exposition-logistics'] = { type: 'geojson', data: geography(map.logistics) as never };
    style.layers.push({ id: 'exposition-logistics-points', type: 'circle', source: 'exposition-logistics', paint: {
      'circle-radius': 8, 'circle-color': '#d7b86a', 'circle-stroke-color': '#fff0ba', 'circle-stroke-width': 2,
    } });
  }
  if (enabled.has('forces')) {
    style.sources['exposition-forces'] = { type: 'geojson', data: geography(map.forces) as never };
    style.layers.push({ id: 'exposition-forces-points', type: 'circle', source: 'exposition-forces', paint: {
      'circle-radius': 7, 'circle-color': '#b5c7ff', 'circle-stroke-color': '#17231e', 'circle-stroke-width': 2,
    } });
  }
  if (enabled.has('modern-symbols')) {
    style.sources['exposition-symbols'] = { type: 'geojson', data: symbolGeography(map.modernSymbols) as never };
    style.layers.push({ id: 'exposition-symbols-points', type: 'circle', source: 'exposition-symbols', paint: {
      'circle-radius': 11, 'circle-color': ['match', ['get', 'side'], 'RED', '#a94c48', '#315e78'],
      'circle-stroke-color': '#d8f2ff', 'circle-stroke-width': 3,
    } });
  }
  return style;
}
