import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  advanceTerrain,
  crossingDecision,
  initialTerrainState,
  projectTerrainState,
  recalculateRoute,
  reserveCrossing,
  routeCost,
  validateTerrainHydrologyProfile,
  type TerrainHydrologyProfile,
  type TerrainObject,
} from '../src/terrain/index';

const profile = JSON.parse(readFileSync(new URL('../data/profiles/terrain-hydrology.json', import.meta.url), 'utf8')) as TerrainHydrologyProfile;
const t0 = '2026-01-01T00:00:00.000Z';
const t1 = '2026-01-01T01:00:00.000Z';
const t2 = '2026-01-01T02:00:00.000Z';
const geometry = { type: 'LineString', coordinates: [[37, 55], [37.01, 55.01]] } as const;

function object(value: Pick<TerrainObject, 'id' | 'kind'> & Partial<TerrainObject>): TerrainObject {
  return {
    geometry,
    status: 'OPEN',
    dataAt: t0,
    source: 'Учебная геометрия',
    uncertainty: 'Точная фикстура',
    ...value,
  };
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

function state() {
  return initialTerrainState({ operationalAt: t0, objects: objects(), profile });
}

const graph = {
  nodes: ['A', 'B', 'C'],
  edges: [
    { id: 'direct', from: 'A', to: 'B', distanceMeters: 8000, terrainObjectId: 'bridge', baseSpeedKph: 40 },
    { id: 'detour-a', from: 'A', to: 'C', distanceMeters: 10000, terrainObjectId: 'road', baseSpeedKph: 40 },
    { id: 'detour-b', from: 'C', to: 'B', distanceMeters: 10000, terrainObjectId: 'road', baseSpeedKph: 40 },
  ],
} as const;

describe('динамическая местность и H_v/G_v', () => {
  it('проверяет поставленный профиль и различает нагрузку и неизвестные параметры', () => {
    expect(validateTerrainHydrologyProfile(profile)).toEqual([]);
    expect(crossingDecision({ loadTonnes: 42 }, { capacityTonnes: 40, status: 'OPEN' })).toBe('BLOCKED');
    expect(crossingDecision({ loadTonnes: 42 }, { capacityTonnes: 40, status: 'CLOSED' })).toBe('BLOCKED');
    expect(crossingDecision({ loadTonnes: 30 }, { capacityTonnes: 40, status: 'OPEN' })).toBe('ALLOWED');
    expect(crossingDecision({ loadTonnes: null }, { capacityTonnes: 40, status: 'OPEN' })).toBe('REQUIRES_REVIEW');
    expect(crossingDecision({ loadTonnes: 30 }, { capacityTonnes: null, status: 'OPEN' })).toBe('REQUIRES_REVIEW');
  });

  it('поддерживает брод, паром, понтон, мост и ледовую переправу', () => {
    for (const kind of ['FORD', 'FERRY', 'PONTOON', 'BRIDGE', 'ICE_CROSSING'] as const) {
      const crossing = objects().find(value => value.kind === kind)!;
      expect(crossingDecision({ loadTonnes: 15, movementClass: 'TRACKED' }, crossing), kind).toBe('ALLOWED');
      expect(crossingDecision({ loadTonnes: 500, movementClass: 'COLUMN' }, crossing), kind).toBe('BLOCKED');
    }
  });

  it('не откатывает пройденный путь и не использует закрытое ребро', () => {
    const route = routeCost({ remainingMeters: 8000, travelledMeters: 2000 }, { speedKph: 20, closed: false });
    expect(route).toMatchObject({ remainingMeters: 8000, travelledMeters: 2000, status: 'OPEN', durationMinutes: 24 });
    const closed = routeCost({ remainingMeters: 8000, travelledMeters: 2000 }, { speedKph: 20, closed: true });
    expect(closed).toMatchObject({ remainingMeters: 8000, travelledMeters: 2000, status: 'CLOSED', durationMinutes: null });
    expect(routeCost({ remainingMeters: 8000, travelledMeters: 0 }, { speedKph: null, closed: false }).status).toBe('REQUIRES_REVIEW');
  });

  it('AC-29: распутица, замерзание/оттаивание и разлив создают события с геометрией и причиной', () => {
    const wet = advanceTerrain(state(), {
      operationalAt: t1,
      weather: { eventId: 'weather-wet', state: { precipitation: 12, soilTemperature: 4 } },
      events: [], profile,
    });
    expect(wet.status).toBe('READY');
    expect(wet.objects.road).toMatchObject({ mud: 'HEAVY', status: 'DEGRADED' });
    expect(wet.objects.road.speedKph?.WHEELED).toBeLessThan(40);
    expect(wet.objects.road.speedKph?.TRACKED).toBeLessThan(30);
    expect(wet.history[0]).toMatchObject({ operationalAt: t1, geometry, reason: expect.stringContaining('распутица') });
    expect(wet.history[0].causeIds).toContain('weather-wet');
    expect(wet.algorithmVersions).toEqual({ H_v: profile.hydrologyVersion, G_v: profile.graphVersion });

    const frozen = advanceTerrain(wet, {
      operationalAt: t2,
      weather: { eventId: 'weather-freeze', state: { precipitation: 0, soilTemperature: -5 } },
      events: [], profile,
    });
    expect(frozen.objects.marsh.frozen).toBe(true);
    expect(frozen.objects.river.ice).toBe('FROZEN');
    const thawed = advanceTerrain(frozen, {
      operationalAt: '2026-01-01T03:00:00.000Z',
      weather: { eventId: 'weather-thaw', state: { precipitation: 25, soilTemperature: 5 } },
      events: [], profile,
    });
    expect(thawed.objects.marsh.frozen).toBe(false);
    expect(thawed.objects.river).toMatchObject({ flooded: true, status: 'CLOSED', ice: 'NONE' });
    expect(thawed.history.some(event => event.reason.includes('разлив'))).toBe(true);
  });

  it('повтор скачка идемпотентен, прошлое не переписывается, пробел требует проверки', () => {
    const input = {
      operationalAt: t1,
      weather: { eventId: 'weather-wet', state: { precipitation: 12, soilTemperature: 4 } },
      events: [], profile,
    } as const;
    const first = advanceTerrain(state(), input);
    expect(advanceTerrain(first, input)).toEqual(first);
    expect(() => advanceTerrain(first, { ...input, operationalAt: t0 })).toThrow('оперативн');
    const missing = advanceTerrain(state(), {
      operationalAt: t1,
      weather: { eventId: 'weather-gap', state: { precipitation: null, soilTemperature: -5 } },
      events: [], profile,
    });
    expect(missing.status).toBe('REQUIRES_REVIEW');
    expect(missing.unknown).toEqual(['precipitation']);
    expect(missing.objects).toEqual(state().objects);
    expect(missing.history).toEqual([]);
  });

  it('события повреждения, восстановления, наведения и снятия переправы версионируют состояние', () => {
    const damaged = advanceTerrain(state(), {
      operationalAt: t1,
      events: [{ id: 'destroy-bridge', type: 'terrain.damage.v1', objectId: 'bridge', operationalAt: t1, geometry, reason: 'Разрушение пролёта', causeIds: ['order-1'], visibility: 'HIDDEN', patch: { status: 'CLOSED', damage: 'DESTROYED' } }],
      profile,
    });
    expect(damaged.objects.bridge.status).toBe('CLOSED');
    expect(damaged.revision).toBe(1);
    const again = advanceTerrain(damaged, {
      operationalAt: t1,
      events: [{ id: 'destroy-bridge', type: 'terrain.damage.v1', objectId: 'bridge', operationalAt: t1, geometry, reason: 'Разрушение пролёта', causeIds: ['order-1'], visibility: 'HIDDEN', patch: { status: 'CLOSED', damage: 'DESTROYED' } }],
      profile,
    });
    expect(again).toEqual(damaged);
    const repaired = advanceTerrain(damaged, {
      operationalAt: t2,
      events: [
        { id: 'repair-bridge', type: 'terrain.repair.v1', objectId: 'bridge', operationalAt: t2, geometry, reason: 'Восстановление пролёта', causeIds: ['destroy-bridge'], visibility: 'PUBLIC', patch: { status: 'OPEN', damage: 'NONE' } },
        { id: 'remove-pontoon', type: 'terrain.crossing.removed.v1', objectId: 'pontoon', operationalAt: t2, geometry, reason: 'Снятие переправы', causeIds: [], visibility: 'PUBLIC', patch: { status: 'CLOSED', deployed: false } },
      ],
      profile,
    });
    expect(repaired.objects.bridge.status).toBe('OPEN');
    expect(repaired.objects.pontoon).toMatchObject({ status: 'CLOSED', deployed: false });
    expect(repaired.history.at(-1)?.causeIds).toEqual([]);
  });

  it('SIM-24: закрытый мост меняет маршрут и снабжение, сохраняя пройденный путь и затраты', () => {
    const request = {
      graph, from: 'A', to: 'B', movement: { movementClass: 'WHEELED', loadTonnes: 30 },
      travelledMeters: 2000, elapsedMinutes: 20, purpose: 'SUPPLY',
    } as const;
    const opened = recalculateRoute({ ...request, state: state() });
    expect(opened).toMatchObject({ status: 'OPEN', edgeIds: ['direct'], remainingMeters: 8000, travelledMeters: 2000, elapsedMinutes: 20 });
    expect(opened.effects.supply).toBe('PLANNED');
    const damaged = advanceTerrain(state(), {
      operationalAt: t1,
      events: [{ id: 'destroy-bridge', type: 'terrain.damage.v1', objectId: 'bridge', operationalAt: t1, geometry, reason: 'Разрушение пролёта', causeIds: [], visibility: 'PUBLIC', patch: { status: 'CLOSED' } }],
      profile,
    });
    const rerouted = recalculateRoute({ ...request, state: damaged });
    expect(rerouted.edgeIds).toEqual(['detour-a', 'detour-b']);
    expect(rerouted.remainingMeters).toBe(20000);
    expect(rerouted.travelledMeters).toBe(2000);
    expect(rerouted.elapsedMinutes).toBe(20);
    expect(rerouted.costMinutes).toBeGreaterThan(opened.costMinutes!);
    expect(rerouted.effects).toMatchObject({ route: 'REROUTED', movement: 'DELAYED', supply: 'DELAYED', evacuation: 'DELAYED', agentOption: 'DELAYED' });
    expect(rerouted.explanation.join(' ')).toContain('Разрушение пролёта');
  });

  it('ёмкость переправы образует занятые интервалы и очередь без дублей', () => {
    const first = reserveCrossing(state(), {
      id: 'reservation-1', crossingId: 'bridge', columnId: 'column-1', movementClass: 'COLUMN', loadTonnes: 30,
      arrivalAt: t0, durationMinutes: 30,
    });
    expect(first.status).toBe('RESERVED');
    expect(first.reservation).toMatchObject({ startAt: t0, endAt: '2026-01-01T00:30:00.000Z' });
    const second = reserveCrossing(first.state, {
      id: 'reservation-2', crossingId: 'bridge', columnId: 'column-2', movementClass: 'COLUMN', loadTonnes: 35,
      arrivalAt: t0, durationMinutes: 20,
    });
    expect(second.status).toBe('QUEUED');
    expect(second.reservation).toMatchObject({ startAt: '2026-01-01T00:30:00.000Z', endAt: '2026-01-01T00:50:00.000Z' });
    const repeated = reserveCrossing(second.state, {
      id: 'reservation-2', crossingId: 'bridge', columnId: 'column-2', movementClass: 'COLUMN', loadTonnes: 35,
      arrivalAt: t0, durationMinutes: 20,
    });
    expect(repeated.state).toEqual(second.state);
    expect(repeated.state.queues.bridge.reservations).toHaveLength(2);
    const overloaded = reserveCrossing(second.state, {
      id: 'reservation-3', crossingId: 'bridge', columnId: 'column-3', movementClass: 'COLUMN', loadTonnes: 41,
      arrivalAt: t0, durationMinutes: 20,
    });
    expect(overloaded.status).toBe('BLOCKED');
    expect(overloaded.state.queues.bridge.reservations).toHaveLength(2);
  });

  it('скрытое разрушение не появляется в проекции до наблюдения', () => {
    const damaged = advanceTerrain(state(), {
      operationalAt: t1,
      events: [{ id: 'secret-damage', type: 'terrain.damage.v1', objectId: 'bridge', operationalAt: t1, geometry, reason: 'Скрытое разрушение', causeIds: [], visibility: 'HIDDEN', patch: { status: 'CLOSED' } }],
      profile,
    });
    const before = projectTerrainState(damaged, { sideId: 'blue', observedEventIds: [] });
    expect(before.objects.bridge.status).toBe('OPEN');
    expect(before.quality).toBe('STALE');
    expect(JSON.stringify(before)).not.toContain('Скрытое разрушение');
    const observed = projectTerrainState(damaged, { sideId: 'blue', observedEventIds: ['secret-damage'] });
    expect(observed.objects.bridge.status).toBe('CLOSED');
    expect(observed.quality).toBe('CURRENT');
  });
});
