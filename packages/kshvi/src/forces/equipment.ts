import type { SourceRef } from '../model/entities';

export const EQUIPMENT_CONDITIONS = ['SERVICEABLE', 'DEGRADED', 'UNDER_REPAIR', 'DAMAGED', 'DESTROYED', 'UNKNOWN'] as const;
export type EquipmentCondition = typeof EQUIPMENT_CONDITIONS[number];
export type EquipmentAccounting = 'AGGREGATE' | 'INDIVIDUAL';
export type EquipmentSource = SourceRef;

export type EquipmentMeasure = Readonly<
  | { status: 'KNOWN'; value: number; unit: string; source: EquipmentSource }
  | { status: 'UNKNOWN'; value: null; unit: string; reason: string }
>;

export type EquipmentResourceRequirement = Readonly<{
  resourceId: string;
  amountPerUnit: number;
  unit: string;
  source: EquipmentSource;
}>;

export type EquipmentResourceAmount = Readonly<{
  resourceId: string;
  amount: number;
  unit: string;
}>;

export type EquipmentType = Readonly<{
  id: string;
  revision: number;
  sha256: string;
  title: string;
  movementClass: string;
  massTonnes: EquipmentMeasure;
  dimensions: Readonly<{ lengthM: EquipmentMeasure; widthM: EquipmentMeasure; heightM: EquipmentMeasure }>;
  transportCapacity: Readonly<{ payloadTonnes: EquipmentMeasure; personnel: EquipmentMeasure }>;
  operatingResources: readonly EquipmentResourceRequirement[];
  allowedTasks: readonly string[];
  environmentLimits: readonly string[];
}>;

export type EquipmentStateCounts = Readonly<Record<EquipmentCondition, number>>;

export type EquipmentEventKind = 'STATE_CHANGE' | 'DAMAGE' | 'LOSS' | 'REPAIR' | 'RETURN_TO_SERVICE' | 'TRANSFER';

export type EquipmentEvent = Readonly<{
  eventId: string;
  kind: EquipmentEventKind;
  at: string;
  from: EquipmentCondition | null;
  to: EquipmentCondition | null;
  causeId: string;
  reason: string;
  resources: readonly EquipmentResourceAmount[];
  unitId?: string;
  quantity?: number;
  allocations?: readonly EquipmentDistribution[];
}>;

export type EquipmentUnit = Readonly<{
  unitId: string;
  serialNumber: string;
  state: EquipmentCondition;
  causeId: string | null;
  assignedTo: string | null;
  appliedEventIds: readonly string[];
  resourceBalances: Readonly<Record<string, EquipmentResourceAmount>>;
  history: readonly EquipmentEvent[];
}>;

export type EquipmentUnitInput = Readonly<{
  unitId: string;
  serialNumber: string;
  state: EquipmentCondition;
  causeId?: string | null;
  assignedTo?: string | null;
}>;

export type EquipmentDistribution = Readonly<{
  targetId: string;
  quantity: number;
  unitIds?: readonly string[];
}>;

export type EquipmentAssignment = Readonly<{
  assignmentId: string;
  kind: string;
  quantity: number;
  unitIds?: readonly string[];
  at: string;
  causeId: string;
}>;

export type EquipmentInitialSnapshot = Readonly<{
  authorized: number | null;
  actual: number | null;
  stateCounts: EquipmentStateCounts;
  crew: EquipmentCrew;
  items: readonly EquipmentUnit[];
  distribution: readonly EquipmentDistribution[];
}>;

export type EquipmentCrew = Readonly<{
  requiredPerUnit: EquipmentMeasure;
  assigned: EquipmentMeasure;
}>;

export type EquipmentHolding = Readonly<{
  schemaVersion: 1;
  id: string;
  forceId: string;
  accounting: EquipmentAccounting;
  equipmentType: EquipmentType;
  authorized: number | null;
  actual: number | null;
  stateCounts: EquipmentStateCounts;
  crew: EquipmentCrew;
  items: readonly EquipmentUnit[];
  distribution: readonly EquipmentDistribution[];
  unallocated: number | null;
  assignments: readonly EquipmentAssignment[];
  source: EquipmentSource;
  initial: EquipmentInitialSnapshot;
  appliedEventIds: readonly string[];
  resourceBalances: Readonly<Record<string, EquipmentResourceAmount>>;
  history: readonly EquipmentEvent[];
}>;

export type EquipmentHoldingInput = Readonly<{
  id: string;
  forceId: string;
  accounting: EquipmentAccounting;
  equipmentType: EquipmentType;
  authorized: number | null;
  actual: number | null;
  stateCounts: EquipmentStateCounts;
  crew: EquipmentCrew;
  distribution: readonly EquipmentDistribution[];
  items?: readonly EquipmentUnitInput[];
  source: EquipmentSource;
}>;

function assertCount(value: number | null, field: string): void {
  if (value !== null && (!Number.isSafeInteger(value) || value < 0)) {
    throw new Error(`${field} должно быть неотрицательным целым или UNKNOWN`);
  }
}

function assertMeasure(value: EquipmentMeasure, field: string): void {
  if (!value.unit.trim()) throw new Error(`Для ${field} нужна единица измерения`);
  if (value.status === 'UNKNOWN') {
    if (!value.reason.trim()) throw new Error(`Для UNKNOWN ${field} нужна причина`);
    return;
  }
  if (!Number.isFinite(value.value) || value.value < 0) throw new Error(`Некорректное значение ${field}`);
  if (!value.source.sourceId.trim()) throw new Error(`Для ${field} нужен источник`);
}

