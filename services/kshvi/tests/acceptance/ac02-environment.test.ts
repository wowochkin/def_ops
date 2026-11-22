import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import type { WeatherScenario } from '@def-ops/core';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { CartographyEnvironmentProvider } from '../../src/environment/cartography-provider';
import { EnvironmentSnapshotStore, assertSnapshotComplete } from '../../src/environment/snapshot-store';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import { withKshviDatabase } from '../helpers/database';

const scenario: WeatherScenario = {
  version: 1, seed: 17, start: '2026-01-01T00:00:00.000Z', durationHours: 2,
  temperature: -2, humidity: 75, pressure: 1002, windSpeed: 2, windDirection: 180,
  cloud: 40, precipitation: 1, variability: 0, transitionHours: 1,
  visibility: 7000, snowDepth: 0, soilTemperature: -1, soilMoisture: 0.3,
};
const selection = () => ({
  region: { name: 'Исходный район', bounds: [36, 54, 38, 56] as [number, number, number, number] },
  atlases: [{ id: 'a1', exportRights: 'ALLOWED' as const, elevationPoints: [[37, 55] as [number, number]] }],
  weather: { mode: 'scenario' as const, scenario },
  elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 },
});
const services: Array<ReturnType<typeof createService>> = [];
const roots: string[] = [];
afterEach(async () => {
  while (services.length) await services.pop()?.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

it('AC-02: исходная среда неизменна, а плановая погода создаёт новую версию с supersedes', async () => {
  await withKshviDatabase(async store => {
    const root = await mkdtemp(path.join('.tmp', 'ac02-environment-'));
    roots.push(root);
    let sourceDeleted = false;
    let requests = 0;
    const fetcher: typeof fetch = async (input, init) => {
      requests += 1;
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const key = `${init?.method ?? 'GET'} ${url.pathname}`;
      if (sourceDeleted) return json({ error: { message: 'Источник удалён' } }, 404);
      if (key === 'GET /cartography/atlas') return json([{ id: 'a1', name: 'Атлас', format: 'pbf', kind: 'vector', minzoom: 0, maxzoom: 12, bounds: [36, 54, 38, 56], attribution: '© Учебный источник', layers: [], bytes: 3, sha256: 'a'.repeat(64) }]);
      if (key === 'GET /cartography/atlas/a1/style') return json({ version: 8, sources: { atlas: { type: 'vector', tiles: ['http://cartography.test/cartography/atlas/a1/tiles/{z}/{x}/{y}'] } }, layers: [] });
      if (key === 'GET /cartography/atlas/a1/export') return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
      if (key === 'POST /cartography/atlas/a1/elevations') return json({ source: 'a1', values: [{ lon: 37, lat: 55, elevationM: 180 }] });
      return json({ error: { message: `Нет фикстуры ${key}` } }, 404);
    };
    const provider = new CartographyEnvironmentProvider({ baseUrl: 'http://cartography.test/cartography', store: new EnvironmentSnapshotStore(root), fetch: fetcher });
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    await sessions.createAccount({
      userId: 'director', username: 'director', password: 'secret123', organizationId: 'org-ac02',
      roles: [{ id: 'director-role', role: 'DIRECTOR', sideId: 'blue', authorities: ['instance:command', 'projection:read', 'exercise:read', 'exercise:revise'] }],
    });
    const login = await sessions.login('director', 'secret123');
    await sessions.selectRole(login.token, 'director-role');
    const commands = new CommandService({ store, organizationId: 'org-ac02' });
    const service = createService({ name: 'kshvi-ac02', port: 0, router: buildRouter({ sessions, commands, environmentProvider: provider }) });
    services.push(service);
    const port = await service.listen();
    const base = `http://127.0.0.1:${port}`;
    const headers = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };
    const post = async (route: string, body: unknown) => {
      const response = await fetch(`${base}${route}`, { method: 'POST', headers, body: JSON.stringify(body) });
      const payload = await response.json() as Record<string, unknown>;
      expect(response.status, JSON.stringify(payload)).toBe(200);
      return payload;
    };
    const snapshotResponse = await fetch(`${base}/kshvi/environment/snapshots`, { method: 'POST', headers, body: JSON.stringify(selection()) });
    const snapshot = await snapshotResponse.json() as Awaited<ReturnType<CartographyEnvironmentProvider['loadSnapshot']>>;
    expect(snapshotResponse.status).toBe(200);
    expect(snapshot.autonomy).toBe('COMPLETE');
    expect(() => assertSnapshotComplete(snapshot)).not.toThrow();

    const changedSelection = selection();
    changedSelection.region = { name: 'Соседний район', bounds: [36, 54, 38, 56] };
    changedSelection.weather = { mode: 'scenario', scenario: { ...scenario, temperature: 25 } };
    await post('/kshvi/environment/snapshots', changedSelection);
    sourceDeleted = true;
    const requestsBeforeRestore = requests;
    const restoredResponse = await fetch(`${base}/kshvi/environment/snapshots/${snapshot.id}`, { headers });
    const restored = await restoredResponse.json() as typeof snapshot;
    expect(restoredResponse.status).toBe(200);
    expect(restored.manifestSha256).toBe(snapshot.manifestSha256);
    expect(restored.id).toBe(snapshot.id);
    expect(requests).toBe(requestsBeforeRestore);

    const bound = await post('/kshvi/instances/ac02/environment', { branchId: 'main', expectedRevision: 0, idempotencyKey: 'bind-environment', snapshotId: snapshot.id });
    expect(bound.revision).toBe(1);
    const changed = await post('/kshvi/instances/ac02/commands', {
      branchId: 'main', expectedRevision: 1, idempotencyKey: 'weather-front-1', type: 'weather.change', at: '2026-01-01T01:00:00.000Z',
      payload: {
        changeId: 'weather-front-1', effectiveAt: '2026-01-01T01:00:00.000Z', reason: 'Плановая вводная руководителя',
        supersedes: snapshot.manifestSha256, scenario: { ...scenario, temperature: 10 },
      },
    });
    expect(changed.revision).toBe(2);
    const weather = async (operationalAt: string) => {
      const response = await fetch(`${base}/kshvi/instances/ac02/weather?lon=37&lat=55&operationalAt=${encodeURIComponent(operationalAt)}`, { headers });
      expect(response.status).toBe(200);
      return response.json() as Promise<{ state: { temperature: number } | null; supersededBy?: string }>;
    };
    expect((await weather('2026-01-01T00:30:00.000Z')).state?.temperature).toBe(-2);
    expect((await weather('2026-01-01T01:00:00.000Z')).state?.temperature).toBe(10);
    const originalWeather = await fetch(`${base}/kshvi/environment/snapshots/${snapshot.id}/weather?lon=37&lat=55&operationalAt=${encodeURIComponent('2026-01-01T01:00:00.000Z')}`, { headers });
    expect((await originalWeather.json() as { state: { temperature: number } }).state.temperature).toBe(-2);

    const history = await store.listEvents('org-ac02', 'ac02', 'main');
    expect(history.map(event => event.type)).toEqual(['environment.bound.v1', 'weather.changed.v1']);
    expect(history[1].payload).toMatchObject({ reason: 'Плановая вводная руководителя', authorId: 'director', supersedes: snapshot.manifestSha256 });
    expect((history[0]!.payload as Record<string, unknown>).supersedes ?? null).toBeNull();

    const weatherRef = snapshot.weather.contentRef!;
    await rm(path.join(root, snapshot.id, weatherRef.path));
    await expect(provider.loadSnapshot(snapshot.id)).rejects.toThrow('не найдено');

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (runId) {
      const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
      const directory = 'docs/release/kshvi/evidence/ac02';
      await mkdir(directory, { recursive: true });
      const initialScenario = { selection: selection(), snapshotId: snapshot.id, manifestSha256: snapshot.manifestSha256 };
      const initialRevision = { id: `ac02-${snapshot.id}`, revision: 1, sha256: hashCanonical(initialScenario) };
      const environment = { snapshotId: snapshot.id, manifestSha256: snapshot.manifestSha256, autonomy: snapshot.autonomy, sourceDeleted };
      const metrics = { beforeTemperature: -2, afterTemperature: 10, restoredRequests: requestsBeforeRestore, weatherChanges: 1 };
      const initialPath = `${directory}/initial-scenario.json`;
      const journalPath = `${directory}/journal.json`;
      const protocolPath = `${directory}/protocol.txt`;
      const metricsPath = `${directory}/metrics.json`;
      const environmentPath = `${directory}/environment.json`;
      const limitations = ['Соседний источник моделируется локальной фикстурой; физическое переименование внешнего атласа не входит в контур.'];
      await writeFile(initialPath, JSON.stringify({ initialRevision, scenario: initialScenario }, null, 2));
      await writeFile(journalPath, JSON.stringify({ runId, commit, events: history }, null, 2));
      await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
      await writeFile(environmentPath, JSON.stringify(environment, null, 2));
      await writeFile(protocolPath, `AC-02 завершён\nrunId: ${runId}\ncommit: ${commit}\nИсходный снимок сохранён после удаления источника; плановая погода создала supersedes; ранний кадр сохранил исходную погоду.\n`);
      const proof = {
        runId, commit, initialRevision,
        journal: { path: journalPath, sha256: hashCanonical(history), eventCount: history.length },
        hashes: { scenario: initialRevision.sha256, environment: hashCanonical(environment), journal: hashCanonical(history) },
        protocols: [protocolPath], screenshots: [], metrics, limitations,
        artifacts: [initialPath, journalPath, protocolPath, metricsPath, environmentPath],
      };
      await writeFile('docs/release/kshvi/acceptance/AC-02.proof.json', JSON.stringify(proof, null, 2));
    }
  });
});
