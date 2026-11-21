export type ResourceLedgerOperation =
  | 'OPENING'
  | 'RECEIPT'
  | 'RESERVE'
  | 'RELEASE'
  | 'DISPATCH'
  | 'DELIVER'
  | 'RETURN'
  | 'CONSUME'
  | 'LOSS'
  | 'ADJUSTMENT_IN'
  | 'ADJUSTMENT_OUT';

export type ResourceLedgerEntry = Readonly<{
  id: string;
  operation: ResourceLedgerOperation;
  resourceId: string;
  unit: string;
  quantity: number | null;
  nodeId: string;
  destinationNodeId?: string;
  supplyId?: string;
  taskId?: string;
  requestedQuantity?: number | null;
  sourceBucket?: 'ON_HAND' | 'IN_TRANSIT';
  at: string;
  causeId: string;
  actorId: string;
}>;

export type ResourceAccount = {
  nodeId: string;
  resourceId: string;
  unit: string;
  onHand: number;
  reserved: number;
  inTransit: number;
  consumed: number;
  lost: number;
  initial: number;
  received: number;
  adjustments: number;
  deficit: number;
  inTransitBySupply: Record<string, number>;
};

export type ResourceLedgerIssue = Readonly<{ code: 'UNKNOWN_QUANTITY' | 'INVALID_ENTRY'; entryId: string; message: string }>;

export type ResourceLedgerProjection = Readonly<{
  status: 'CALCULATED' | 'REQUIRES_REVIEW';
  accounts: Readonly<Record<string, ResourceAccount>>;
  entries: readonly ResourceLedgerEntry[];
  duplicateEntryIds: readonly string[];
  issues: readonly ResourceLedgerIssue[];
}>;

export type ResourceLedgerAppendResult = Readonly<{
  status: 'APPLIED' | 'DUPLICATE' | 'REQUIRES_REVIEW';
  entries: readonly ResourceLedgerEntry[];
  projection: ResourceLedgerProjection;
}>;

function key(nodeId: string, resourceId: string): string {
  return `${nodeId}|${resourceId}`;
}

function account(nodeId: string, entry: ResourceLedgerEntry): ResourceAccount {
  return {
    nodeId, resourceId: entry.resourceId, unit: entry.unit,
    onHand: 0, reserved: 0, inTransit: 0, consumed: 0, lost: 0,
    initial: 0, received: 0, adjustments: 0, deficit: 0, inTransitBySupply: {},
  };
}

function round(value: number): number {
  return Number(value.toFixed(12));
}

function requirePositive(value: number | null, entry: ResourceLedgerEntry): number {
  if (value === null || !Number.isFinite(value) || value <= 0) throw new Error(`Некорректное количество ресурса в проводке ${entry.id}`);
  return value;
}

function requireAvailable(actual: number, needed: number, message: string): void {
  if (needed > actual + 1e-9) throw new Error(message);
}

