import {
  EQUIPMENT_CONDITIONS,
  type EquipmentCondition,
  type EquipmentDistribution,
  type EquipmentEvent,
  type EquipmentEventKind,
  type EquipmentHolding,
  type EquipmentMeasure,
  type EquipmentResourceAmount,
  type EquipmentStateCounts,
  type EquipmentUnit,
} from './equipment';
import { canonicalJson } from '../events/canonical';

export type EquipmentState = Readonly<{
  state: EquipmentCondition;
  causeId: string | null;
  at: string | null;
  appliedEventIds: readonly string[];
  resourceBalances: Readonly<Record<string, EquipmentResourceAmount>>;
  history: readonly EquipmentEvent[];
}>;

export type EquipmentStateInput = Readonly<{
  state: EquipmentCondition;
  causeId?: string | null;
  at?: string | null;
  appliedEventIds?: readonly string[];
  resourceBalances?: Readonly<Record<string, EquipmentResourceAmount>>;
  history?: readonly EquipmentEvent[];
}>;

export type EquipmentTransitionCommand = Readonly<{
  kind?: Exclude<EquipmentEventKind, 'TRANSFER'>;
  to: EquipmentCondition;
  causeId: string;
  eventId: string;
  at: string;
  reason: string;
  resources: readonly EquipmentResourceAmount[];
  availableResources?: readonly EquipmentResourceAmount[];
  from?: EquipmentCondition;
  quantity?: number;
  unitId?: string;
}>;

export type EquipmentAllocation = Readonly<
  | { targetId: string; quantity: number; unitIds?: never }
  | { targetId: string; unitIds: readonly string[]; quantity?: never }
>;

export type EquipmentTask = Readonly<{
  kind: string;
  requiredUnits: number;
  requiredPayloadTonnes?: number;
  requiredPersonnelCapacity?: number;
  maxMassTonnes?: number;
  maxLengthM?: number;
  maxWidthM?: number;
  maxHeightM?: number;
  requiredResources?: readonly EquipmentResourceAmount[];
  availableResources?: readonly EquipmentResourceAmount[];
}>;

const ALLOWED_TRANSITIONS: Readonly<Record<EquipmentCondition, readonly EquipmentCondition[]>> = {
  SERVICEABLE: ['DEGRADED', 'UNDER_REPAIR', 'DAMAGED', 'DESTROYED'],
  DEGRADED: ['SERVICEABLE', 'UNDER_REPAIR', 'DAMAGED', 'DESTROYED'],
  UNDER_REPAIR: ['SERVICEABLE', 'DEGRADED', 'DAMAGED', 'DESTROYED'],
  DAMAGED: ['DESTROYED'],
  DESTROYED: [],
  UNKNOWN: [],
};

function emptyCounts(): Record<EquipmentCondition, number> {
  return Object.fromEntries(EQUIPMENT_CONDITIONS.map(condition => [condition, 0])) as Record<EquipmentCondition, number>;
}

function countsForItems(items: readonly EquipmentUnit[]): EquipmentStateCounts {
  const result = emptyCounts();
  for (const item of items) result[item.state] += 1;
  return result;
}

function assertCommand(command: EquipmentTransitionCommand): void {
  if (!command.eventId.trim() || !command.causeId.trim() || !command.reason.trim()) {
    throw new Error('Переход техники требует событие, причину и основание');
  }
  if (!Number.isFinite(Date.parse(command.at))) throw new Error('Переход техники требует корректное время');
  for (const resource of [...command.resources, ...(command.availableResources ?? [])]) {
    if (!resource.resourceId.trim() || !resource.unit.trim() || !Number.isFinite(resource.amount) || resource.amount < 0) {
      throw new Error('Некорректный ресурс перехода техники');
    }
  }
}

function consumeResources(
  current: Readonly<Record<string, EquipmentResourceAmount>>,
  available: readonly EquipmentResourceAmount[],
  required: readonly EquipmentResourceAmount[],
): Record<string, EquipmentResourceAmount> {
  const balances: Record<string, EquipmentResourceAmount> = { ...current };
  for (const resource of available) balances[resource.resourceId] = { ...resource };
  for (const resource of required) {
    const balance = balances[resource.resourceId];
    if (!balance || balance.unit !== resource.unit || balance.amount < resource.amount) {
      throw new Error(`Недостаточно ресурса ${resource.resourceId}`);
    }
    balances[resource.resourceId] = { ...balance, amount: balance.amount - resource.amount };
  }
  return balances;
}

