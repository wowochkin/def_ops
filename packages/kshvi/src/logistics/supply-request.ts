export type SupplyRequestStatus = 'REQUESTED' | 'ALLOCATED' | 'PARTIALLY_ALLOCATED' | 'BLOCKED' | 'REQUIRES_REVIEW' | 'CANCELLED';

export type SupplyPriorityChange = Readonly<{
  at: string;
  actorId: string;
  basis: string;
  previousPriority: number;
  priority: number;
}>;

export type SupplyRequest = Readonly<{
  id: string;
  resourceId: string;
  unit: string;
  requesterNodeId: string;
  sourceNodeId: string;
  quantity: number;
  totalWeightTonnes: number | null;
  totalVolumeM3: number | null;
  priority: number;
  requiredBy: string;
  createdAt: string;
  taskIds: readonly string[];
  status: SupplyRequestStatus;
  allocatedQuantity: number;
  deficit: number;
  orderId?: string;
  allocationIds?: readonly string[];
  history: readonly SupplyPriorityChange[];
}>;

export type SupplyTransport = Readonly<{
  id: string;
  status: 'SERVICEABLE' | 'DEGRADED' | 'UNDER_REPAIR' | 'DAMAGED' | 'DESTROYED';
  remainingCapacityQuantity: number | null;
  remainingWeightTonnes: number | null;
  remainingVolumeM3: number | null;
}>;

export type SupplyNode = Readonly<{
  id: string;
  remainingStorageCapacity: number | null;
  throughputQuantityPerHour: number | null;
  queuedQuantity: number;
}>;

export type SupplyAllocation = Readonly<{
  id: string;
  requestId: string;
  transportId: string;
  resourceId: string;
  unit: string;
  quantity: number;
  weightTonnes: number;
  volumeM3: number;
}>;

export type SupplyIssue = Readonly<{
  code: 'RESOURCE_DEFICIT' | 'TRANSPORT_CAPACITY_EXCEEDED' | 'RESOURCE_UNKNOWN' | 'TRANSPORT_UNKNOWN' | 'INVALID_REQUEST';
  requestId?: string;
  message: string;
}>;

export function createSupplyRequest(input: Readonly<{
  id: string;
  resourceId: string;
  unit: string;
  requesterNodeId: string;
  sourceNodeId: string;
  quantity: number;
  totalWeightTonnes: number | null;
  totalVolumeM3: number | null;
  priority: number;
  requiredBy: string;
  createdAt: string;
  taskIds: readonly string[];
}>): SupplyRequest {
  if (!input.id.trim() || !input.resourceId.trim() || !input.unit.trim() || !Number.isFinite(input.quantity) || input.quantity <= 0) {
    throw new Error('Заявка требует идентификатор, номенклатуру, единицу и положительное количество');
  }
  if (!Number.isFinite(input.priority) || !Number.isFinite(Date.parse(input.requiredBy)) || !Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error('Заявка требует приоритет и корректные сроки');
  }
  return { ...input, taskIds: [...input.taskIds], status: 'REQUESTED', allocatedQuantity: 0, deficit: input.quantity, history: [] };
}

