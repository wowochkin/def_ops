import { describe, expect, it } from 'vitest';
import { computeDocumentSha256Sync, type DocumentRevision } from '../src/documents/document';
import { supersedeDocument, transitionDocument } from '../src/documents/document-lifecycle';
import {
  advanceCascadeDelivery,
  cascadeReminders,
  issueCascade,
  recordCascadeFact,
  relayCascade,
} from '../src/documents/cascade';
import { advanceApproval, resolveDualConflict } from '../src/documents/dual-chain';
import { exportDocumentSet, verifyExportSet } from '../src/documents/export-set';

const HASH = 'a'.repeat(64);
const NEXT_HASH = 'b'.repeat(64);

function revision(overrides: Partial<DocumentRevision> = {}): DocumentRevision {
  const value: DocumentRevision = {
    id: 'order-1:r1', documentId: 'order-1', revision: 1, state: 'IN_REVIEW',
    requisites: {
      exerciseId: 'exercise-1', scenarioRevisionId: 'scenario-1', instanceId: 'hq', authorId: 'author', category: 'OPERATIONAL', type: 'COMBAT_ORDER',
      title: 'Боевое распоряжение', number: '1', operationalAt: '2030-01-01T06:00:00+03:00', place: 'КП',
      validFrom: '2030-01-01T00:00:00+03:00', validUntil: '2030-01-02T00:00:00+03:00', stageId: 'stage-1', sideId: 'blue',
      visibility: { sideIds: ['blue'], instanceIds: [], roles: [] }, addressees: [{ instanceId: 'middle', channelId: 'main' }],
      copies: [], sourceRole: 'COMMANDER', deliveryChannelId: 'main', basis: 'План операции', executorId: 'middle', deadlineAt: '2030-01-01T09:00:00+03:00',
      linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: ['task-1'], templateVersion: 'combat-order:v1',
    },
    content: { body: 'Выполнить задачу', units: { distance: 'm' } },
    map: { environmentSnapshotId: 'env-1', legend: ['cp:v1'], attribution: ['Локальная топооснова'], visibility: { sideIds: ['blue'], instanceIds: [], roles: [] } },
    attachments: [], approvalRouteId: 'dual-1', sha256: HASH, supersedes: null, supersedesRevision: null, supersedeReason: null,
    signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] }, ...overrides,
  };
  return overrides.sha256 ? value : { ...value, sha256: computeDocumentSha256Sync(value) };
}

const issueInput = {
  originInstanceId: 'hq', issuedAt: '2030-01-01T06:00:00+03:00', availableChannelIds: ['main', 'reserve'],
  treeEdges: [{ from: 'hq', to: 'middle' }, { from: 'middle', to: 'lower' }, { from: 'hq', to: 'neighbor' }],
  legs: [
    { id: 'leg-middle', from: 'hq', to: 'middle', channelId: 'main', delayMinutes: 5, relayId: 'hq-relay', processingDeadlineAt: '2030-01-01T06:20:00+03:00' },
    { id: 'leg-neighbor', from: 'hq', to: 'neighbor', channelId: 'reserve', delayMinutes: 20, relayId: 'hq-relay', processingDeadlineAt: '2030-01-01T06:40:00+03:00', copyStatus: 'PARTIAL' as const, omittedAttachmentIds: ['attachment-2'] },
  ],
};

function approvedIssuedRevision(): DocumentRevision {
  const approved = transitionDocument(revision(), 'APPROVE', {
    signature: { userId: 'designatedAuthority', role: 'COMMANDER', signedAt: '2030-01-01T05:50:00+03:00' },
  });
  return transitionDocument(approved, 'ISSUE', {
    issue: {
      recipient: { instanceId: 'middle', sideId: 'blue', roles: ['COMMANDER'] }, knownInstanceIds: ['hq', 'middle'],
      availableChannelIds: ['main'], senderHasAuthority: true, at: '2030-01-01T06:00:00+03:00',
    },
  });
}

