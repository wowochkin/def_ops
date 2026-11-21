import { canonicalJson } from '../events/canonical';
import { hashCanonical } from './initial-map-hash';
import { INITIAL_MAP_LAYER_IDS, type MapLayerId } from './initial-map-layers';
import { validateInitialMap, type InitialMapIssue, type InitialMapValidationInput } from './initial-map-validation';

export { INITIAL_MAP_LAYER_IDS } from './initial-map-layers';
export type { MapLayerId } from './initial-map-layers';
export type Bounds = readonly [number, number, number, number];
export type Position = readonly [number, number];
export type MapGeometry = Readonly<
  | { type: 'Point'; coordinates: Position }
  | { type: 'LineString'; coordinates: readonly Position[] }
  | { type: 'Polygon'; coordinates: readonly (readonly Position[])[] }
>;

export type MapMarkerKind = 'FORCE' | 'COMMAND_POST' | 'COMMUNICATION' | 'LOGISTICS' | 'MEDICAL' | 'REPAIR'
  | 'AREA' | 'BOUNDARY' | 'COLUMN' | 'ROUTE' | 'OBSTACLE' | 'CROSSING' | 'TASK';
export type MapMarkerState = 'OBSERVED' | 'ASSUMED' | 'PLANNED' | 'UNKNOWN';

export type MapVisibility = Readonly<{
  sideIds?: readonly string[];
  instanceIds?: readonly string[];
  roles?: readonly string[];
  staffOnly?: boolean;
}>;
export type MapSymbolUse = Readonly<{
  id: string;
  version: string;
  sideId: string;
  status: 'IMPORTED' | 'MAPPED' | 'VERIFIED' | 'APPROVED' | 'DEPRECATED';
  sourceDocument: string;
  sourcePage: number;
}>;
export type MapMarkerLinks = Readonly<{
  forceId?: string;
  taskId?: string;
  documentId?: string;
  linkedMarkerIds?: readonly string[];
}>;
export type MapMarker = Readonly<{
  id: string;
  revision: number;
  kind: MapMarkerKind;
  layerId: MapLayerId;
  truth: 'TRUTH' | 'PRIVATE';
  geometry: MapGeometry | null;
  sourceId: string;
  authorId: string;
  eventId: string;
  validFrom: string;
  validUntil: string;
  state: MapMarkerState;
  confidence: number | null;
  uncertainty: Readonly<{ radiusM: number | null; note: string }>;
  visibility: MapVisibility;
  links: MapMarkerLinks;
  sideId: string;
  symbol: MapSymbolUse;
  loadTonnes?: number;
  crossingCapacityTonnes?: number;
  passable?: boolean;
  routeId?: string | null;
  offRoadJustification?: string;
  geometryRequired?: boolean;
}>;
export type InitialMapLayer = Readonly<{ id: MapLayerId; independent: true }>;
export type InitialSituationMap = Readonly<{
  schemaVersion: 1;
  id: string;
  revision: number;
  state: 'DRAFT' | 'APPROVED';
  sha256?: string;
  environment: Readonly<{ snapshotId: string; manifestSha256: string; bounds: Bounds }>;
  bounds: Bounds;
  initialOperationalAt: string;
  timeZone: string;
  weatherFrameRef: string;
  terrainStateRef: string;
  symbolSet: Readonly<{ id: string; revision: number; sha256: string }>;
  attribution: readonly string[];
  layers: readonly InitialMapLayer[];
  markers: readonly MapMarker[];
  history: readonly MapMarker[];
}>;
export type ApprovedInitialMap = InitialSituationMap & Readonly<{ state: 'APPROVED'; sha256: string }>;

export type InitialMapImportResult = Readonly<{
  markers: readonly MapMarker[];
  issues: readonly InitialMapIssue[];
  map?: InitialSituationMap;
}>;

export const INITIAL_MAP_JSON_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'kshvi/initial-map-v1.schema.json',
  type: 'object',
  required: ['schemaVersion', 'id', 'revision', 'environment', 'bounds', 'initialOperationalAt', 'timeZone', 'weatherFrameRef', 'terrainStateRef', 'symbolSet', 'layers', 'markers'],
  properties: {
    schemaVersion: { const: 1 },
    id: { type: 'string', minLength: 1 },
    revision: { type: 'integer', minimum: 1 },
    environment: { type: 'object', required: ['snapshotId', 'manifestSha256', 'bounds'] },
    markers: { type: 'array', items: { type: 'object', required: ['id', 'geometry', 'sourceId', 'authorId', 'validFrom', 'validUntil', 'state', 'uncertainty', 'visibility', 'links', 'symbol'] } },
  },
} as const;

