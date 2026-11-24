import { describe, expect, it } from 'vitest';
import {
  appendResourceLedgerEntry,
  projectResourceLedger,
  type ResourceLedgerEntry,
} from '../src/logistics/ledger';
import {
  allocateSupplyRequests,
  changeSupplyPriority,
  createSupplyRequest,
  type SupplyRequest,
  type SupplyTransport,
} from '../src/logistics/supply-request';
import {
  advanceSupply,
  createSupplyMovement,
  supplyTaskEffect,
  type SupplyMovement,
} from '../src/logistics/supply-movement';
import { advanceRepair, requestRepair } from '../src/logistics/repair';

const T0 = '2030-01-01T06:00:00.000Z';
const T1 = '2030-01-01T07:00:00.000Z';

function entry(id: string, operation: ResourceLedgerEntry['operation'], quantity: number | null, overrides: Partial<ResourceLedgerEntry> = {}): ResourceLedgerEntry {
  return {
    id, operation, quantity, resourceId: 'fuel', unit: 'tonne', nodeId: 'warehouse', at: T0,
    causeId: `cause-${id}`, actorId: 'logistics-officer', ...overrides,
  };
}

function transport(id = 'truck-1', capacityQuantity = 60): SupplyTransport {
  return {
    id,
    status: 'SERVICEABLE',
    remainingCapacityQuantity: capacityQuantity,
    remainingWeightTonnes: capacityQuantity,
    remainingVolumeM3: capacityQuantity,
  };
}

function request(id: string, quantity: number, priority: number): SupplyRequest {
  return createSupplyRequest({
    id, resourceId: 'fuel', unit: 'tonne', requesterNodeId: `force-${id}`, sourceNodeId: 'warehouse',
    quantity, totalWeightTonnes: quantity, totalVolumeM3: quantity, priority,
    requiredBy: T1, createdAt: T0, taskIds: [`task-${id}`],
  });
}

function allocatedRequest(): SupplyRequest {
  return { ...request('r1', 60, 5), status: 'ALLOCATED', allocatedQuantity: 60, deficit: 0, orderId: 'order-1' };
}

function newMovement(): SupplyMovement {
  return createSupplyMovement({
    id: 'movement-1', request: allocatedRequest(), transport: transport(), originNodeId: 'warehouse', destinationNodeId: 'force-r1',
    routeLengthMeters: 1000, at: T0,
  });
}

function sentMovement(): { movement: SupplyMovement; entries: ResourceLedgerEntry[] } {
  let movement = newMovement();
  const entries: ResourceLedgerEntry[] = [];
  for (const action of ['PREPARE', 'START_LOADING', 'COMPLETE_LOADING', 'START_MOVEMENT'] as const) {
    const result = advanceSupply(movement, {
      commandId: action, action, at: T0,
      transport: transport(),
      originNode: { id: 'warehouse', remainingStorageCapacity: 1000, throughputQuantityPerHour: 100, queuedQuantity: 0 },
    });
    movement = result.movement;
    entries.push(...result.ledgerEntries);
  }
  return { movement, entries };
}

