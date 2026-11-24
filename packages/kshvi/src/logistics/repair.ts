import type { ResourceLedgerEntry } from './ledger';

export type RepairEquipmentState = 'SERVICEABLE' | 'DEGRADED' | 'DAMAGED' | 'DESTROYED' | 'UNDER_REPAIR';

export type RepairEquipmentRecord = Readonly<{
  equipmentId: string;
  state: RepairEquipmentState;
  locationNodeId: string;
  activeTaskId: string | null;
  activeRepairId: string | null;
}>;

export type RepairPart = Readonly<{
  resourceId: string;
  unit: string;
  required: number;
  available: number | null;
}>;

export type RepairRequest = Readonly<{
  id: string;
  equipmentId: string;
  faultId: string;
  repairNodeId: string;
  requestedAt: string;
  actorId: string;
  requiredParts: readonly RepairPart[];
  repairDurationMinutes: number;
  evacuationRequired: boolean;
  status: 'AWAITING_RESOURCES' | 'AWAITING_EVACUATION' | 'EVACUATING' | 'READY_FOR_REPAIR' | 'UNDER_REPAIR' | 'RESTORED' | 'RETURNED' | 'BLOCKED';
  startedAt: string | null;
  completedAt: string | null;
  history: readonly Readonly<{ id: string; at: string; action: string; details: string }>[];
}>;

export type RepairIssue = Readonly<{
  code: 'EQUIPMENT_IN_TASK' | 'EQUIPMENT_UNAVAILABLE' | 'REPAIR_PARTS_DEFICIT' | 'REPAIR_PARTS_UNKNOWN' | 'EVACUATION_ROUTE_CLOSED' | 'REPAIR_NOT_DUE' | 'INVALID_TRANSITION';
  message: string;
}>;

export type RepairResult = Readonly<{
  request: RepairRequest;
  equipment: RepairEquipmentRecord;
  ledgerEntries: readonly ResourceLedgerEntry[];
  issues: readonly RepairIssue[];
}>;

export function requestRepair(equipment: RepairEquipmentRecord, input: Readonly<{
  id: string;
  faultId: string;
  repairNodeId: string;
  requestedAt: string;
  actorId: string;
  requiredParts: readonly RepairPart[];
  repairDurationMinutes: number;
}>): RepairResult {
  const issues: RepairIssue[] = [];
  if (!input.id.trim() || !input.faultId.trim() || !input.repairNodeId.trim() || !input.actorId.trim() || !Number.isFinite(Date.parse(input.requestedAt)) || !Number.isFinite(input.repairDurationMinutes) || input.repairDurationMinutes <= 0) {
    throw new Error('Заявка на ремонт требует реквизиты, время и положительную длительность');
  }
  if (equipment.activeTaskId) issues.push({ code: 'EQUIPMENT_IN_TASK', message: 'Единица занята задачей и не может одновременно числиться в ремонте' });
  if (equipment.activeRepairId || equipment.state === 'DESTROYED' || equipment.state === 'UNDER_REPAIR') issues.push({ code: 'EQUIPMENT_UNAVAILABLE', message: 'Единица уже в ремонте или не подлежит восстановлению этим переходом' });
  for (const part of input.requiredParts) {
    if (part.available === null) issues.push({ code: 'REPAIR_PARTS_UNKNOWN', message: `Неизвестен запас ${part.resourceId}` });
    else if (!Number.isFinite(part.available) || part.available < part.required) issues.push({ code: 'REPAIR_PARTS_DEFICIT', message: `Дефицит ${part.resourceId}: требуется ${part.required} ${part.unit}` });
  }
  const blocked = issues.some(issue => issue.code === 'EQUIPMENT_IN_TASK' || issue.code === 'EQUIPMENT_UNAVAILABLE');
  const partsMissing = issues.some(issue => issue.code === 'REPAIR_PARTS_DEFICIT' || issue.code === 'REPAIR_PARTS_UNKNOWN');
  const evacuationRequired = equipment.locationNodeId !== input.repairNodeId;
  const status = blocked ? 'BLOCKED' : partsMissing ? 'AWAITING_RESOURCES' : evacuationRequired ? 'AWAITING_EVACUATION' : 'READY_FOR_REPAIR';
  return {
    request: {
      ...input,
      equipmentId: equipment.equipmentId,
      requiredParts: [...input.requiredParts],
      evacuationRequired,
      status,
      startedAt: null,
      completedAt: null,
      history: [],
    },
    equipment: blocked ? equipment : { ...equipment, activeRepairId: input.id },
    ledgerEntries: [],
    issues,
  };
}