function assertType(type: EquipmentType): void {
  if (!type.id.trim() || !Number.isSafeInteger(type.revision) || type.revision < 1 || !/^[0-9a-f]{64}$/.test(type.sha256)) {
    throw new Error('Тип техники требует неизменяемую редакцию и SHA-256');
  }
  assertMeasure(type.massTonnes, 'массы');
  for (const [field, value] of Object.entries(type.dimensions)) assertMeasure(value, `габарита ${field}`);
  assertMeasure(type.transportCapacity.payloadTonnes, 'грузовой ёмкости');
  assertMeasure(type.transportCapacity.personnel, 'ёмкости личного состава');
  for (const resource of type.operatingResources) {
    if (!resource.resourceId.trim() || !Number.isFinite(resource.amountPerUnit) || resource.amountPerUnit < 0 || !resource.unit.trim() || !resource.source.sourceId.trim()) {
      throw new Error('Некорректная потребность техники в ресурсах');
    }
  }
  if (new Set(type.allowedTasks).size !== type.allowedTasks.length) throw new Error('Допустимые задачи не должны повторяться');
}

function normalizedCounts(counts: EquipmentStateCounts): EquipmentStateCounts {
  const result = {} as Record<EquipmentCondition, number>;
  for (const condition of EQUIPMENT_CONDITIONS) {
    const value = counts[condition];
    assertCount(value, `Количество ${condition}`);
    result[condition] = value;
  }
  return result;
}

function normalizeUnit(input: EquipmentUnitInput): EquipmentUnit {
  if (!input.unitId.trim() || !input.serialNumber.trim()) throw new Error('Поштучная запись требует unitId и серийный номер');
  if (!EQUIPMENT_CONDITIONS.includes(input.state)) throw new Error('Неизвестное состояние единицы техники');
  return {
    unitId: input.unitId,
    serialNumber: input.serialNumber,
    state: input.state,
    causeId: input.causeId ?? null,
    assignedTo: input.assignedTo ?? null,
    appliedEventIds: [],
    resourceBalances: {},
    history: [],
  };
}

function countsForItems(items: readonly EquipmentUnit[]): EquipmentStateCounts {
  const result = Object.fromEntries(EQUIPMENT_CONDITIONS.map(condition => [condition, 0])) as Record<EquipmentCondition, number>;
  for (const item of items) result[item.state] += 1;
  return result;
}

function distributionQuantity(distribution: readonly EquipmentDistribution[]): number {
  return distribution.reduce((sum, entry) => sum + entry.quantity, 0);
}

export function createEquipmentHolding(input: EquipmentHoldingInput): EquipmentHolding {
  if (!input.id.trim() || !input.forceId.trim() || !input.source.sourceId.trim()) {
    throw new Error('Ведомость требует идентификаторы и источник');
  }
  assertType(input.equipmentType);
  assertCount(input.authorized, 'Количество по штату');
  assertCount(input.actual, 'Фактическое количество');
  assertMeasure(input.crew.requiredPerUnit, 'потребности в экипаже');
  assertMeasure(input.crew.assigned, 'наличия экипажа');

  const items = (input.items ?? []).map(normalizeUnit);
  const unitIds = new Set(items.map(item => item.unitId));
  const serialNumbers = new Set(items.map(item => item.serialNumber));
  if (unitIds.size !== items.length || serialNumbers.size !== items.length) {
    throw new Error('Идентификаторы и серийные номера техники должны быть уникальны');
  }
  if (input.accounting === 'AGGREGATE' && items.length) throw new Error('Агрегированная ведомость не принимает поштучные записи');
  if (input.accounting === 'INDIVIDUAL' && !items.length) throw new Error('Поштучная ведомость не должна быть пустой');

  const stateCounts = input.accounting === 'INDIVIDUAL' ? countsForItems(items) : normalizedCounts(input.stateCounts);
  const actual = input.accounting === 'INDIVIDUAL' ? items.length : input.actual;
  const counted = Object.values(stateCounts).reduce((sum, value) => sum + value, 0);
  if (actual === null ? counted !== 0 : counted !== actual) {
    throw new Error('Сумма состояний должна равняться фактическому количеству');
  }

  const distribution = input.distribution.map(entry => ({ ...entry, unitIds: entry.unitIds ? [...entry.unitIds] : undefined }));
  for (const entry of distribution) assertCount(entry.quantity, 'Распределённое количество');
  if (new Set(distribution.map(entry => entry.targetId)).size !== distribution.length) throw new Error('Объект распределения указан повторно');
  if (actual !== null && distributionQuantity(distribution) > actual) throw new Error('Распределение превышает фактическое количество');

  const initial: EquipmentInitialSnapshot = {
    authorized: input.authorized,
    actual,
    stateCounts: { ...stateCounts },
    crew: { ...input.crew },
    items: items.map(item => ({ ...item })),
    distribution: distribution.map(entry => ({ ...entry })),
  };
  return {
    schemaVersion: 1,
    id: input.id,
    forceId: input.forceId,
    accounting: input.accounting,
    equipmentType: input.equipmentType,
    authorized: input.authorized,
    actual,
    stateCounts,
    crew: { ...input.crew },
    items,
    distribution,
    unallocated: actual === null ? null : actual - distributionQuantity(distribution),
    assignments: [],
    source: input.source,
    initial,
    appliedEventIds: [],
    resourceBalances: {},
    history: [],
  };
}
