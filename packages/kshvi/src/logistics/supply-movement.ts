import type { ResourceLedgerEntry } from './ledger';
import type { SupplyNode, SupplyRequest, SupplyTransport } from './supply-request';

export type SupplyMovementStatus =
  | 'ALLOCATED'
  | 'PREPARING'
  | 'LOADING'
  | 'LOADED'
  | 'IN_TRANSIT'
  | 'DELAYED'
  | 'BLOCKED'
  | 'REQUIRES_REVIEW'
  | 'ARRIVED'
  | 'UNLOADING'
  | 'UNLOADED'
  | 'PARTIALLY_DELIVERED'
  | 'DELIVERED'
  | 'CANCELLED';

export type SupplyHistoryEntry = Readonly<{
  id: string;
  at: string;
  action: string;
  details: string;
}>;

export type SupplyMovement = Readonly<{
  id: string;
  requestId: string;
  orderId: string | null;
  resourceId: string;
  unit: string;
  originNodeId: string;
  destinationNodeId: string;
  transportId: string;
  quantity: number;
  weightTonnes: number;
  volumeM3: number;
  loadedQuantity: number;
  sentQuantity: number;
  deliveredQuantity: number;
  status: SupplyMovementStatus;
  route: Readonly<{ routeLengthMeters: number; remainingMeters: number; travelledMeters: number }>;
  delayMinutes: number;
  sentAt: string | null;
  /** Обновляется только успешными MOVE/DELAY, не отклонёнными командами. */
  lastMovementAt?: string | null;
  deliveredAt: string | null;
  cancellationRequested: boolean;
  reportIds: readonly string[];
  history: readonly SupplyHistoryEntry[];
}>;

export type SupplyRouteCapacity = Readonly<{
  closed: boolean;
  capacityTonnes: number | null;
  loadTonnes: number | null;
  availableColumns: number | null;
}>;

export type SupplyCommand = Readonly<{
  commandId: string;
  action: 'PREPARE' | 'START_LOADING' | 'COMPLETE_LOADING' | 'START_MOVEMENT' | 'MOVE' | 'DELAY' | 'START_UNLOADING' | 'COMPLETE_UNLOADING' | 'CONFIRM_RECEIPT' | 'CANCEL' | 'REPORT';
  at: string;
  transport?: SupplyTransport;
  originNode?: SupplyNode;
  destinationNode?: SupplyNode;
  route?: SupplyRouteCapacity;
  /** Устаревший прямой исход не исполняется; оставлен только для диагностики старых команд. */
  distanceMeters?: number;
  /** Скорость из утверждённого транспортного профиля, применяемая к истёкшему времени. */
  speedKph?: number;
  delayMinutes?: number;
  reason?: string;
  quantity?: number;
  reportId?: string;
  actorId?: string;
}>;

export type SupplyAdvanceIssue = Readonly<{
  code: 'INVALID_TRANSITION' | 'TRANSPORT_CAPACITY_EXCEEDED' | 'NODE_CAPACITY_EXCEEDED' | 'STORAGE_CAPACITY_EXCEEDED' | 'ROUTE_CLOSED' | 'ROUTE_CAPACITY_EXCEEDED' | 'ROUTE_CAPACITY_UNKNOWN' | 'ROUTE_QUEUE' | 'CARGO_REMAINS_IN_TRANSIT' | 'INVALID_COMMAND';
  message: string;
}>;

export type SupplyAdvanceResult = Readonly<{
  movement: SupplyMovement;
  ledgerEntries: readonly ResourceLedgerEntry[];
  issues: readonly SupplyAdvanceIssue[];
}>;

function round(value: number): number {
  return Number(value.toFixed(12));
}

export function createSupplyMovement(input: Readonly<{
  id: string;
  request: SupplyRequest;
  transport: SupplyTransport;
  originNodeId: string;
  destinationNodeId: string;
  routeLengthMeters: number;
  at: string;
}>): SupplyMovement {
  const quantity = input.request.allocatedQuantity;
  if (!input.id.trim() || quantity <= 0 || !Number.isFinite(quantity) || !Number.isFinite(input.routeLengthMeters) || input.routeLengthMeters < 0) {
    throw new Error('Поставка требует идентификатор, положительное выделение и длину маршрута');
  }
  if (input.request.totalWeightTonnes === null || input.request.totalVolumeM3 === null) throw new Error('Масса и объём поставки должны быть известны');
  const ratio = quantity / input.request.quantity;
  return {
    id: input.id,
    requestId: input.request.id,
    orderId: input.request.orderId ?? null,
    resourceId: input.request.resourceId,
    unit: input.request.unit,
    originNodeId: input.originNodeId,
    destinationNodeId: input.destinationNodeId,
    transportId: input.transport.id,
    quantity,
    weightTonnes: round(input.request.totalWeightTonnes * ratio),
    volumeM3: round(input.request.totalVolumeM3 * ratio),
    loadedQuantity: 0,
    sentQuantity: 0,
    deliveredQuantity: 0,
    status: 'ALLOCATED',
    route: { routeLengthMeters: input.routeLengthMeters, remainingMeters: input.routeLengthMeters, travelledMeters: 0 },
    delayMinutes: 0,
    sentAt: null,
    deliveredAt: null,
    cancellationRequested: false,
    reportIds: [],
    history: [],
  };
}