function sameEntry(a: ResourceLedgerEntry, b: ResourceLedgerEntry): boolean {
  const normalize = (value: unknown): unknown => Array.isArray(value)
    ? value.map(normalize)
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)).map(([k, v]) => [k, normalize(v)]))
      : value;
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function apply(accounts: Record<string, ResourceAccount>, entry: ResourceLedgerEntry, quantity: number): void {
  if (!entry.id.trim() || !entry.resourceId.trim() || !entry.unit.trim() || !entry.nodeId.trim() || !entry.causeId.trim() || !entry.actorId.trim() || !Number.isFinite(Date.parse(entry.at))) {
    throw new Error(`Проводка ${entry.id} не содержит обязательные реквизиты`);
  }
  for (const existing of Object.values(accounts)) {
    if (existing.resourceId === entry.resourceId && existing.unit !== entry.unit) throw new Error(`Несовместимые единицы ресурса ${entry.resourceId}`);
  }
  const originKey = key(entry.nodeId, entry.resourceId);
  const origin = accounts[originKey] ?? account(entry.nodeId, entry);
  accounts[originKey] = origin;
  const destination = entry.destinationNodeId
    ? accounts[key(entry.destinationNodeId, entry.resourceId)] ?? account(entry.destinationNodeId, entry)
    : null;
  if (destination && entry.destinationNodeId) accounts[key(entry.destinationNodeId, entry.resourceId)] = destination;
  const available = () => round(origin.onHand - origin.reserved);
  const supply = (required = true): string => {
    if (!entry.supplyId?.trim()) {
      if (required) throw new Error(`Проводка ${entry.id} требует идентификатор поставки`);
      return '';
    }
    return entry.supplyId;
  };
  const removeInTransit = (value: number): void => {
    const supplyId = supply();
    const current = origin.inTransitBySupply[supplyId] ?? 0;
    requireAvailable(current, value, `Недостаточно груза поставки ${supplyId} в пути`);
    origin.inTransit = round(origin.inTransit - value);
    origin.inTransitBySupply[supplyId] = round(current - value);
  };
  const addAtDestination = (value: number): void => {
    if (!destination) throw new Error(`Проводка ${entry.id} требует фактический пункт назначения`);
    destination.onHand = round(destination.onHand + value);
  };

  switch (entry.operation) {
    case 'OPENING':
      origin.initial = round(origin.initial + quantity);
      origin.onHand = round(origin.onHand + quantity);
      break;
    case 'RECEIPT':
      origin.received = round(origin.received + quantity);
      origin.onHand = round(origin.onHand + quantity);
      break;
    case 'RESERVE':
      requireAvailable(available(), quantity, `Недостаточно доступного ресурса для резерва: ${entry.resourceId}`);
      origin.reserved = round(origin.reserved + quantity);
      break;
    case 'RELEASE':
      requireAvailable(origin.reserved, quantity, 'Недостаточно зарезервированного ресурса для освобождения');
      origin.reserved = round(origin.reserved - quantity);
      break;
    case 'DISPATCH': {
      const supplyId = supply();
      requireAvailable(origin.reserved, quantity, 'Недостаточно зарезервированного ресурса для отправки');
      requireAvailable(origin.onHand, quantity, 'Недостаточно физического остатка для отправки');
      origin.reserved = round(origin.reserved - quantity);
      origin.onHand = round(origin.onHand - quantity);
      origin.inTransit = round(origin.inTransit + quantity);
      origin.inTransitBySupply[supplyId] = round((origin.inTransitBySupply[supplyId] ?? 0) + quantity);
      break;
    }
    case 'DELIVER':
    case 'RETURN':
      removeInTransit(quantity);
      addAtDestination(quantity);
      break;
    case 'CONSUME': {
      const requested = entry.requestedQuantity ?? quantity;
      if (requested === null || !Number.isFinite(requested) || requested < quantity) throw new Error('Некорректная потребность расхода ресурса');
      requireAvailable(available(), quantity, `Недостаточно доступного ресурса для расхода: ${entry.resourceId}`);
      origin.onHand = round(origin.onHand - quantity);
      origin.consumed = round(origin.consumed + quantity);
      origin.deficit = round(origin.deficit + requested - quantity);
      break;
    }
    case 'LOSS':
      if (entry.sourceBucket === 'IN_TRANSIT') removeInTransit(quantity);
      else {
        requireAvailable(available(), quantity, 'Недостаточно доступного ресурса для оформления потери');
        origin.onHand = round(origin.onHand - quantity);
      }
      origin.lost = round(origin.lost + quantity);
      break;
    case 'ADJUSTMENT_IN':
      origin.onHand = round(origin.onHand + quantity);
      origin.adjustments = round(origin.adjustments + quantity);
      break;
    case 'ADJUSTMENT_OUT':
      requireAvailable(available(), quantity, 'Недостаточно доступного ресурса для ручной корректировки');
      origin.onHand = round(origin.onHand - quantity);
      origin.adjustments = round(origin.adjustments - quantity);
      break;
  }
}

export function projectResourceLedger(entries: readonly ResourceLedgerEntry[]): ResourceLedgerProjection {
  const accounts: Record<string, ResourceAccount> = {};
  const seen = new Map<string, ResourceLedgerEntry>();
  const duplicateEntryIds: string[] = [];
  const issues: ResourceLedgerIssue[] = [];
  const applied: ResourceLedgerEntry[] = [];
  for (const entry of entries) {
    const duplicate = seen.get(entry.id);
    if (duplicate) {
      if (!sameEntry(duplicate, entry)) throw new Error(`Конфликт идентификатора проводки ${entry.id}`);
      duplicateEntryIds.push(entry.id);
      continue;
    }
    seen.set(entry.id, entry);
    if (entry.quantity === null || entry.requestedQuantity === null) {
      issues.push({ code: 'UNKNOWN_QUANTITY', entryId: entry.id, message: 'Неизвестное количество не заменяется нулём' });
      continue;
    }
    const quantity = requirePositive(entry.quantity, entry);
    apply(accounts, entry, quantity);
    applied.push(entry);
  }
  return { status: issues.length ? 'REQUIRES_REVIEW' : 'CALCULATED', accounts, entries: applied, duplicateEntryIds, issues };
}

/** Добавление одной проводки; прежний массив и его записи не изменяются. */
export function appendResourceLedgerEntry(entries: readonly ResourceLedgerEntry[], entry: ResourceLedgerEntry): ResourceLedgerAppendResult {
  const duplicate = entries.find(item => item.id === entry.id);
  if (duplicate) {
    if (!sameEntry(duplicate, entry)) throw new Error(`Конфликт идентификатора проводки ${entry.id}`);
    return { status: 'DUPLICATE', entries, projection: projectResourceLedger(entries) };
  }
  if (entry.quantity === null || entry.requestedQuantity === null) {
    return { status: 'REQUIRES_REVIEW', entries, projection: projectResourceLedger(entries) };
  }
  const next = [...entries, entry];
  return { status: 'APPLIED', entries: next, projection: projectResourceLedger(next) };
}
