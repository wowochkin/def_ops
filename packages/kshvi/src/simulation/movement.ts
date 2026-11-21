export type RouteProgress = Readonly<{
  routeLengthMeters: number;
  remainingMeters: number;
  travelledMeters: number;
  delayMinutes: number;
}>;

export type MovementProfileRef = Readonly<{
  id: string;
  version: number;
  status: 'APPROVED' | 'DRAFT';
  approvedBy?: string;
}>;

export type MovementInput = Readonly<{
  speedKph: number | null;
  terrainFactor: number | null;
  weatherFactor: number | null;
  stateFactor: number | null;
  hours: number | null;
  routeStatus?: 'OPEN' | 'CLOSED';
  queueDelayMinutes?: number | null;
  reason?: string;
  profile?: MovementProfileRef;
  movementMode?: string;
  eventId?: string;
  at?: string;
}>;

export type MovementResult = RouteProgress & Readonly<{
  status: 'IN_PROGRESS' | 'ARRIVED' | 'DELAYED' | 'BLOCKED' | 'REQUIRES_REVIEW';
  arrived: boolean;
  distanceMeters: number | null;
  unknown: readonly string[];
  explanation: readonly string[];
  arrivalEvent?: Readonly<{ type: 'movement.arrived.v1'; eventId: string; at: string | null }>;
}>;

function round(value: number): number {
  return Number(value.toFixed(12));
}

function review(previous: RouteProgress, unknown: readonly string[], explanation: readonly string[]): MovementResult {
  return {
    ...previous,
    status: 'REQUIRES_REVIEW',
    arrived: previous.remainingMeters === 0,
    distanceMeters: null,
    unknown,
    explanation,
  };
}

/** L_(t+Δ)=max(0,L_t-v_base·k_terrain·k_weather·k_state·Δ). */
export function advanceMovement(previous: RouteProgress, input: MovementInput): MovementResult {
  const base: RouteProgress = {
    routeLengthMeters: previous.routeLengthMeters,
    remainingMeters: previous.remainingMeters,
    travelledMeters: previous.travelledMeters,
    delayMinutes: previous.delayMinutes,
  };
  if (![base.routeLengthMeters, base.remainingMeters, base.travelledMeters, base.delayMinutes].every(Number.isFinite)
    || base.routeLengthMeters < 0 || base.remainingMeters < 0 || base.travelledMeters < 0 || base.delayMinutes < 0
    || Math.abs(base.remainingMeters + base.travelledMeters - base.routeLengthMeters) > 1e-6) {
    return review(base, ['route:inconsistent'], ['Остаток и пройденный путь не согласованы с длиной маршрута']);
  }
  if (input.routeStatus === 'CLOSED') {
    return { ...base, status: 'BLOCKED', arrived: base.remainingMeters === 0, distanceMeters: 0, unknown: [], explanation: [input.reason ?? 'Маршрут или переправа закрыты; фактическая точка сохранена'] };
  }
  const unknown: string[] = [];
  const numeric = ['speedKph', 'terrainFactor', 'weatherFactor', 'stateFactor', 'hours'] as const;
  for (const key of numeric) {
    const value = input[key];
    if (value === null || !Number.isFinite(value) || value < 0 || key === 'speedKph' && value === 0) unknown.push(key);
  }
  if (input.queueDelayMinutes === null || input.queueDelayMinutes !== undefined && (!Number.isFinite(input.queueDelayMinutes) || input.queueDelayMinutes < 0)) unknown.push('queueDelayMinutes');
  if (input.profile && (input.profile.status !== 'APPROVED' || !input.profile.approvedBy?.trim() || !Number.isSafeInteger(input.profile.version) || input.profile.version < 1)) unknown.push('profile:notApproved');
  if (unknown.length) return review(base, [...new Set(unknown)], ['Обязательный коэффициент движения отсутствует или профиль не утверждён']);

  const queueDelay = input.queueDelayMinutes ?? 0;
  const delayMinutes = round(base.delayMinutes + queueDelay);
  if (base.remainingMeters === 0) {
    return { ...base, delayMinutes, status: 'ARRIVED', arrived: true, distanceMeters: 0, unknown: [], explanation: ['Маршрут уже завершён'] };
  }
  const potentialMeters = input.speedKph! * 1000 * input.terrainFactor! * input.weatherFactor! * input.stateFactor! * input.hours!;
  const distanceMeters = round(Math.min(base.remainingMeters, Math.max(0, potentialMeters)));
  const remainingMeters = round(Math.max(0, base.remainingMeters - distanceMeters));
  const travelledMeters = round(base.travelledMeters + distanceMeters);
  const arrived = remainingMeters === 0;
  const explanation = [`Скорость ${input.speedKph} км/ч; местность ${input.terrainFactor}; погода ${input.weatherFactor}; состояние ${input.stateFactor}; интервал ${input.hours} ч`];
  if (input.movementMode) explanation.push(`Способ движения: ${input.movementMode}`);
  if (queueDelay > 0) explanation.push(`Добавлена задержка ${queueDelay} мин`);
  if (distanceMeters === 0 && !arrived) explanation.push(input.reason ?? 'Нулевая фактическая скорость: движение задержано');
  return {
    routeLengthMeters: base.routeLengthMeters,
    remainingMeters,
    travelledMeters,
    delayMinutes,
    status: arrived ? 'ARRIVED' : distanceMeters === 0 ? 'DELAYED' : 'IN_PROGRESS',
    arrived,
    distanceMeters,
    unknown: [],
    explanation,
    ...(arrived ? { arrivalEvent: { type: 'movement.arrived.v1' as const, eventId: input.eventId ?? `arrival:${travelledMeters}:${remainingMeters}`, at: input.at ?? null } } : {}),
  };
}

