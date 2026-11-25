import {
  WEATHER_FIELDS,
  simulateWeather,
  validateWeatherDataset,
  validateWeatherScenario,
  weatherAt,
  weatherDuration,
  weatherGrid,
  weatherTime,
  type WeatherDataset,
  type WeatherScenario,
  type WeatherState,
} from '@def-ops/core';

export type Bounds = readonly [number, number, number, number];

export type EnvironmentTime = Readonly<{ operationalAt: string; timeZone: string }>;

export function atlasCoversBounds(atlas: Bounds, region: Bounds): boolean {
  return region[0] >= atlas[0] && region[1] >= atlas[1] && region[2] <= atlas[2] && region[3] <= atlas[3];
}

export function validateEnvironmentTime(value: EnvironmentTime): EnvironmentTime {
  if (typeof value.operationalAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.operationalAt)) {
    throw new Error('Задайте оперативный момент с часовым поясом.');
  }
  weatherTime(value.operationalAt.replace(/(?:Z|[+-]\d{2}:\d{2})$/, 'Z'));
  const operationalAt = new Date(value.operationalAt).toISOString();
  if (typeof value.timeZone !== 'string' || !value.timeZone.trim()) throw new Error('Укажите часовой пояс отображения.');
  try { new Intl.DateTimeFormat('ru-RU', { timeZone: value.timeZone }); }
  catch { throw new Error('Неизвестный часовой пояс отображения.'); }
  return { operationalAt, timeZone: value.timeZone };
}

export type AtlasMeta = Readonly<{
  id: string;
  name: string;
  format: 'pbf' | 'png' | 'jpg' | 'webp';
  kind: 'vector' | 'raster' | 'terrain';
  minzoom: number;
  maxzoom: number;
  bounds: Bounds;
  attribution: string;
  layers: readonly Readonly<{ id: string; fields?: Record<string, string> }>[];
  bytes: number;
  sha256?: string;
  importedAt?: string;
  source?: string;
  license?: string;
}>;

export type ContentRef = Readonly<{ path: string; sha256: string; bytes: number }>;
export type SnapshotArtifact = Readonly<{ contentRef: ContentRef | null; sha256: string | null }>;
export type SnapshotResource = Readonly<{
  path: `glyphs/${string}` | `sprites/${string}`;
  artifact: SnapshotArtifact;
}>;

export type EnvironmentSelection = Readonly<{
  region: Readonly<{ name: string; bounds: Bounds }>;
  atlases: readonly Readonly<{
    id: string;
    license?: string;
    exportRights?: 'ALLOWED' | 'REFERENCE_ONLY';
    elevationPoints?: readonly (readonly [number, number])[];
  }>[];
  weather: Readonly<
    | { mode: 'scenario'; scenario: WeatherScenario }
    | { mode: 'archive'; datasetId: string }
  >;
  operationalTime?: EnvironmentTime;
  elevation: Readonly<{ adjustmentM: number; algorithmVersion: number }>;
  algorithmVersions: Readonly<{ snapshot: number; weather: number }>;
}>;

export type SnapshotAtlas = Readonly<{
  meta: AtlasMeta;
  id: string;
  sha256: string;
  attribution: string;
  license: string;
  exportRights: 'ALLOWED' | 'REFERENCE_ONLY';
  style: SnapshotArtifact;
  export: SnapshotArtifact;
  elevations: SnapshotArtifact;
}>;

export type EnvironmentWeather = Readonly<{
  mode: 'scenario' | 'archive';
  contentRef: ContentRef | null;
  sourceId: string;
  attribution: string;
  license: string;
  scenario?: WeatherScenario;
  dataset?: WeatherDataset;
}>;

export type EnvironmentSnapshot = Readonly<{
  schemaVersion: 1;
  id: string;
  manifestSha256: string;
  region: EnvironmentSelection['region'];
  atlases: readonly SnapshotAtlas[];
  resources: readonly SnapshotResource[];
  weather: EnvironmentWeather;
  operationalTime?: EnvironmentTime;
  elevation: EnvironmentSelection['elevation'];
  algorithmVersions: EnvironmentSelection['algorithmVersions'];
  autonomy: 'COMPLETE' | 'INCOMPLETE';
  limitations: readonly string[];
}>;

