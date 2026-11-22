import { expect, it } from 'vitest';
import { executeJump } from '../src/runtime/jump';
import { orderActions } from '../src/runtime/queue';
import { advanceMovement } from '../src/simulation/movement';
import { advanceSupply, createSupplyMovement } from '../src/logistics/supply-movement';
import { createSupplyRequest } from '../src/logistics/supply-request';
import { advanceRepair, requestRepair } from '../src/logistics/repair';
import { assertReadyForTask, type ReadinessAuthorization, type ReadinessState } from '../src/forces/readiness';

const T0 = '2030-01-01T06:00:00.000Z';
const route = { closed: false, capacityTonnes: 80, loadTonnes: 60, availableColumns: 1 };

it('C6: конкурентный повтор скачка возвращает один результат и выполняет расчёт один раз', async () => {
  let calculations = 0;
  let snapshots = 0;
  const transaction = {
    jumpId: 'concurrent-jump', instanceId: 'instance-1', targetOperationalAt: '2030-01-02T00:00:00Z', world: { value: 0 },
    calculate: async (world: { value: number }) => {
      calculations += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return { value: world.value + 1 };
    },
    approve: async () => {},
    snapshot: async (world: { value: number }) => { snapshots += 1; return { state: world, hash: 'jump-hash' }; },
    report: async () => {},
  };
  const results = await Promise.all([executeJump(transaction), executeJump(transaction)]);
  expect(results[0]).toEqual(results[1]);
  expect(results[0].world.value).toBe(1);
  expect(calculations).toBe(1);
  expect(snapshots).toBe(1);
});

it('I10: очередь сравнивает моменты времени с разными часовыми поясами', () => {
  const actions = [
    { operationalAt: '2030-01-01T04:00:00Z', priority: 0, dependencyOrder: 0, sequence: 1 },
    { operationalAt: '2030-01-01T06:00:00+03:00', priority: 0, dependencyOrder: 0, sequence: 2 },
  ];
  expect(orderActions(actions).map(action => action.sequence)).toEqual([2, 1]);
});

it('I3: задержка вычитает фактическое время движения', () => {
  const previous = { routeLengthMeters: 10_000, remainingMeters: 10_000, travelledMeters: 0, delayMinutes: 0 };
  const input = { speedKph: 1, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 };
  expect(advanceMovement(previous, { ...input, queueDelayMinutes: 60 }).distanceMeters).toBe(0);
  expect(advanceMovement(previous, { ...input, queueDelayMinutes: 30 }).distanceMeters).toBe(500);
});

function sentSupply() {
  const request = {
    ...createSupplyRequest({
      id: 'request', resourceId: 'fuel', unit: 'tonne', requesterNodeId: 'force', sourceNodeId: 'warehouse', quantity: 1,
      totalWeightTonnes: 1, totalVolumeM3: 1, priority: 1, requiredBy: '2030-01-02T06:00:00.000Z', createdAt: T0, taskIds: [],
    }),
    status: 'ALLOCATED' as const,
    allocatedQuantity: 1,
    deficit: 0,
  };
  const transport = { id: 'truck', status: 'SERVICEABLE' as const, remainingCapacityQuantity: 1, remainingWeightTonnes: 1, remainingVolumeM3: 1 };
  let movement = createSupplyMovement({ id: 'supply', request, transport, originNodeId: 'warehouse', destinationNodeId: 'force', routeLengthMeters: 5000, at: T0 });
  for (const action of ['PREPARE', 'START_LOADING', 'COMPLETE_LOADING', 'START_MOVEMENT'] as const) {
    movement = advanceSupply(movement, {
      commandId: action, action, at: T0, transport,
      originNode: { id: 'warehouse', remainingStorageCapacity: 10, throughputQuantityPerHour: 10, queuedQuantity: 0 },
    }).movement;
  }
  return movement;
}

it('C7: поставка проходит путь по скорости и истёкшему времени, а не по произвольному расстоянию', () => {
  const movement = sentSupply();
  const rejected = advanceSupply(movement, { commandId: 'instant', action: 'MOVE', at: T0, distanceMeters: 5000, route });
  expect(rejected.movement.route.remainingMeters).toBe(5000);
  expect(rejected.issues.map(issue => issue.code)).toContain('INVALID_COMMAND');
  const advanced = advanceSupply(movement, {
    commandId: 'timed', action: 'MOVE', at: '2030-01-01T07:00:00.000Z', speedKph: 2, delayMinutes: 30, route,
  } as never);
  expect(advanced.movement.route.travelledMeters).toBe(1000);
  expect(advanced.movement.route.remainingMeters).toBe(4000);
});

