import { describe, expect, it } from 'vitest';
import { advanceMovement, advanceTask, type TaskExecution } from '../src/simulation/movement';

const T0 = '2030-01-01T06:00:00.000Z';

function task(): TaskExecution {
  return {
    id: 'task-e1', elementId: 'e1', orderId: 'order-1', receivedOrderIds: ['order-1'], stage: 'PREPARATION',
    route: { routeLengthMeters: 10000, remainingMeters: 6000, travelledMeters: 4000, delayMinutes: 0 },
    elapsedMinutes: 30,
    resources: [{ entryId: 'consume-1', resourceId: 'fuel', unit: 'tonne', requestedQuantity: 5, consumedQuantity: 5, deficit: 0 }],
    reportIds: [], limitations: [], history: [],
  };
}

describe('движение по остатку пути', () => {
  it('сохраняет пройденный путь при изменении скорости', () => {
    const next = advanceMovement(
      { routeLengthMeters: 10000, remainingMeters: 6000, travelledMeters: 4000, delayMinutes: 0 },
      { speedKph: 30, terrainFactor: 0.5, weatherFactor: 0.8, stateFactor: 1, hours: 1 },
    );
    expect(next.remainingMeters).toBe(0);
    expect(next.travelledMeters).toBe(10000);
    expect(next.arrived).toBe(true);
    expect(next.arrivalEvent?.type).toBe('movement.arrived.v1');
  });

  it('не подставляет коэффициент 1 при обязательном пробеле', () => {
    const previous = { routeLengthMeters: 10000, remainingMeters: 6000, travelledMeters: 4000, delayMinutes: 5 };
    const next = advanceMovement(previous, { speedKph: 30, terrainFactor: null, weatherFactor: 0.8, stateFactor: 1, hours: 1 });
    expect(next.status).toBe('REQUIRES_REVIEW');
    expect(next.unknown).toEqual(['terrainFactor']);
    expect(next.remainingMeters).toBe(6000);
    expect(next.travelledMeters).toBe(4000);
    expect(next.distanceMeters).toBeNull();
  });

  it('парный сценарий SIM-24: только закрытие переправы останавливает движение', () => {
    const previous = { routeLengthMeters: 10000, remainingMeters: 6000, travelledMeters: 4000, delayMinutes: 0 };
    const input = { speedKph: 30, terrainFactor: 0.5, weatherFactor: 0.8, stateFactor: 1, hours: 1 };
    const open = advanceMovement(previous, { ...input, routeStatus: 'OPEN' });
    const closed = advanceMovement(previous, { ...input, routeStatus: 'CLOSED', reason: 'Переправа разрушена' });
    expect(open.travelledMeters).toBeGreaterThan(4000);
    expect(closed).toMatchObject({ status: 'BLOCKED', travelledMeters: 4000, remainingMeters: 6000, arrived: false });
    expect(closed.explanation).toContain('Переправа разрушена');
  });

  it('парный сценарий SIM-24: только погодный коэффициент меняет фактический путь', () => {
    const previous = { routeLengthMeters: 10000, remainingMeters: 6000, travelledMeters: 4000, delayMinutes: 0 };
    const input = { speedKph: 10, terrainFactor: 0.5, stateFactor: 1, hours: 1 };
    const clear = advanceMovement(previous, { ...input, weatherFactor: 1 });
    const rain = advanceMovement(previous, { ...input, weatherFactor: 0.5 });
    expect(rain.travelledMeters).toBeLessThan(clear.travelledMeters);
    expect(rain.routeLengthMeters).toBe(clear.routeLengthMeters);
  });

  it('не утверждает расчёт с неутверждённым профилем коэффициентов', () => {
    const next = advanceMovement(
      { routeLengthMeters: 1000, remainingMeters: 1000, travelledMeters: 0, delayMinutes: 0 },
      { speedKph: 30, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1, profile: { id: 'draft', version: 1, status: 'DRAFT' } },
    );
    expect(next.status).toBe('REQUIRES_REVIEW');
    expect(next.unknown).toContain('profile:notApproved');
    expect(next.travelledMeters).toBe(0);
  });
});