export const INITIAL_MAP_COMMAND_SCHEMAS = {
  manualAdd: { type: 'object', required: ['marker'], properties: { marker: { type: 'object' } } },
  geoJsonImport: { type: 'object', required: ['document'], properties: { document: { anyOf: [{ type: 'string' }, { type: 'object' }] } } },
  groupShift: { type: 'object', required: ['markerIds', 'delta'], properties: { markerIds: { type: 'array', minItems: 1 }, delta: { type: 'object', required: ['lon', 'lat'] } } },
  approve: { type: 'object', required: ['expectedRevision'], properties: { expectedRevision: { type: 'integer', minimum: 1 } } },
} as const;

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createLayers(): readonly InitialMapLayer[] {
  return INITIAL_MAP_LAYER_IDS.map(id => ({ id, independent: true as const }));
}

export function createInitialSituationMap(input: Readonly<{
  id: string;
  revision: number;
  environment: InitialSituationMap['environment'];
  initialOperationalAt: string;
  timeZone: string;
  weatherFrameRef: string;
  terrainStateRef: string;
  symbolSet: InitialSituationMap['symbolSet'];
  attribution: readonly string[];
}>): InitialSituationMap {
  if (!input.id.trim() || !Number.isSafeInteger(input.revision) || input.revision < 1) throw new Error('MAP_REVISION_INVALID');
  return deepFreeze({
    schemaVersion: 1 as const,
    id: input.id,
    revision: input.revision,
    state: 'DRAFT' as const,
    environment: clone(input.environment),
    bounds: clone(input.environment.bounds),
    initialOperationalAt: input.initialOperationalAt,
    timeZone: input.timeZone,
    weatherFrameRef: input.weatherFrameRef,
    terrainStateRef: input.terrainStateRef,
    symbolSet: clone(input.symbolSet),
    attribution: [...input.attribution],
    layers: createLayers(),
    markers: [],
    history: [],
  });
}

export function addInitialMapMarker(map: InitialSituationMap, marker: MapMarker): InitialSituationMap {
  if (map.markers.some(item => item.id === marker.id)) throw new Error('DUPLICATE_OBJECT_ID');
  const issues = validateInitialMap({ bounds: map.bounds, markers: [marker] }).filter(issue => issue.severity === 'ERROR');
  if (issues.length) throw new Error(issues.map(issue => issue.code).join(', '));
  return deepFreeze({ ...map, state: 'DRAFT' as const, sha256: undefined, markers: [...map.markers, clone(marker)] });
}

export function updateInitialMapMarker(map: InitialSituationMap, markerId: string, patch: Partial<Omit<MapMarker, 'id' | 'revision'>>): InitialSituationMap {
  const previous = map.markers.find(item => item.id === markerId);
  if (!previous) throw new Error('MAP_MARKER_NOT_FOUND');
  const next: MapMarker = { ...previous, ...clone(patch), id: previous.id, revision: previous.revision + 1 };
  const issues = validateInitialMap({ bounds: map.bounds, markers: [next] }).filter(issue => issue.severity === 'ERROR');
  if (issues.length) throw new Error(issues.map(issue => issue.code).join(', '));
  return deepFreeze({
    ...map,
    revision: map.revision + 1,
    state: 'DRAFT' as const,
    sha256: undefined,
    markers: map.markers.map(item => item.id === markerId ? next : item),
    history: [...map.history, previous],
  });
}

function shiftGeometry(geometry: MapGeometry, delta: Readonly<{ lon: number; lat: number }>): MapGeometry {
  const point = ([lon, lat]: Position): Position => [lon + delta.lon, lat + delta.lat];
  if (geometry.type === 'Point') return { type: 'Point', coordinates: point(geometry.coordinates) };
  if (geometry.type === 'LineString') return { type: 'LineString', coordinates: geometry.coordinates.map(point) };
  return { type: 'Polygon', coordinates: geometry.coordinates.map(ring => ring.map(point)) };
}

export function shiftInitialMapMarkers(map: InitialSituationMap, markerIds: readonly string[], delta: Readonly<{ lon: number; lat: number }>): InitialSituationMap {
  const selected = new Set(markerIds);
  if (!selected.size) throw new Error('GROUP_SHIFT_EMPTY');
  for (const id of selected) if (!map.markers.some(item => item.id === id)) throw new Error('MAP_MARKER_NOT_FOUND');
  for (const item of map.markers) {
    const linked = item.links.linkedMarkerIds ?? [];
    const linkedSelected = linked.some(id => selected.has(id));
    if (selected.has(item.id) && linked.some(id => !selected.has(id))) throw new Error('GROUP_SHIFT_LINKS');
    if (!selected.has(item.id) && linkedSelected) throw new Error('GROUP_SHIFT_LINKS');
  }
  const shifted = map.markers.map(item => selected.has(item.id) && item.geometry
    ? { ...item, revision: item.revision + 1, geometry: shiftGeometry(item.geometry, delta) }
    : item);
  const issues = validateInitialMap({ bounds: map.bounds, markers: shifted }).filter(issue => issue.severity === 'ERROR');
  if (issues.length) throw new Error(issues.map(issue => issue.code).join(', '));
  const previous = map.markers.filter(item => selected.has(item.id));
  return deepFreeze({ ...map, revision: map.revision + 1, state: 'DRAFT' as const, sha256: undefined, markers: shifted, history: [...map.history, ...previous] });
}