export type TaskStage = 'AWAITING_ORDER' | 'PREPARATION' | 'EXECUTION' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';

export type TaskResourceConsumption = Readonly<{
  entryId: string;
  resourceId: string;
  unit: string;
  requestedQuantity: number;
  consumedQuantity: number;
  deficit: number;
}>;

export type TaskHistoryEntry = Readonly<{
  id: string;
  at: string;
  action: string;
  details: string;
}>;

export type TaskExecution = Readonly<{
  id: string;
  elementId: string;
  orderId: string;
  receivedOrderIds: readonly string[];
  stage: TaskStage;
  route: RouteProgress;
  elapsedMinutes: number;
  resources: readonly TaskResourceConsumption[];
  reportIds: readonly string[];
  limitations: readonly string[];
  history: readonly TaskHistoryEntry[];
}>;

export type TaskCommand = Readonly<{
  commandId: string;
  action: 'RECEIVE_ORDER' | 'START_PREPARATION' | 'START_EXECUTION' | 'ADVANCE' | 'INTERRUPT' | 'COMPLETE';
  at: string;
  orderId?: string;
  orderReceivedAt?: string;
  newRemainingMeters?: number;
  movement?: MovementInput;
  readiness?: Readonly<{ orderProcessingDelayMinutes: number | null; movementFactor: number | null; capabilityFactor: number | null; resourceFactor: number | null }>;
  supply?: Readonly<{ taskFactor: number | null; delayMinutes: number | null }>;
  equipment?: Readonly<{ equipmentId: string; state: 'SERVICEABLE' | 'DEGRADED' | 'UNDER_REPAIR' | 'DAMAGED' | 'DESTROYED'; movementFactor?: number | null }>;
  resourceConsumption?: Readonly<{ entryId: string; resourceId: string; unit: string; requestedQuantity: number; availableQuantity: number | null }>;
  reportId?: string;
  reason?: string;
}>;

export type TaskIssue = Readonly<{
  code: 'ORDER_NOT_RECEIVED' | 'RESOURCE_DEFICIT' | 'RESOURCE_UNKNOWN' | 'EQUIPMENT_NOT_SERVICEABLE' | 'EQUIPMENT_FACTOR_UNKNOWN' | 'REPORT_REQUIRED' | 'ROUTE_NOT_FINISHED' | 'INVALID_COMMAND' | 'REQUIRES_REVIEW';
  message: string;
}>;

