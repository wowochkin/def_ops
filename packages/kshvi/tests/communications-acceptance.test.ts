import { expect, it } from 'vitest';
import { admitAttempts, routeMessage, type Channel, type CommunicationMessage, type CommunicationNode } from '../src/communications/channel';
import { applyInfrastructureFailure } from '../src/communications/failure-model';
import { advanceMessage, createMessageAttempt, deliverAttempt, retryMessage } from '../src/communications/message';
import { recordPaperExchange } from '../src/communications/paper-exchange';
import { checkReportDeadline } from '../src/communications/report-schedule';

const at = '2030-01-01T06:00:00Z';

function channel(id: string, nodeId: string, reserveChannelIds: string[]): Channel {
  return {
    id, version: 1, fromInstanceId: 'hq', toInstanceId: 'unit', nodeIds: [nodeId], direction: 'SIMPLEX',
    allowedMessageTypes: ['ORDER'], capacity: 1, bytesPerSecond: 1000, baseDelayMs: 1000,
    priorityPolicy: { allowQueuedPreemption: true }, availability: 'AVAILABLE', encrypted: true,
    reserveChannelIds, validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
  };
}

function message(id: string, priority: number): CommunicationMessage {
  return { id, type: 'ORDER', senderRole: 'COMMANDER', recipientIds: ['unit'], sizeBytes: 1000, priority, domainKey: 'order-1', createdAt: at };
}

it('AC-06 отказ, задержка, резерв, дубли, срок донесения и бумажный обмен доступны разбору', () => {
  const main = channel('main', 'node-main', ['reserve']);
  const reserve = channel('reserve', 'node-reserve', []);
  const channels = [main, reserve];
  const nodes: CommunicationNode[] = [{ id: 'node-main', status: 'AVAILABLE' }, { id: 'node-reserve', status: 'AVAILABLE' }];
  const mainRoute = routeMessage({ message: message('low', 1), channels, nodes, at });
  const low = advanceMessage(createMessageAttempt(message('low', 1), mainRoute, at), 'START', { at });
  const queuedUrgent = createMessageAttempt(message('urgent', 10), mainRoute, at);
  const fullQueue = admitAttempts({ channel: main, inTransit: [low], queued: [queuedUrgent], at });
  expect(fullQueue.queued[0]?.status).toBe('queued');
  expect(fullQueue.inTransit[0]?.status).toBe('inTransit');

  const failure = {
    id: 'node-failure', type: 'NODE_FAILURE' as const, basis: 'Сценарное повреждение узла', trainingQuestion: 'Когда будет задействован резерв?',
    workaround: 'Резервный канал и бумажный обмен', scope: { nodeIds: ['node-main'], channelIds: [] }, at,
    expectedImpact: { documentIds: ['order-1'], deadlineIds: ['report-deadline'], branchIds: ['command'] },
  };
  const degraded = applyInfrastructureFailure({ nodes, channels, factor: failure });
  const reserveRoute = routeMessage({ message: message('urgent', 10), channels: degraded.channels, nodes: degraded.nodes, at });
  expect(reserveRoute).toMatchObject({ channelId: 'reserve', selectedReserve: true });
  expect(degraded.impactPreview.documentIds).toEqual(['order-1']);

  let urgent = createMessageAttempt(message('urgent', 10), reserveRoute, at);
  urgent = advanceMessage(urgent, 'START', { at });
  urgent = advanceMessage(urgent, 'FAIL', { at: '2030-01-01T06:00:01Z', reason: 'Потеря на основном направлении' });
  urgent = retryMessage(urgent, '2030-01-01T06:00:02Z');
  const restored = applyInfrastructureFailure({ nodes: degraded.nodes, channels: degraded.channels, factor: { ...failure, id: 'node-recovery', type: 'RECOVERY' } });
  expect(restored.nodes.find(node => node.id === 'node-main')?.status).toBe('AVAILABLE');
  urgent = advanceMessage(urgent, 'START', { at: '2030-01-01T06:00:03Z' });
  urgent = advanceMessage(urgent, 'DELIVER', { at: '2030-01-01T06:00:05Z' });
  expect(urgent).toMatchObject({ status: 'delivered', attempt: 2, domainEffectApplied: true, appliedDomainKeys: ['order-1'] });
  const cancelled = advanceMessage(low, 'CANCEL', { at: '2030-01-01T06:00:04Z', reason: 'Заменён резервной попыткой' });
  expect(cancelled.status).toBe('cancelled');
  expect([queuedUrgent.status, low.status, urgent.previousAttempt?.status, urgent.status, cancelled.status]).toEqual([
    'queued', 'inTransit', 'failed', 'delivered', 'cancelled',
  ]);

  const duplicate = deliverAttempt({ ...urgent, attempt: 3, appliedDomainKeys: urgent.appliedDomainKeys });
  expect(duplicate).toMatchObject({ duplicate: true, domainEffectApplied: false, appliedDomainKeys: ['order-1'] });
  expect(duplicate.deliveryJournalEntry.attempt).toBe(3);

  const schedule = {
    id: 'urgent-report', type: 'CONTACT_REPORT', triggerEventId: 'contact-1', senderRole: 'UNIT_COMMANDER', recipientIds: ['hq'], channelId: 'main',
    deadlineAt: '2030-01-01T06:04:00Z', requiredFields: ['location'], escalation: { toRole: 'DUTY_OFFICER', afterMinutes: 0 }, reporterKind: 'TRAINEE' as const,
  };
  expect(checkReportDeadline({ schedule, now: '2030-01-01T06:05:00Z', eventStatus: 'OCCURRED' }).status).toBe('REPORT_NOT_SENT');
  expect(checkReportDeadline({ schedule, now: '2030-01-01T06:05:00Z', eventStatus: 'NOT_OCCURRED' }).status).toBe('EVENT_NOT_OCCURRED');

  const paper = recordPaperExchange({
    documentId: 'order-1', revision: 1, sha256: 'a'.repeat(64), domainKey: 'order-1',
    issued: { at: '2030-01-01T06:01:00Z', actorId: 'hq' }, received: { at: '2030-01-01T06:10:00Z', actorId: 'unit' },
    evidence: { kind: 'PAPER_ORIGINAL', reference: 'Журнал бумажного обмена № 1' },
    enteredAt: '2030-01-01T06:20:00Z', enteredBy: 'operator', appliedDomainKeys: duplicate.appliedDomainKeys,
    electronicQueue: [{ messageId: 'urgent-electronic', domainKey: 'order-1', status: 'inTransit' }],
  });
  expect(paper).toMatchObject({
    domainEffectApplied: false, duplicate: true, appliedDomainKeys: ['order-1'], electronicResolution: 'CANCEL_DUPLICATE', cancelledMessageIds: ['urgent-electronic'],
  });
  expect(paper.facts[1]).toMatchObject({ actualAt: '2030-01-01T06:10:00Z', recordedAt: '2030-01-01T06:20:00Z' });
});
