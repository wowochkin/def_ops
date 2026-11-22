import { expect, it } from 'vitest';
import { CommandService } from '../src/instances/command-service';
import { verifyEventChain } from '../../../packages/kshvi/src/events/hash-chain';

const actor = { userId: 'approver', role: 'LEADER', organizationId: 'org', sideId: 'blue', assignedNodeIds: ['node-1'] };
const draft = {
  id: 'doc-1:r1', documentId: 'doc-1', revision: 1,
  requisites: {
    exerciseId: 'session', scenarioRevisionId: 'scenario-r1', instanceId: 'session', authorId: 'author', category: 'OPERATIONAL', type: 'ORDER',
    title: 'Приказ', number: '1', operationalAt: '2030-01-01T01:00:00Z', place: 'Район', validFrom: '2030-01-01T00:00:00Z',
    validUntil: '2030-01-02T00:00:00Z', stageId: 'stage', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: [], roles: [] },
    addressees: [{ instanceId: 'node-1', channelId: 'radio' }], copies: [], sourceRole: 'LEADER', deliveryChannelId: 'radio', basis: 'decision-1',
    executorId: 'node-1', deadlineAt: '2030-01-01T02:00:00Z', linkedEventIds: [], linkedDecisionIds: ['decision-1'], linkedTaskIds: ['task'], templateVersion: '1',
  },
  content: { body: 'Выполнить задачу', units: {} }, map: null, attachments: [], approvalRouteId: 'route',
  supersedes: null, supersedesRevision: null, supersedeReason: null,
} as const;

it('официально создаёт, утверждает и выдаёт документ и ставит сообщение на серверный маршрут', async () => {
  const operations = {
    knownInstanceIds: ['session', 'node-1'], availableChannelIds: ['radio'], nodes: [{ id: 'node-1', status: 'AVAILABLE' as const }],
    channels: [{
      id: 'radio', version: 1, fromInstanceId: 'session', toInstanceId: 'node-1', nodeIds: ['node-1'], direction: 'SIMPLEX' as const,
      allowedMessageTypes: ['ORDER'], capacity: 10, bytesPerSecond: 1000, baseDelayMs: 25, priorityPolicy: { allowQueuedPreemption: false },
      availability: 'AVAILABLE' as const, encrypted: true, reserveChannelIds: [], validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z',
    }],
  };
  const service = new CommandService({ operations });
  const execute = (expectedRevision: number, idempotencyKey: string, type: string, payload: Record<string, unknown>) => service.execute({
    instanceId: 'session', branchId: 'main', expectedRevision, idempotencyKey, type, at: '2030-01-01T01:10:00Z', actor, payload,
  });
  await execute(0, 'doc-create', 'document.create', { revision: draft });
  await execute(1, 'doc-submit', 'document.transition', { documentId: 'doc-1', action: 'SUBMIT' });
  await execute(2, 'doc-approve', 'document.transition', { documentId: 'doc-1', action: 'APPROVE' });
  await execute(3, 'doc-issue', 'document.transition', { documentId: 'doc-1', action: 'ISSUE', recipient: { instanceId: 'node-1', sideId: 'blue', roles: ['TRAINEE'] } });
  await execute(4, 'message-1', 'communication.enqueue', { message: {
    id: 'message-1', type: 'ORDER', senderRole: 'LEADER', fromInstanceId: 'session', recipientIds: ['node-1'], sizeBytes: 100,
    priority: 1, domainKey: 'doc-1:r1', createdAt: '2030-01-01T01:10:00Z',
  } });

  const history = await service.history('session', 'main');
  expect(history.map(event => event.type)).toEqual([
    'document.created.v1', 'document.status.changed.v1', 'document.approved.v1', 'document.issued.v1', 'communication.queued.v1',
  ]);
  expect(history[3].payload).toMatchObject({ sideId: 'blue', document: { state: 'ISSUED', sha256: service.state('session', 'main').documents['doc-1']!.sha256 } });
  expect(history[4].payload).toMatchObject({ sideId: 'blue', attempt: { messageId: 'message-1', status: 'queued', route: { channelId: 'radio', delayMs: 125 } } });
  expect(verifyEventChain(history)).toEqual([]);
  expect(service.state('session', 'main').documents['doc-1'].state).toBe('ISSUED');
});