describe('самостоятельные плечи каскада', () => {
  it('не доставляет нижестоящему при подтверждении вышестоящего', () => {
    const cascade = issueCascade({ ...issueInput, revision: approvedIssuedRevision() });
    expect(cascade.deliveries).toHaveLength(2);
    expect(cascade.deliveries.map(delivery => delivery.messageId)).not.toEqual([cascade.deliveries[0]?.messageId, cascade.deliveries[0]?.messageId]);
    expect(cascade.deliveries[0]?.scheduledDeliveryAt).toBe('2030-01-01T06:05:00+03:00');
    expect(cascade.deliveries[1]?.scheduledDeliveryAt).toBe('2030-01-01T06:20:00+03:00');
    const middleInTransit = advanceCascadeDelivery(cascade.deliveries[0]!, 'BEGIN', { at: '2030-01-01T06:01:00+03:00' });
    const middle = advanceCascadeDelivery(middleInTransit, 'DELIVER', { at: '2030-01-01T06:05:00+03:00' });
    const acknowledged = recordCascadeFact(middle, 'ACKNOWLEDGED', { at: '2030-01-01T06:06:00+03:00', actorId: 'middle-commander' });
    expect(acknowledged.state).toBe('ACKNOWLEDGED');
    expect(acknowledged.executionStartedAt).toBeNull();
    expect(cascade.deliveries[1]?.state).toBe('QUEUED');
    expect(cascadeReminders(acknowledged, '2030-01-01T06:21:00+03:00')).toEqual([]);
    expect(cascadeReminders(middle, '2030-01-01T06:21:00+03:00')).toEqual([
      { deliveryId: 'leg-middle', kind: 'ESCALATION', recipientId: 'hq-relay' },
    ]);
    expect(middle.executionStartedAt).toBeNull();
  });

  it('ретранслирует ссылку на исходную редакцию и хранит неполную копию отдельно', () => {
    const cascade = issueCascade({ ...issueInput, revision: approvedIssuedRevision() });
    const inTransit = advanceCascadeDelivery(cascade.deliveries[0]!, 'BEGIN', { at: '2030-01-01T06:01:00+03:00' });
    const delivered = advanceCascadeDelivery(inTransit, 'DELIVER', { at: '2030-01-01T06:05:00+03:00' });
    const withMiddle = { ...cascade, deliveries: [delivered, cascade.deliveries[1]!] };
    const relayed = relayCascade(withMiddle, 'leg-middle', {
      id: 'leg-lower', from: 'middle', to: 'lower', channelId: 'reserve', delayMinutes: 7, relayId: 'middle-relay', processingDeadlineAt: '2030-01-01T06:30:00+03:00',
    }, { issuedAt: '2030-01-01T06:06:00+03:00', availableChannelIds: ['main', 'reserve'] });
    expect(relayed.deliveries[2]).toMatchObject({
      from: 'middle', to: 'lower', relayId: 'middle-relay', state: 'QUEUED',
      source: { documentId: 'order-1', revision: 1, sha256: cascade.source.sha256 }, scheduledDeliveryAt: '2030-01-01T06:13:00+03:00',
    });
    expect(relayed.deliveries[1]).toMatchObject({ copyStatus: 'PARTIAL', omittedAttachmentIds: ['attachment-2'] });
    expect(relayed.deliveries[0]?.messageId).not.toBe(relayed.deliveries[2]?.messageId);
  });

  it('отклоняет адресата вне дерева и недоступный канал', () => {
    expect(() => issueCascade({
      ...issueInput, revision: approvedIssuedRevision(), legs: [{ ...issueInput.legs[0]!, to: 'unknown' }],
    })).toThrow('дерев');
    expect(() => issueCascade({ ...issueInput, revision: approvedIssuedRevision(), availableChannelIds: [] })).toThrow('канал');
  });
});

describe('AC-04 двойная вертикаль и каскад документов', () => {
  it('проходит неполные поля, конфликт, частичное получение, новую редакцию и единый экспорт', async () => {
    const incomplete = revision({ requisites: { ...revision().requisites, basis: '' } });
    expect(() => transitionDocument(incomplete, 'APPROVE', {
      signature: { userId: 'authority', role: 'COMMANDER', signedAt: '2030-01-01T05:40:00+03:00' },
    })).toThrow('requisites.basis');

    let dual = advanceApproval({ command: 'PENDING', service: 'PENDING' }, { actor: 'commander', branch: 'command', decision: 'APPROVED', comment: 'Командная ветвь согласна' });
    expect(dual.state).toBe('IN_REVIEW');
    dual = advanceApproval(dual, { actor: 'service', branch: 'service', decision: 'CHANGES_REQUESTED', comment: 'Функциональная ветвь против' });
    expect(dual.state).toBe('CONFLICT');
    dual = resolveDualConflict(dual, { actor: 'designatedAuthority', decision: 'APPROVED', comment: 'Разногласие разрешено' });

    const issued = approvedIssuedRevision();
    const cascade = issueCascade({ ...issueInput, revision: issued });
    const first = advanceCascadeDelivery(advanceCascadeDelivery(cascade.deliveries[0]!, 'BEGIN', { at: '2030-01-01T06:01:00+03:00' }), 'DELIVER', { at: '2030-01-01T06:05:00+03:00' });
    const acknowledged = recordCascadeFact(first, 'ACKNOWLEDGED', { at: '2030-01-01T06:06:00+03:00', actorId: 'middle' });
    expect(acknowledged.executionStartedAt).toBeNull();
    expect(cascade.deliveries[1]?.state).toBe('QUEUED');

    const next = supersedeDocument(issued, { reason: 'Изменилась граница', sha256: NEXT_HASH });
    expect(next.supersedes).toBe(issued.sha256);
    expect(next.previousRevision?.signatures[0]?.sha256).toBe(issued.sha256);
    expect(next.previousRevision?.sha256).toBe(issued.sha256);
    const exported = await exportDocumentSet(next, { exerciseTitle: 'Учение AC-04', exerciseRevision: 1, exportedAt: '2030-01-01T06:10:00Z' });
    expect(exported.model.source.revision).toBe(2);
    expect(exported.model.legend).toEqual(['cp:v1']);
    expect(exported.model.attribution).toEqual(['Локальная топооснова']);
    await expect(verifyExportSet(exported)).resolves.toEqual({ valid: true, issues: [] });
  });
});
