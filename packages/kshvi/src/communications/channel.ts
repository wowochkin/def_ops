import type { MessageAttempt } from './message';

export type CommunicationNode = Readonly<{
  id: string;
  status: 'AVAILABLE' | 'FAILED';
}>;

export type Channel = Readonly<{
  id: string;
  version: number;
  fromInstanceId: string;
  toInstanceId: string;
  nodeIds: readonly string[];
  direction: 'SIMPLEX' | 'DUPLEX';
  allowedMessageTypes: readonly string[];
  capacity: number;
  bytesPerSecond: number;
  baseDelayMs: number;
  priorityPolicy: Readonly<{ allowQueuedPreemption: boolean }>;
  availability: 'AVAILABLE' | 'DEGRADED' | 'FAILED';
  encrypted: boolean;
  reserveChannelIds: readonly string[];
  validFrom: string;
  validUntil: string;
  degradedCapacity?: number | null;
}>;

export type CommunicationMessage = Readonly<{
  id: string;
  type: string;
  senderRole: string;
  /** Подлинная инстанция отправителя, зафиксированная серверной командой. */
  fromInstanceId: string;
  recipientIds: readonly string[];
  sizeBytes: number;
  priority: number;
  domainKey: string | null;
  createdAt: string;
}>;

export type RouteEvent = Readonly<{
  type: 'RESERVE_ROUTE_SELECTED';
  at: string;
  channelId: string;
  replacedChannelId: string;
}>;

export type MessageRoute = Readonly<{
  channelId: string;
  nodeIds: readonly string[];
  delayMs: number;
  selectedReserve: boolean;
  events: readonly RouteEvent[];
}>;

function time(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Некорректное время маршрута сообщения');
  return parsed;
}

function connects(channel: Channel, message: CommunicationMessage): boolean {
  if (message.fromInstanceId === channel.fromInstanceId) {
    return channel.toInstanceId !== '' && message.recipientIds.includes(channel.toInstanceId);
  }
  return channel.direction === 'DUPLEX'
    && message.fromInstanceId === channel.toInstanceId
    && message.recipientIds.includes(channel.fromInstanceId);
}

/** Маршрут фиксируется на момент передачи; последующий отказ не меняет прошлый объект. */
export function routeMessage(input: {
  message: CommunicationMessage;
  channels: readonly Channel[];
  nodes: readonly CommunicationNode[];
  at: string;
  processingDelayMs?: number;
}): MessageRoute {
  const at = time(input.at);
  const senderKnown = input.channels.some(channel => channel.fromInstanceId === input.message.fromInstanceId
    || channel.direction === 'DUPLEX' && channel.toInstanceId === input.message.fromInstanceId);
  if (!senderKnown) throw new Error('Отправитель сообщения не соответствует каналу');
  const typed = input.channels.filter(channel => connects(channel, input.message));
  if (!typed.some(channel => channel.allowedMessageTypes.includes(input.message.type))) throw new Error(`Сообщение типа ${input.message.type} не допущено каналами`);
  const candidates = typed.filter(channel => channel.allowedMessageTypes.includes(input.message.type));
  const primary = candidates[0];
  const allowedRouteIds = new Set(primary ? [primary.id] : []);
  for (let changed = true; changed;) {
    changed = false;
    for (const channel of candidates) {
      if (!allowedRouteIds.has(channel.id)) continue;
      for (const reserveId of channel.reserveChannelIds) {
        if (!allowedRouteIds.has(reserveId)) {
          allowedRouteIds.add(reserveId);
          changed = true;
        }
      }
    }
  }
  const availableNodes = new Map(input.nodes.map(node => [node.id, node.status] as const));
  const viable = candidates.filter(channel => allowedRouteIds.has(channel.id)
    && channel.availability !== 'FAILED'
    && at >= Date.parse(channel.validFrom) && at <= Date.parse(channel.validUntil)
    && channel.nodeIds.every(nodeId => availableNodes.get(nodeId) === 'AVAILABLE'));
  const selected = viable[0];
  if (!selected) throw new Error('Нет доступного маршрута передачи сообщения');
  if (!Number.isSafeInteger(input.message.sizeBytes) || input.message.sizeBytes < 0) throw new Error('Размер сообщения неотрицателен');
  if (!Number.isFinite(selected.bytesPerSecond) || selected.bytesPerSecond <= 0) throw new Error('Профиль канала требует положительную скорость передачи');
  const processingDelayMs = input.processingDelayMs ?? 0;
  if (!Number.isFinite(processingDelayMs) || processingDelayMs < 0) throw new Error('Задержка обработки неотрицательна');
  const replaced = candidates[0];
  const selectedReserve = replaced?.id !== selected.id;
  return {
    channelId: selected.id,
    nodeIds: [...selected.nodeIds],
    delayMs: selected.baseDelayMs + Math.ceil(input.message.sizeBytes / selected.bytesPerSecond * 1000) + processingDelayMs,
    selectedReserve,
    events: selectedReserve && replaced ? [{ type: 'RESERVE_ROUTE_SELECTED', at: input.at, channelId: selected.id, replacedChannelId: replaced.id }] : [],
  };
}

export function effectiveChannelCapacity(channel: Channel): number {
  if (channel.availability === 'FAILED') return 0;
  const capacity = channel.availability === 'DEGRADED' ? channel.degradedCapacity ?? channel.capacity : channel.capacity;
  if (!Number.isSafeInteger(capacity) || capacity < 0) throw new Error('Ёмкость канала должна быть неотрицательным целым числом');
  return capacity;
}

/** Начатые попытки не вытесняются; приоритет применяется только среди queued. */
export function admitAttempts(input: {
  channel: Channel;
  inTransit: readonly MessageAttempt[];
  queued: readonly MessageAttempt[];
  at: string;
}): Readonly<{ inTransit: readonly MessageAttempt[]; queued: readonly MessageAttempt[] }> {
  time(input.at);
  const queued = [...input.queued].sort((left, right) => {
    if (input.channel.priorityPolicy.allowQueuedPreemption && left.priority !== right.priority) return right.priority - left.priority;
    const leftMs = Date.parse(left.queuedAt);
    const rightMs = Date.parse(right.queuedAt);
    if (!Number.isFinite(leftMs) || !Number.isFinite(rightMs)) throw new Error('Некорректное время постановки в очередь');
    return leftMs - rightMs || left.messageId.localeCompare(right.messageId);
  });
  const slots = Math.max(0, effectiveChannelCapacity(input.channel) - input.inTransit.length);
  const started = queued.slice(0, slots).map(attempt => ({
    ...attempt,
    status: 'inTransit' as const,
    startedAt: input.at,
    failureReason: null,
  }));
  return { inTransit: [...input.inTransit, ...started], queued: queued.slice(slots) };
}
