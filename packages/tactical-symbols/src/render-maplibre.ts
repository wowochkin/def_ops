import { anchorOffset, validateModifiers } from './geometry';
import type { RenderSymbolInput, SymbolDefinition, SymbolKind } from './model';
import { renderSymbol, type RenderSymbolOptions } from './render-svg';

export type SymbolGeoJsonGeometry =
  | Readonly<{ type: 'Point'; coordinates: readonly [number, number] }>
  | Readonly<{ type: 'LineString'; coordinates: readonly (readonly [number, number])[] }>
  | Readonly<{ type: 'Polygon'; coordinates: readonly (readonly (readonly [number, number])[])[] }>;

export interface SymbolInstance {
  readonly id: string;
  readonly setVersion: string;
  readonly symbol: SymbolDefinition;
  readonly geometry: SymbolGeoJsonGeometry;
  readonly properties?: Readonly<Record<string, unknown>>;
}

export interface SymbolFeature {
  readonly type: 'Feature';
  readonly id: string;
  readonly geometry: SymbolGeoJsonGeometry;
  readonly properties: Readonly<Record<string, unknown> & {
    symbolId: string;
    symbolVersion: string;
    setVersion: string;
    geometryVersion: number;
    status: string;
    kind: SymbolKind;
    icon: string;
    offset: readonly [number, number];
  }>;
}

export interface SymbolFeatureCollection {
  readonly type: 'FeatureCollection';
  readonly features: readonly SymbolFeature[];
}

export function symbolImageId(symbol: RenderSymbolInput & { readonly geometry?: SymbolDefinition['geometry'] }): string {
  return `tactical:${symbol.id}:${symbol.version ?? '0.0.0'}:${symbol.geometry?.version ?? 1}`;
}

const iconId = symbolImageId;

function labelOf(symbol: SymbolDefinition): string {
  const value = symbol.labels.top ?? symbol.labels.bottom ?? symbol.name;
  return value === null || value === '' ? '' : String(value);
}
function dashOf(symbol: SymbolDefinition): readonly number[] {
  switch (symbol.geometry.template) {
    case 'BOUNDARY': return [10, 4, 2, 4];
    case 'FORD': return [6, 4];
    case 'FERRY': return [5, 4];
    case 'ICE_CROSSING': return [8, 4];
    default: return [1, 0];
  }
}

export function symbolFeatures(
  instances: readonly SymbolInstance[],
  options: SymbolSizeForMap = { width: 64, height: 64 },
): SymbolFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: instances.map(instance => {
      validateModifiers(instance.symbol);
      return {
        type: 'Feature',
        id: instance.id,
        geometry: instance.geometry,
        properties: {
          ...instance.properties,
          symbolId: instance.symbol.id,
          symbolVersion: instance.symbol.version,
          setVersion: instance.setVersion,
          geometryVersion: instance.symbol.geometry.version,
          geometryTemplate: instance.symbol.geometry.template,
          geometryParameters: { ...instance.symbol.geometry.parameters },
          modifiers: instance.symbol.modifiers.map(modifier => ({ ...modifier })),
          label: labelOf(instance.symbol),
          lineDasharray: dashOf(instance.symbol),
          symbolSpacing: typeof instance.symbol.geometry.parameters.symbolSpacing === 'number' ? instance.symbol.geometry.parameters.symbolSpacing : 48,
          status: instance.symbol.status,
          kind: instance.symbol.kind,
          affiliation: instance.symbol.affiliation,
          objectType: instance.symbol.objectType,
          color: instance.symbol.color,
          icon: iconId(instance.symbol),
          offset: instance.symbol.kind === 'POINT' ? anchorOffset(instance.symbol, options) : [0, 0],
        },
      };
    }),
  };
}

export interface SymbolSizeForMap {
  readonly width: number;
  readonly height: number;
  readonly detail?: 'FULL' | 'SEMANTIC';
}