function assertDuplicatePayload(current: EquipmentHolding | EquipmentStateInput, command: EquipmentTransitionCommand): void {
  const event = (current.history ?? []).find(candidate => candidate.eventId === command.eventId);
  const same = event
    && event.kind === (command.kind ?? 'STATE_CHANGE')
    && event.to === command.to
    && event.causeId === command.causeId
    && event.at === command.at
    && event.reason === command.reason
    && (command.from === undefined || event.from === command.from)
    && (event.unitId ?? null) === (command.unitId ?? null)
    && (event.quantity ?? null) === (command.quantity ?? null)
    && canonicalJson(event.resources) === canonicalJson(command.resources)
    && canonicalJson(event.availableResources ?? []) === canonicalJson(command.availableResources ?? []);
  if (!same) throw new Error(`Конфликт идемпотентности: ${command.eventId} уже применён к другой команде`);
}

function transitionSingle(current: EquipmentStateInput, command: EquipmentTransitionCommand): EquipmentState {
  assertCommand(command);
  const from = current.state;
  if (command.from && command.from !== from) throw new Error('Исходное состояние не соответствует записи');
  if (!ALLOWED_TRANSITIONS[from].includes(command.to)) {
    throw new Error(`Несовместимый переход ${from} → ${command.to}`);
  }
  const resourceBalances = consumeResources(current.resourceBalances ?? {}, command.availableResources ?? [], command.resources);
  const event: EquipmentEvent = {
    eventId: command.eventId,
    kind: command.kind ?? 'STATE_CHANGE',
    at: command.at,
    from,
    to: command.to,
    causeId: command.causeId,
    reason: command.reason,
    resources: command.resources.map(resource => ({ ...resource })),
    availableResources: (command.availableResources ?? []).map(resource => ({ ...resource })),
    unitId: command.unitId,
    quantity: command.quantity,
  };
  return {
    state: command.to,
    causeId: command.causeId,
    at: command.at,
    appliedEventIds: [...(current.appliedEventIds ?? []), command.eventId],
    resourceBalances,
    history: [...(current.history ?? []), event],
  };
}

export function transitionEquipment(current: EquipmentHolding, command: EquipmentTransitionCommand): EquipmentHolding;
export function transitionEquipment(current: EquipmentStateInput, command: EquipmentTransitionCommand): EquipmentState;
export function transitionEquipment(
  current: EquipmentHolding | EquipmentStateInput,
  command: EquipmentTransitionCommand,
): EquipmentHolding | EquipmentState {
  if (current.appliedEventIds?.includes(command.eventId)) {
    assertDuplicatePayload(current, command);
    if ('stateCounts' in current) return current;
    return current as EquipmentState;
  }
  if (!('stateCounts' in current)) return transitionSingle(current, command);

  const holding = current;
  assertCommand(command);
  if (!Number.isSafeInteger(command.quantity ?? 1) || (command.quantity ?? 1) < 1) {
    throw new Error('Количество единиц перехода должно быть положительным целым');
  }
  const quantity = command.quantity ?? 1;

  if (holding.accounting === 'INDIVIDUAL') {
    if (!command.unitId) throw new Error('Для поштучного перехода нужен unitId');
    const item = holding.items.find(candidate => candidate.unitId === command.unitId);
    if (!item) throw new Error('Единица техники не найдена');
    if (item.appliedEventIds.includes(command.eventId)) return holding;
    const nextItemState = transitionSingle({ ...item, state: item.state }, { ...command, from: command.from ?? item.state, quantity: 1 });
    const items = holding.items.map(candidate => candidate.unitId === item.unitId ? {
      ...candidate,
      state: nextItemState.state,
      causeId: nextItemState.causeId,
      appliedEventIds: nextItemState.appliedEventIds,
      resourceBalances: nextItemState.resourceBalances,
      history: nextItemState.history,
    } : candidate);
    const event = nextItemState.history[nextItemState.history.length - 1];
    return {
      ...holding,
      items,
      stateCounts: countsForItems(items),
      appliedEventIds: [...holding.appliedEventIds, command.eventId],
      resourceBalances: nextItemState.resourceBalances,
      history: [...holding.history, event],
    };
  }

  if (command.unitId) throw new Error('Агрегированный переход не принимает unitId');
  const from = command.from;
  if (!from) throw new Error('Для агрегированного перехода нужно исходное состояние');
  if (holding.stateCounts[from] < quantity) throw new Error('Недостаточно единиц в исходном состоянии');
  const batch = transitionSingle({
    state: from,
    resourceBalances: holding.resourceBalances,
    appliedEventIds: [],
    history: [],
  }, { ...command, quantity });
  const stateCounts = { ...holding.stateCounts, [from]: holding.stateCounts[from] - quantity, [command.to]: holding.stateCounts[command.to] + quantity };
  return {
    ...holding,
    stateCounts,
    appliedEventIds: [...holding.appliedEventIds, command.eventId],
    resourceBalances: batch.resourceBalances,
    history: [...holding.history, batch.history[0]],
  };
}

