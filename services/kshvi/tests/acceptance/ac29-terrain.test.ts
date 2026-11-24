import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import {
  advanceTerrain, initialTerrainState, projectTerrainState, recalculateRoute, reserveCrossing,
  validateTerrainHydrologyProfile, type TerrainHydrologyProfile, type TerrainObject,
} from '../../../../packages/kshvi/src/terrain/index';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

const profile = JSON.parse(readFileSync(new URL('../../../../packages/kshvi/data/profiles/terrain-hydrology.json', import.meta.url), 'utf8')) as TerrainHydrologyProfile;
const T0 = '2030-01-01T00:00:00.000Z';
const T1 = '2030-01-01T01:00:00.000Z';
const T2 = '2030-01-01T02:00:00.000Z';
const T3 = '2030-01-01T03:00:00.000Z';
const T4 = '2030-01-01T04:00:00.000Z';
const geometry = { type: 'LineString', coordinates: [[37, 55], [37.01, 55.01]] } as const;
function object(value: Pick<TerrainObject, 'id' | 'kind'> & Partial<TerrainObject>): TerrainObject {
  return { geometry, status: 'OPEN', dataAt: T0, source: 'Учебная геометрия', uncertainty: 'Точная фикстура', ...value };
}
function objects(): TerrainObject[] {
  return [
    object({ id: 'forest', kind: 'FOREST', density: 0.8, leafiness: 'LEAFLESS', blockage: false, fire: false, speedKph: { FOOT: 4, WHEELED: 8, TRACKED: 12 } }),
    object({ id: 'marsh', kind: 'MARSH', moisture: 0.8, frozen: false, speedKph: { FOOT: 2, WHEELED: 3, TRACKED: 5 } }),
    object({ id: 'road', kind: 'ROAD', surface: 'UNPAVED', mud: 'NONE', capacityPerHour: 20, speedKph: { FOOT: 5, WHEELED: 40, TRACKED: 30 } }),
    object({ id: 'river', kind: 'RIVER', widthM: 80, depthM: 2, currentMps: 1, waterLevelM: 1, flooded: false, ice: 'NONE' }),
    object({ id: 'bridge', kind: 'BRIDGE', capacityTonnes: 40, capacityPerHour: 2, widthM: 5, heightM: 4, crossingMinutes: 20 }),
    object({ id: 'ford', kind: 'FORD', capacityTonnes: 35, depthM: 0.5, bottom: 'FIRM', currentMps: 0.5, crossingMinutes: 15 }),
    object({ id: 'ferry', kind: 'FERRY', capacityTonnes: 45, capacityPerHour: 2, crossingMinutes: 30, workingMinutesPerCycle: 30 }),
    object({ id: 'pontoon', kind: 'PONTOON', capacityTonnes: 50, deployed: true, equipmentStatus: 'SERVICEABLE', crossingMinutes: 20 }),
    object({ id: 'ice', kind: 'ICE_CROSSING', capacityTonnes: 20, iceThicknessM: 0.2, crossingMinutes: 25 }),
  ];
}
function state() { return initialTerrainState({ operationalAt: T0, objects: objects(), profile }); }
const graph = {
  nodes: ['A', 'B', 'C'],
  edges: [
    { id: 'direct', from: 'A', to: 'B', distanceMeters: 8000, terrainObjectId: 'bridge', baseSpeedKph: 40 },
    { id: 'detour-a', from: 'A', to: 'C', distanceMeters: 10000, terrainObjectId: 'road', baseSpeedKph: 40 },
    { id: 'detour-b', from: 'C', to: 'B', distanceMeters: 10000, terrainObjectId: 'road', baseSpeedKph: 40 },
  ],
} as const;

