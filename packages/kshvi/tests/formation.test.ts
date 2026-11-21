import { describe, expect, it } from 'vitest';
import { formationExecutionStatus, type FormationPlan } from '../src/forces/formation';
import { validateFormation } from '../src/forces/formation-validation';

const T0 = '2030-01-01T06:00:00.000Z';
const T1 = '2030-01-01T07:00:00.000Z';
const T2 = '2030-01-01T08:00:00.000Z';
const T3 = '2030-01-01T09:00:00.000Z';

function plan(): FormationPlan {
  return {
    id: 'formation-1', orderVersion: 1, orderIssuedAt: T0, orderReceivedAt: T0,
    echelons: [
      { id: 'e1', order: 1, forceIds: ['f1'], areaId: 'area-1', readyAt: T1, dependsOn: [] },
      { id: 'e2', order: 2, forceIds: ['f2'], areaId: 'area-2', readyAt: T2, dependsOn: [] },
    ],
    reserves: [{ id: 'reserve-1', forceIds: ['f3'], areaId: 'area-3', readyAt: T3, dependsOn: [] }],
    supportGroups: [],
    columns: [
      { id: 'column-1', echelonId: 'e1', forceIds: ['f1'], routeId: 'route-1', startAt: T0, endAt: T1, loadTonnes: 30, transportRequired: 1 },
      { id: 'column-2', echelonId: 'e2', forceIds: ['f2'], routeId: 'route-1', startAt: T1, endAt: T2, loadTonnes: 30, transportRequired: 1 },
    ],
    areas: [
      { id: 'area-1', kind: 'AREA', capacityForces: 1 },
      { id: 'area-2', kind: 'LINE', capacityForces: 1 },
      { id: 'area-3', kind: 'POSITION', capacityForces: 1 },
    ],
    routes: [{ id: 'route-1', status: 'OPEN', capacityColumns: 1, crossingCapacityTonnes: 40, intersectsRouteIds: [] }],
    controlPosts: [
      { id: 'cp-main', role: 'MAIN', nodeId: 'hq-1', available: true },
      { id: 'cp-alt', role: 'ALTERNATE', nodeId: 'hq-2', available: true },
    ],
    logistics: { transportAvailable: 1, communicationsAvailable: true, requiredStocks: { fuel: 20 }, availableStocks: { fuel: 30 } },
  };
}

describe('оперативное построение', () => {
  it('отличает сложное допустимое построение с предупреждением от ошибки', () => {
    const complex: FormationPlan = {
      ...plan(),
      columns: [
        { ...plan().columns[0], routeId: 'route-1' },
        { ...plan().columns[1], routeId: 'route-2' },
      ],
      routes: [
        { id: 'route-1', status: 'OPEN', capacityColumns: 1, crossingCapacityTonnes: 40, intersectsRouteIds: ['route-2'] },
        { id: 'route-2', status: 'OPEN', capacityColumns: 1, crossingCapacityTonnes: 40, intersectsRouteIds: ['route-1'] },
      ],
      logistics: { ...plan().logistics, transportAvailable: 2 },
    };
    const result = validateFormation(complex);
    expect(result.valid).toBe(true);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'ROUTE_INTERSECTION', severity: 'WARNING' }));
  });

  it('запрещает несовместимое назначение одной силы в разные эшелоны', () => {
    const base = plan();
    const invalid: FormationPlan = {
      ...base,
      echelons: [base.echelons[0], { ...base.echelons[1], forceIds: ['f1'] }],
    };
    const result = validateFormation(invalid);
    expect(result.valid).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: 'FORCE_ASSIGNMENT_CONFLICT', severity: 'ERROR' }));
  });

  it('проверяет район, дорогу, переправу, транспорт, запасы, связь и срок доведения', () => {
    const base = plan();
    const invalid: FormationPlan = {
      ...base,
      orderReceivedAt: T1,
      areas: [{ ...base.areas[0], capacityForces: 0 }, ...base.areas.slice(1)],
      columns: [{ ...base.columns[0], startAt: T0, loadTonnes: 50, transportRequired: 2 }, base.columns[1]],
      routes: [{ ...base.routes[0], capacityColumns: 0, crossingCapacityTonnes: 40 }],
      logistics: { transportAvailable: 1, communicationsAvailable: false, requiredStocks: { fuel: 30 }, availableStocks: { fuel: 20 } },
    };
    const codes = validateFormation(invalid).issues.map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining([
      'AREA_CAPACITY_EXCEEDED', 'ROUTE_CAPACITY_EXCEEDED', 'CROSSING_OVERLOAD', 'TRANSPORT_SHORTAGE',
      'SUPPLY_DEFICIT', 'COMMUNICATIONS_UNAVAILABLE', 'ORDER_NOT_DELIVERED_IN_TIME',
    ]));
  });

  it('неизвестная ёмкость требует рассмотрения, а не разрешения по умолчанию', () => {
    const base = plan();
    const result = validateFormation({
      ...base,
      routes: [{ ...base.routes[0], crossingCapacityTonnes: null }],
      logistics: { ...base.logistics, availableStocks: { fuel: null } },
    });
    expect(result.valid).toBe(false);
    expect(result.requiresReview).toBe(true);
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['CROSSING_CAPACITY_UNKNOWN', 'SUPPLY_UNKNOWN']));
  });

  it('сохраняет частичное построение и фактический участок неприбывшей колонны', () => {
    const current = plan();
    const result = formationExecutionStatus(current, [
      { elementId: 'e1', stage: 'COMPLETED', route: { routeLengthMeters: 1000, remainingMeters: 0, travelledMeters: 1000, delayMinutes: 0 }, reportIds: ['report-1'] },
      { elementId: 'e2', stage: 'PARTIAL', route: { routeLengthMeters: 1000, remainingMeters: 400, travelledMeters: 600, delayMinutes: 20 }, reportIds: [] },
      { elementId: 'reserve-1', stage: 'PREPARATION', route: null, reportIds: [] },
    ]);
    expect(result.status).toBe('PARTIAL');
    expect(result.completedElementIds).toEqual(['e1']);
    expect(result.pendingElementIds).toEqual(['e2', 'reserve-1']);
    expect(result.positions['e2']).toMatchObject({ remainingMeters: 400, travelledMeters: 600 });
    expect(result.reportIds).toEqual(['report-1']);
  });
});