export function allocateEquipment(holding: EquipmentHolding, allocations: readonly EquipmentAllocation[]): EquipmentHolding {
  if (new Set(allocations.map(entry => entry.targetId)).size !== allocations.length) {
    throw new Error('Один объект распределения указан повторно');
  }
  if (holding.accounting === 'AGGREGATE') {
    if (holding.actual === null) throw new Error('Нельзя рассчитать распределение при UNKNOWN фактическом количестве');
    let total = 0;
    const distribution: EquipmentDistribution[] = allocations.map(entry => {
      const quantity = entry.quantity;
      if (entry.unitIds !== undefined || quantity === undefined || !Number.isSafeInteger(quantity) || quantity < 0) {
        throw new Error('Агрегированное распределение требует неотрицательное целое количество');
      }
      total += quantity;
      return { targetId: entry.targetId, quantity };
    });
    if (total > holding.actual) throw new Error('Распределение превышает фактическое количество');
    return { ...holding, distribution, unallocated: holding.actual - total };
  }

  const owners = new Map<string, string>();
  for (const entry of allocations) {
    const unitIds = entry.unitIds;
    if (!unitIds) throw new Error('Поштучное распределение требует unitIds');
    for (const unitId of unitIds) {
      if (owners.has(unitId)) throw new Error(`Единица ${unitId} распределена дважды`);
      if (!holding.items.some(item => item.unitId === unitId)) throw new Error(`Единица ${unitId} не найдена`);
      owners.set(unitId, entry.targetId);
    }
  }
  const items = holding.items.map(item => ({ ...item, assignedTo: owners.get(item.unitId) ?? null }));
  const distribution = allocations.map(entry => {
    const unitIds = entry.unitIds;
    if (!unitIds) throw new Error('Поштучное распределение требует unitIds');
    return { targetId: entry.targetId, quantity: unitIds.length, unitIds: [...unitIds] };
  });
  return { ...holding, items, distribution, unallocated: items.filter(item => item.assignedTo === null).length };
}

function crewedUnits(holding: EquipmentHolding, serviceable: number): number | null {
  const required = holding.crew.requiredPerUnit;
  const assigned = holding.crew.assigned;
  if (required.status === 'UNKNOWN' || assigned.status === 'UNKNOWN') return null;
  if (required.unit !== assigned.unit) return null;
  if (required.value === 0) return serviceable;
  return Math.min(serviceable, Math.floor(assigned.value / required.value));
}

export function equipmentCapabilities(input: EquipmentHolding | readonly EquipmentHolding[] | Readonly<{ type: string; serviceable: number; degraded: number }>): readonly string[] {
  if ('type' in input) {
    return input.type.toLowerCase() === 'pontoon' && input.serviceable > 0 ? ['CROSSING_BUILD'] : [];
  }
  const holdings = Array.isArray(input) ? input : [input as EquipmentHolding];
  const capabilities = new Set<string>();
  for (const holding of holdings) {
    const serviceable = holding.stateCounts.SERVICEABLE;
    if (serviceable < 1 || (crewedUnits(holding, serviceable) ?? 0) < 1) continue;
    for (const task of holding.equipmentType.allowedTasks) capabilities.add(task);
  }
  return [...capabilities];
}