describe('исполнение задачи построения', () => {
  it('новый приказ действует после получения и не отменяет затраченное время и ресурсы', () => {
    const previous = task();
    const early = advanceTask(previous, {
      commandId: 'change-early', action: 'RECEIVE_ORDER', at: T0, orderId: 'order-2', orderReceivedAt: '2030-01-01T07:00:00.000Z', newRemainingMeters: 3000,
    });
    expect(early.task.orderId).toBe('order-1');
    expect(early.task.route.remainingMeters).toBe(6000);
    const received = advanceTask(previous, {
      commandId: 'change', action: 'RECEIVE_ORDER', at: '2030-01-01T07:00:00.000Z', orderId: 'order-2', orderReceivedAt: '2030-01-01T07:00:00.000Z', newRemainingMeters: 3000,
    });
    expect(received.task.orderId).toBe('order-2');
    expect(received.task.route).toMatchObject({ routeLengthMeters: 7000, travelledMeters: 4000, remainingMeters: 3000 });
    expect(received.task.elapsedMinutes).toBe(30);
    expect(received.task.resources).toEqual(previous.resources);
  });

  it('сохраняет частичное исполнение, расход и дефицит без отрицательного остатка', () => {
    const result = advanceTask(task(), {
      commandId: 'advance', action: 'ADVANCE', at: T0,
      movement: { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
      resourceConsumption: { entryId: 'consume-2', resourceId: 'fuel', unit: 'tonne', requestedQuantity: 10, availableQuantity: 4 },
    });
    expect(result.task.stage).toBe('PARTIAL');
    expect(result.task.route.travelledMeters).toBeGreaterThan(4000);
    expect(result.task.route.travelledMeters).toBeLessThan(10000);
    expect(result.task.resources.at(-1)).toMatchObject({ requestedQuantity: 10, consumedQuantity: 4, deficit: 6 });
    expect(result.issues.map(issue => issue.code)).toContain('RESOURCE_DEFICIT');
    const repeated = advanceTask(result.task, {
      commandId: 'advance-2', action: 'ADVANCE', at: T0,
      movement: { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
      resourceConsumption: { entryId: 'consume-2', resourceId: 'fuel', unit: 'tonne', requestedQuantity: 10, availableQuantity: 4 },
    });
    expect(repeated.task.resources.filter(item => item.entryId === 'consume-2')).toHaveLength(1);
  });

  it('неисправность и ремонт останавливают задачу без потери фактического положения', () => {
    const result = advanceTask(task(), {
      commandId: 'repair-stop', action: 'ADVANCE', at: T0,
      movement: { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 },
      equipment: { equipmentId: 'vehicle-1', state: 'UNDER_REPAIR' },
    });
    expect(result.task.stage).toBe('SUSPENDED');
    expect(result.task.route).toEqual(task().route);
    expect(result.issues.map(issue => issue.code)).toContain('EQUIPMENT_NOT_SERVICEABLE');
  });

  it('задержка подвоза и готовность влияют на движение по явным коэффициентам', () => {
    const base = task();
    const movement = { speedKph: 10, terrainFactor: 1, weatherFactor: 1, stateFactor: 1, hours: 1 };
    const supplied = advanceTask(base, {
      commandId: 'supplied', action: 'ADVANCE', at: T0, movement,
      readiness: { orderProcessingDelayMinutes: 0, movementFactor: 1, capabilityFactor: 1, resourceFactor: 1 },
      supply: { taskFactor: 1, delayMinutes: 0 },
    });
    const delayed = advanceTask(base, {
      commandId: 'delayed', action: 'ADVANCE', at: T0, movement,
      readiness: { orderProcessingDelayMinutes: 10, movementFactor: 0.5, capabilityFactor: 0.8, resourceFactor: 0.5 },
      supply: { taskFactor: 0.5, delayMinutes: 30 },
    });
    expect(delayed.task.route.travelledMeters).toBeLessThan(supplied.task.route.travelledMeters);
    expect(delayed.task.route.delayMinutes).toBe(40);
    expect(delayed.task.stage).toBe('PARTIAL');
  });

  it('завершение требует прибытия и доклада, а не смены статуса приказа', () => {
    const arrived: TaskExecution = {
      ...task(), stage: 'EXECUTION',
      route: { routeLengthMeters: 10000, remainingMeters: 0, travelledMeters: 10000, delayMinutes: 0 },
    };
    const withoutReport = advanceTask(arrived, { commandId: 'complete-0', action: 'COMPLETE', at: T0 });
    expect(withoutReport.task.stage).toBe('PARTIAL');
    const completed = advanceTask(arrived, { commandId: 'complete-1', action: 'COMPLETE', at: T0, reportId: 'formation-report-1' });
    expect(completed.task.stage).toBe('COMPLETED');
    expect(completed.task.reportIds).toEqual(['formation-report-1']);
  });
});