describe('ресурсный журнал', () => {
  it('связывает списание, запас в пути и поступление без двойного списания', () => {
    let entries: readonly ResourceLedgerEntry[] = [];
    for (const value of [
      entry('open', 'OPENING', 100),
      entry('reserve', 'RESERVE', 40, { supplyId: 's1' }),
      entry('dispatch', 'DISPATCH', 30, { supplyId: 's1' }),
    ]) entries = appendResourceLedgerEntry(entries, value).entries;

    let projection = projectResourceLedger(entries);
    expect(projection.accounts['warehouse|fuel']).toMatchObject({ onHand: 70, reserved: 10, inTransit: 30, consumed: 0, lost: 0 });
    const duplicate = appendResourceLedgerEntry(entries, entry('dispatch', 'DISPATCH', 30, { supplyId: 's1' }));
    expect(duplicate.status).toBe('DUPLICATE');
    expect(duplicate.entries).toHaveLength(3);

    entries = appendResourceLedgerEntry(entries, entry('deliver', 'DELIVER', 30, {
      supplyId: 's1', destinationNodeId: 'force-1', at: T1,
    })).entries;
    projection = projectResourceLedger(entries);
    expect(projection.accounts['warehouse|fuel']).toMatchObject({ onHand: 70, reserved: 10, inTransit: 0 });
    expect(projection.accounts['force-1|fuel']).toMatchObject({ onHand: 30, initial: 0, received: 0 });
  });

  it('запрещает отрицательный остаток, чужой груз и конфликт идемпотентности', () => {
    const opened = appendResourceLedgerEntry([], entry('open', 'OPENING', 10)).entries;
    expect(() => appendResourceLedgerEntry(opened, entry('consume', 'CONSUME', 11))).toThrow('Недостаточно');
    expect(() => appendResourceLedgerEntry(opened, entry('deliver', 'DELIVER', 1, { supplyId: 'foreign', destinationNodeId: 'force' }))).toThrow('поставки');
    expect(() => appendResourceLedgerEntry(opened, entry('open', 'OPENING', 9))).toThrow('идентификатор');
  });

  it('неизвестное не становится нулём, а дефицит не обрезается вместе с остатком', () => {
    const opened = appendResourceLedgerEntry([], entry('open', 'OPENING', 10)).entries;
    const unknown = appendResourceLedgerEntry(opened, entry('unknown', 'CONSUME', null));
    expect(unknown.status).toBe('REQUIRES_REVIEW');
    expect(unknown.entries).toHaveLength(1);
    const consumed = appendResourceLedgerEntry(opened, entry('consume', 'CONSUME', 10, { requestedQuantity: 15, taskId: 'task-1' }));
    expect(consumed.status).toBe('APPLIED');
    const account = projectResourceLedger(consumed.entries).accounts['warehouse|fuel'];
    expect(account).toMatchObject({ onHand: 0, consumed: 10, deficit: 5 });
  });
});

describe('заявки, приоритеты и ёмкость', () => {
  it('распределяет ограниченный ресурс по приоритету без увеличения остатка', () => {
    const result = allocateSupplyRequests([request('low', 40, 1), request('high', 40, 10)], {
      availableQuantity: 50,
      transports: [transport('truck', 100)],
      orderId: 'order-1', at: T0, actorId: 'chief-logistics',
    });
    expect(result.requests.find(item => item.id === 'high')).toMatchObject({ allocatedQuantity: 40, deficit: 0, status: 'ALLOCATED' });
    expect(result.requests.find(item => item.id === 'low')).toMatchObject({ allocatedQuantity: 10, deficit: 30, status: 'PARTIALLY_ALLOCATED' });
    expect(result.allocations.reduce((sum, item) => sum + item.quantity, 0)).toBe(50);
    expect(result.issues.map(item => item.code)).toContain('RESOURCE_DEFICIT');
  });

  it('выявляет превышение транспорта и оформляет частичное выделение', () => {
    const result = allocateSupplyRequests([request('large', 100, 5)], {
      availableQuantity: 100, transports: [transport('truck', 60)], orderId: 'order-1', at: T0, actorId: 'logistics',
    });
    expect(result.requests[0]).toMatchObject({ allocatedQuantity: 60, deficit: 40, status: 'PARTIALLY_ALLOCATED' });
    expect(result.issues.map(item => item.code)).toContain('TRANSPORT_CAPACITY_EXCEEDED');
  });

  it('изменение приоритета оставляет отдельный след и не создаёт ресурс', () => {
    const changed = changeSupplyPriority(request('low', 40, 1), {
      priority: 20, at: T0, actorId: 'chief', basis: 'Приоритет основной задачи',
    });
    expect(changed.priority).toBe(20);
    expect(changed.history.at(-1)).toMatchObject({ previousPriority: 1, priority: 20, basis: 'Приоритет основной задачи' });
    const result = allocateSupplyRequests([changed], { availableQuantity: 10, transports: [transport('truck', 100)], orderId: 'o', at: T0, actorId: 'chief' });
    expect(result.requests[0].allocatedQuantity).toBe(10);
    expect(result.requests[0].deficit).toBe(30);
  });
});

