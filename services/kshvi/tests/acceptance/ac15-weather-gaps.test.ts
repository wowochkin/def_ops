import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createService } from '@def-ops/service-kit';
import { afterEach, expect, it } from 'vitest';
import { buildRouter } from '../../src/app';
import { InMemorySessionStore, SessionManager } from '../../src/auth/sessions';
import { CommandService } from '../../src/instances/command-service';
import { CartographyEnvironmentProvider } from '../../src/environment/cartography-provider';
import { EnvironmentSnapshotStore } from '../../src/environment/snapshot-store';
import { withKshviDatabase } from '../helpers/database';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';
import type { Calculation } from '../../../../packages/kshvi/src/simulation/calculation';

const services: Array<ReturnType<typeof createService>> = [];
const roots: string[] = [];
afterEach(async () => {
  while (services.length) await services.pop()?.close();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});
const scenario = { version: 1 as const, seed: 17, start: '2026-01-01T00:00:00.000Z', durationHours: 2, temperature: -2, humidity: 75, pressure: 1002, windSpeed: 2, windDirection: 180, cloud: 40, precipitation: 1, variability: 0, transitionHours: 1 };
const episode = {
  state: {}, forces: {}, task: { id: 'task', status: 'IN_PROGRESS', progressPercent: 0 }, resource: { id: 'fuel', unit: 'L', onHand: 20, consumption: 10, supplied: 0 },
  elapsedMinutes: 30, position: { remainingMeters: 1000, travelledMeters: 0 }, uncertainty: {}, effects: { taskProgressDelta: 10, positionAdvanceMeters: 100, stateChanges: {}, uncertaintyChanges: {} },
} as const;
const passport = { purpose: 'Движение с учётом погоды', limitations: ['Только учебный расчёт'], source: { kind: 'ASSUMPTION' as const, note: 'Учебная модель', applicability: 'AC-15' }, knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1 };

