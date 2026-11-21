import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Router } from '@def-ops/service-kit';
import type { WeatherDataset, WeatherScenario } from '@def-ops/core';
import { CartographyEnvironmentProvider } from '../src/environment/cartography-provider';
import { EnvironmentSnapshotStore, assertSnapshotComplete } from '../src/environment/snapshot-store';
import { addEnvironmentRoutes } from '../src/http/environment-routes';

const dataset: WeatherDataset = {
  version: 1,
  id: 'w1',
  name: 'Архивная фикстура',
  source: {
    title: 'Учебный архив',
    kind: 'reanalysis',
    license: 'CC BY 4.0',
    spatialResolution: 'точка',
    temporalResolution: '1 h',
  },
  rows: [
    { lat: 55, lon: 37, time: '2026-01-01T00:00:00.000Z', temperature: -4, humidity: 80, pressure: 1000, windSpeed: 3, windDirection: 90, gust: 5, cloud: 70, precipitation: null, visibility: 9000, snowDepth: 0.1, soilTemperature: -2, soilMoisture: 0.4 },
    { lat: 55, lon: 37, time: '2026-01-01T01:00:00.000Z', temperature: -3, humidity: 82, pressure: 1001, windSpeed: 4, windDirection: 100, gust: 6, cloud: 80, precipitation: 2, visibility: 8000, snowDepth: 0.1, soilTemperature: -2, soilMoisture: 0.4 },
  ],
};

const scenario: WeatherScenario = {
  version: 1,
  seed: 17,
  start: '2026-01-01T00:00:00.000Z',
  durationHours: 2,
  temperature: -2,
  humidity: 75,
  pressure: 1002,
  windSpeed: 2,
  windDirection: 180,
  cloud: 40,
  precipitation: 1,
  variability: 0,
  transitionHours: 1,
  visibility: 7000,
  snowDepth: 0,
  soilTemperature: -1,
  soilMoisture: 0.3,
};

const meta = {
  id: 'a1', name: 'Учебный атлас', format: 'pbf', kind: 'vector', minzoom: 0, maxzoom: 12,
  bounds: [36, 54, 38, 56], attribution: '© Учебный источник', layers: [{ id: 'roads' }], bytes: 15,
  sha256: 'a'.repeat(64), source: 'fixture',
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}

