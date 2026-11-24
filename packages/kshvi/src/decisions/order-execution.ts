export type OrderStatus = 'AWAITING_DELIVERY' | 'DELIVERED' | 'PROCESSING' | 'PREPARING' | 'EXECUTING' | 'REPORTED' | 'CANCELLED_BEFORE_RECEIPT' | 'CANCELLED_AFTER_RECEIPT';
export type OrderOutcome = 'COMPLETED' | 'PARTIALLY_COMPLETED' | 'NOT_COMPLETED' | 'REJECTED' | null;
export type OrderCosts = Readonly<{ timeMinutes: number; resources: Readonly<Record<string, number>> }>;
export type OrderPosition = Readonly<{ remainingMeters: number; travelledMeters: number }>;
export type OrderHistoryEntry = Readonly<{ type: string; at: string; reason?: string }>;
export type OrderExecution = Readonly<{
  id: string; decisionId: string; issuerNodeId: string; executorNodeId: string; sideId: string; issuedAt: string; taskId: string;
  plannedResources: Readonly<Record<string, number>>; receivedAt: string | null; status: OrderStatus; outcome: OrderOutcome; reason: string | null;
  actualCosts: OrderCosts; position: OrderPosition | null; history: readonly OrderHistoryEntry[];
}>;
export type IssueOrderInput = Omit<OrderExecution, 'receivedAt' | 'status' | 'outcome' | 'reason' | 'actualCosts' | 'position' | 'history'>;
export type OrderAction =
  | Readonly<{ type: 'DELIVER' | 'PROCESS' | 'PREPARE'; at: string }>
  | Readonly<{ type: 'START_EXECUTION'; at: string; position?: OrderPosition }>
  | Readonly<{ type: 'RECORD_COST'; at: string; timeMinutes: number; resources: Readonly<Record<string, number>>; position?: OrderPosition }>
  | Readonly<{ type: 'REPORT'; at: string; outcome: Exclude<OrderOutcome, null>; reason: string; position?: OrderPosition }>
  | Readonly<{ type: 'REJECT'; at: string; reason: string }>;

const nextStatus = {
  DELIVER: { from: ['AWAITING_DELIVERY'], to: 'DELIVERED' }, PROCESS: { from: ['DELIVERED'], to: 'PROCESSING' },
  PREPARE: { from: ['PROCESSING'], to: 'PREPARING' }, START_EXECUTION: { from: ['PREPARING'], to: 'EXECUTING' },
} as const;

function validAt(at: string): void { if (!Number.isFinite(Date.parse(at))) throw new Error('Нужно корректное оперативное время действия'); }
function assertChronology(order: OrderExecution, at: string): void {
  const previousAt = order.history.at(-1)?.at;
  if (previousAt && Date.parse(at) < Date.parse(previousAt)) throw new Error('Нарушена хронология действий приказа');
}
function appendHistory(order: OrderExecution, entry: OrderHistoryEntry): OrderHistoryEntry[] { return [...order.history, entry]; }
function validatePosition(position: OrderPosition | undefined): void {
  if (!position) return;
  if (![position.remainingMeters, position.travelledMeters].every(value => Number.isFinite(value) && value >= 0)) throw new Error('Положение на маршруте должно быть неотрицательным');
}
function validatePositionTransition(order: OrderExecution, next: OrderPosition | undefined, at: string, positiveCost = true): void {
  if (!next) return;
  validatePosition(next);
  const previous = order.position;
  if (!previous) {
    if (next.travelledMeters !== 0) throw new Error('Начальная точка маршрута не может содержать уже пройденный путь без прежнего состояния');
    return;
  }
  const routeBefore = previous.remainingMeters + previous.travelledMeters;
  const routeAfter = next.remainingMeters + next.travelledMeters;
  if (Math.abs(routeBefore - routeAfter) > 1e-6 || next.travelledMeters < previous.travelledMeters || next.remainingMeters > previous.remainingMeters) {
    throw new Error('Нарушена монотонность пройденного пути и остатка маршрута');
  }
  const advanced = previous.remainingMeters - next.remainingMeters;
  if (advanced > 0 && (Date.parse(at) <= Date.parse(order.history.at(-1)?.at ?? '') || !positiveCost)) {
    throw new Error('Перемещение требует положительного интервала времени и ненулевых затрат');
  }
}