type WeatherSample = Readonly<{ lon: number; lat: number; state: WeatherState }>;
export type ArchiveWeatherCoverage = Readonly<{
  samples: readonly WeatherSample[];
  error?: string;
  warning?: string;
}>;

const weatherCoordinateEpsilon = 1e-7;
const bucket = (value: number) => Math.floor(value / weatherCoordinateEpsilon);

function longitudeSpan(west: number, east: number): number {
  return east >= west ? east - west : 360 + east - west;
}

function canonicalLongitude(longitude: number): number {
  return longitude === 180 ? -180 : longitude;
}

function longitudeOffset(longitude: number, west: number): number {
  const difference = (canonicalLongitude(longitude) - canonicalLongitude(west)) % 360;
  const offset = difference < 0 ? difference + 360 : difference;
  return offset > 360 - weatherCoordinateEpsilon ? offset - 360 : offset;
}

function archiveExtentCovers(archive: Bounds, bounds: Bounds): boolean {
  const width = longitudeSpan(archive[0], archive[2]);
  const start = longitudeOffset(bounds[0], archive[0]);
  return bounds[1] >= archive[1] && bounds[3] <= archive[3]
    && (width === 360 || (start >= -weatherCoordinateEpsilon
      && start + longitudeSpan(bounds[0], bounds[2]) <= width + weatherCoordinateEpsilon));
}

export function archiveWeatherCoverage(dataset: WeatherDataset, bounds: Bounds, operationalAt: string): ArchiveWeatherCoverage {
  const [west, south, east, north] = bounds;
  const width = longitudeSpan(west, east);
  const inside = (offset: number, lat: number): boolean => lat >= south - weatherCoordinateEpsilon && lat <= north + weatherCoordinateEpsilon
    && offset >= -weatherCoordinateEpsilon && offset <= width + weatherCoordinateEpsilon;
  const series = new Map<string, WeatherDataset['rows']>();
  for (const row of dataset.rows) {
    const offset = longitudeOffset(row.lon, west);
    if (!inside(offset, row.lat)) continue;
    const key = `${offset},${row.lat}`;
    const rows = series.get(key);
    if (rows) rows.push(row);
    else series.set(key, [row]);
  }
  const samples: WeatherSample[] = [];
  const buckets = new Map<string, WeatherSample[]>();
  for (const rows of series.values()) {
    const { lon, lat } = rows[0]!;
    const state = weatherAt({ ...dataset, rows }, lat, lon, operationalAt);
    if (!state || !WEATHER_FIELDS.some(field => state[field] != null)) continue;
    const sample = { lon, lat, state };
    samples.push(sample);
    const key = `${bucket(longitudeOffset(lon, west))},${bucket(lat)}`;
    const matches = buckets.get(key);
    if (matches) matches.push(sample);
    else buckets.set(key, [sample]);
  }
  if (dataset.region) {
    const expected = new Map<string, readonly [number, number]>();
    for (const [lon, lat] of weatherGrid(dataset.region)) {
      const offset = longitudeOffset(lon, west);
      if (inside(offset, lat)) expected.set(`${offset},${lat}`, [offset, lat]);
    }
    const available = [...expected.values()].filter(([offset, lat]) => {
      const x = bucket(offset);
      const y = bucket(lat);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          if (buckets.get(`${x + dx},${y + dy}`)?.some(sample =>
            Math.abs(longitudeOffset(sample.lon, west) - offset) < weatherCoordinateEpsilon && Math.abs(sample.lat - lat) < weatherCoordinateEpsilon)) return true;
        }
      }
      return false;
    }).length;
    if (available < expected.size) {
      return { samples, error: `На оперативный момент доступны ${available} из ${expected.size} заявленных погодных узлов внутри области.` };
    }
    if (expected.size && archiveExtentCovers(dataset.region.bounds, bounds)) return { samples };
  }
  if (!samples.length) return { samples, error: 'Внутри выбранной области нет наблюдений на оперативный момент.' };
  return { samples, warning: 'Погодный набор покрывает только часть области.' };
}