function knownValue(measure: EquipmentMeasure): number | null {
  return measure.status === 'KNOWN' ? measure.value : null;
}

export function evaluateEquipmentTask(input: { holdings: readonly EquipmentHolding[]; task: EquipmentTask }) {
  const { task } = input;
  if (!task.kind.trim() || !Number.isSafeInteger(task.requiredUnits) || task.requiredUnits < 1) {
    throw new Error('Задача требует тип и положительное целое количество техники');
  }
  const candidates = input.holdings.filter(holding => holding.equipmentType.allowedTasks.includes(task.kind));
  const reasons: string[] = [];
  const unknown = new Set<string>();
  let serviceableUnits = 0;
  let usableUnits = 0;
  let payloadTonnes = 0;
  let personnelCapacity = 0;

  for (const holding of candidates) {
    const reserved = holding.assignments.reduce((sum, assignment) => sum + assignment.quantity, 0);
    const serviceable = Math.max(0, holding.stateCounts.SERVICEABLE - reserved);
    serviceableUnits += serviceable;
    const crewed = crewedUnits(holding, serviceable);
    if (crewed === null) unknown.add('crew');
    else usableUnits += crewed;

    const payload = knownValue(holding.equipmentType.transportCapacity.payloadTonnes);
    const personnel = knownValue(holding.equipmentType.transportCapacity.personnel);
    if (task.requiredPayloadTonnes !== undefined && payload === null && serviceable > 0) unknown.add('payloadTonnes');
    else payloadTonnes += (payload ?? 0) * serviceable;
    if (task.requiredPersonnelCapacity !== undefined && personnel === null && serviceable > 0) unknown.add('personnelCapacity');
    else personnelCapacity += (personnel ?? 0) * serviceable;

    if (task.maxMassTonnes !== undefined && serviceable > 0) {
      const mass = knownValue(holding.equipmentType.massTonnes);
      if (mass === null) unknown.add('massTonnes');
      else if (mass > task.maxMassTonnes) reasons.push('Превышена допустимая масса');
    }
    const dimensions = [
      ['maxLengthM', 'lengthM', holding.equipmentType.dimensions.lengthM, 'Превышена допустимая длина'],
      ['maxWidthM', 'widthM', holding.equipmentType.dimensions.widthM, 'Превышена допустимая ширина'],
      ['maxHeightM', 'heightM', holding.equipmentType.dimensions.heightM, 'Превышена допустимая высота'],
    ] as const;
    for (const [taskField, field, measure, reason] of dimensions) {
      const limit = task[taskField];
      if (limit === undefined || serviceable === 0) continue;
      const value = knownValue(measure);
      if (value === null) unknown.add(field);
      else if (value > limit) reasons.push(reason);
    }
  }

  if (!candidates.length || serviceableUnits < task.requiredUnits) reasons.push('Недостаточно исправной техники');
  if (serviceableUnits >= task.requiredUnits && usableUnits < task.requiredUnits) reasons.push('Недостаточно экипажа');
  if (task.requiredPayloadTonnes !== undefined && payloadTonnes < task.requiredPayloadTonnes) reasons.push('Недостаточная грузовая ёмкость');
  if (task.requiredPersonnelCapacity !== undefined && personnelCapacity < task.requiredPersonnelCapacity) reasons.push('Недостаточная ёмкость для личного состава');

  for (const required of task.requiredResources ?? []) {
    const available = (task.availableResources ?? []).find(resource => resource.resourceId === required.resourceId);
    if (!available || available.unit !== required.unit || available.amount < required.amount) {
      reasons.push(`Недостаточно ресурса ${required.resourceId}`);
    }
  }

  const uniqueReasons = [...new Set(reasons)];
  const unknownFields = [...unknown];
  const allowed = uniqueReasons.length === 0 && unknownFields.length === 0 && usableUnits >= task.requiredUnits;
  return {
    status: unknownFields.length ? 'REQUIRES_REVIEW' as const : allowed ? 'ALLOWED' as const : 'BLOCKED' as const,
    allowed,
    reasons: uniqueReasons,
    unknown: unknownFields,
    serviceableUnits,
    usableUnits,
    capacity: { payloadTonnes, personnel: personnelCapacity },
    resourceConsumptions: allowed ? (task.requiredResources ?? []).map(resource => ({ ...resource })) : [],
  };
}