it('AC-29: погода, гидрология, скрытое повреждение и очередь меняют маршрут и снабжение без отката пути', { timeout: 120_000 }, async () => {
  const moduleOutput = execFileSync('npx', ['vitest', 'run', 'packages/kshvi/tests/terrain.test.ts'], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
  expect(moduleOutput).toContain('1 passed');
  expect(validateTerrainHydrologyProfile(profile)).toEqual([]);

  const weatherInput = {
    operationalAt: T1,
    weather: { eventId: 'weather-wet-ac29', state: { precipitation: 12, soilTemperature: 4 }, geometry },
    events: [], profile,
  } as const;
  const wet = advanceTerrain(state(), weatherInput);
  expect(wet.status).toBe('READY');
  expect(wet.objects.road).toMatchObject({ mud: 'HEAVY', status: 'DEGRADED' });
  expect(wet.objects.road.speedKph?.WHEELED).toBeLessThan(40);
  expect(wet.objects.road.speedKph?.TRACKED).toBeLessThan(30);
  expect(wet.objects.forest.speedKph?.FOOT).not.toBe(wet.objects.road.speedKph?.WHEELED);
  expect(wet.history[0].causeIds).toContain('weather-wet-ac29');
  expect(advanceTerrain(wet, weatherInput)).toEqual(wet);

  const frozen = advanceTerrain(wet, {
    operationalAt: T2, weather: { eventId: 'weather-freeze-ac29', state: { precipitation: 0, soilTemperature: -5 }, geometry }, events: [], profile,
  });
  expect(frozen.objects.marsh.frozen).toBe(true);
  expect(frozen.objects.river.ice).toBe('FROZEN');
  const thawed = advanceTerrain(frozen, {
    operationalAt: T3, weather: { eventId: 'weather-thaw-ac29', state: { precipitation: 25, soilTemperature: 5 }, geometry }, events: [], profile,
  });
  expect(thawed.objects.marsh.frozen).toBe(false);
  expect(thawed.objects.river).toMatchObject({ flooded: true, status: 'CLOSED', ice: 'NONE' });
  expect(thawed.history.some(event => event.reason.includes('разлив'))).toBe(true);

  const routeInput = {
    graph, from: 'A', to: 'B', movement: { movementClass: 'WHEELED', loadTonnes: 30 },
    travelledMeters: 2000, elapsedMinutes: 20, purpose: 'SUPPLY',
  } as const;
  const opened = recalculateRoute({ ...routeInput, state: state() });
  expect(opened).toMatchObject({ status: 'OPEN', edgeIds: ['direct'], remainingMeters: 8000, travelledMeters: 2000, elapsedMinutes: 20 });
  const damaged = advanceTerrain(thawed, {
    operationalAt: T4,
    events: [{
      id: 'secret-damage-ac29', type: 'terrain.damage.v1', objectId: 'bridge', operationalAt: T4, geometry,
      reason: 'Скрытое разрушение пролёта', causeIds: ['order-ac29'], visibility: 'HIDDEN', patch: { status: 'CLOSED', damage: 'DESTROYED' },
    }],
    profile,
  });
  expect(damaged.objects.bridge.status).toBe('CLOSED');
  expect(advanceTerrain(damaged, {
    operationalAt: T4,
    events: [{
      id: 'secret-damage-ac29', type: 'terrain.damage.v1', objectId: 'bridge', operationalAt: T4, geometry,
      reason: 'Скрытое разрушение пролёта', causeIds: ['order-ac29'], visibility: 'HIDDEN', patch: { status: 'CLOSED', damage: 'DESTROYED' },
    }], profile,
  })).toEqual(damaged);
  const processCalls: string[] = [];
  const rerouted = recalculateRoute({
    ...routeInput, state: damaged,
    processes: {
      supply: effect => { processCalls.push('supply'); return { accepted: effect }; },
      evacuation: effect => { processCalls.push('evacuation'); return { accepted: effect }; },
      reconnaissance: effect => { processCalls.push('reconnaissance'); return { accepted: effect }; },
      agentOption: effect => { processCalls.push('agentOption'); return { accepted: effect }; },
    },
  });
  expect(rerouted.edgeIds).toEqual(['detour-a', 'detour-b']);
  expect(rerouted.remainingMeters).toBe(20000);
  expect(rerouted.travelledMeters).toBe(2000);
  expect(rerouted.elapsedMinutes).toBe(20);
  expect(rerouted.costMinutes).toBeGreaterThan(opened.costMinutes!);
  expect(rerouted.effects).toMatchObject({ route: 'REROUTED', movement: 'DELAYED', supply: 'DELAYED', evacuation: 'DELAYED', agentOption: 'DELAYED' });
  expect(rerouted.explanation.join(' ')).toContain('Скрытое разрушение');
  expect(processCalls).toEqual(['supply', 'evacuation', 'reconnaissance', 'agentOption']);

  const firstReservation = reserveCrossing(state(), {
    id: 'reservation-ac29-1', crossingId: 'bridge', columnId: 'column-ac29-1', movementClass: 'COLUMN', loadTonnes: 30,
    arrivalAt: T0, durationMinutes: 30,
  });
  const secondReservation = reserveCrossing(firstReservation.state, {
    id: 'reservation-ac29-2', crossingId: 'bridge', columnId: 'column-ac29-2', movementClass: 'COLUMN', loadTonnes: 35,
    arrivalAt: T0, durationMinutes: 20,
  });
  expect(secondReservation.status).toBe('QUEUED');
  expect(secondReservation.reservation).toMatchObject({ startAt: '2030-01-01T00:30:00.000Z', endAt: '2030-01-01T00:50:00.000Z' });
  const repeatedReservation = reserveCrossing(secondReservation.state, {
    id: 'reservation-ac29-2', crossingId: 'bridge', columnId: 'column-ac29-2', movementClass: 'COLUMN', loadTonnes: 35,
    arrivalAt: T0, durationMinutes: 20,
  });
  expect(repeatedReservation.state).toEqual(secondReservation.state);
  const overloaded = reserveCrossing(secondReservation.state, {
    id: 'reservation-ac29-3', crossingId: 'bridge', columnId: 'column-ac29-3', movementClass: 'COLUMN', loadTonnes: 41,
    arrivalAt: T0, durationMinutes: 20,
  });
  expect(overloaded.status).toBe('BLOCKED');
  expect(overloaded.state.queues.bridge.reservations).toHaveLength(2);

  const hidden = projectTerrainState(damaged, { sideId: 'blue', observedEventIds: [] });
  expect(hidden.objects.bridge.status).toBe('OPEN');
  expect(hidden.quality).toBe('STALE');
  expect(JSON.stringify(hidden)).not.toContain('Скрытое разрушение');
  const observed = projectTerrainState(damaged, { sideId: 'blue', observedEventIds: ['secret-damage-ac29'] });
  expect(observed.objects.bridge.status).toBe('CLOSED');
  // Остальные погодные события ещё не наблюдались, поэтому частичная проекция остаётся STALE.
  expect(observed.quality).toBe('STALE');
  const fullyObserved = projectTerrainState(damaged, { sideId: 'blue', observedEventIds: damaged.history.map(event => event.id) });
  expect(fullyObserved.quality).toBe('CURRENT');
  const unknown = advanceTerrain(state(), {
    operationalAt: T1, weather: { eventId: 'weather-gap-ac29', state: { precipitation: null, soilTemperature: -5 }, geometry }, events: [], profile,
  });
  expect(unknown.status).toBe('REQUIRES_REVIEW');
  expect(unknown.unknown).toEqual(['precipitation']);
  expect(unknown.objects).toEqual(state().objects);

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac29';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: profile.id, revision: 1, sha256: hashCanonical(profile) };
  const journalPath = `${directory}/journal.json`;
  const routePath = `${directory}/route-comparison.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const journal = JSON.parse(JSON.stringify({
    runId, commit, moduleOutput, wet, frozen, thawed, damaged, opened, rerouted,
    reservations: [firstReservation, secondReservation, repeatedReservation, overloaded], hidden, observed, unknown, processCalls,
  }));
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    terrainEvents: wet.history.length + frozen.history.length + thawed.history.length + damaged.history.length,
    repeatedTerrainEffects: 0, queuedColumns: secondReservation.state.queues.bridge.reservations.length,
    additionalRouteMinutes: rerouted.costMinutes! - opened.costMinutes!, preservedTravelledMeters: rerouted.travelledMeters,
    hiddenChangesBeforeObservation: 1, unknownWeatherReviews: 1, domainProcessesCalled: processCalls.length,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(routePath, JSON.stringify({ opened, rerouted, processCalls }, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-29 завершён\nrunId: ${runId}\ncommit: ${commit}\nРаспутица, замерзание, оттаивание и разлив создали версионные события; скрытое повреждение изменило граф только в истине; маршрут и снабжение задержаны; путь и затраты сохранены; очередь и повторы идемпотентны; UNKNOWN не применён.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-29.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: journalSha256, eventCount: metrics.terrainEvents },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical(state()), journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Динамическая модель и проекции проверены на версионном профиле; фактическая географическая точность конкретного атласа оценивается отдельно по источникам и на контрольном стенде.'],
    artifacts: [journalPath, routePath, protocolPath, metricsPath],
  }, null, 2));
});