describe('путь поставки', () => {
  it('проходит загрузку, движение, разгрузку и подтверждение: sent не равен delivered', () => {
    let movement = newMovement();
    let entries: readonly ResourceLedgerEntry[] = [];
    for (const action of ['PREPARE', 'START_LOADING', 'COMPLETE_LOADING', 'START_MOVEMENT'] as const) {
      const result = advanceSupply(movement, {
        commandId: action, action, at: T0, transport: transport(),
        originNode: { id: 'warehouse', remainingStorageCapacity: 1000, throughputQuantityPerHour: 100, queuedQuantity: 0 },
      });
      movement = result.movement;
      entries = [...entries, ...result.ledgerEntries];
    }
    expect(movement).toMatchObject({ status: 'IN_TRANSIT', sentQuantity: 60, deliveredQuantity: 0 });
    expect(entries.map(item => item.operation)).toEqual(['RESERVE', 'DISPATCH']);

    let result = advanceSupply(movement, {
      commandId: 'move-1', action: 'MOVE', at: '2030-01-01T06:12:00.000Z', speedKph: 2,
      route: { closed: false, capacityTonnes: 80, loadTonnes: 60, availableColumns: 1 },
    });
    movement = result.movement;
    expect(movement.route).toMatchObject({ travelledMeters: 400, remainingMeters: 600 });
    expect(movement.deliveredQuantity).toBe(0);

    result = advanceSupply(movement, { commandId: 'delay', action: 'DELAY', at: '2030-01-01T06:12:00.000Z', delayMinutes: 30, reason: 'Очередь переправы' });
    movement = result.movement;
    expect(movement).toMatchObject({ status: 'DELAYED', delayMinutes: 30, deliveredQuantity: 0 });

    result = advanceSupply(movement, {
      commandId: 'move-2', action: 'MOVE', at: T1, speedKph: 0.75,
      route: { closed: false, capacityTonnes: 80, loadTonnes: 60, availableColumns: 1 },
    });
    movement = result.movement;
    expect(movement.route.remainingMeters).toBe(0);

    for (const action of ['START_UNLOADING', 'COMPLETE_UNLOADING'] as const) {
      result = advanceSupply(movement, {
        commandId: action, action, at: T1,
        destinationNode: { id: 'force-r1', remainingStorageCapacity: 100, throughputQuantityPerHour: 100, queuedQuantity: 0 },
      });
      movement = result.movement;
      entries = [...entries, ...result.ledgerEntries];
    }
    expect(movement.status).toBe('UNLOADED');
    expect(movement.deliveredQuantity).toBe(0);

    result = advanceSupply(movement, { commandId: 'receipt', action: 'CONFIRM_RECEIPT', at: T1 });
    movement = result.movement;
    entries = [...entries, ...result.ledgerEntries];
    expect(movement).toMatchObject({ status: 'DELIVERED', sentQuantity: 60, deliveredQuantity: 60 });
    expect(entries.at(-1)).toMatchObject({ operation: 'DELIVER', supplyId: 'movement-1', destinationNodeId: 'force-r1' });

    result = advanceSupply(movement, { commandId: 'report', action: 'REPORT', at: T1, reportId: 'supply-report-1' });
    expect(result.movement.reportIds).toEqual(['supply-report-1']);
  });

  it('задерживает закрытую или перегруженную переправу без отката пройденного пути', () => {
    const { movement } = sentMovement();
    const moved = advanceSupply(movement, {
      commandId: 'move', action: 'MOVE', at: '2030-01-01T06:06:00.000Z', speedKph: 2,
      route: { closed: false, capacityTonnes: 80, loadTonnes: 60, availableColumns: 1 },
    });
    const blocked = advanceSupply(moved.movement, {
      commandId: 'overload', action: 'MOVE', at: '2030-01-01T06:06:00.000Z', speedKph: 2,
      route: { closed: false, capacityTonnes: 40, loadTonnes: 60, availableColumns: 1 },
    });
    expect(blocked.movement.status).toBe('BLOCKED');
    expect(blocked.movement.route.travelledMeters).toBe(200);
    expect(blocked.issues.map(item => item.code)).toContain('ROUTE_CAPACITY_EXCEEDED');
  });

  it('отмена после отправки не возвращает груз и не создаёт проводку поступления', () => {
    const { movement } = sentMovement();
    const cancelled = advanceSupply(movement, { commandId: 'cancel', action: 'CANCEL', at: T0, reason: 'Изменение задачи' });
    expect(cancelled.movement.cancellationRequested).toBe(true);
    expect(cancelled.movement.status).toBe('IN_TRANSIT');
    expect(cancelled.movement.sentQuantity).toBe(60);
    expect(cancelled.movement.deliveredQuantity).toBe(0);
    expect(cancelled.ledgerEntries).toEqual([]);
    expect(cancelled.issues.map(item => item.code)).toContain('CARGO_REMAINS_IN_TRANSIT');
  });

  it('повтор команды отправки идемпотентен', () => {
    const { movement, entries } = sentMovement();
    const repeated = advanceSupply(movement, { commandId: 'START_MOVEMENT', action: 'START_MOVEMENT', at: T0 });
    expect(repeated.movement).toEqual(movement);
    expect(repeated.ledgerEntries).toEqual([]);
    expect(entries.filter(item => item.operation === 'DISPATCH')).toHaveLength(1);
  });

  it('парный сценарий SIM-24: задержанный и доставленный подвоз различают задачу', () => {
    const { movement } = sentMovement();
    const delayed = { ...movement, status: 'DELAYED' as const };
    const delivered = { ...movement, status: 'DELIVERED' as const, deliveredQuantity: 60, route: { ...movement.route, remainingMeters: 0, travelledMeters: 1000 } };
    const profile = {
      id: 'supply-task-test', version: 1, status: 'APPROVED' as const, approvedBy: 'Методист',
      delivered: { taskFactor: 1, delayMinutes: 0 }, delayed: { taskFactor: 0.4, delayMinutes: 30 },
    };
    const onTime = supplyTaskEffect(delivered, profile);
    const late = supplyTaskEffect(delayed, profile);
    expect(onTime).toMatchObject({ status: 'CALCULATED', taskFactor: 1, delayMinutes: 0 });
    expect(late).toMatchObject({ status: 'CALCULATED', taskFactor: 0.4, delayMinutes: 30 });
  });
});