describe('контентно-адресуемый снимок среды', () => {
  let root: string;
  let deleted: boolean;
  let requests: string[];
  let fetcher: typeof fetch;
  let store: EnvironmentSnapshotStore;
  let provider: CartographyEnvironmentProvider;
  let exportBytes: Buffer;

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.environment-snapshot-test-'));
    const sourceAtlas = path.join(root, 'source.mbtiles');
    const database = new DatabaseSync(sourceAtlas);
    database.exec('create table tiles(zoom_level integer, tile_column integer, tile_row integer, tile_data blob)');
    database.prepare('insert into tiles values(0, 0, 0, ?)').run(new Uint8Array([9, 8, 7]));
    database.close();
    exportBytes = await readFile(sourceAtlas);
    deleted = false;
    requests = [];
    fetcher = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const key = `${init?.method ?? 'GET'} ${url.pathname}`;
      requests.push(key);
      if (deleted) return json({ error: { message: 'Источник удалён' } }, 404);
      if (key === 'GET /api/cartography/atlas') return json([meta]);
      if (key === 'GET /api/cartography/atlas/a1/style') return json({
        version: 8,
        glyphs: 'http://cartography.test/api/cartography/fonts/{fontstack}/{range}.pbf',
        sources: { atlas: { type: 'vector', tiles: ['http://cartography.test/api/cartography/atlas/a1/tiles/{z}/{x}/{y}'], attribution: meta.attribution } },
        layers: [],
      });
      if (key === 'GET /api/cartography/atlas/a1/export') return new Response(new Uint8Array(exportBytes), { status: 200 });
      if (key === 'POST /api/cartography/atlas/a1/elevations') return json({ source: 'a1', values: [{ lon: 37, lat: 55, elevationM: 180 }] });
      if (key === 'GET /api/cartography/environment/weather/w1/export') return json(dataset);
      return json({ error: { message: `Нет фикстуры ${key}` } }, 404);
    };
    store = new EnvironmentSnapshotStore(root);
    provider = new CartographyEnvironmentProvider({ baseUrl: 'http://cartography.test/api/cartography', store, fetch: fetcher });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const archiveSelection = () => ({
    region: { name: 'Район', bounds: [36, 54, 38, 56] as [number, number, number, number] },
    atlases: [{ id: 'a1', license: 'ODbL', exportRights: 'ALLOWED' as 'ALLOWED' | 'REFERENCE_ONLY', elevationPoints: [[37, 55] as [number, number]] }],
    weather: { mode: 'archive' as const, datasetId: 'w1' },
    elevation: { adjustmentM: 0, algorithmVersion: 1 },
    algorithmVersions: { snapshot: 1, weather: 1 },
  });

  it('копирует стиль, экспорт, высоты, погоду и атрибуцию и не зависит от удаления атласа', async () => {
    const snapshot = await provider.snapshot(archiveSelection());
    expect(snapshot.id).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.manifestSha256).toBe(snapshot.id);
    expect(snapshot.autonomy).toBe('COMPLETE');
    expect(snapshot.atlases[0]).toMatchObject({ id: 'a1', attribution: meta.attribution, license: 'ODbL' });
    expect(snapshot.atlases[0].style.contentRef).toBeTruthy();
    expect(snapshot.atlases[0].export.contentRef).toBeTruthy();
    expect(snapshot.atlases[0].elevations.contentRef).toBeTruthy();
    expect(snapshot.weather.contentRef).toBeTruthy();
    expect(() => assertSnapshotComplete(snapshot)).not.toThrow();

    const style = JSON.parse((await store.read(snapshot.atlases[0].style.contentRef!)).toString('utf8')) as {
      sources: { atlas: { tiles: string[] } };
    };
    expect(style.sources.atlas.tiles[0]).toContain('{snapshotId}');
    expect(style.sources.atlas.tiles[0]).not.toContain('cartography.test');
    expect(await store.read(snapshot.atlases[0].export.contentRef!)).toEqual(exportBytes);

    const again = await provider.snapshot(archiveSelection());
    expect(again.id).toBe(snapshot.id);
    const before = await readFile(path.join(root, snapshot.id, 'manifest.json'), 'utf8');
    deleted = true;
    const restored = await provider.loadSnapshot(snapshot.id);
    expect(restored).toEqual(snapshot);
    expect(await readFile(path.join(root, snapshot.id, 'manifest.json'), 'utf8')).toBe(before);
    await expect(provider.weatherAt(restored, { lon: 37, lat: 55, operationalAt: '2026-01-01T01:00:00.000Z' })).resolves.toMatchObject({ temperature: -3 });
    await expect(provider.snapshotTile(restored, 'a1', 0, 0, 0)).resolves.toEqual({ bytes: Buffer.from([9, 8, 7]), format: 'pbf' });
    expect(requests.filter(value => value.includes('/atlas/a1/export'))).toHaveLength(1);
  });

  it('AC-15: различает weatherAt и simulateWeather, сохраняет null и качество без нормальной погоды', async () => {
    const archive = await provider.snapshot(archiveSelection());
    const known = await provider.weatherAtOperational(archive, { lon: 37, lat: 55, operationalAt: '2026-01-01T00:30:00.000Z' });
    expect(known.quality.algorithm).toBe('weatherAt');
    expect(known.state?.temperature).toBe(-3.5);
    expect(known.state?.precipitation).toBeNull();
    expect(known.quality.missingFields).toContain('precipitation');
    expect(known.quality.status).toBe('PARTIAL');

    const outsidePoint = await provider.weatherAtOperational(archive, { lon: 38, lat: 55, operationalAt: '2026-01-01T00:30:00.000Z' });
    expect(outsidePoint.state).toBeNull();
    expect(outsidePoint.quality.status).toBe('NO_DATA');
    const outsideTime = await provider.weatherAtOperational(archive, { lon: 37, lat: 55, operationalAt: '2026-01-01T02:00:00.000Z' });
    expect(outsideTime.state).toBeNull();
    expect(outsideTime.quality.status).toBe('NO_DATA');

    const scenarioSnapshot = await provider.snapshot({ ...archiveSelection(), weather: { mode: 'scenario', scenario } });
    const first = await provider.weatherAtOperational(scenarioSnapshot, {
      lon: 37, lat: 55, operationalAt: '2026-01-01T01:00:00.000Z', wallClockAt: '2030-05-01T00:00:00.000Z', playbackRate: 1,
    });
    const second = await provider.weatherAtOperational(scenarioSnapshot, {
      lon: 37, lat: 55, operationalAt: '2026-01-01T01:00:00.000Z', wallClockAt: '2031-06-01T00:00:00.000Z', playbackRate: 100,
    });
    expect(first.quality.algorithm).toBe('simulateWeather');
    expect(first).toEqual(second);
    const beyondScenario = await provider.weatherAtOperational(scenarioSnapshot, { lon: 37, lat: 55, operationalAt: '2026-01-01T03:00:00.000Z' });
    expect(beyondScenario.state).toBeNull();
    expect(beyondScenario.quality.status).toBe('NO_DATA');
  });

  it('NF-21: ограниченный экспорт явно неполон и не выдаётся за автономный', async () => {
    const selection = archiveSelection();
    selection.atlases[0].exportRights = 'REFERENCE_ONLY';
    const snapshot = await provider.snapshot(selection);
    expect(snapshot.autonomy).toBe('INCOMPLETE');
    expect(snapshot.atlases[0].export.contentRef).toBeNull();
    expect(snapshot.limitations.join(' ')).toContain('лиценз');
    expect(() => assertSnapshotComplete(snapshot)).toThrow('автономн');
  });

  it('отклоняет ссылку на изменяемый атлас вместо автономного содержимого', () => {
    expect(() => assertSnapshotComplete({
      atlases: [{ id: 'a1', sha256: 'abc', style: { contentRef: null }, export: { contentRef: null }, elevations: { contentRef: null } }],
      weather: { mode: 'scenario', contentRef: 'weather/abc' },
    })).toThrow('автономн');
  });

  it('предоставляет отдельные HTTP-маршруты среды без изменения общего приложения', () => {
    const router = new Router();
    addEnvironmentRoutes(router, provider);
    expect(router.match('GET', '/kshvi/environment/atlases')).not.toBeNull();
    expect(router.match('POST', '/kshvi/environment/snapshots')).not.toBeNull();
    expect(router.match('GET', '/kshvi/environment/snapshots/abc')).not.toBeNull();
    expect(router.match('GET', '/kshvi/environment/snapshots/abc/weather')).not.toBeNull();
    expect(router.match('GET', '/kshvi/environment/snapshots/abc/atlas/a1/style')).not.toBeNull();
    expect(router.match('GET', '/kshvi/environment/snapshots/abc/atlas/a1/export')).not.toBeNull();
    expect(router.match('GET', '/kshvi/environment/snapshots/abc/atlas/a1/tiles/0/0/0')).not.toBeNull();
  });
});