export type RepairCommand = Readonly<{
  commandId: string;
  action: 'EVACUATE' | 'START' | 'COMPLETE' | 'RETURN';
  at: string;
  arrived?: boolean;
  routeClosed?: boolean;
  elapsedMinutes?: number;
  actorId?: string;
}>;

/** Ремонт занимает запись техники до фактического восстановления; повтор commandId ничего не расходует. */
export function advanceRepair(previousRequest: RepairRequest, previousEquipment: RepairEquipmentRecord, command: RepairCommand): RepairResult {
  if (previousRequest.history.some(item => item.id === command.commandId)) return { request: previousRequest, equipment: previousEquipment, ledgerEntries: [], issues: [] };
  if (!command.commandId.trim() || !Number.isFinite(Date.parse(command.at))) throw new Error('Команда ремонта требует идентификатор и время');
  let request: RepairRequest = { ...previousRequest, history: [...previousRequest.history] };
  let equipment = previousEquipment;
  const issues: RepairIssue[] = [];
  const ledgerEntries: ResourceLedgerEntry[] = [];
  const transition = (allowed: readonly RepairRequest['status'][]): boolean => {
    if (allowed.includes(previousRequest.status)) return true;
    issues.push({ code: 'INVALID_TRANSITION', message: `Переход ${command.action} невозможен из ${previousRequest.status}` });
    return false;
  };

  switch (command.action) {
    case 'EVACUATE':
      if (!transition(['AWAITING_EVACUATION', 'EVACUATING'])) break;
      if (command.routeClosed) {
        request = { ...request, status: 'EVACUATING' };
        issues.push({ code: 'EVACUATION_ROUTE_CLOSED', message: 'Эвакуация задержана закрытым маршрутом; техника остаётся в фактической точке' });
      } else if (command.arrived) {
        request = { ...request, status: 'READY_FOR_REPAIR' };
        equipment = { ...equipment, locationNodeId: previousRequest.repairNodeId };
      } else request = { ...request, status: 'EVACUATING' };
      break;
    case 'START':
      if (!transition(['READY_FOR_REPAIR'])) break;
      if (equipment.activeTaskId || equipment.activeRepairId !== previousRequest.id || equipment.locationNodeId !== previousRequest.repairNodeId) {
        issues.push({ code: 'EQUIPMENT_IN_TASK', message: 'Запись техники занята или не достигла ремонтного органа' });
        break;
      }
      request = { ...request, status: 'UNDER_REPAIR', startedAt: command.at };
      equipment = { ...equipment, state: 'UNDER_REPAIR', activeTaskId: null };
      for (const part of previousRequest.requiredParts) {
        ledgerEntries.push({
          id: `${previousRequest.id}:part:${part.resourceId}`,
          operation: 'CONSUME',
          resourceId: part.resourceId,
          unit: part.unit,
          quantity: part.required,
          requestedQuantity: part.required,
          nodeId: previousRequest.repairNodeId,
          taskId: previousRequest.id,
          at: command.at,
          causeId: previousRequest.faultId,
          actorId: command.actorId ?? previousRequest.actorId,
        });
      }
      break;
    case 'COMPLETE': {
      if (!transition(['UNDER_REPAIR'])) break;
      const startedAt = previousRequest.startedAt ? Date.parse(previousRequest.startedAt) : Number.NaN;
      const completedAt = Date.parse(command.at);
      const elapsed = (completedAt - startedAt) / 60000;
      if (!Number.isFinite(startedAt) || !Number.isFinite(elapsed) || elapsed < previousRequest.repairDurationMinutes) {
        issues.push({ code: 'REPAIR_NOT_DUE', message: 'Ремонт ещё не завершён; длительность и ресурсы сохранены' });
        break;
      }
      request = { ...request, status: 'RESTORED', completedAt: command.at };
      equipment = { ...equipment, state: 'SERVICEABLE', activeRepairId: null, activeTaskId: null };
      break;
    }
    case 'RETURN':
      if (transition(['RESTORED'])) request = { ...request, status: 'RETURNED' };
      break;
  }
  request = { ...request, history: [...request.history, { id: command.commandId, at: command.at, action: command.action, details: issues.map(issue => issue.message).join('; ') || command.action }] };
  return { request, equipment, ledgerEntries, issues };
}
