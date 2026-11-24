import type { Channel, CommunicationNode } from './channel';
import { advanceMessage, type MessageAttempt } from './message';

export type CommunicationFailure = Readonly<{
  id: string;
  type: 'DELAY' | 'LOSS' | 'DUPLICATE' | 'PARTIAL_DELIVERY' | 'NODE_FAILURE' | 'CAPACITY_REDUCTION' | 'RECOVERY';
  basis: string;
  trainingQuestion: string;
  workaround: string;
  scope: Readonly<{ nodeIds: readonly string[]; channelIds: readonly string[] }>;
  at: string;
  delayMs?: number;
  capacity?: number;
  recipientIds?: readonly string[];
  expectedImpact: Readonly<{ documentIds: readonly string[]; deadlineIds: readonly string[]; branchIds: readonly string[] }>;
}>;

function assertFailure(factor: CommunicationFailure): void {
  if (!factor.id.trim() || !factor.basis.trim()) throw new Error('Сценарный сбой требует идентификатор и основание');
  if (!factor.trainingQuestion.trim()) throw new Error('Сбой требует связанный учебный вопрос');
  if (!factor.workaround.trim()) throw new Error('Сбой требует правило восстановления или обхода');
  if (!factor.expectedImpact) throw new Error('До сбоя нужен предпросмотр влияния на документы, сроки и ветви');
  if (!Number.isFinite(Date.parse(factor.at))) throw new Error('Некорректное время сценарного сбоя');
}

export function applyInfrastructureFailure(input: {
  nodes: readonly CommunicationNode[];
  channels: readonly Channel[];
  factor: CommunicationFailure;
}): Readonly<{
  nodes: readonly CommunicationNode[];
  channels: readonly Channel[];
  events: readonly Readonly<{ type: CommunicationFailure['type']; at: string; scope: CommunicationFailure['scope'] }>[];
  impactPreview: CommunicationFailure['expectedImpact'];
}> {
  const { factor } = input;
  assertFailure(factor);
  let nodes = input.nodes;
  let channels = input.channels;
  if (factor.type === 'NODE_FAILURE') {
    nodes = nodes.map(node => factor.scope.nodeIds.includes(node.id) ? { ...node, status: 'FAILED' } : node);
  } else if (factor.type === 'CAPACITY_REDUCTION') {
    if (!Number.isSafeInteger(factor.capacity) || (factor.capacity as number) < 0) throw new Error('Снижение ёмкости требует неотрицательное целое значение');
    channels = channels.map(channel => factor.scope.channelIds.includes(channel.id)
      ? { ...channel, availability: 'DEGRADED', degradedCapacity: factor.capacity }
      : channel);
  } else if (factor.type === 'RECOVERY') {
    nodes = nodes.map(node => factor.scope.nodeIds.includes(node.id) ? { ...node, status: 'AVAILABLE' } : node);
    channels = channels.map(channel => factor.scope.channelIds.includes(channel.id)
      ? { ...channel, availability: 'AVAILABLE', degradedCapacity: null }
      : channel);
  } else {
    throw new Error(`Фактор ${factor.type} не является отказом инфраструктуры`);
  }
  return {
    nodes,
    channels,
    events: [{ type: factor.type, at: factor.at, scope: factor.scope }],
    impactPreview: factor.expectedImpact,
  };
}

export function applyFailure(input: {
  attempt: MessageAttempt;
  factor: CommunicationFailure;
  at: string;
}): Readonly<{
  attempt: MessageAttempt;
  duplicateRequested: boolean;
  event: Readonly<{ type: CommunicationFailure['type']; at: string; messageId: string; attempt: number }>;
  impactPreview: CommunicationFailure['expectedImpact'];
}> {
  const { attempt, factor } = input;
  assertFailure(factor);
  let next = attempt;
  let duplicateRequested = false;
  if (factor.type === 'DELAY') {
    if (!Number.isFinite(factor.delayMs) || (factor.delayMs as number) < 0) throw new Error('Задержка сбоя неотрицательна');
    next = { ...attempt, route: { ...attempt.route, delayMs: attempt.route.delayMs + (factor.delayMs ?? 0) } };
  } else if (factor.type === 'LOSS') {
    next = advanceMessage(attempt, 'FAIL', { at: input.at, reason: factor.basis });
  } else if (factor.type === 'DUPLICATE') {
    duplicateRequested = true;
  } else if (factor.type === 'PARTIAL_DELIVERY') {
    if (!factor.recipientIds?.length) throw new Error('Частичная доставка требует фактических получателей');
    next = advanceMessage(attempt, 'DELIVER', { at: input.at, recipientIds: factor.recipientIds });
  } else {
    throw new Error(`Фактор ${factor.type} применяется к инфраструктуре, а не к попытке`);
  }
  return {
    attempt: next,
    duplicateRequested,
    event: { type: factor.type, at: input.at, messageId: attempt.messageId, attempt: attempt.attempt },
    impactPreview: factor.expectedImpact,
  };
}