function ledgerEntry(movement: SupplyMovement, command: SupplyCommand, operation: ResourceLedgerEntry['operation'], quantity: number, suffix: string): ResourceLedgerEntry {
  return {
    id: `${movement.id}:${suffix}`,
    operation,
    resourceId: movement.resourceId,
    unit: movement.unit,
    quantity,
    nodeId: movement.originNodeId,
    ...(operation === 'DELIVER' || operation === 'RETURN' ? { destinationNodeId: movement.destinationNodeId } : {}),
    supplyId: movement.id,
    taskId: movement.requestId,
    at: command.at,
    causeId: movement.orderId ?? movement.requestId,
    actorId: command.actorId ?? 'supply-movement',
  };
}

function capacityIssue(node: SupplyNode | undefined, quantity: number, destination: boolean): SupplyAdvanceIssue | null {
  if (!node) return { code: 'INVALID_COMMAND', message: 'Не передан фактический пункт погрузки или разгрузки' };
  if (node.remainingStorageCapacity === null || node.throughputQuantityPerHour === null) return { code: 'NODE_CAPACITY_EXCEEDED', message: 'Ёмкость пункта неизвестна' };
  if (destination && node.remainingStorageCapacity < quantity) return { code: 'STORAGE_CAPACITY_EXCEEDED', message: 'Недостаточно ёмкости склада назначения' };
  if (node.queuedQuantity + quantity > node.throughputQuantityPerHour) return { code: 'NODE_CAPACITY_EXCEEDED', message: 'Пропускная способность пункта занята; поставка ставится в очередь' };
  return null;
}

