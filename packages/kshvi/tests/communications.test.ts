import { describe, expect, it } from 'vitest';
import {
  admitAttempts,
  routeMessage,
  type Channel,
  type CommunicationMessage,
  type CommunicationNode,
} from '../src/communications/channel';
import {
  advanceMessage,
  createMessageAttempt,
  deliverAttempt,
  retryMessage,
} from '../src/communications/message';
import {
  applyFailure,
  applyInfrastructureFailure,
  type CommunicationFailure,
} from '../src/communications/failure-model';

const at = '2030-01-01T06:00:00Z';

function channel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: 'main', version: 1, fromInstanceId: 'hq', toInstanceId: 'unit', nodeIds: ['node-main'], direction: 'SIMPLEX',
    allowedMessageTypes: ['ORDER', 'REPORT'], capacity: 1, bytesPerSecond: 1000, baseDelayMs: 1000,
    priorityPolicy: { allowQueuedPreemption: true }, availability: 'AVAILABLE', encrypted: true,
    reserveChannelIds: ['reserve'], validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z', ...overrides,
  };
}

function message(overrides: Partial<CommunicationMessage> = {}): CommunicationMessage {
  return {
    id: 'message-1', type: 'ORDER', senderRole: 'COMMANDER', recipientIds: ['unit'], sizeBytes: 2000,
    priority: 5, domainKey: 'order-1', createdAt: at, ...overrides,
  };
}

const nodes: CommunicationNode[] = [
  { id: 'node-main', status: 'AVAILABLE' },
  { id: 'node-reserve', status: 'AVAILABLE' },
  { id: 'node-independent', status: 'AVAILABLE' },
];

const reserve = channel({ id: 'reserve', nodeIds: ['node-reserve'], baseDelayMs: 3000, reserveChannelIds: [] });
const independent = channel({ id: 'independent', toInstanceId: 'neighbor', nodeIds: ['node-independent'], reserveChannelIds: [] });

function infrastructure() {
  return [channel(), reserve, independent];
}

describe('каналы, маршруты и ёмкость', () => {
  it('вычисляет задержку и переходит на резерв только при отказе зависимого узла', () => {
    const initial = routeMessage({ message: message(), channels: infrastructure(), nodes, at, processingDelayMs: 500 });
    expect(initial).toMatchObject({ channelId: 'main', nodeIds: ['node-main'], delayMs: 3500, selectedReserve: false });
    const failure: CommunicationFailure = {
      id: 'failure-node', type: 'NODE_FAILURE', basis: 'Сценарный отказ узла', trainingQuestion: 'Как сохранить управление?',
      workaround: 'Перейти на резерв', scope: { nodeIds: ['node-main'], channelIds: [] }, at,
      expectedImpact: { documentIds: ['order-1'], deadlineIds: ['deadline-1'], branchIds: ['branch-1'] },
    };
    const changed = applyInfrastructureFailure({ nodes, channels: infrastructure(), factor: failure });
    expect(changed.nodes.find(node => node.id === 'node-main')?.status).toBe('FAILED');
    expect(changed.nodes.find(node => node.id === 'node-independent')?.status).toBe('AVAILABLE');
    expect(changed.impactPreview).toEqual(failure.expectedImpact);
    const rerouted = routeMessage({ message: message(), channels: changed.channels, nodes: changed.nodes, at });
    expect(rerouted).toMatchObject({ channelId: 'reserve', selectedReserve: true, delayMs: 5000 });
    expect(rerouted.events[0]?.type).toBe('RESERVE_ROUTE_SELECTED');
    const unaffected = routeMessage({ message: message({ recipientIds: ['neighbor'] }), channels: changed.channels, nodes: changed.nodes, at });
    expect(unaffected.channelId).toBe('independent');
    expect(initial.events).toEqual([]);
  });

  it('не выпускает сообщение вне периода, типа или доступного маршрута', () => {
    expect(() => routeMessage({ message: message({ type: 'FREE_TEXT' }), channels: infrastructure(), nodes, at })).toThrow('тип');
    expect(() => routeMessage({ message: message(), channels: infrastructure(), nodes, at: '2031-01-01T00:00:00Z' })).toThrow('маршрут');
  });

  it('приоритет выбирает очередь, но не вытесняет начатую передачу', () => {
    const main = channel();
    const route = routeMessage({ message: message(), channels: [main], nodes, at });
    const low = advanceMessage(createMessageAttempt(message({ id: 'low', priority: 1 }), route, at), 'START', { at });
    const urgent = createMessageAttempt(message({ id: 'urgent', priority: 10 }), route, at);
    const busy = admitAttempts({ channel: main, inTransit: [low], queued: [urgent], at });
    expect(busy.inTransit).toEqual([low]);
    expect(busy.queued[0]).toMatchObject({ messageId: 'urgent', status: 'queued' });
    const free = admitAttempts({ channel: main, inTransit: [], queued: [
      createMessageAttempt(message({ id: 'low-new', priority: 1 }), route, at),
      urgent,
    ], at });
    expect(free.inTransit.map(attempt => attempt.messageId)).toEqual(['urgent']);
    expect(free.queued.map(attempt => attempt.messageId)).toEqual(['low-new']);
    expect(free.inTransit[0]?.startedAt).toBe(at);
  });
});

