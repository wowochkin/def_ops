import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { formationExecutionStatus, type FormationPlan } from '../../../../packages/kshvi/src/forces/formation';
import { validateFormation } from '../../../../packages/kshvi/src/forces/formation-validation';
import { resourceBalanceFromLedger } from '../../../../packages/kshvi/src/logistics/balance';
import { appendResourceLedgerEntry, projectResourceLedger, type ResourceLedgerEntry } from '../../../../packages/kshvi/src/logistics/ledger';
import { advanceRepair, requestRepair } from '../../../../packages/kshvi/src/logistics/repair';
import { advanceSupply, createSupplyMovement, type SupplyMovement } from '../../../../packages/kshvi/src/logistics/supply-movement';
import { allocateSupplyRequests, changeSupplyPriority, createSupplyRequest, type SupplyRequest, type SupplyTransport } from '../../../../packages/kshvi/src/logistics/supply-request';
import { advanceTask, type TaskExecution } from '../../../../packages/kshvi/src/simulation/movement';
import { hashCanonical } from '../../../../packages/kshvi/src/scenario/initial-map-hash';

const T0 = '2030-01-01T06:00:00.000Z';
const T1 = '2030-01-01T07:00:00.000Z';
const T2 = '2030-01-01T08:00:00.000Z';

function formationPlan(): FormationPlan {
  return {
    id: 'ac23-plan', orderVersion: 1, orderIssuedAt: T0, orderReceivedAt: T0,
    echelons: [
      { id: 'e1', order: 1, forceIds: ['f1'], areaId: 'a1', readyAt: T1, dependsOn: [] },
      { id: 'e2', order: 2, forceIds: ['f2'], areaId: 'a2', readyAt: T2, dependsOn: [] },
    ],
    reserves: [{ id: 'reserve', forceIds: ['f3'], areaId: 'a3', readyAt: '2030-01-01T09:00:00.000Z', dependsOn: [] }], supportGroups: [],
    columns: [
      { id: 'c1', echelonId: 'e1', forceIds: ['f1'], routeId: 'road', startAt: T0, endAt: T1, loadTonnes: 50, transportRequired: 3 },
      { id: 'c2', echelonId: 'e2', forceIds: ['f2'], routeId: 'road', startAt: T1, endAt: T2, loadTonnes: 30, transportRequired: 1 },
    ],
    areas: [{ id: 'a1', kind: 'AREA', capacityForces: 1 }, { id: 'a2', kind: 'AREA', capacityForces: 1 }, { id: 'a3', kind: 'AREA', capacityForces: 1 }],
    routes: [{ id: 'road', status: 'OPEN', capacityColumns: 1, crossingCapacityTonnes: 40, intersectsRouteIds: [] }],
    controlPosts: [{ id: 'main', role: 'MAIN', nodeId: 'hq', available: true }, { id: 'alt', role: 'ALTERNATE', nodeId: 'hq-alt', available: true }],
    logistics: { transportAvailable: 2, communicationsAvailable: true, requiredStocks: { fuel: 40 }, availableStocks: { fuel: 100 } },
  };
}
function request(id: string, priority: number): SupplyRequest {
  return createSupplyRequest({
    id, resourceId: 'fuel', unit: 'tonne', requesterNodeId: `force-${id}`, sourceNodeId: 'warehouse',
    quantity: 40, totalWeightTonnes: 40, totalVolumeM3: 40, priority, requiredBy: T1, createdAt: T0, taskIds: [`task-${id}`],
  });
}
const transport: SupplyTransport = { id: 'truck-ac23', status: 'SERVICEABLE', remainingCapacityQuantity: 60, remainingWeightTonnes: 60, remainingVolumeM3: 60 };

