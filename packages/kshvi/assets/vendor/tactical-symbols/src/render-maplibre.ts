import { anchorOffset } from './geometry';
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

function iconId(symbol: RenderSymbolInput & { readonly geometry?: SymbolDefinition['geometry'] }): string {
  return `tactical:${symbol.id}:${symbol.version ?? '0.0.0'}:${symbol.geometry?.version ?? 1}`;
}

export function symbolFeatures(
  instances: readonly SymbolInstance[],
  options: SymbolSizeForMap = { width: 64, height: 64 },
): SymbolFeatureCollection {
  return {
    type: 'FeatureCollection',
    features: instances.map(instance => ({
      type: 'Feature',
      id: instance.id,
      geometry: instance.geometry,
      properties: {
        ...instance.properties,
        symbolId: instance.symbol.id,
        symbolVersion: instance.symbol.version,
        setVersion: instance.setVersion,
        geometryVersion: instance.symbol.geometry.version,
        status: instance.symbol.status,
        kind: instance.symbol.kind,
        affiliation: instance.symbol.affiliation,
        objectType: instance.symbol.objectType,
        color: instance.symbol.color,
        icon: iconId(instance.symbol),
        offset: instance.symbol.kind === 'POINT' ? anchorOffset(instance.symbol, options) : [0, 0],
      },
    })),
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
      id: `${sourceId}-areas-outline`, type: 'line', source: sourceId,
      filter: ['==', ['geometry-type'], 'Polygon'],
      paint: { 'line-color': ['get', 'color'], 'line-width': 1.5 },
    },
    {
      id: `${sourceId}-lines`, type: 'line', source: sourceId,
      filter: ['==', ['geometry-type'], 'LineString'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['get', 'color'], 'line-width': 3 },
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
