import {
  WEATHER_FIELDS,
  simulateWeather,
  validateWeatherDataset,
  validateWeatherScenario,
  weatherAt,
  weatherDuration,
  weatherTime,
  type WeatherDataset,
  type WeatherScenario,
  type WeatherState,
} from '@def-ops/core';

export type Bounds = readonly [number, number, number, number];

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
  weather: EnvironmentWeather;
  elevation: EnvironmentSelection['elevation'];
  algorithmVersions: EnvironmentSelection['algorithmVersions'];
  autonomy: 'COMPLETE' | 'INCOMPLETE';
  limitations: readonly string[];
}>;

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