it('AC-23: исправленное построение, путь поставки, баланс и ремонт образуют один причинный журнал', { timeout: 120_000 }, async () => {
  const invalidPlan = formationPlan();
  const invalid = validateFormation(invalidPlan);
  expect(invalid.valid).toBe(false);
  expect(invalid.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['CROSSING_OVERLOAD', 'TRANSPORT_SHORTAGE']));
  const draft = formationPlan();
  const plan: FormationPlan = {
    ...draft,
    columns: draft.columns.map((column, index) => index === 0 ? { ...column, loadTonnes: 40 } : column),
    logistics: { ...draft.logistics, transportAvailable: 3 },
  };
  const validation = validateFormation(plan);
  expect(validation.valid).toBe(true);

  const prioritized = changeSupplyPriority(request('low', 1), { priority: 20, at: T0, actorId: 'chief-logistics', basis: 'Приоритет первого эшелона' });
  const allocation = allocateSupplyRequests([request('high', 10), prioritized], {
    availableQuantity: 50, transports: [transport], orderId: plan.id, at: T0, actorId: 'chief-logistics',
  });
  const low = allocation.requests.find(item => item.id === 'low')!;
  const high = allocation.requests.find(item => item.id === 'high')!;
  expect(low).toMatchObject({ status: 'ALLOCATED', allocatedQuantity: 40, deficit: 0 });
  expect(high).toMatchObject({ status: 'PARTIALLY_ALLOCATED', allocatedQuantity: 10, deficit: 30 });
  expect(allocation.allocations.reduce((sum, item) => sum + item.quantity, 0)).toBe(50);
  expect(prioritized.history.at(-1)).toMatchObject({ previousPriority: 1, priority: 20, basis: 'Приоритет первого эшелона' });

  let movement: SupplyMovement = createSupplyMovement({
    id: 'supply-ac23', request: low, transport, originNodeId: 'warehouse', destinationNodeId: 'force-low', routeLengthMeters: 1000, at: T0,
  });
  let entries: readonly ResourceLedgerEntry[] = [{
    id: 'opening-ac23', causeId: 'initial-ac23', operation: 'OPENING', quantity: 100,
    resourceId: 'fuel', unit: 'tonne', nodeId: 'warehouse', at: T0, actorId: 'logistics-ac23',
  }];
  const supplyHistory: unknown[] = [];
  const apply = (result: ReturnType<typeof advanceSupply>) => {
    movement = result.movement;
    for (const entry of result.ledgerEntries) entries = appendResourceLedgerEntry(entries, entry).entries;
    supplyHistory.push({ status: movement.status, route: movement.route, sent: movement.sentQuantity, delivered: movement.deliveredQuantity, reports: movement.reportIds });
  };
  for (const action of ['PREPARE', 'START_LOADING', 'COMPLETE_LOADING', 'START_MOVEMENT'] as const) {
    apply(advanceSupply(movement, {
      commandId: `ac23-${action}`, action, at: T0, transport,
      originNode: { id: 'warehouse', remainingStorageCapacity: 1000, throughputQuantityPerHour: 100, queuedQuantity: 0 },
    }));
  }
  expect(movement).toMatchObject({ status: 'IN_TRANSIT', sentQuantity: 40, deliveredQuantity: 0 });
  let projection = projectResourceLedger(entries);
  expect(projection.accounts['warehouse|fuel']).toMatchObject({ onHand: 60, inTransit: 40 });
  const dispatchCount = entries.filter(entry => entry.operation === 'DISPATCH').length;
  apply(advanceSupply(movement, { commandId: 'ac23-START_MOVEMENT', action: 'START_MOVEMENT', at: T0 }));
  expect(entries.filter(entry => entry.operation === 'DISPATCH')).toHaveLength(dispatchCount);

  apply(advanceSupply(movement, {
    commandId: 'ac23-move-1', action: 'MOVE', at: '2030-01-01T06:12:00.000Z', speedKph: 2,
    route: { closed: false, capacityTonnes: 80, loadTonnes: 40, availableColumns: 1 },
  }));
  expect(movement.route.travelledMeters).toBe(400);
  apply(advanceSupply(movement, { commandId: 'ac23-delay', action: 'DELAY', at: '2030-01-01T06:12:00.000Z', delayMinutes: 30, reason: 'Очередь переправы' }));
  expect(movement).toMatchObject({ status: 'DELAYED', delayMinutes: 30, deliveredQuantity: 0 });
  apply(advanceSupply(movement, {
    commandId: 'ac23-move-2', action: 'MOVE', at: T1, speedKph: 0.75,
    route: { closed: false, capacityTonnes: 80, loadTonnes: 40, availableColumns: 1 },
  }));
  expect(movement.route.remainingMeters).toBe(0);
  for (const action of ['START_UNLOADING', 'COMPLETE_UNLOADING'] as const) {
    apply(advanceSupply(movement, {
      commandId: `ac23-${action}`, action, at: T1,
      destinationNode: { id: 'force-low', remainingStorageCapacity: 100, throughputQuantityPerHour: 100, queuedQuantity: 0 },
    }));
  }
  apply(advanceSupply(movement, { commandId: 'ac23-receipt', action: 'CONFIRM_RECEIPT', at: T1 }));
  apply(advanceSupply(movement, { commandId: 'ac23-report', action: 'REPORT', at: T1, reportId: 'supply-report-ac23' }));
  expect(movement).toMatchObject({ status: 'DELIVERED', sentQuantity: 40, deliveredQuantity: 40, reportIds: ['supply-report-ac23'] });

  entries = appendResourceLedgerEntry(entries, {
    id: 'consume-ac23', causeId: 'task-e1', taskId: 'task-e1', operation: 'CONSUME', quantity: 20, requestedQuantity: 25,
    resourceId: 'fuel', unit: 'tonne', nodeId: 'force-low', at: T1, actorId: 'logistics-ac23',
  }).entries;
  projection = projectResourceLedger(entries);
  expect(projection.accounts['force-low|fuel']).toMatchObject({ onHand: 20, consumed: 20, deficit: 5 });
  const balance = resourceBalanceFromLedger(projection, 'fuel');
  expect(balance).toMatchObject({ expected: 100, actual: 100, balanced: true, deficit: 5, inTransit: 0 });
  const unknown = appendResourceLedgerEntry(entries, {
    id: 'unknown-ac23', causeId: 'task-e1', operation: 'CONSUME', quantity: null,
    resourceId: 'fuel', unit: 'tonne', nodeId: 'force-low', at: T1, actorId: 'logistics-ac23',
  });
  expect(unknown.status).toBe('REQUIRES_REVIEW');
  expect(unknown.entries).toHaveLength(entries.length);

  const equipment = { equipmentId: 'vehicle-ac23', state: 'DAMAGED' as const, locationNodeId: 'repair', activeTaskId: null, activeRepairId: null };
  const requestedRepair = requestRepair(equipment, {
    id: 'repair-ac23', faultId: 'fault-ac23', repairNodeId: 'repair', requestedAt: T0, actorId: 'technician-ac23',
    requiredParts: [{ resourceId: 'parts', unit: 'item', required: 1, available: 1 }], repairDurationMinutes: 60,
  });
  const startedRepair = advanceRepair(requestedRepair.request, requestedRepair.equipment, { commandId: 'repair-start-ac23', action: 'START', at: T0 });
  const taskRoute = { routeLengthMeters: 1000, remainingMeters: 600, travelledMeters: 400, delayMinutes: 0 };
  const task: TaskExecution = {
    id: 'task-e1', elementId: 'e1', orderId: plan.id, receivedOrderIds: [plan.id], stage: 'PREPARATION', route: taskRoute,
    elapsedMinutes: 30, resources: [], reportIds: [], limitations: [], history: [],
  };
  const stopped = advanceTask(task, {
    commandId: 'task-stopped-ac23', action: 'ADVANCE', at: T0,
    movement: { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
    equipment: { equipmentId: equipment.equipmentId, state: startedRepair.equipment.state },
  });
  expect(stopped.task.stage).toBe('SUSPENDED');
  expect(stopped.task.route).toEqual(taskRoute);
  const earlyRepair = advanceRepair(startedRepair.request, startedRepair.equipment, { commandId: 'repair-early-ac23', action: 'COMPLETE', at: '2030-01-01T06:30:00.000Z', elapsedMinutes: 999 });
  expect(earlyRepair.request.status).toBe('UNDER_REPAIR');
  const restored = advanceRepair(startedRepair.request, startedRepair.equipment, { commandId: 'repair-complete-ac23', action: 'COMPLETE', at: T1, elapsedMinutes: 60 });
  expect(restored.equipment.state).toBe('SERVICEABLE');
  const moved = advanceTask(stopped.task, {
    commandId: 'task-moved-ac23', action: 'ADVANCE', at: T1,
    movement: { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
    equipment: { equipmentId: equipment.equipmentId, state: restored.equipment.state },
  });
  expect(moved.task.route.travelledMeters).toBeGreaterThan(400);
  expect(moved.task.route.remainingMeters).toBeLessThan(600);
  expect(moved.task.orderId).toBe(plan.id);

  const formation = formationExecutionStatus(plan, [
    { elementId: 'e1', stage: moved.task.stage, route: moved.task.route, reportIds: ['supply-report-ac23'] },
    { elementId: 'e2', stage: 'PREPARATION', route: null, reportIds: [] },
    { elementId: 'reserve', stage: 'PREPARATION', route: null, reportIds: [] },
  ]);
  expect(formation.status).toBe('PARTIAL');
  expect(formation.positions.e1.travelledMeters).toBe(moved.task.route.travelledMeters);
  expect(resourceBalanceFromLedger(projectResourceLedger(entries), 'fuel')).toEqual(balance);

  const runId = process.env.KSHVI_ACCEPTANCE_RUN_ID;
  if (!runId) return;
  const directory = 'docs/release/kshvi/evidence/ac23';
  await mkdir(directory, { recursive: true });
  const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const initialRevision = { id: plan.id, revision: plan.orderVersion, sha256: hashCanonical(plan) };
  const journalPath = `${directory}/journal.json`;
  const balancePath = `${directory}/balance.json`;
  const protocolPath = `${directory}/protocol.txt`;
  const metricsPath = `${directory}/metrics.json`;
  const journal = JSON.parse(JSON.stringify({
    runId, commit, invalidPlan: invalid.issues, plan, validation, allocation, supplyHistory,
    ledger: entries, repair: { requestedRepair, startedRepair, earlyRepair, restored },
    stoppedTask: stopped.task, movedTask: moved.task, formation,
  }));
  const journalSha256 = hashCanonical(journal);
  const metrics = {
    rejectedCapacityIssues: invalid.issues.filter(issue => issue.severity === 'ERROR').length,
    allocatedQuantity: allocation.allocations.reduce((sum, item) => sum + item.quantity, 0),
    sentQuantity: movement.sentQuantity, deliveredQuantity: movement.deliveredQuantity, inTransitAfterDelivery: balance.inTransit,
    deficit: balance.deficit, ledgerEntries: entries.length, repairedEquipment: 1, partialFormation: 1,
  };
  await writeFile(journalPath, JSON.stringify(journal, null, 2));
  await writeFile(balancePath, JSON.stringify({ projection, balance }, null, 2));
  await writeFile(metricsPath, JSON.stringify(metrics, null, 2));
  await writeFile(protocolPath, `AC-23 завершён\nrunId: ${runId}\ncommit: ${commit}\nНевалидное построение отклонено до исполнения; после исправления поставка прошла загрузку, маршрут, задержку, разгрузку и доклад; баланс сошёлся; ремонт остановил и затем возобновил задачу; частичное построение сохранено.\n`);
  await writeFile('docs/release/kshvi/acceptance/AC-23.proof.json', JSON.stringify({
    runId, commit, initialRevision,
    journal: { path: journalPath, sha256: journalSha256, eventCount: entries.length },
    hashes: { scenario: initialRevision.sha256, environment: hashCanonical({ routes: plan.routes, stocks: plan.logistics }), journal: journalSha256 },
    protocols: [protocolPath], screenshots: [], metrics,
    limitations: ['Причинный доменный сценарий и реплей проводок подтверждены; распределённый запуск на отдельных рабочих местах входит в нагрузочный и fresh-install контур.'],
    artifacts: [journalPath, balancePath, protocolPath, metricsPath],
  }, null, 2));
});