export function copyInitialSituationMap(map: InitialSituationMap, options: Readonly<{ id: string; idFactory: () => string }>): InitialSituationMap {
  if (!options.id.trim()) throw new Error('MAP_ID_REQUIRED');
  const ids = new Map<string, string>();
  const markers = map.markers.map(item => {
    const id = options.idFactory();
    ids.set(item.id, id);
    return { ...clone(item), id, revision: 1 };
  }).map(item => ({
    ...item,
    links: { ...item.links, linkedMarkerIds: item.links.linkedMarkerIds?.map(id => ids.get(id) ?? id) },
  }));
  return deepFreeze({ ...clone(map), id: options.id, revision: 1, state: 'DRAFT' as const, sha256: undefined, markers, history: [] });
}

function parseDocument(document: string | Readonly<Record<string, unknown>>): Record<string, unknown> {
  if (typeof document !== 'string') return clone(document);
  try {
    const parsed = JSON.parse(document) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('GEOJSON_DOCUMENT_INVALID');
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error('GEOJSON_DOCUMENT_INVALID');
  }
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function importedMarker(feature: Readonly<Record<string, unknown>>): MapMarker {
  const properties = feature.properties && typeof feature.properties === 'object' ? feature.properties as Record<string, unknown> : {};
  const symbol = properties.symbol && typeof properties.symbol === 'object' ? properties.symbol as Record<string, unknown> : {};
  const uncertainty = properties.uncertainty && typeof properties.uncertainty === 'object' ? properties.uncertainty as Record<string, unknown> : {};
  const visibility = properties.visibility && typeof properties.visibility === 'object' ? properties.visibility as Record<string, unknown> : {};
  const links = properties.links && typeof properties.links === 'object' ? properties.links as Record<string, unknown> : {};
  const geometry = feature.geometry === null || (feature.geometry && typeof feature.geometry === 'object')
    ? feature.geometry as MapGeometry | null
    : null;
  return {
    id: text(properties.id),
    revision: typeof properties.revision === 'number' ? properties.revision : 1,
    kind: text(properties.kind) as MapMarkerKind,
    layerId: text(properties.layerId) as MapLayerId,
    truth: properties.truth === 'TRUTH' ? 'TRUTH' : 'PRIVATE',
    geometry: clone(geometry),
    sourceId: text(properties.sourceId),
    authorId: text(properties.authorId),
    eventId: text(properties.eventId),
    validFrom: text(properties.validFrom),
    validUntil: text(properties.validUntil),
    state: properties.state === 'OBSERVED' || properties.state === 'ASSUMED' || properties.state === 'PLANNED' ? properties.state : 'UNKNOWN',
    confidence: typeof properties.confidence === 'number' ? properties.confidence : null,
    uncertainty: { radiusM: typeof uncertainty.radiusM === 'number' ? uncertainty.radiusM : null, note: text(uncertainty.note) },
    visibility: clone(visibility) as MapVisibility,
    links: clone(links) as MapMarkerLinks,
    sideId: text(properties.sideId),
    symbol: {
      id: text(symbol.id), version: text(symbol.version), sideId: text(symbol.sideId),
      status: text(symbol.status) as MapSymbolUse['status'], sourceDocument: text(symbol.sourceDocument),
      sourcePage: typeof symbol.sourcePage === 'number' ? symbol.sourcePage : 0,
    },
  };
}

export function importInitialMap(document: string | Readonly<Record<string, unknown>>, options: Readonly<{ bounds: Bounds }>): InitialMapImportResult {
  const parsed = parseDocument(document);
  if (parsed.schemaVersion === 1 && Array.isArray(parsed.markers)) {
    const map = clone(parsed) as unknown as InitialSituationMap;
    const issues = validateInitialMap(map as InitialMapValidationInput);
    return deepFreeze({ markers: map.markers, issues, map });
  }
  if (parsed.type !== 'FeatureCollection' || !Array.isArray(parsed.features)) throw new Error('GEOJSON_FEATURE_COLLECTION_REQUIRED');
  const markers = parsed.features.map(feature => {
    if (!feature || typeof feature !== 'object') throw new Error('GEOJSON_FEATURE_INVALID');
    return importedMarker(feature as Record<string, unknown>);
  });
  const issues = validateInitialMap({ bounds: options.bounds, markers });
  return deepFreeze({ markers, issues });
}

export function initialMapCanonicalJson(map: InitialSituationMap): string {
  const content = { ...map } as Record<string, unknown>;
  delete content.sha256;
  delete content.state;
  return canonicalJson(content);
}

export function initialMapHash(map: InitialSituationMap): string {
  return hashCanonical(JSON.parse(initialMapCanonicalJson(map)));
}

export function approveInitialMap(map: InitialSituationMap): ApprovedInitialMap {
  const issues = validateInitialMap(map).filter(issue => issue.severity === 'ERROR');
  if (issues.length) throw new Error(issues.map(issue => issue.code).join(', '));
  return deepFreeze({ ...map, state: 'APPROVED' as const, sha256: initialMapHash(map) });
}

function visible(marker: MapMarker, audience: Readonly<{ sideId: string; instanceId: string; role: string }>): boolean {
  const rule = marker.visibility;
  if (rule.staffOnly) return false;
  if (rule.sideIds?.length && !rule.sideIds.includes(audience.sideId)) return false;
  if (rule.instanceIds?.length && !rule.instanceIds.includes(audience.instanceId)) return false;
  if (rule.roles?.length && !rule.roles.includes(audience.role)) return false;
  return true;
}

export function projectInitialMap(map: InitialSituationMap, audience: Readonly<
  | { mode: 'TRUTH'; role: string }
  | { mode: 'INSTANCE'; sideId: string; instanceId: string; role: string }
>): InitialSituationMap {
  if (audience.mode === 'TRUTH') {
    if (audience.role !== 'DIRECTOR' && audience.role !== 'UMPIRE') throw new Error('TRUTH_PROJECTION_FORBIDDEN');
    return deepFreeze({ ...clone(map), state: 'DRAFT' as const, sha256: undefined });
  }
  const allowed = (marker: MapMarker) => visible(marker, audience);
  return deepFreeze({
    ...clone(map),
    state: 'DRAFT' as const,
    sha256: undefined,
    markers: map.markers.filter(allowed),
    history: map.history.filter(allowed),
  });
}

export { validateInitialMap } from './initial-map-validation';
export type { InitialMapIssue, InitialMapValidationInput } from './initial-map-validation';


export type InitialMapScaleAttribute = 'sourceId' | 'authorId' | 'eventId' | 'validFrom' | 'validUntil' | 'visibility' | 'symbol';
export type InitialMapScaleProfile = Readonly<{
  id: string;
  revision: number;
  minZoom: number;
  maxZoom: number;
  requiredLayerIds: readonly MapLayerId[];
  availableLayerIds: readonly MapLayerId[];
  minimumAttributes: readonly InitialMapScaleAttribute[];
  aggregation: 'NONE' | 'SEMANTIC' | 'CLUSTER';
}>;
export type InitialMapScalePreview = Readonly<{
  map: InitialSituationMap;
  issues: readonly InitialMapIssue[];
}>;

/** Профиль рабочего места не меняет ни масштаб учения, ни исходную версионную карту. */
export function projectInitialMapScale(map: InitialSituationMap, profile: InitialMapScaleProfile, zoom: number): InitialMapScalePreview {
  if (!Number.isFinite(zoom) || zoom < profile.minZoom || zoom > profile.maxZoom) throw new Error('SCALE_ZOOM_UNSUPPORTED');
  const available = new Set(profile.availableLayerIds);
  const existing = new Set(map.layers.map(layer => layer.id));
  if (profile.requiredLayerIds.some(layer => !available.has(layer)) || [...available].some(layer => !existing.has(layer))) {
    throw new Error('SCALE_LAYER_UNAVAILABLE');
  }
  const issues: InitialMapIssue[] = [];
  const markers = map.markers.filter(marker => available.has(marker.layerId));
  for (const marker of markers) {
    for (const attribute of profile.minimumAttributes) {
      const value = marker[attribute];
      if (value === null || value === undefined || value === '') {
        issues.push({ code: 'SCALE_ATTRIBUTE_REQUIRED', severity: 'ERROR', objectId: marker.id, message: `В масштабном профиле ${profile.id} обязательна атрибуция ${attribute}` });
      }
    }
  }
  const projected = deepFreeze({
    ...clone(map),
    state: 'DRAFT' as const,
    sha256: undefined,
    layers: map.layers.filter(layer => available.has(layer.id)),
    markers,
    history: map.history.filter(marker => available.has(marker.layerId)),
  });
  return { map: projected, issues };
}