/** Продвигает один фактический переход; отправка и подтверждение имеют разные проводки. */
export function advanceSupply(previous: SupplyMovement, command: SupplyCommand): SupplyAdvanceResult {
  if (previous.history.some(item => item.id === command.commandId)) return { movement: previous, ledgerEntries: [], issues: [] };
  const issues: SupplyAdvanceIssue[] = [];
  const ledgerEntries: ResourceLedgerEntry[] = [];
  let next: SupplyMovement = { ...previous, route: { ...previous.route }, reportIds: [...previous.reportIds], history: [...previous.history] };
  if (!command.commandId.trim() || !Number.isFinite(Date.parse(command.at))) {
    return { movement: previous, ledgerEntries: [], issues: [{ code: 'INVALID_COMMAND', message: 'Команда требует идентификатор и оперативное время' }] };
  }
  const transition = (allowed: readonly SupplyMovementStatus[]): boolean => {
    if (allowed.includes(previous.status)) return true;
    issues.push({ code: 'INVALID_TRANSITION', message: `Переход ${command.action} невозможен из ${previous.status}` });
    return false;
  };
  const nodeCheck = (node: SupplyNode | undefined, destination: boolean): boolean => {
    const issue = capacityIssue(node, previous.quantity, destination);
    if (!issue) return true;
    issues.push(issue);
    next = { ...next, status: issue.code === 'NODE_CAPACITY_EXCEEDED' ? 'DELAYED' : 'BLOCKED' };
    return false;
  };

  switch (command.action) {
    case 'PREPARE':
      if (transition(['ALLOCATED'])) next = { ...next, status: 'PREPARING' };
      break;
    case 'START_LOADING':
      if (!transition(['PREPARING'])) break;
      if (!command.transport || !Number.isFinite(command.transport.remainingCapacityQuantity) || !Number.isFinite(command.transport.remainingWeightTonnes) || !Number.isFinite(command.transport.remainingVolumeM3)) {
        issues.push({ code: 'TRANSPORT_CAPACITY_EXCEEDED', message: 'Доступная ёмкость транспорта неизвестна' });
        next = { ...next, status: 'REQUIRES_REVIEW' };
        break;
      }
      if (command.transport.status !== 'SERVICEABLE' && command.transport.status !== 'DEGRADED'
        || command.transport.remainingCapacityQuantity! < previous.quantity
        || command.transport.remainingWeightTonnes! < previous.weightTonnes
        || command.transport.remainingVolumeM3! < previous.volumeM3) {
        issues.push({ code: 'TRANSPORT_CAPACITY_EXCEEDED', message: 'Транспорт не может принять всю партию' });
        next = { ...next, status: 'BLOCKED' };
        break;
      }
      if (nodeCheck(command.originNode, false)) next = { ...next, status: 'LOADING' };
      break;
    case 'COMPLETE_LOADING':
      if (transition(['LOADING'])) {
        next = { ...next, status: 'LOADED', loadedQuantity: previous.quantity };
        ledgerEntries.push(ledgerEntry(previous, command, 'RESERVE', previous.quantity, 'reserve'));
      }
      break;
    case 'START_MOVEMENT':
      if (transition(['LOADED'])) {
        next = { ...next, status: 'IN_TRANSIT', sentQuantity: previous.quantity, sentAt: command.at };
        ledgerEntries.push(ledgerEntry(previous, command, 'DISPATCH', previous.quantity, 'dispatch'));
      }
      break;
    case 'MOVE': {
      if (!transition(['IN_TRANSIT', 'DELAYED', 'BLOCKED', 'REQUIRES_REVIEW'])) break;
      const route = command.route;
      if (!route || route.capacityTonnes === null || route.loadTonnes === null || route.availableColumns === null
        || !Number.isFinite(route.capacityTonnes) || !Number.isFinite(route.loadTonnes) || !Number.isFinite(route.availableColumns)) {
        issues.push({ code: 'ROUTE_CAPACITY_UNKNOWN', message: 'Ёмкость дороги или переправы неизвестна' });
        next = { ...next, status: 'REQUIRES_REVIEW' };
        break;
      }
      if (route.closed) {
        issues.push({ code: 'ROUTE_CLOSED', message: 'Маршрут закрыт; фактическая точка сохранена' });
        next = { ...next, status: 'DELAYED' };
        break;
      }
      if (route.loadTonnes > route.capacityTonnes) {
        issues.push({ code: 'ROUTE_CAPACITY_EXCEEDED', message: 'Нагрузка превышает ёмкость переправы или дороги' });
        next = { ...next, status: 'BLOCKED' };
        break;
      }
      if (route.availableColumns < 1) {
        issues.push({ code: 'ROUTE_QUEUE', message: 'Маршрут занят; колонна ожидает интервал' });
        next = { ...next, status: 'DELAYED' };
        break;
      }
      const speed = command.speedKph;
      const delay = command.delayMinutes ?? 0;
      const checkpoint = previous.lastMovementAt ?? previous.sentAt;
      const elapsedMinutes = checkpoint ? (Date.parse(command.at) - Date.parse(checkpoint)) / 60000 : Number.NaN;
      if (command.distanceMeters !== undefined || speed === undefined || !Number.isFinite(speed) || speed <= 0
        || !Number.isFinite(delay) || delay < 0 || !Number.isFinite(elapsedMinutes) || elapsedMinutes < 0) {
        issues.push({ code: 'INVALID_COMMAND', message: 'Движение требует скорость и истёкшее время; прямой участок пути не принимается' });
        next = { ...next, status: 'REQUIRES_REVIEW' };
        break;
      }
      const effectiveHours = Math.max(0, elapsedMinutes - delay) / 60;
      const distance = speed * 1000 * effectiveHours;
      const travelled = round(Math.min(previous.route.routeLengthMeters, previous.route.travelledMeters + distance));
      const remaining = round(Math.max(0, previous.route.remainingMeters - distance));
      next = {
        ...next,
        status: remaining === 0 ? 'ARRIVED' : distance === 0 ? 'DELAYED' : 'IN_TRANSIT',
        delayMinutes: round(previous.delayMinutes + Math.min(delay, elapsedMinutes)),
        lastMovementAt: command.at,
        route: { ...previous.route, travelledMeters: travelled, remainingMeters: remaining },
      };
      break;
    }
    case 'DELAY': {
      if (!transition(['IN_TRANSIT', 'DELAYED'])) break;
      const delay = command.delayMinutes;
      if (delay === undefined || !Number.isFinite(delay) || delay < 0) {
        issues.push({ code: 'INVALID_COMMAND', message: 'Задержка должна быть неотрицательной' });
        break;
      }
      next = { ...next, status: 'DELAYED', delayMinutes: round(previous.delayMinutes + delay), lastMovementAt: command.at };
      break;
    }
    case 'START_UNLOADING':
      if (previous.route.remainingMeters !== 0) {
        issues.push({ code: 'INVALID_TRANSITION', message: 'Разгрузка возможна только в фактически достигнутой точке' });
        break;
      }
      if (transition(['ARRIVED', 'IN_TRANSIT', 'DELAYED']) && nodeCheck(command.destinationNode, true)) next = { ...next, status: 'UNLOADING' };
      break;
    case 'COMPLETE_UNLOADING':
      if (transition(['UNLOADING'])) next = { ...next, status: 'UNLOADED' };
      break;
    case 'CONFIRM_RECEIPT': {
      if (!transition(['UNLOADED', 'PARTIALLY_DELIVERED'])) break;
      const outstanding = round(previous.sentQuantity - previous.deliveredQuantity);
      const quantity = command.quantity ?? outstanding;
      if (!Number.isFinite(quantity) || quantity <= 0 || quantity > outstanding) {
        issues.push({ code: 'INVALID_COMMAND', message: 'Подтверждаемое количество превышает отправленное или неизвестно' });
        break;
      }
      const deliveredQuantity = round(previous.deliveredQuantity + quantity);
      next = {
        ...next,
        deliveredQuantity,
        status: deliveredQuantity === previous.sentQuantity ? 'DELIVERED' : 'PARTIALLY_DELIVERED',
        deliveredAt: command.at,
      };
      ledgerEntries.push(ledgerEntry(previous, command, 'DELIVER', quantity, `deliver:${deliveredQuantity}`));
      break;
    }
    case 'CANCEL':
      if (previous.sentQuantity > 0) {
        issues.push({ code: 'CARGO_REMAINS_IN_TRANSIT', message: 'Отмена не возвращает отправленный груз; требуется фактический обратный маршрут' });
        next = { ...next, cancellationRequested: true };
      } else {
        next = { ...next, cancellationRequested: true, status: 'CANCELLED' };
        if (previous.loadedQuantity > 0) ledgerEntries.push(ledgerEntry(previous, command, 'RELEASE', previous.loadedQuantity, 'release'));
      }
      break;
    case 'REPORT':
      if (!command.reportId?.trim()) issues.push({ code: 'INVALID_COMMAND', message: 'Донесение требует идентификатор' });
      else if (!previous.reportIds.includes(command.reportId)) next = { ...next, reportIds: [...previous.reportIds, command.reportId] };
      break;
  }

  next = {
    ...next,
    history: [...next.history, { id: command.commandId, at: command.at, action: command.action, details: command.reason ?? (issues.map(issue => issue.message).join('; ') || command.action) }],
  };
  return { movement: next, ledgerEntries, issues };
}