export function symbolSource(
  data: SymbolFeatureCollection,
  options: { readonly cluster?: boolean; readonly clusterMaxZoom?: number; readonly clusterRadius?: number } = {},
) {
  return {
    type: 'geojson' as const,
    data,
    cluster: options.cluster ?? true,
    clusterMaxZoom: options.clusterMaxZoom ?? 14,
    clusterRadius: options.clusterRadius ?? 48,
  };
}

export function symbolLayers(sourceId = 'tactical-symbols') {
  return [
    {
      id: `${sourceId}-areas`, type: 'fill', source: sourceId,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.12 },
    },
    {
      id: `${sourceId}-areas-pattern`, type: 'fill', source: sourceId,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'fill-pattern': ['get', 'icon'], 'fill-opacity': 0.22 },
    },
    {
      id: `${sourceId}-areas-outline`, type: 'line', source: sourceId,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
    },
    {
      id: `${sourceId}-lines`, type: 'line', source: sourceId,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-dasharray': ['get', 'lineDasharray'] },
    },
    {
      id: `${sourceId}-lines-template`, type: 'symbol', source: sourceId,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: {
        'symbol-placement': 'line', 'icon-image': ['get', 'icon'], 'icon-size': 0.5,
        'symbol-spacing': ['get', 'symbolSpacing'], 'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true, 'icon-ignore-placement': true,
      },
    },
    {
      id: `${sourceId}-clusters`, type: 'circle', source: sourceId,
      filter: ['has', 'point_count'],
      metadata: { interaction: 'EXPAND_CLUSTER', clusterIdProperty: 'cluster_id' },
      paint: {
        'circle-color': '#475569',
        'circle-radius': ['step', ['get', 'point_count'], 14, 10, 18, 50, 23],
        'circle-opacity': 0.85,
      },
    },
    {
      id: `${sourceId}-cluster-count`, type: 'symbol', source: sourceId,
      filter: ['has', 'point_count'],
      layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    },
    {
      id: `${sourceId}-labels`, type: 'symbol', source: sourceId,
      filter: ['all', ['!', ['has', 'point_count']], ['!=', ['get', 'label'], '']],
      layout: {
        'text-field': ['get', 'label'], 'text-size': 12, 'text-offset': [0, -3],
        'text-allow-overlap': false, 'text-optional': true,
      },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 1 },
    },
    {
      id: `${sourceId}-points`, type: 'symbol', source: sourceId,
      filter: ['all', ['!', ['has', 'point_count']], ['==', ['geometry-type'], 'Point']],
      layout: {
        'icon-image': ['get', 'icon'],
        'icon-offset': ['get', 'offset'],
        'icon-size': 1,
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
      },
    },
  ];
}

export function symbolImages(
  symbols: readonly SymbolDefinition[],
  options: SymbolSizeForMap = { width: 64, height: 64 },
) {
  const renderOptions: RenderSymbolOptions = {
    width: options.width,
    height: options.height,
    ...(options.detail ? { detail: options.detail } : {}),
  };
  return symbols.map(symbol => ({
    id: iconId(symbol),
    symbolId: symbol.id,
    symbolVersion: symbol.version,
    geometryVersion: symbol.geometry.version,
    width: options.width,
    height: options.height,
    pixelRatio: 1,
    anchor: symbol.anchor,
    offset: anchorOffset(symbol, options),
    svg: renderSymbol(symbol, renderOptions),
  }));
}

export async function expandSymbolCluster(
  clusterId: number,
  getExpansionZoom: (clusterId: number) => Promise<number>,
): Promise<{ readonly clusterId: number; readonly zoom: number }> {
  if (!Number.isSafeInteger(clusterId) || clusterId < 0) throw new Error('Некорректный clusterId кластера знаков');
  const zoom = await getExpansionZoom(clusterId);
  if (!Number.isFinite(zoom) || zoom < 0) throw new Error('MapLibre вернул некорректный масштаб раскрытия кластера');
  return { clusterId, zoom };
}