export function issueOrder(input: IssueOrderInput): OrderExecution {
  validAt(input.issuedAt);
  if (!input.id.trim() || !input.decisionId.trim() || !input.executorNodeId.trim()) throw new Error('Приказ требует идентификаторы решения и исполнителя');
  for (const amount of Object.values(input.plannedResources)) if (!Number.isFinite(amount) || amount < 0) throw new Error('Плановые ресурсы приказа должны быть неотрицательными');
  return Object.freeze({
    ...structuredClone(input), receivedAt: null, status: 'AWAITING_DELIVERY' as const, outcome: null, reason: null,
    actualCosts: Object.freeze({ timeMinutes: 0, resources: Object.freeze({}) }), position: null,
    history: Object.freeze([Object.freeze({ type: 'ISSUE', at: input.issuedAt })]),
  });
}

export function advanceOrder(order: OrderExecution, action: OrderAction): OrderExecution {
  validAt(action.at);
  assertChronology(order, action.at);
  if (order.status.startsWith('CANCELLED') || order.status === 'REPORTED') throw new Error('Завершённый приказ нельзя изменить без новой записи');
  if (action.type === 'REJECT') {
    if (!action.reason.trim()) throw new Error('Отклонение приказа требует причины');
    return Object.freeze({ ...order, status: 'REPORTED' as const, outcome: 'REJECTED' as const, reason: action.reason, history: appendHistory(order, action) });
  }
  if (action.type === 'REPORT') {
    if (order.status !== 'EXECUTING') throw new Error('Доклад возможен только после начала исполнения');
    if (!action.reason.trim()) throw new Error('Результат исполнения требует причины');
    validatePositionTransition(order, action.position, action.at);
    return Object.freeze({ ...order, status: 'REPORTED' as const, outcome: action.outcome, reason: action.reason, position: action.position ?? order.position, history: appendHistory(order, action) });
  }
  if (action.type === 'RECORD_COST') {
    if (!['PREPARING', 'EXECUTING'].includes(order.status)) throw new Error('Затраты фиксируются во время подготовки или исполнения');
    if (!Number.isFinite(action.timeMinutes) || action.timeMinutes < 0) throw new Error('Затраченное время должно быть неотрицательным');
    const resources = { ...order.actualCosts.resources };
    for (const [resourceId, amount] of Object.entries(action.resources)) {
      if (!Number.isFinite(amount) || amount < 0) throw new Error('Фактический расход должен быть неотрицательным');
      resources[resourceId] = (resources[resourceId] ?? 0) + amount;
    }
    validatePositionTransition(order, action.position, action.at, action.timeMinutes > 0);
    return Object.freeze({
      ...order,
      actualCosts: Object.freeze({ timeMinutes: order.actualCosts.timeMinutes + action.timeMinutes, resources: Object.freeze(resources) }),
      position: action.position ?? order.position,
      history: appendHistory(order, action),
    });
  }
  const transition = nextStatus[action.type];
  if (!(transition.from as readonly string[]).includes(order.status)) throw new Error(`Нарушена последовательность приказа: ${order.status}, ${action.type}`);
  if (action.type === 'START_EXECUTION') validatePositionTransition(order, action.position, action.at);
  return Object.freeze({
    ...order, status: transition.to,
    receivedAt: action.type === 'DELIVER' ? action.at : order.receivedAt,
    position: action.type === 'START_EXECUTION' ? action.position ?? order.position : order.position,
    history: appendHistory(order, action),
  });
}

export function cancelOrder(order: OrderExecution, input: { at: string; reason: string }): OrderExecution {
  validAt(input.at);
  assertChronology(order, input.at);
  if (!input.reason.trim()) throw new Error('Отмена приказа требует причины');
  if (order.status === 'REPORTED' || order.status.startsWith('CANCELLED')) throw new Error('Завершённый приказ нельзя отменить повторно');
  return Object.freeze({
    ...order, status: order.receivedAt ? 'CANCELLED_AFTER_RECEIPT' as const : 'CANCELLED_BEFORE_RECEIPT' as const,
    reason: input.reason, actualCosts: structuredClone(order.actualCosts), position: order.position ? { ...order.position } : null,
    history: appendHistory(order, { type: 'CANCEL', at: input.at, reason: input.reason }),
  });
}
