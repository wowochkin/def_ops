import { describe, expect, it } from 'vitest';
import type { DocumentRequisites, DocumentRevision } from '../src/documents/document';
import { computeDocumentSha256, computeDocumentSha256Sync } from '../src/documents/document';
import {
  DocumentRevisionConflictError,
  issueDocument,
  recordDocumentFact,
  supersedeDocument,
  transitionDocument,
} from '../src/documents/document-lifecycle';
import { canonicalJson } from '../src/events/canonical';
import {
  analyzeDocument,
  assertDocumentIssue,
  assertDocumentReady,
  validateDocumentReadiness,
} from '../src/documents/document-validation';

const HASH = 'a'.repeat(64);
const NEXT_HASH = 'b'.repeat(64);

function requisites(overrides: Partial<DocumentRequisites> = {}): DocumentRequisites {
  return {
    exerciseId: 'exercise-1',
    scenarioRevisionId: 'scenario-3',
    instanceId: 'hq',
    authorId: 'author-1',
    category: 'OPERATIONAL',
    type: 'ORDER',
    title: 'Приказ на действия',
    number: '15',
    operationalAt: '2030-01-01T06:00:00+03:00',
    place: 'Пункт управления',
    validFrom: '2030-01-01T06:00:00+03:00',
    validUntil: '2030-01-02T06:00:00+03:00',
    stageId: 'stage-1',
    sideId: 'blue',
    visibility: { sideIds: ['blue'], instanceIds: [], roles: [] },
    addressees: [{ instanceId: 'unit-1', channelId: 'radio-1' }],
    copies: [],
    sourceRole: 'COMMANDER',
    deliveryChannelId: 'radio-1',
    basis: 'Замысел учения',
    executorId: 'unit-1',
    deadlineAt: '2030-01-01T08:00:00+03:00',
    linkedEventIds: ['event-1'],
    linkedDecisionIds: ['decision-1'],
    linkedTaskIds: ['task-1'],
    templateVersion: 'order:v1',
    ...overrides,
  };
}

function revision(overrides: Partial<DocumentRevision> = {}): DocumentRevision {
  const value: DocumentRevision = {
    id: 'order-1:r1',
    documentId: 'order-1',
    revision: 1,
    state: 'IN_REVIEW',
    requisites: requisites(),
    content: { body: 'Выполнить задачу', units: { distance: 'm', duration: 'min' } },
    map: null,
    attachments: [],
    approvalRouteId: 'route-1',
    sha256: HASH,
    supersedes: null,
    supersedesRevision: null,
    supersedeReason: null,
    signatures: [],
    delivery: { state: 'NOT_ISSUED', facts: [] },
    ...overrides,
  };
  return overrides.sha256 ? value : { ...value, sha256: computeDocumentSha256Sync(value) };
}

const signature = {
  userId: 'commander-1',
  role: 'COMMANDER',
  signedAt: '2030-01-01T05:30:00+03:00',
};