it('C7: ремонт завершается по разнице моментов, игнорируя заявленную длительность', () => {
  const equipment = { equipmentId: 'vehicle', state: 'DAMAGED' as const, locationNodeId: 'repair', activeTaskId: null, activeRepairId: null };
  const requested = requestRepair(equipment, {
    id: 'repair', faultId: 'fault', repairNodeId: 'repair', requestedAt: T0, actorId: 'technician', requiredParts: [], repairDurationMinutes: 60,
  });
  const started = advanceRepair(requested.request, requested.equipment, { commandId: 'start', action: 'START', at: T0 });
  const instant = advanceRepair(started.request, started.equipment, { commandId: 'instant', action: 'COMPLETE', at: T0, elapsedMinutes: 999 });
  expect(instant.request.status).toBe('UNDER_REPAIR');
  expect(instant.equipment.state).toBe('UNDER_REPAIR');
});

function readinessState(authorization: ReadinessAuthorization): ReadinessState {
  return {
    subjectId: 'force', subjectKind: 'FORCE', initialLevel: 0.4, requiredLevel: 0.8, status: 'PARTIAL',
    completedActivityIds: [], activityRecords: [], reports: [], criterionResults: {},
    limitations: [{ code: 'PERSONNEL_SHORTAGE', since: T0, details: 'Недокомплект' }], authorizations: [authorization], history: [],
  };
}

it('I4: разрешение частичной готовности ограничено одним приказом', () => {
  const authorization = {
    decisionId: 'decision', actorId: 'chief', authorized: true, basis: 'Приказ', rationale: 'Продолжить', at: T0,
    orderId: 'order-1', actorRole: 'LEADER', authorities: ['readiness.partial.override'], limitations: ['PERSONNEL_SHORTAGE'],
  } as ReadinessAuthorization;
  const state = readinessState(authorization);
  const profile = {
    id: 'effects', version: 1, status: 'APPROVED' as const, approvedBy: 'chief',
    rules: [{ code: 'PERSONNEL_SHORTAGE' as const, orderProcessingDelayMinutes: 0, capabilityFactor: 1, movementFactor: 1, resourceFactor: 1 }],
  };
  const first = assertReadyForTask({ scenarioState: 'SEALED', readiness: state, allowPartial: true, orderId: 'order-1', profile } as never);
  const second = assertReadyForTask({ scenarioState: 'SEALED', readiness: state, allowPartial: true, orderId: 'order-2', profile } as never);
  expect(first.allowed).toBe(true);
  expect(second.allowed).toBe(false);
});


it('I4: однократное применение разрешения помечает только свой orderId', async () => {
  const { consumePartialReadinessAuthorization } = await import('../src/forces/readiness');
  const authorization = {
    decisionId: 'decision-consume', actorId: 'chief', authorized: true, basis: 'Приказ', rationale: 'Продолжить', at: T0,
    orderId: 'order-1', actorRole: 'LEADER', authorities: ['readiness.partial.override'], limitations: ['PERSONNEL_SHORTAGE'],
  } as ReadinessAuthorization;
  const state = readinessState(authorization);
  const profile = {
    id: 'effects', version: 1, status: 'APPROVED' as const, approvedBy: 'chief',
    rules: [{ code: 'PERSONNEL_SHORTAGE' as const, orderProcessingDelayMinutes: 0, capabilityFactor: 1, movementFactor: 1, resourceFactor: 1 }],
  };
  const first = consumePartialReadinessAuthorization(state, { orderId: 'order-1', profile });
  expect(first.check.allowed).toBe(true);
  expect(first.state.authorizations[0].consumedByOrderId).toBe('order-1');
  const repeated = consumePartialReadinessAuthorization(first.state, { orderId: 'order-1', profile });
  expect(repeated.state).toBe(first.state);
  const other = consumePartialReadinessAuthorization(first.state, { orderId: 'order-2', profile });
  expect(other.check.allowed).toBe(false);
});


it('C7: отклонённая команда поставки не сдвигает checkpoint фактического движения', () => {
  const movement = sentSupply();
  const rejected = advanceSupply(movement, {
    commandId: 'invalid', action: 'MOVE', at: '2030-01-01T06:30:00.000Z', distanceMeters: 5000, route,
  });
  const corrected = advanceSupply(rejected.movement, {
    commandId: 'corrected', action: 'MOVE', at: '2030-01-01T07:00:00.000Z', speedKph: 2, delayMinutes: 30, route,
  } as never);
  expect(corrected.movement.route.travelledMeters).toBe(1000);
});

it('I3: задержка длиннее интервала переносится на следующий интервал', () => {
  const previous = { routeLengthMeters: 10_000, remainingMeters: 10_000, travelledMeters: 0, delayMinutes: 0 };
  const input = { speedKph: 1, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 };
  const first = advanceMovement(previous, { ...input, queueDelayMinutes: 90 });
  expect(first.distanceMeters).toBe(0);
  const second = advanceMovement(first, input);
  expect(second.distanceMeters).toBe(500);
});