describe('попытки сообщения и идемпотентный доменный эффект', () => {
  it('показывает дубликат доставки, но не дублирует приказ', () => {
    const first = deliverAttempt({ messageId: 'm1', attempt: 1, domainKey: 'order-1', appliedDomainKeys: [] });
    expect(first).toMatchObject({ status: 'delivered', duplicate: false, domainEffectApplied: true, appliedDomainKeys: ['order-1'] });
    const second = deliverAttempt({ ...first, attempt: 2, appliedDomainKeys: first.appliedDomainKeys });
    expect(second.duplicate).toBe(true);
    expect(second.domainEffectApplied).toBe(false);
    expect(second.appliedDomainKeys).toEqual(['order-1']);
    expect(second.deliveryJournalEntry).toMatchObject({ messageId: 'm1', attempt: 2, duplicate: true });
  });

  it('поддерживает queued/inTransit/failed/cancelled и повтор новой попыткой', () => {
    const route = routeMessage({ message: message(), channels: infrastructure(), nodes, at });
    const queued = createMessageAttempt(message(), route, at);
    expect(queued.status).toBe('queued');
    const inTransit = advanceMessage(queued, 'START', { at });
    expect(inTransit.status).toBe('inTransit');
    expect(() => advanceMessage(inTransit, 'DELIVER', { at: '2030-01-01T06:00:02Z' })).toThrow('задержк');
    const failed = advanceMessage(inTransit, 'FAIL', { at: '2030-01-01T06:00:03Z', reason: 'Потеря сообщения' });
    expect(failed.status).toBe('failed');
    const retry = retryMessage(failed, '2030-01-01T06:00:04Z');
    expect(retry).toMatchObject({ attempt: 2, status: 'queued', previousAttempt: { attempt: 1, status: 'failed' } });
    const delivered = advanceMessage(advanceMessage(retry, 'START', { at: '2030-01-01T06:00:05Z' }), 'DELIVER', { at: '2030-01-01T06:00:08.500Z' });
    expect(delivered).toMatchObject({ status: 'delivered', domainEffectApplied: true, appliedDomainKeys: ['order-1'] });
    const cancelled = advanceMessage(createMessageAttempt(message({ id: 'cancelled' }), route, at), 'CANCEL', { at, reason: 'Отмена отправителем' });
    expect(cancelled.status).toBe('cancelled');
  });
});

describe('сценарные сбои', () => {
  const baseFailure: CommunicationFailure = {
    id: 'failure-1', type: 'DELAY', basis: 'Перегрузка узла', trainingQuestion: 'Как изменится срок приказа?',
    workaround: 'Использовать резерв', scope: { nodeIds: [], channelIds: ['main'] }, at, delayMs: 2000,
    expectedImpact: { documentIds: ['order-1'], deadlineIds: [], branchIds: [] },
  };

  it('не допускает ненаблюдаемый сбой без учебного вопроса и обхода', () => {
    const route = routeMessage({ message: message(), channels: infrastructure(), nodes, at });
    const attempt = createMessageAttempt(message(), route, at);
    expect(() => applyFailure({ attempt, factor: { ...baseFailure, trainingQuestion: '' }, at })).toThrow('учебн');
    expect(() => applyInfrastructureFailure({ nodes, channels: infrastructure(), factor: { ...baseFailure, workaround: '' } })).toThrow('обход');
  });

  it('моделирует задержку, потерю, дублирование и частичную доставку', () => {
    const route = routeMessage({ message: message({ recipientIds: ['unit', 'neighbor'] }), channels: [channel({ toInstanceId: 'unit' })], nodes, at });
    const queued = createMessageAttempt(message({ recipientIds: ['unit', 'neighbor'] }), route, at);
    const delayed = applyFailure({ attempt: queued, factor: baseFailure, at });
    expect(delayed.attempt.route.delayMs).toBe(5000);
    expect(delayed.event.type).toBe('DELAY');
    const lost = applyFailure({ attempt: advanceMessage(queued, 'START', { at }), factor: { ...baseFailure, id: 'loss', type: 'LOSS' }, at });
    expect(lost.attempt.status).toBe('failed');
    const duplicated = applyFailure({ attempt: queued, factor: { ...baseFailure, id: 'duplicate', type: 'DUPLICATE' }, at });
    expect(duplicated.duplicateRequested).toBe(true);
    const partial = applyFailure({
      attempt: advanceMessage(queued, 'START', { at }),
      factor: { ...baseFailure, id: 'partial', type: 'PARTIAL_DELIVERY', recipientIds: ['unit'] },
      at: '2030-01-01T06:00:04Z',
    });
    expect(partial.attempt).toMatchObject({ status: 'delivered', partial: true, recipientResults: { unit: 'delivered', neighbor: 'failed' } });
    expect(partial.attempt.appliedDomainKeys).toEqual(['order-1']);
  });

  it('снижает ёмкость и восстанавливает инфраструктуру явными событиями', () => {
    const degraded = applyInfrastructureFailure({ nodes, channels: infrastructure(), factor: { ...baseFailure, type: 'CAPACITY_REDUCTION', capacity: 0 } });
    expect(degraded.channels[0]).toMatchObject({ availability: 'DEGRADED', degradedCapacity: 0 });
    const recovered = applyInfrastructureFailure({ nodes: degraded.nodes, channels: degraded.channels, factor: { ...baseFailure, id: 'recovery', type: 'RECOVERY' } });
    expect(recovered.channels[0]).toMatchObject({ availability: 'AVAILABLE', degradedCapacity: null });
    expect(recovered.nodes[0]?.status).toBe('AVAILABLE');
  });
});