export type WeatherQuery = Readonly<{
  lon: number;
  lat: number;
  operationalAt: string;
  wallClockAt?: string;
  playbackRate?: number;
}>;

export type EnvironmentDataQuality = Readonly<{
  status: 'OK' | 'PARTIAL' | 'NO_DATA';
  reason: 'KNOWN' | 'MISSING_CONTENT' | 'OUTSIDE_INTERVAL' | 'OUTSIDE_COVERAGE' | 'MISSING_VALUES';
  algorithm: 'simulateWeather' | 'weatherAt' | null;
  operationalAt: string;
  missingFields: readonly string[];
}>;

export type OperationalWeather = Readonly<{
  state: WeatherState | null;
  quality: EnvironmentDataQuality;
}>;

export interface EnvironmentProvider {
  listAtlases(): Promise<readonly AtlasMeta[]>;
  snapshot(selection: EnvironmentSelection): Promise<EnvironmentSnapshot>;
  weatherAt(snapshot: EnvironmentSnapshot, at: WeatherQuery): Promise<WeatherState | null>;
}

const noData = (at: WeatherQuery, algorithm: EnvironmentDataQuality['algorithm'], reason: 'MISSING_CONTENT' | 'OUTSIDE_INTERVAL' | 'OUTSIDE_COVERAGE'): OperationalWeather => ({
  state: null,
  quality: { status: 'NO_DATA', reason, algorithm, operationalAt: at.operationalAt, missingFields: [] },
});

/** Единственный доменный переход от зафиксированной погоды к оперативному моменту. */
export function weatherAtOperational(weather: EnvironmentWeather, at: WeatherQuery): OperationalWeather {
  const operationalMs = weatherTime(at.operationalAt);
  if (weather.mode === 'scenario') {
    if (!weather.scenario) return noData(at, 'simulateWeather', 'MISSING_CONTENT');
    const scenario = validateWeatherScenario(weather.scenario);
    const start = weatherTime(scenario.start);
    const end = start + weatherDuration(scenario) * 3600000;
    if (operationalMs < start || operationalMs > end) return noData(at, 'simulateWeather', 'OUTSIDE_INTERVAL');
    const state = simulateWeather(scenario, at.lat, at.lon, at.operationalAt);
    const missingFields = WEATHER_FIELDS.filter(field => state[field] === null || state[field] === undefined);
    return {
      state,
      quality: {
        status: missingFields.length ? 'PARTIAL' : 'OK',
        reason: missingFields.length ? 'MISSING_VALUES' : 'KNOWN',
        algorithm: 'simulateWeather', operationalAt: at.operationalAt, missingFields,
      },
    };
  }
  if (!weather.dataset) return noData(at, 'weatherAt', 'MISSING_CONTENT');
  const dataset = validateWeatherDataset(weather.dataset);
  const state = weatherAt(dataset, at.lat, at.lon, at.operationalAt);
  if (!state) {
    const knownPoint = dataset.rows.some(row => Math.abs(row.lat - at.lat) < 1e-7 && Math.abs((((row.lon - at.lon + 180) % 360) + 360) % 360 - 180) < 1e-7);
    return noData(at, 'weatherAt', knownPoint ? 'OUTSIDE_INTERVAL' : 'OUTSIDE_COVERAGE');
  }
  const missingFields = WEATHER_FIELDS.filter(field => state[field] === null || state[field] === undefined);
  return {
    state,
    quality: {
      status: missingFields.length ? 'PARTIAL' : 'OK',
      reason: missingFields.length ? 'MISSING_VALUES' : 'KNOWN',
      algorithm: 'weatherAt', operationalAt: at.operationalAt, missingFields,
    },
  };
}