export function changeSupplyPriority(request: SupplyRequest, change: Readonly<{
  priority: number;
  at: string;
  actorId: string;
  basis: string;
}>): SupplyRequest {
  if (!Number.isFinite(change.priority) || !change.actorId.trim() || !change.basis.trim() || !Number.isFinite(Date.parse(change.at))) {
    throw new Error('Изменение приоритета требует значение, исполнителя, основание и время');
  }
  return {
    ...request,
    priority: change.priority,
    history: [...request.history, { previousPriority: request.priority, priority: change.priority, at: change.at, actorId: change.actorId, basis: change.basis }],
  };
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

/** Выделение сортирует заявки, но расходует только переданный остаток и ёмкость транспорта. */
export function allocateSupplyRequests(requests: readonly SupplyRequest[], input: Readonly<{
  availableQuantity: number | null;
  transports: readonly SupplyTransport[];
  orderId: string;
  at: string;
  actorId: string;
}>): Readonly<{
  requests: readonly SupplyRequest[];
  allocations: readonly SupplyAllocation[];
  transports: readonly SupplyTransport[];
  issues: readonly SupplyIssue[];
}> {
  if (!input.orderId.trim() || !input.actorId.trim() || !Number.isFinite(Date.parse(input.at))) throw new Error('Выделение требует приказ, исполнителя и время');
  const resource = requests[0]?.resourceId;
  const unit = requests[0]?.unit;
  if (requests.some(request => request.resourceId !== resource || request.unit !== unit)) throw new Error('Одно выделение выполняется для одной номенклатуры и единицы');
  const issues: SupplyIssue[] = [];
  if (input.availableQuantity === null || !Number.isFinite(input.availableQuantity) || (input.availableQuantity ?? -1) < 0) {
    return {
      requests: requests.map(request => ({ ...request, status: 'REQUIRES_REVIEW' as const })),
      allocations: [], transports: input.transports,
      issues: [{ code: 'RESOURCE_UNKNOWN', message: 'Доступный остаток неизвестен; нулём он не заменяется' }],
    };
  }
  if (input.transports.some(item => [item.remainingCapacityQuantity, item.remainingWeightTonnes, item.remainingVolumeM3].some(value => value === null || !Number.isFinite(value)))) {
    return {
      requests: requests.map(request => ({ ...request, status: 'REQUIRES_REVIEW' as const })),
      allocations: [], transports: input.transports,
      issues: [{ code: 'TRANSPORT_UNKNOWN', message: 'Ёмкость транспорта неизвестна' }],
    };
  }

  let stock = input.availableQuantity;
  const transports = input.transports.map(item => ({ ...item })) as Array<{ -readonly [K in keyof SupplyTransport]: SupplyTransport[K] }>;
  const allocations: SupplyAllocation[] = [];
  const sorted = [...requests].sort((a, b) => b.priority - a.priority || a.requiredBy.localeCompare(b.requiredBy) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const nextRequests = sorted.map(request => {
    if (request.status === 'CANCELLED') return request;
    if (request.totalWeightTonnes === null || request.totalVolumeM3 === null || request.totalWeightTonnes < 0 || request.totalVolumeM3 < 0) {
      issues.push({ code: 'INVALID_REQUEST', requestId: request.id, message: 'Масса или объём заявки неизвестны' });
      return { ...request, status: 'REQUIRES_REVIEW' as const, allocatedQuantity: 0, deficit: request.quantity, orderId: input.orderId, allocationIds: [] };
    }
    const weightPerUnit = request.totalWeightTonnes / request.quantity;
    const volumePerUnit = request.totalVolumeM3 / request.quantity;
    let remaining = request.quantity;
    const allocationIds: string[] = [];
    for (const vehicle of transports) {
      if (remaining <= 1e-9 || stock <= 1e-9) break;
      if (vehicle.status !== 'SERVICEABLE' && vehicle.status !== 'DEGRADED') continue;
      const byWeight = weightPerUnit === 0 ? remaining : vehicle.remainingWeightTonnes! / weightPerUnit;
      const byVolume = volumePerUnit === 0 ? remaining : vehicle.remainingVolumeM3! / volumePerUnit;
      const quantity = round(Math.max(0, Math.min(remaining, stock, vehicle.remainingCapacityQuantity!, byWeight, byVolume)));
      if (quantity <= 0) continue;
      const id = `allocation:${input.orderId}:${request.id}:${vehicle.id}`;
      allocations.push({
        id, requestId: request.id, transportId: vehicle.id, resourceId: request.resourceId, unit: request.unit,
        quantity, weightTonnes: round(quantity * weightPerUnit), volumeM3: round(quantity * volumePerUnit),
      });
      allocationIds.push(id);
      vehicle.remainingCapacityQuantity = round(vehicle.remainingCapacityQuantity! - quantity);
      vehicle.remainingWeightTonnes = round(vehicle.remainingWeightTonnes! - quantity * weightPerUnit);
      vehicle.remainingVolumeM3 = round(vehicle.remainingVolumeM3! - quantity * volumePerUnit);
      stock = round(stock - quantity);
      remaining = round(remaining - quantity);
    }
    const allocatedQuantity = round(request.quantity - remaining);
    if (remaining > 1e-9) {
      if (stock <= 1e-9) issues.push({ code: 'RESOURCE_DEFICIT', requestId: request.id, message: `Не удовлетворено ${remaining} ${request.unit}; задачи: ${request.taskIds.join(', ')}` });
      if (stock > 1e-9 || transports.every(vehicle => vehicle.remainingCapacityQuantity! <= 1e-9)) {
        issues.push({ code: 'TRANSPORT_CAPACITY_EXCEEDED', requestId: request.id, message: `Недостаточно транспорта для ${remaining} ${request.unit}` });
      }
    }
    return {
      ...request,
      status: remaining <= 1e-9 ? 'ALLOCATED' as const : allocatedQuantity > 0 ? 'PARTIALLY_ALLOCATED' as const : 'BLOCKED' as const,
      allocatedQuantity,
      deficit: round(Math.max(0, remaining)),
      orderId: input.orderId,
      allocationIds,
    };
  });
  return { requests: nextRequests, allocations, transports, issues };
}

export type SupplyPlan = Readonly<{
  id: string;
  actionPlanVersion: number;
  linkedActionPlanVersion: number;
  requests: readonly SupplyRequest[];
  actionTasks: readonly Readonly<{ taskId: string; resourceId: string; requiredQuantity: number; requiredBy: string }>[];
  routes: readonly Readonly<{ routeId: string; requestIds: readonly string[]; status: 'OPEN' | 'CLOSED' | 'UNKNOWN' }>[];
  reserves: Readonly<Record<string, number | null>>;
  reportingSchedule: readonly Readonly<{ taskId: string; reportAt: string }>[];
  approved: boolean;
}>;

export type SupplyPlanIssue = Readonly<{
  code: 'PLAN_VERSION_MISMATCH' | 'UNCOVERED_TASK' | 'REQUEST_QUANTITY_SHORTAGE' | 'REQUEST_LATE' | 'ROUTE_MISSING' | 'ROUTE_UNAVAILABLE' | 'RESERVE_NOT_PLANNED' | 'RESERVE_UNKNOWN' | 'REPORT_SCHEDULE_MISSING' | 'PLAN_NOT_CONSISTENT';
  severity: 'ERROR' | 'REVIEW';
  message: string;
  refs: readonly string[];
}>;

/** Сверка решения и МТО до утверждения; заявки, маршруты, резерв и доклады должны покрывать задачи. */
export function validateSupplyPlan(plan: SupplyPlan): Readonly<{ valid: boolean; issues: readonly SupplyPlanIssue[] }> {
  const issues: SupplyPlanIssue[] = [];
  const add = (code: SupplyPlanIssue['code'], severity: SupplyPlanIssue['severity'], message: string, refs: readonly string[] = []): void => {
    issues.push({ code, severity, message, refs });
  };
  if (plan.actionPlanVersion !== plan.linkedActionPlanVersion) {
    add('PLAN_VERSION_MISMATCH', 'ERROR', `План МТО ссылается на редакцию ${plan.linkedActionPlanVersion} вместо ${plan.actionPlanVersion}`, [plan.id]);
  }
  for (const task of plan.actionTasks) {
    const requests = plan.requests.filter(request => request.taskIds.includes(task.taskId) && request.resourceId === task.resourceId);
    if (!requests.length) add('UNCOVERED_TASK', 'ERROR', `Задача ${task.taskId} не обеспечена заявкой ${task.resourceId}`, [task.taskId, task.resourceId]);
    const allocated = requests.reduce((sumValue, request) => sumValue + request.allocatedQuantity, 0);
    if (allocated < task.requiredQuantity) add('REQUEST_QUANTITY_SHORTAGE', 'ERROR', `Для ${task.taskId} выделено ${allocated} из ${task.requiredQuantity} ${task.resourceId}`, [task.taskId, task.resourceId]);
    for (const request of requests) {
      if (Date.parse(request.requiredBy) > Date.parse(task.requiredBy)) add('REQUEST_LATE', 'ERROR', `Заявка ${request.id} запаздывает к сроку задачи ${task.taskId}`, [request.id, task.taskId]);
      const routes = plan.routes.filter(route => route.requestIds.includes(request.id));
      if (!routes.length) add('ROUTE_MISSING', 'ERROR', `Для заявки ${request.id} не назначен маршрут`, [request.id]);
      for (const route of routes) {
        if (route.status !== 'OPEN') add('ROUTE_UNAVAILABLE', route.status === 'UNKNOWN' ? 'REVIEW' : 'ERROR', `Маршрут ${route.routeId} не подтверждён как открытый`, [request.id, route.routeId]);
      }
    }
    if (!plan.reportingSchedule.some(item => item.taskId === task.taskId && Number.isFinite(Date.parse(item.reportAt)))) {
      add('REPORT_SCHEDULE_MISSING', 'ERROR', `Для ${task.taskId} не задан порядок докладов`, [task.taskId]);
    }
  }
  for (const resourceId of [...new Set(plan.actionTasks.map(task => task.resourceId))]) {
    const reserve = plan.reserves[resourceId];
    if (reserve === null) add('RESERVE_UNKNOWN', 'REVIEW', `Резерв ${resourceId} неизвестен`, [resourceId]);
    else if (reserve === undefined || !Number.isFinite(reserve) || reserve < 0) add('RESERVE_NOT_PLANNED', 'ERROR', `Не назначен резерв ${resourceId}`, [resourceId]);
  }
  if (plan.approved && issues.length) add('PLAN_NOT_CONSISTENT', 'ERROR', 'Несогласованный план МТО не может быть утверждён', [plan.id]);
  return { valid: !issues.length, issues };
}