it('AC-15: пробел погоды возвращает NO_DATA и REQUIRES_REVIEW вместо коэффициента 1', { timeout: 30_000 }, async () => {
  await mkdir('.tmp', { recursive: true });
  const root = await mkdtemp(join('.tmp', 'ac15-environment-'));
  roots.push(root);
  const provider = new CartographyEnvironmentProvider({ baseUrl: 'http://cartography.test/cartography', store: new EnvironmentSnapshotStore(join(root, 'snapshots')), fetch: async input => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const key = `${url.pathname}`;
    if (key === '/cartography/atlas') return Response.json([{ id: 'a1', name: 'Атлас', format: 'pbf', kind: 'vector', minzoom: 0, maxzoom: 12, bounds: [36, 54, 38, 56], attribution: 'Учебный источник', layers: [], bytes: 3, sha256: 'a'.repeat(64) }]);
    if (key === '/cartography/atlas/a1/style') return Response.json({ version: 8, sources: {}, layers: [] });
    if (key === '/cartography/atlas/a1/export') return new Response(new Uint8Array([1, 2, 3]));
    if (key === '/cartography/atlas/a1/elevations') return Response.json({ source: 'a1', values: [] });
    return Response.json({ error: { message: `Нет фикстуры ${key}` } }, { status: 404 });
  } });
  const snapshot = await provider.snapshot({ region: { name: 'Район', bounds: [36, 54, 38, 56] }, atlases: [{ id: 'a1', exportRights: 'ALLOWED', elevationPoints: [] }], weather: { mode: 'scenario', scenario }, elevation: { adjustmentM: 0, algorithmVersion: 1 }, algorithmVersions: { snapshot: 1, weather: 1 } });
  const known = await provider.weatherAtOperational(snapshot, { lon: 37, lat: 55, operationalAt: '2026-01-01T01:00:00.000Z' });
  expect(known.quality).toMatchObject({ status: 'OK', algorithm: 'simulateWeather' });
  expect(known.state).not.toBeNull();
  const missing = await provider.weatherAtOperational(snapshot, { lon: 37, lat: 55, operationalAt: '2026-01-01T04:00:00.000Z' });
  expect(missing).toMatchObject({ state: null, quality: { status: 'NO_DATA', algorithm: 'simulateWeather' } });

  await withKshviDatabase(async store => {
    const sessions = new SessionManager({ store: new InMemorySessionStore() });
    await sessions.createAccount({ userId: 'leader', username: 'leader', password: 'secret123', organizationId: 'org-ac15', roles: [{ id: 'leader-role', role: 'LEADER', sideId: 'blue', authorities: ['instance:command'] }] });
    const login = await sessions.login('leader', 'secret123');
    await sessions.selectRole(login.token, 'leader-role');
    const commands = new CommandService({ store, organizationId: 'org-ac15' });
    const service = createService({ name: 'kshvi-ac15', port: 0, router: buildRouter({ sessions, commands }) });
    services.push(service);
    const base = `http://127.0.0.1:${await service.listen()}`;
    const headers = { Authorization: `Bearer ${login.token}`, 'content-type': 'application/json' };
    const create = async (weatherFactor: number | null, revision: number, idempotencyKey: string) => {
      const response = await fetch(`${base}/kshvi/instances/ac15/commands`, { method: 'POST', headers, body: JSON.stringify({
        branchId: 'main', expectedRevision: revision, idempotencyKey, type: 'calculation.create', at: '2026-01-01T01:00:00.000Z',
        payload: { calculationId: idempotencyKey, mode: 'DETERMINISTIC', input: {
          reason: 'Движение при погодном пробеле', inputSnapshot: { revision: 1 }, inputs: { episode, weatherFactor }, requiredInputs: ['weatherFactor'], units: { fuel: 'L' },
          modelVersion: 'aggregate-v1', profileVersions: {}, modelPassport: passport, sideId: 'blue', nodeId: 'node-blue-1',
        } },
      }) });
      expect(response.status, await response.text()).toBe(200);
    };
    await create(0.8, 0, 'calc-known');
    await create(null, 1, 'calc-missing');
    const events = await store.listEvents('org-ac15', 'ac15', 'main');
    const calculations = events.map(event => (event.payload as { calculation?: Calculation } | null)?.calculation);
    const calculated = calculations.find(calculation => calculation?.id === 'calc-known');
    const requiresReview = calculations.find(calculation => calculation?.id === 'calc-missing')!;
    expect(calculated).toMatchObject({ state: 'CALCULATED', inputs: { weatherFactor: 0.8 } });
    expect(requiresReview).toMatchObject({ state: 'REQUIRES_REVIEW', unknown: ['weatherFactor'] });
    expect(requiresReview.warnings.join(' ')).toContain('weatherFactor');
    expect(requiresReview.modelPassport.purpose).toBe('Движение с учётом погоды');

    const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
    if (!runId) return;
    const directory = 'docs/release/kshvi/evidence/ac15';
    await mkdir(directory, { recursive: true });
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
    const initialRevision = { id: 'ac15-weather', revision: 1, sha256: snapshot.manifestSha256 };
    const journalPath = `${directory}/journal.json`;
    const protocolPath = `${directory}/protocol.txt`;
    const metricsPath = `${directory}/metrics.json`;
    const journal = { runId, commit, known, missing, calculated, requiresReview, events };
    const metrics = { knownWeatherQueries: 1, noDataResponses: 1, calculatedWithKnownFactor: 1, requiresReview: 1, substitutedUnitFactors: 0 };
    await writeFile(journalPath, JSON.stringify(journal, null, 2));
    await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
    await writeFile(protocolPath, `AC-15 завершён\nrunId: ${runId}\ncommit: ${commit}\nИзвестная погода рассчитана; пропуск вернул NO_DATA; обязательный расчёт получил REQUIRES_REVIEW; коэффициент 1 не подставлялся.\n`);
    await writeFile('docs/release/kshvi/acceptance/AC-15.proof.json', JSON.stringify({
      runId, commit, initialRevision,
      journal: { path: journalPath, sha256: hashCanonical(journal), eventCount: events.length },
      hashes: { scenario: initialRevision.sha256, environment: snapshot.manifestSha256, journal: hashCanonical(journal) },
      protocols: [protocolPath], screenshots: [], metrics,
      limitations: ['Проверен профиль движения с обязательным weatherFactor; остальные расчётные профили требуют собственных обязательных входов.'],
      artifacts: [journalPath, protocolPath, metricsPath],
    }, null, 2));
  });
});
