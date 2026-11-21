import { expect, it } from 'vitest';
import { resourceBalanceFromLedger } from '../src/logistics/balance';
import { appendResourceLedgerEntry, projectResourceLedger, type ResourceLedgerEntry } from '../src/logistics/ledger';
import { advanceRepair, requestRepair } from '../src/logistics/repair';
import { formationExecutionStatus, type FormationPlan } from '../src/forces/formation';
import { validateFormation } from '../src/forces/formation-validation';
import { advanceTask, type TaskExecution } from '../src/simulation/movement';

const T0 = '2030-01-01T06:00:00.000Z';
const T1 = '2030-01-01T07:00:00.000Z';

it('AC-23: ёмкость, путь поставки, баланс, ремонт и частичное построение связаны', () => {
  const plan: FormationPlan = {
    id: 'ac23-plan', orderVersion: 1, orderIssuedAt: T0, orderReceivedAt: T0,
    echelons: [
      { id: 'e1', order: 1, forceIds: ['f1'], areaId: 'a1', readyAt: T1, dependsOn: [] },
      { id: 'e2', order: 2, forceIds: ['f2'], areaId: 'a2', readyAt: '2030-01-01T08:00:00.000Z', dependsOn: [] },
    ],
    reserves: [{ id: 'reserve', forceIds: ['f3'], areaId: 'a3', readyAt: '2030-01-01T09:00:00.000Z', dependsOn: [] }],
    supportGroups: [],
    columns: [
      { id: 'c1', echelonId: 'e1', forceIds: ['f1'], routeId: 'road', startAt: T0, endAt: T1, loadTonnes: 50, transportRequired: 3 },
      { id: 'c2', echelonId: 'e2', forceIds: ['f2'], routeId: 'road', startAt: T1, endAt: '2030-01-01T08:00:00.000Z', loadTonnes: 30, transportRequired: 1 },
    ],
    areas: [{ id: 'a1', kind: 'AREA', capacityForces: 1 }, { id: 'a2', kind: 'AREA', capacityForces: 1 }, { id: 'a3', kind: 'AREA', capacityForces: 1 }],
    routes: [{ id: 'road', status: 'OPEN', capacityColumns: 1, crossingCapacityTonnes: 40, intersectsRouteIds: [] }],
    controlPosts: [{ id: 'main', role: 'MAIN', nodeId: 'hq', available: true }, { id: 'alt', role: 'ALTERNATE', nodeId: 'hq-alt', available: true }],
    logistics: { transportAvailable: 2, communicationsAvailable: true, requiredStocks: { fuel: 40 }, availableStocks: { fuel: 100 } },
  };
  const validation = validateFormation(plan);
  expect(validation.valid).toBe(false);
  expect(validation.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['CROSSING_OVERLOAD', 'TRANSPORT_SHORTAGE']));

  const base = { resourceId: 'fuel', unit: 'tonne', nodeId: 'warehouse', at: T0, actorId: 'logistics' };
  const input: ResourceLedgerEntry[] = [
    { ...base, id: 'ac23-open', causeId: 'initial', operation: 'OPENING', quantity: 100 },
    { ...base, id: 'ac23-reserve', causeId: 'ac23-plan', supplyId: 'supply-1', operation: 'RESERVE', quantity: 40 },
    { ...base, id: 'ac23-dispatch', causeId: 'ac23-plan', supplyId: 'supply-1', operation: 'DISPATCH', quantity: 40 },
    { ...base, id: 'ac23-deliver', causeId: 'ac23-plan', supplyId: 'supply-1', destinationNodeId: 'force', operation: 'DELIVER', quantity: 30, at: T1 },
  ];
  let entries: readonly ResourceLedgerEntry[] = [];
  for (const item of input) entries = appendResourceLedgerEntry(entries, item).entries;
  let projection = projectResourceLedger(entries);
  expect(projection.accounts['warehouse|fuel']).toMatchObject({ onHand: 60, inTransit: 10 });
  expect(projection.accounts['force|fuel'].onHand).toBe(30);
  const duplicate = appendResourceLedgerEntry(entries, input[2]);
  expect(duplicate.status).toBe('DUPLICATE');
  expect(duplicate.entries).toHaveLength(4);

  entries = appendResourceLedgerEntry(entries, {
    ...base, id: 'ac23-consume', nodeId: 'force', causeId: 'task-e1', taskId: 'task-e1', operation: 'CONSUME', quantity: 20, requestedQuantity: 25, at: T1,
  }).entries;
  projection = projectResourceLedger(entries);
  const balance = resourceBalanceFromLedger(projection, 'fuel');
  expect(balance).toMatchObject({ expected: 100, actual: 100, balanced: true, deficit: 5 });
  expect(projection.accounts['force|fuel'].onHand).toBe(10);

  const equipment = { equipmentId: 'vehicle-1', state: 'DAMAGED' as const, locationNodeId: 'repair', activeTaskId: null, activeRepairId: null };
  const repair = requestRepair(equipment, {
    id: 'repair-ac23', faultId: 'fault-ac23', repairNodeId: 'repair', requestedAt: T0, actorId: 'technician',
    requiredParts: [{ resourceId: 'parts', unit: 'item', required: 1, available: 1 }], repairDurationMinutes: 60,
  });
  const started = advanceRepair(repair.request, repair.equipment, { commandId: 'start-ac23', action: 'START', at: T0 });
  const route = { routeLengthMeters: 1000, remainingMeters: 600, travelledMeters: 400, delayMinutes: 0 };
  const task: TaskExecution = {
    id: 'task-e1', elementId: 'e1', orderId: 'ac23-plan', receivedOrderIds: ['ac23-plan'], stage: 'PREPARATION', route,
    elapsedMinutes: 30, resources: [], reportIds: [], limitations: [], history: [],
  };
  const stopped = advanceTask(task, {
    commandId: 'stopped-ac23', action: 'ADVANCE', at: T0,
    movement: { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
    equipment: { equipmentId: 'vehicle-1', state: started.equipment.state },
  });
  expect(stopped.task.stage).toBe('SUSPENDED');
  expect(stopped.task.route).toEqual(route);
  const restored = advanceRepair(started.request, started.equipment, { commandId: 'complete-ac23', action: 'COMPLETE', at: T1, elapsedMinutes: 60 });
  expect(restored.equipment.state).toBe('SERVICEABLE');

  const moved = advanceTask(stopped.task, {
    commandId: 'moved-ac23', action: 'ADVANCE', at: T1,
    movement: { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
    equipment: { equipmentId: 'vehicle-1', state: restored.equipment.state },
  });
  expect(moved.task.route.travelledMeters).toBeGreaterThan(400);
  expect(moved.task.route.remainingMeters).toBeLessThan(600);
  expect(moved.task.stage).not.toBe('COMPLETED');

  const execution = formationExecutionStatus(plan, [
    { elementId: 'e1', stage: moved.task.stage, route: moved.task.route, reportIds: [] },
    { elementId: 'e2', stage: 'PREPARATION', route: null, reportIds: [] },
    { elementId: 'reserve', stage: 'PREPARATION', route: null, reportIds: [] },
  ]);
  expect(execution.status).toBe('PARTIAL');
  expect(execution.positions.e1.travelledMeters).toBe(moved.task.route.travelledMeters);
  expect(entries.map(item => item.supplyId).filter(Boolean)).toContain('supply-1');
  expect(started.ledgerEntries[0].causeId).toBe('fault-ac23');
  expect(moved.task.orderId).toBe('ac23-plan');
});
