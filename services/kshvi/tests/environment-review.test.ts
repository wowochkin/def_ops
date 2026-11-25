import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { createService } from '@def-ops/service-kit';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { WeatherScenario } from '@def-ops/core';
import { CartographyEnvironmentProvider } from '../src/environment/cartography-provider';
import { EnvironmentSnapshotStore } from '../src/environment/snapshot-store';
import { addEnvironmentRoutes } from '../src/http/environment-routes';

const scenario: WeatherScenario = {
  version: 1, seed: 17, start: '2026-01-01T00:00:00.000Z', durationHours: 2,
  temperature: -2, humidity: 75, pressure: 1002, windSpeed: 2, windDirection: 180,
  cloud: 40, precipitation: 1, variability: 0, transitionHours: 1,
  visibility: 7000, snowDepth: 0, soilTemperature: -1, soilMoisture: 0.3,
};
const meta = {
  id: 'a1', name: 'Учебный атлас', format: 'pbf', kind: 'vector', minzoom: 0, maxzoom: 12,
  bounds: [36, 54, 38, 56], attribution: '© Учебный источник', layers: [{ id: 'roads' }], bytes: 15,
  sha256: 'a'.repeat(64), source: 'fixture',
};
const selection = () => ({
  region: { name: 'Район', bounds: [36, 54, 38, 56] as [number, number, number, number] },
  atlases: [{ id: 'a1', exportRights: 'ALLOWED' as const, elevationPoints: [[37, 55] as [number, number]] }],
  weather: { mode: 'scenario' as const, scenario },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

describe('автономность и покрытие снимка среды', () => {
  let root: string;
  let requests: string[];
  let store: EnvironmentSnapshotStore;
  let provider: CartographyEnvironmentProvider;
  let namedSprites: boolean;
  const closers: Array<() => Promise<void>> = [];

  beforeEach(async () => {
    root = await mkdtemp(path.join(process.cwd(), '.environment-review-test-'));
    requests = [];
    namedSprites = false;
    const fetcher: typeof fetch = async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const key = `${init?.method ?? 'GET'} ${url.pathname}`;
      requests.push(key);
      if (key === 'GET /cartography/atlas') return json([meta]);
      if (key === 'GET /cartography/atlas/a1/style') return json({
        version: 8,
        glyphs: 'http://cartography.test/cartography/fonts/{fontstack}/{range}.pbf',
        sprite: namedSprites ? [{ id: 'marks', url: 'http://cartography.test/cartography/sprites/ohm' }]
          : 'http://cartography.test/cartography/sprites/ohm',
        sources: { atlas: { type: 'vector', tiles: ['http://cartography.test/cartography/atlas/a1/tiles/{z}/{x}/{y}'] } },
        layers: [{ id: 'labels', type: 'symbol', layout: { 'text-font': ['Test Sans'] } }],
      });
      if (key === 'GET /cartography/atlas/a1/export') return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (key === 'POST /cartography/atlas/a1/elevations') return json({ source: 'a1', values: [{ lon: 37, lat: 55, elevationM: 180 }] });
      if (/^GET \/cartography\/fonts\/Test%20Sans\/\d+-\d+\.pbf$/.test(key)) return new Response(new Uint8Array([7]), { status: 200 });
      if (/^GET \/cartography\/sprites\/ohm(@2x)?\.(json|png)$/.test(key)) {
        return key.endsWith('.json') ? json({}) : new Response(new Uint8Array([8]), { status: 200 });
      }
      return json({ error: { message: `Нет фикстуры ${key}` } }, 404);
    };
    store = new EnvironmentSnapshotStore(root);
    provider = new CartographyEnvironmentProvider({ baseUrl: 'http://cartography.test/cartography', store, fetch: fetcher });
  });
  afterEach(async () => {
    while (closers.length) await closers.pop()?.();
    await rm(root, { recursive: true, force: true });
  });

  it('использует штатный /cartography/atlas и проверяет покрытие области', async () => {
    const main = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(main).toContain("env('CARTOGRAPHY_URL', 'http://localhost:8104/cartography')");
    await provider.snapshot(selection());
    expect(requests).toContain('GET /cartography/atlas');
    const outside = selection();
    outside.region.bounds = [30, 50, 31, 51];
    await expect(provider.snapshot(outside)).rejects.toMatchObject({ status: 422, code: 'environment_coverage_missing' });
  });

  it('сохраняет полные glyphs и sprite по SHA и переписывает их на снимок', async () => {
    const snapshot = await provider.snapshot(selection());
    expect(snapshot.autonomy).toBe('COMPLETE');
    expect(snapshot.resources).toHaveLength(260);
    expect(requests).toContain('GET /cartography/fonts/Test%20Sans/0-255.pbf');
    expect(requests).toContain('GET /cartography/fonts/Test%20Sans/65280-65535.pbf');
    for (const resource of snapshot.resources) await store.read(resource.artifact.contentRef!, snapshot.id);
    const style = await provider.snapshotArtifact(snapshot, 'a1', 'style') as { glyphs: string; sprite: string };
    expect(style.glyphs).toBe(`/kshvi/environment/snapshots/${snapshot.id}/resources/glyphs/{fontstack}/{range}.pbf`);
    expect(style.sprite).toBe(`/kshvi/environment/snapshots/${snapshot.id}/resources/sprites/ohm`);
    expect(JSON.stringify(style)).not.toContain('cartography.test');
  });

  it('сохраняет именованный sprite и закрывает его на ресурсы снимка', async () => {
    namedSprites = true;
    const snapshot = await provider.snapshot(selection());
    expect(snapshot.resources).toHaveLength(260);
    const style = await provider.snapshotArtifact(snapshot, 'a1', 'style');
    expect(style).toMatchObject({
      sprite: [{ id: 'marks', url: `/kshvi/environment/snapshots/${snapshot.id}/resources/sprites/sprite-marks` }],
    });
    const image = await provider.snapshotResource(snapshot, 'sprites/sprite-marks.png');
    expect(image).toEqual(Buffer.from([8]));
  });

  it('обнаруживает отсутствие и повреждение содержимого при загрузке', async () => {
    const snapshot = await provider.snapshot(selection());
    const ref = snapshot.atlases[0].style.contentRef!;
    const file = path.join(root, snapshot.id, ref.path);
    await writeFile(file, 'повреждено');
    await expect(provider.loadSnapshot(snapshot.id)).rejects.toThrow('SHA-256');
    await rm(file);
    await expect(provider.loadSnapshot(snapshot.id)).rejects.toThrow('не найдено');
  });

  it('возвращает 422 вместо координаты (0,0) при пропущенных параметрах', async () => {
    const snapshot = await provider.snapshot(selection());
    const { Router } = await import('@def-ops/service-kit');
    const router = addEnvironmentRoutes(new Router(), provider);
    const service = createService({ name: 'kshvi-environment-review-test', port: 0, router });
    const port = await service.listen();
    closers.push(service.close);
    const base = `http://127.0.0.1:${port}/kshvi/environment/snapshots/${snapshot.id}/weather?operationalAt=2026-01-01T01:00:00.000Z`;
    const missing = await fetch(base);
    expect(missing.status).toBe(422);
    const invalid = await fetch(`${base}&lon=0&lat=not-a-number`);
    expect(invalid.status).toBe(422);
    const valid = await fetch(`${base}&lon=37&lat=55`);
    expect(valid.status).toBe(200);
  });
});
