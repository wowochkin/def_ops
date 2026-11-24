import { expect, it } from 'vitest';
import { computeDocumentSha256, type DocumentRevision } from '../src/documents/document';
import { transitionDocument } from '../src/documents/document-lifecycle';
import { advanceApproval } from '../src/documents/dual-chain';

function revision(sha256: string): DocumentRevision {
  return {
    id: 'order:r1', documentId: 'order', revision: 1, state: 'IN_REVIEW',
    requisites: {
      exerciseId: 'exercise', scenarioRevisionId: 'scenario', instanceId: 'hq', authorId: 'author', category: 'OPERATIONAL', type: 'ORDER',
      title: 'Приказ', number: '1', operationalAt: '2030-01-01T06:00:00Z', place: 'КП', validFrom: '2030-01-01T00:00:00Z',
      validUntil: '2030-01-02T00:00:00Z', stageId: 'stage', sideId: 'blue', visibility: { sideIds: ['blue'], instanceIds: [], roles: [] },
      addressees: [{ instanceId: 'unit', channelId: 'radio' }], copies: [], sourceRole: 'COMMANDER', deliveryChannelId: 'radio', basis: 'Замысел',
      executorId: 'unit', deadlineAt: '2030-01-01T08:00:00Z', linkedEventIds: [], linkedDecisionIds: [], linkedTaskIds: [], templateVersion: 'v1',
    },
    content: { body: 'Исходное содержимое', units: {} }, map: null, attachments: [], approvalRouteId: 'route', sha256,
    supersedes: null, supersedesRevision: null, supersedeReason: null, signatures: [], delivery: { state: 'NOT_ISSUED', facts: [] },
  };
}

it('I7: утверждение и выдача пересчитывают фактический хеш содержимого', async () => {
  const draft = revision('a'.repeat(64));
  const actualHash = await computeDocumentSha256(draft);
  const approved = transitionDocument({ ...draft, sha256: actualHash }, 'APPROVE', {
    signature: { userId: 'chief', role: 'COMMANDER', signedAt: '2030-01-01T05:00:00Z' },
  });
  const tampered = { ...approved, content: { ...approved.content, body: 'Подменённое содержимое' } };
  expect(() => transitionDocument(tampered, 'ISSUE', {
    issue: {
      recipient: { instanceId: 'unit', sideId: 'blue', roles: ['COMMANDER'] }, knownInstanceIds: ['hq', 'unit'], availableChannelIds: ['radio'],
      senderHasAuthority: true, at: '2030-01-01T06:00:00Z',
    },
  })).toThrow('Содержимое');
});

it('I7: неверный сохранённый хеш нельзя утвердить даже при совпадающей подписи', async () => {
  const draft = revision('a'.repeat(64));
  expect(() => transitionDocument(draft, 'APPROVE', {
    signature: { userId: 'chief', role: 'COMMANDER', signedAt: '2030-01-01T05:00:00Z' },
  })).toThrow('SHA-256');
});

it('I8: согласие командной и функциональной ветвей завершает согласование', () => {
  const pending = { command: 'PENDING', service: 'PENDING' } as const;
  const command = advanceApproval(pending, { actor: 'chief', branch: 'command', decision: 'APPROVED' });
  const both = advanceApproval(command, { actor: 'service', branch: 'service', decision: 'APPROVED' });
  expect(both.state).toBe('APPROVED');
});