export function supplyTaskEffect(movement: SupplyMovement, profile: Readonly<{
  id: string;
  version: number;
  status: 'APPROVED' | 'DRAFT';
  approvedBy?: string;
  delivered: Readonly<{ taskFactor: number; delayMinutes: number }>;
  delayed: Readonly<{ taskFactor: number; delayMinutes: number }>;
}>): Readonly<{
  status: 'CALCULATED' | 'REQUIRES_REVIEW';
  taskFactor: number | null;
  delayMinutes: number | null;
  supplyId: string;
  explanation: string;
}> {
  const delivered = movement.status === 'DELIVERED' && movement.deliveredQuantity === movement.quantity && movement.route.remainingMeters === 0;
  const effect = delivered ? profile.delivered : profile.delayed;
  const valid = profile.status === 'APPROVED' && !!profile.approvedBy?.trim() && Number.isSafeInteger(profile.version) && profile.version >= 1
    && Number.isFinite(effect.taskFactor) && effect.taskFactor > 0 && Number.isFinite(effect.delayMinutes) && effect.delayMinutes >= 0;
  if (!valid) return { status: 'REQUIRES_REVIEW', taskFactor: null, delayMinutes: null, supplyId: movement.id, explanation: 'Профиль влияния поставки не утверждён или некорректен' };
  return {
    status: 'CALCULATED', taskFactor: effect.taskFactor, delayMinutes: effect.delayMinutes, supplyId: movement.id,
    explanation: delivered ? 'Подтверждённое поступление применяет правило delivered' : 'Отправка или задержка не считается поступлением; применяется правило delayed',
  };
}