describe('реквизиты и готовность документа', () => {
  it('показывает конкретные обязательные поля и блокирует утверждение', () => {
    const incomplete = revision({
      requisites: requisites({ basis: '', executorId: '', deadlineAt: '', addressees: [] }),
    });
    expect(validateDocumentReadiness(incomplete).map(issue => issue.field)).toEqual(expect.arrayContaining([
      'requisites.basis',
      'requisites.executorId',
      'requisites.deadlineAt',
      'requisites.addressees',
    ]));
    expect(() => assertDocumentReady(incomplete)).toThrow('requisites.basis');
    expect(() => transitionDocument(incomplete, 'APPROVE', { signature })).toThrow('requisites.basis');
  });

  it('вычисляет SHA-256 содержимого без учёта служебного состояния', async () => {
    const first = revision();
    const second = revision({ id: 'другой-id', state: 'DRAFT', revision: 9 });
    await expect(computeDocumentSha256(first)).resolves.toBe(await computeDocumentSha256(second));
    await expect(computeDocumentSha256(second)).resolves.toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('неизменяемые подписанные редакции', () => {
  it('повторное согласование удаляет прежнее замечание из канонического состояния', () => {
    const submitted = transitionDocument(revision({ state: 'DRAFT', returnComment: 'Прежнее замечание' }), 'SUBMIT');
    expect(submitted.returnComment).toBeUndefined();
    expect('returnComment' in submitted).toBe(false);
    expect(() => canonicalJson(submitted)).not.toThrow();
  });

  it('фиксирует пользователя, роль, момент, редакцию и хеш', () => {
    const approved = transitionDocument(revision(), 'APPROVE', {
      expectedRevision: 1,
      signature: { ...signature, external: { provider: 'локальный файл', certificateRef: 'cert-1', value: 'signature-value' } },
    });
    expect(approved.state).toBe('APPROVED');
    expect(approved.signatures).toEqual([expect.objectContaining({
      userId: 'commander-1',
      role: 'COMMANDER',
      signedAt: signature.signedAt,
      revision: 1,
      sha256: approved.sha256,
    })]);
    expect(approved.signatures[0]?.external).toEqual(expect.objectContaining({ certificateRef: 'cert-1' }));
  });

  it('возвращает 409 при устаревшей expectedRevision', () => {
    expect(() => transitionDocument(revision(), 'APPROVE', { expectedRevision: 0, signature }))
      .toThrow(DocumentRevisionConflictError);
    try {
      transitionDocument(revision(), 'APPROVE', { expectedRevision: 0, signature });
    } catch (error) {
      expect(error).toMatchObject({ status: 409, code: 'DOCUMENT_REVISION_CONFLICT' });
    }
  });

  it('создаёт supersedes и сохраняет прежнюю подпись, хеш и выдачу', () => {
    const approved = transitionDocument(revision(), 'APPROVE', { signature });
    const issued = issueDocument(approved, {
      recipient: { instanceId: 'unit-1', sideId: 'blue', roles: ['COMMANDER'] },
      knownInstanceIds: ['hq', 'unit-1'],
      availableChannelIds: ['radio-1'],
      senderHasAuthority: true,
      at: '2030-01-01T06:10:00+03:00',
    });
    const next = supersedeDocument(issued, { reason: 'Уточнение границ', sha256: NEXT_HASH });
    expect(next).toMatchObject({
      revision: 2,
      state: 'DRAFT',
      supersedes: approved.sha256,
      supersedesRevision: 1,
      supersedeReason: 'Уточнение границ',
      signatures: [],
      delivery: { state: 'NOT_ISSUED', facts: [] },
    });
    expect(next.sha256).toBe(computeDocumentSha256Sync(next));
    expect(next.previousRevision).toMatchObject({
      state: 'SUPERSEDED',
      revision: 1,
      sha256: approved.sha256,
      delivery: { state: 'ISSUED' },
    });
    expect(next.previousRevision?.signatures[0]).toMatchObject({ sha256: approved.sha256, userId: 'commander-1' });
    expect(issued.state).toBe('ISSUED');
    expect(issued.signatures).toHaveLength(1);
  });

  it('не принимает изменённый файл под прежней подписью', () => {
    const approved = transitionDocument(revision(), 'APPROVE', { signature });
    expect(() => transitionDocument({ ...approved, sha256: NEXT_HASH }, 'ISSUE', {
      issue: {
        recipient: { instanceId: 'unit-1', sideId: 'blue', roles: [] },
        knownInstanceIds: ['hq', 'unit-1'],
        availableChannelIds: ['radio-1'],
        senderHasAuthority: true,
        at: '2030-01-01T06:10:00+03:00',
      },
    })).toThrow('подпис');
  });
});

describe('видимость, выдача и исполнение', () => {
  const issue = {
    recipient: { instanceId: 'unit-1', sideId: 'blue', roles: ['COMMANDER'] },
    knownInstanceIds: ['hq', 'unit-1'],
    availableChannelIds: ['radio-1'],
    senderHasAuthority: true,
    at: '2030-01-01T06:10:00+03:00',
  };

  it('блокирует вложение вне области видимости адресата', () => {
    const hidden = revision({
      attachments: [{
        id: 'attachment-red',
        title: 'Скрытая схема',
        sha256: HASH,
        contentRef: 'files/red.pdf',
        paperOriginal: false,
        visibility: { sideIds: ['red'], instanceIds: [], roles: [] },
      }],
    });
    expect(() => assertDocumentIssue(hidden, issue)).toThrow('видимости');
    expect(() => issueDocument(hidden, issue)).toThrow('видимости');
  });

  it('регистрирует получение, ознакомление и начало исполнения раздельно', () => {
    const approved = transitionDocument(revision(), 'APPROVE', { signature });
    const issued = issueDocument(approved, issue);
    const delivered = recordDocumentFact(issued, 'DELIVERED', { at: '2030-01-01T06:20:00+03:00', actorId: 'unit-1' });
    expect(delivered.delivery.state).toBe('DELIVERED');
    expect(delivered.state).toBe('ISSUED');
    const acknowledged = recordDocumentFact(delivered, 'ACKNOWLEDGED', { at: '2030-01-01T06:25:00+03:00', actorId: 'unit-1' });
    const started = recordDocumentFact(acknowledged, 'EXECUTION_STARTED', { at: '2030-01-01T06:30:00+03:00', actorId: 'unit-1' });
    expect(started.delivery.state).toBe('EXECUTION_STARTED');
    expect(started.delivery.facts.map(fact => fact.type)).toEqual(['DELIVERED', 'ACKNOWLEDGED', 'EXECUTION_STARTED']);
    expect(issued.delivery.facts).toEqual([]);
    expect(() => recordDocumentFact(issued, 'EXECUTION_STARTED', { at: '2030-01-01T06:30:00+03:00', actorId: 'unit-1' }))
      .toThrow('получ');
  });
});

describe('аналитика типовых ошибок DOC-16', () => {
  it('различает связи задач, сроки, конфликт служб и недоступные ресурсы', () => {
    const issues = analyzeDocument(revision(), {
      tasks: [{ id: 'task-1', orderId: null, contradictsSuperior: true, justification: '' }],
      stages: [{ id: 'stage-1', endsAt: '2030-01-01T10:00:00+03:00', nextStartsAt: '2030-01-01T09:00:00+03:00', ownerIds: ['hq'] }],
      receiptDeadlineAt: '2030-01-01T06:15:00+03:00',
      now: '2030-01-01T06:20:00+03:00',
      serviceDecisions: ['APPROVED', 'CHANGES_REQUESTED'],
      requiredResourceIds: ['fuel'],
      availableResourceIds: [],
      availableChannelIds: [],
    });
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'TASK_ORDER_LINK_REQUIRED',
      'TASK_SUPERIOR_CONTRADICTION',
      'STAGE_PERIOD_CONFLICT',
      'RECEIPT_OVERDUE',
      'SERVICE_CONFLICT',
      'RESOURCE_MISSING',
      'CHANNEL_UNAVAILABLE',
    ]));
    expect(issues.find(issue => issue.code === 'TASK_ORDER_LINK_REQUIRED')).toMatchObject({ severity: 'WARNING' });
  });
});