export type TaskAdvanceResult = Readonly<{
  task: TaskExecution;
  movement: MovementResult | null;
  issues: readonly TaskIssue[];
}>;

/** Исполнение хранит фактические затраты и не применяет приказ до его получения. */
export function advanceTask(previous: TaskExecution, command: TaskCommand): TaskAdvanceResult {
  if (previous.history.some(item => item.id === command.commandId)) return { task: previous, movement: null, issues: [] };
  const issues: TaskIssue[] = [];
  let task: TaskExecution = {
    ...previous,
    receivedOrderIds: [...previous.receivedOrderIds],
    route: { ...previous.route },
    resources: [...previous.resources],
    reportIds: [...previous.reportIds],
    limitations: [...previous.limitations],
    history: [...previous.history],
  };
  let movementResult: MovementResult | null = null;
  if (!command.commandId.trim() || !Number.isFinite(Date.parse(command.at))) {
    return { task: previous, movement: null, issues: [{ code: 'INVALID_COMMAND', message: 'Команда задачи требует идентификатор и время' }] };
  }

  switch (command.action) {
    case 'RECEIVE_ORDER': {
      if (!command.orderId?.trim() || !command.orderReceivedAt || !Number.isFinite(Date.parse(command.orderReceivedAt)) || command.newRemainingMeters === undefined || !Number.isFinite(command.newRemainingMeters) || command.newRemainingMeters < 0) {
        issues.push({ code: 'INVALID_COMMAND', message: 'Новый приказ требует идентификатор, время получения и остаток маршрута' });
        break;
      }
      if (Date.parse(command.orderReceivedAt) > Date.parse(command.at)) {
        issues.push({ code: 'ORDER_NOT_RECEIVED', message: 'Приказ ещё не получен; прежний маршрут продолжается' });
        break;
      }
      const remaining = command.newRemainingMeters;
      task = {
        ...task,
        orderId: command.orderId,
        receivedOrderIds: previous.receivedOrderIds.includes(command.orderId) ? previous.receivedOrderIds : [...previous.receivedOrderIds, command.orderId],
        stage: 'PREPARATION',
        route: {
          ...previous.route,
          routeLengthMeters: round(previous.route.travelledMeters + remaining),
          remainingMeters: remaining,
          travelledMeters: previous.route.travelledMeters,
        },
      };
      break;
    }
    case 'START_PREPARATION':
      task = { ...task, stage: 'PREPARATION' };
      break;
    case 'START_EXECUTION':
      task = { ...task, stage: 'EXECUTION' };
      break;
    case 'INTERRUPT':
      task = { ...task, stage: 'SUSPENDED' };
      break;
    case 'ADVANCE': {
      if (!command.movement) {
        issues.push({ code: 'INVALID_COMMAND', message: 'Для продвижения нужны параметры движения' });
        break;
      }
      const hours = command.movement.hours ?? 0;
      let stateFactor = command.movement.stateFactor;
      let additionalDelay = 0;
      let limited = false;
      if (command.readiness) {
        additionalDelay += command.readiness.orderProcessingDelayMinutes ?? 0;
        stateFactor = stateFactor === null || command.readiness.movementFactor === null ? null : stateFactor * command.readiness.movementFactor;
        limited ||= command.readiness.orderProcessingDelayMinutes !== 0 || command.readiness.movementFactor !== 1 || command.readiness.resourceFactor !== 1 || command.readiness.capabilityFactor !== 1;
      }
      if (command.supply) {
        additionalDelay += command.supply.delayMinutes ?? 0;
        stateFactor = stateFactor === null || command.supply.taskFactor === null ? null : stateFactor * command.supply.taskFactor;
        limited ||= command.supply.delayMinutes !== 0 || command.supply.taskFactor !== 1;
      }
      if (command.equipment && command.equipment.state !== 'SERVICEABLE' && command.equipment.state !== 'DEGRADED') {
        issues.push({ code: 'EQUIPMENT_NOT_SERVICEABLE', message: `Техника ${command.equipment.equipmentId} находится в состоянии ${command.equipment.state}; положение сохранено` });
        task = { ...task, stage: 'SUSPENDED', elapsedMinutes: round(previous.elapsedMinutes + hours * 60) };
        limited = true;
      } else if (command.equipment?.state === 'DEGRADED') {
        if (command.equipment.movementFactor === null || command.equipment.movementFactor === undefined) {
          issues.push({ code: 'EQUIPMENT_FACTOR_UNKNOWN', message: 'Для деградировавшей техники нужен утверждённый коэффициент' });
          stateFactor = null;
        } else {
          stateFactor = stateFactor === null ? null : stateFactor * command.equipment.movementFactor;
          limited ||= command.equipment.movementFactor !== 1;
        }
      }

      const consumption = command.resourceConsumption;
      if (consumption && !previous.resources.some(item => item.entryId === consumption.entryId)) {
        if (consumption.availableQuantity === null || !Number.isFinite(consumption.availableQuantity)) {
          issues.push({ code: 'RESOURCE_UNKNOWN', message: `Доступный запас ${consumption.resourceId} неизвестен` });
          stateFactor = null;
        } else if (!Number.isFinite(consumption.requestedQuantity) || consumption.requestedQuantity <= 0 || consumption.availableQuantity < 0) {
          issues.push({ code: 'INVALID_COMMAND', message: 'Некорректная потребность или доступный запас' });
          stateFactor = null;
        } else {
          const consumedQuantity = round(Math.min(consumption.requestedQuantity, consumption.availableQuantity));
          const deficit = round(consumption.requestedQuantity - consumedQuantity);
          task = { ...task, resources: [...task.resources, { entryId: consumption.entryId, resourceId: consumption.resourceId, unit: consumption.unit, requestedQuantity: consumption.requestedQuantity, consumedQuantity, deficit }] };
          if (deficit > 0) {
            issues.push({ code: 'RESOURCE_DEFICIT', message: `Дефицит ${consumption.resourceId}: ${deficit} ${consumption.unit}` });
            limited = true;
            if (stateFactor !== null) stateFactor *= consumedQuantity / consumption.requestedQuantity;
          }
        }
      }

      if (!issues.some(issue => issue.code === 'EQUIPMENT_NOT_SERVICEABLE')) {
        movementResult = advanceMovement(previous.route, {
          ...command.movement,
          stateFactor,
          queueDelayMinutes: round((command.movement.queueDelayMinutes ?? 0) + additionalDelay),
          at: command.at,
        });
        if (movementResult.status === 'REQUIRES_REVIEW') issues.push({ code: 'REQUIRES_REVIEW', message: 'Движение требует рассмотрения; прежняя точка сохранена' });
        task = {
          ...task,
          route: {
            routeLengthMeters: movementResult.routeLengthMeters,
            remainingMeters: movementResult.remainingMeters,
            travelledMeters: movementResult.travelledMeters,
            delayMinutes: movementResult.delayMinutes,
          },
          elapsedMinutes: round(previous.elapsedMinutes + hours * 60),
          stage: limited || movementResult.status === 'REQUIRES_REVIEW' ? 'PARTIAL' : 'EXECUTION',
        };
      }
      break;
    }
    case 'COMPLETE':
      if (previous.route.remainingMeters !== 0) {
        issues.push({ code: 'ROUTE_NOT_FINISHED', message: 'Сила ещё не прибыла; частичное построение сохранено' });
        task = { ...task, stage: 'PARTIAL' };
      } else if (!command.reportId?.trim()) {
        issues.push({ code: 'REPORT_REQUIRED', message: 'Для завершения нужен доклад о фактическом занятии построения' });
        task = { ...task, stage: 'PARTIAL' };
      } else {
        task = { ...task, stage: 'COMPLETED', reportIds: previous.reportIds.includes(command.reportId) ? previous.reportIds : [...previous.reportIds, command.reportId] };
      }
      break;
  }

  const limitations = [...new Set([...task.limitations, ...issues.map(issue => issue.code)])];
  task = {
    ...task,
    limitations,
    history: [...task.history, { id: command.commandId, at: command.at, action: command.action, details: command.reason ?? (issues.map(issue => issue.message).join('; ') || command.action) }],
  };
  return { task, movement: movementResult, issues };
}
