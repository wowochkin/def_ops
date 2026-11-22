import { expect, it } from 'vitest';
import { routeMessage, type Channel, type CommunicationMessage, type CommunicationNode } from '../src/communications/channel';
import { advanceMessage, createMessageAttempt, retryMessage } from '../src/communications/message';
import { applyFailure, type CommunicationFailure } from '../src/communications/failure-model';

const at = '2030-01-01T06:00:00Z';
const nodes: CommunicationNode[] = [
  { id: 'main-node', status: 'AVAILABLE' }, { id: 'reserve-node', status: 'AVAILABLE' }, { id: 'other-node', status: 'AVAILABLE' },
];
function channel(id: string, nodeId: string, reserveChannelIds: readonly string[] = []): Channel {
  return {
    id, version: 1, fromInstanceId: 'hq', toInstanceId: 'unit', nodeIds: [nodeId], direction: 'SIMPLEX', allowedMessageTypes: ['ORDER'],
    capacity: 1, bytesPerSecond: 1000, baseDelayMs: 0, priorityPolicy: { allowQueuedPreemption: true }, availability: 'AVAILABLE', encrypted: true,
    reserveChannelIds, validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
  };
}
function message(overrides: Partial<CommunicationMessage> = {}): CommunicationMessage {
  return {
    id: 'message', type: 'ORDER', senderRole: 'COMMANDER', fromInstanceId: 'hq', recipientIds: ['unit'], sizeBytes: 0, priority: 1,
    domainKey: 'order', createdAt: at, ...overrides,
  } as CommunicationMessage;
}

it('I9: канал принимает сообщение только от фактического отправителя', () => {
  expect(() => routeMessage({ message: message({ fromInstanceId: 'spoofed' } as never), channels: [channel('main', 'main-node')], nodes, at })).toThrow(/отправител/i);
});

it('I9: резерв выбирается только из списка reserveChannelIds основного канала', () => {
  const main = { ...channel('main', 'main-node', ['reserve']), availability: 'FAILED' as const };
  const reserve = { ...channel('reserve', 'reserve-node'), availability: 'FAILED' as const };
  const unrelated = { ...channel('unrelated', 'other-node'), toInstanceId: 'neighbor' };
  expect(() => routeMessage({
    message: message({ recipientIds: ['unit', 'neighbor'] }), channels: [main, reserve, unrelated], nodes, at,
  })).toThrow('Нет доступного маршрута');
});

it('I9: частичная доставка остаётся failed для недоставленных и допускает повтор', () => {
  const routed = routeMessage({ message: message({ recipientIds: ['unit', 'neighbor'] }), channels: [channel('main', 'main-node')], nodes, at });
  const attempt = advanceMessage(createMessageAttempt(message({ recipientIds: ['unit', 'neighbor'] }), routed, at), 'START', { at });
  const factor: CommunicationFailure = {
    id: 'partial', type: 'PARTIAL_DELIVERY', basis: 'Потеря одного адресата', trainingQuestion: 'Как повторить?', workaround: 'Резерв',
    scope: { nodeIds: [], channelIds: ['main'] }, at, recipientIds: ['unit'], expectedImpact: { documentIds: [], deadlineIds: [], branchIds: [] },
  };
  const partial = applyFailure({ attempt, factor, at }).attempt;
  expect(partial).toMatchObject({ status: 'failed', partial: true, recipientResults: { unit: 'delivered', neighbor: 'failed' } });
  const retry = retryMessage(partial, '2030-01-01T06:01:00Z');
  expect(retry.recipients).toEqual(['neighbor']);
  expect(retry.status).toBe('queued');
  const delivered = advanceMessage(advanceMessage(retry, 'START', { at: '2030-01-01T06:01:00Z' }), 'DELIVER', { at: '2030-01-01T06:01:00Z' });
  expect(delivered.domainEffectApplied).toBe(true);
});


it('I10: очередь каналов сравнивает queuedAt как instant', async () => {
  const { admitAttempts } = await import('../src/communications/channel');
  const main = channel('main', 'main-node');
  const routed = routeMessage({ message: message(), channels: [main], nodes, at });
  const later = createMessageAttempt(message({ id: 'later' }), routed, '2030-01-01T04:00:00Z');
  const earlier = createMessageAttempt(message({ id: 'earlier' }), routed, '2030-01-01T06:00:00+03:00');
  const admitted = admitAttempts({ channel: { ...main, capacity: 2 }, inTransit: [], queued: [later, earlier], at });
  expect(admitted.inTransit.map(attempt => attempt.messageId)).toEqual(['earlier', 'later']);
});

it('I7: анализ документа обнаруживает несовпадение сохранённого хеша с содержимым', async () => {
  const { analyzeDocument } = await import('../src/documents/document-validation');
  const { computeDocumentSha256Sync } = await import('../src/documents/document');
  const draft = revisionForAnalysis('a'.repeat(64));
  const valid = { ...draft, sha256: computeDocumentSha256Sync(draft) };
  const tampered = { ...valid, content: { ...valid.content, body: 'Изменено без редакции' } };
  expect(analyzeDocument(tampered, {}).map(issue => issue.code)).toContain('SIGNED_CONTENT_CHANGED');
});

function revisionForAnalysis(sha256: string) {
  return {
    id: 'doc:r1', documentId: 'doc', revision: 1, state: 'IN_REVIEW' as const,
    requisites: {
      exerciseId: 'e', scenarioRevisionId: 's', instanceId: 'hq', authorId: 'a', category: 'OPERATIONAL' as const, type: 'ORDER' as const,
      title: 't', number: '1', operationalAt: at, place: 'p', validFrom: at, validUntil: '2030-01-02T00:00:00Z', stageId: 's', sideId: 'blue',
      visibility: { sideIds: [], instanceIds: [], roles: [] }, addressees: [], copies: [], sourceRole: 'r', deliveryChannelId: 'c', basis: 'b', executorId: 'u',
      deadlineAt: at, linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: [], templateVersion: '1',
    },
    content: { body: 'original', units: {} }, map: null, attachments: [], approvalRouteId: 'route', sha256,
    supersedes: null, supersedesRevision: null, supersedeReason: null, signatures: [], delivery: { state: 'NOT_ISSUED' as const, facts: [] },
  };
}