describe('ремонт и эвакуация', () => {
  it('связывает неисправность, эвакуацию, запасные части и возврат в строй', () => {
    const equipment = { equipmentId: 'vehicle-1', state: 'DAMAGED' as const, locationNodeId: 'force-1', activeTaskId: null, activeRepairId: null };
    const requested = requestRepair(equipment, {
      id: 'repair-1', faultId: 'fault-1', repairNodeId: 'repair-node', requestedAt: T0, actorId: 'technician',
      requiredParts: [{ resourceId: 'engine-part', unit: 'item', required: 2, available: 2 }],
      repairDurationMinutes: 60,
    });
    expect(requested.request.status).toBe('AWAITING_EVACUATION');
    expect(requested.equipment.activeRepairId).toBe('repair-1');
    const evacuated = advanceRepair(requested.request, requested.equipment, {
      commandId: 'evacuate', action: 'EVACUATE', at: T0, arrived: true, routeClosed: false,
    });
    expect(evacuated.request.status).toBe('READY_FOR_REPAIR');
    const started = advanceRepair(evacuated.request, evacuated.equipment, { commandId: 'start', action: 'START', at: T0 });
    expect(started.request.status).toBe('UNDER_REPAIR');
    expect(started.equipment).toMatchObject({ state: 'UNDER_REPAIR', activeTaskId: null, activeRepairId: 'repair-1' });
    expect(started.ledgerEntries).toHaveLength(1);
    expect(started.ledgerEntries[0]).toMatchObject({ operation: 'CONSUME', resourceId: 'engine-part', quantity: 2 });
    const early = advanceRepair(started.request, started.equipment, { commandId: 'early', action: 'COMPLETE', at: '2030-01-01T06:30:00.000Z', elapsedMinutes: 999 });
    expect(early.request.status).toBe('UNDER_REPAIR');
    const completed = advanceRepair(started.request, started.equipment, { commandId: 'complete', action: 'COMPLETE', at: T1, elapsedMinutes: 60 });
    expect(completed.request.status).toBe('RESTORED');
    expect(completed.equipment).toMatchObject({ state: 'SERVICEABLE', activeRepairId: null, activeTaskId: null });
  });

  it('не допускает одновременное использование в задаче и ремонте', () => {
    const result = requestRepair({ equipmentId: 'vehicle-1', state: 'SERVICEABLE', locationNodeId: 'repair-node', activeTaskId: 'task-1', activeRepairId: null }, {
      id: 'repair-1', faultId: 'fault-1', repairNodeId: 'repair-node', requestedAt: T0, actorId: 'technician', requiredParts: [], repairDurationMinutes: 60,
    });
    expect(result.request.status).toBe('BLOCKED');
    expect(result.equipment.activeTaskId).toBe('task-1');
    expect(result.equipment.activeRepairId).toBeNull();
    expect(result.issues.map(item => item.code)).toContain('EQUIPMENT_IN_TASK');
  });
});