export function assignEquipmentTask(holding: EquipmentHolding, input: {
  assignmentId: string;
  kind: string;
  quantity: number;
  at: string;
  causeId: string;
  unitIds?: readonly string[];
}): EquipmentHolding {
  if (holding.assignments.some(assignment => assignment.assignmentId === input.assignmentId)) return holding;
  if (!input.assignmentId.trim() || !input.causeId.trim() || !Number.isFinite(Date.parse(input.at))) {
    throw new Error('Назначение техники требует идентификатор, причину и время');
  }
  const evaluation = evaluateEquipmentTask({ holdings: [holding], task: { kind: input.kind, requiredUnits: input.quantity } });
  if (!evaluation.allowed) throw new Error(`Техника занята или задача недоступна: ${[...evaluation.reasons, ...evaluation.unknown].join(', ')}`);

  let unitIds: string[] | undefined;
  if (holding.accounting === 'INDIVIDUAL') {
    const reserved = new Set(holding.assignments.flatMap(assignment => assignment.unitIds ?? []));
    const available = holding.items.filter(item => item.state === 'SERVICEABLE' && !reserved.has(item.unitId));
    unitIds = input.unitIds ? [...input.unitIds] : available.slice(0, input.quantity).map(item => item.unitId);
    if (unitIds.length !== input.quantity || unitIds.some(unitId => !available.some(item => item.unitId === unitId))) {
      throw new Error('Выбранная техника занята или неисправна');
    }
  } else if (input.unitIds) {
    throw new Error('Агрегированное назначение не принимает unitIds');
  }
  return {
    ...holding,
    assignments: [...holding.assignments, {
      assignmentId: input.assignmentId,
      kind: input.kind,
      quantity: input.quantity,
      unitIds,
      at: input.at,
      causeId: input.causeId,
    }],
  };
}


type EquipmentTransferInput = Readonly<{
  eventId: string;
  at: string;
  causeId: string;
  reason: string;
  resources: readonly EquipmentResourceAmount[];
  availableResources?: readonly EquipmentResourceAmount[];
  allocations: readonly EquipmentAllocation[];
}>;
function assertTransferDuplicatePayload(holding: EquipmentHolding, input: EquipmentTransferInput): void {
  const event = holding.history.find(candidate => candidate.eventId === input.eventId);
  const allocations = input.allocations.map(entry => ({
    targetId: entry.targetId,
    quantity: entry.quantity ?? entry.unitIds?.length ?? 0,
    ...(entry.unitIds ? { unitIds: [...entry.unitIds] } : {}),
  }));
  const same = event?.kind === 'TRANSFER'
    && event.at === input.at
    && event.causeId === input.causeId
    && event.reason === input.reason
    && canonicalJson(event.resources) === canonicalJson(input.resources)
    && canonicalJson(event.availableResources ?? []) === canonicalJson(input.availableResources ?? [])
    && canonicalJson(event.allocations ?? []) === canonicalJson(allocations);
  if (!same) throw new Error(`Конфликт идемпотентности: ${input.eventId} уже применён к другой передаче`);
}

export function transferEquipment(holding: EquipmentHolding, input: EquipmentTransferInput): EquipmentHolding {
  if (holding.appliedEventIds.includes(input.eventId)) {
    assertTransferDuplicatePayload(holding, input);
    return holding;
  }
  if (!input.eventId.trim() || !input.causeId.trim() || !input.reason.trim() || !Number.isFinite(Date.parse(input.at))) {
    throw new Error('Передача техники требует событие, причину, основание и время');
  }
  const transferred = allocateEquipment(holding, input.allocations);
  const resourceBalances = consumeResources(holding.resourceBalances, input.availableResources ?? [], input.resources);
  const event: EquipmentEvent = {
    eventId: input.eventId,
    kind: 'TRANSFER',
    at: input.at,
    from: null,
    to: null,
    causeId: input.causeId,
    reason: input.reason,
    resources: input.resources.map(resource => ({ ...resource })),
    availableResources: (input.availableResources ?? []).map(resource => ({ ...resource })),
    allocations: transferred.distribution,
  };
  return {
    ...transferred,
    appliedEventIds: [...holding.appliedEventIds, input.eventId],
    resourceBalances,
    history: [...holding.history, event],
  };
}
