import {
  computeDocumentSha256Sync,
  type ApprovalSignature,
  type DocumentFactType,
  type DocumentRevision,
} from './document';
import {
  assertApprovedSignaturesMatch,
  assertDocumentIssue,
  assertDocumentReady,
  type DocumentIssueContext,
} from './document-validation';

export class DocumentRevisionConflictError extends Error {
  readonly status = 409;
  readonly code = 'DOCUMENT_REVISION_CONFLICT';

  constructor(expectedRevision: number, actualRevision: number) {
    super(`Данные изменились: ожидалась редакция ${expectedRevision}, актуальна ${actualRevision}`);
    this.name = 'DocumentRevisionConflictError';
  }
}

export type DocumentTransitionAction = 'SUBMIT' | 'APPROVE' | 'ISSUE' | 'RETURN' | 'CANCEL';

export type DocumentTransitionContext = Readonly<{
  expectedRevision?: number;
  signature?: Omit<ApprovalSignature, 'revision' | 'sha256'>;
  comment?: string;
  issue?: DocumentIssueContext;
}>;

function assertExpectedRevision(revision: DocumentRevision, expectedRevision: number | undefined): void {
  if (expectedRevision !== undefined && expectedRevision !== revision.revision) {
    throw new DocumentRevisionConflictError(expectedRevision, revision.revision);
  }
}

function instant(value: string, message: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(message);
  return parsed;
}

export function transitionDocument(
  revision: DocumentRevision,
  action: DocumentTransitionAction,
  context: DocumentTransitionContext = {},
): DocumentRevision {
  assertExpectedRevision(revision, context.expectedRevision);
  if (action === 'SUBMIT') {
    if (revision.state !== 'DRAFT') throw new Error('В согласование можно направить только DRAFT');
    return { ...revision, state: 'IN_REVIEW', returnComment: undefined };
  }
  if (action === 'APPROVE') {
    if (revision.state !== 'IN_REVIEW') throw new Error('Утверждается только редакция IN_REVIEW');
    assertDocumentReady(revision);
    if (!context.signature) throw new Error('Электронное утверждение требует подписи');
    const { userId, role, signedAt, external } = context.signature;
    if (!userId.trim() || !role.trim()) throw new Error('Подпись требует учётную запись и назначенную роль');
    instant(signedAt, 'Некорректный момент подписания');
    const signature: ApprovalSignature = {
      userId,
      role,
      signedAt,
      ...(external ? { external: { ...external } } : {}),
      revision: revision.revision,
      sha256: revision.sha256,
    };
    return { ...revision, state: 'APPROVED', signatures: [...revision.signatures, signature] };
  }
  if (action === 'ISSUE') {
    if (!context.issue) throw new Error('Для выдачи нужны адресат, канал и полномочие отправителя');
    assertApprovedSignaturesMatch(revision);
    return issueDocument(revision, context.issue);
  }
  if (action === 'RETURN') {
    if (revision.state !== 'IN_REVIEW') throw new Error('С замечаниями возвращается только редакция IN_REVIEW');
    if (!context.comment?.trim()) throw new Error('Возврат требует замечания');
    return { ...revision, state: 'DRAFT', returnComment: context.comment };
  }
  if (revision.state === 'ISSUED' || revision.state === 'SUPERSEDED' || revision.state === 'CANCELLED') {
    throw new Error('Выданную или завершённую редакцию нельзя отменить этим переходом');
  }
  return { ...revision, state: 'CANCELLED' };
}

export function issueDocument(revision: DocumentRevision, context: DocumentIssueContext): DocumentRevision {
  assertDocumentIssue(revision, context);
  if (revision.state !== 'APPROVED') throw new Error('Выдаётся только утверждённая редакция');
  assertDocumentReady(revision);
  assertApprovedSignaturesMatch(revision);
  return {
    ...revision,
    state: 'ISSUED',
    delivery: { ...revision.delivery, state: 'ISSUED' },
  };
}

export function supersedeDocument(
  revision: DocumentRevision,
  input: Readonly<{
    reason: string;
    sha256: string;
    requisites?: DocumentRevision['requisites'];
    content?: DocumentRevision['content'];
    map?: DocumentRevision['map'];
    attachments?: DocumentRevision['attachments'];
  }>,
): DocumentRevision {
  if (revision.state !== 'APPROVED' && revision.state !== 'ISSUED') {
    throw new Error('Новая редакция создаётся из утверждённого или выданного документа');
  }
  if (!input.reason.trim()) throw new Error('Исправление подписанного документа требует основания');
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new Error('Новая редакция требует SHA-256 содержимого');
  assertApprovedSignaturesMatch(revision);
  const number = revision.revision + 1;
  const draft: DocumentRevision = {
    ...revision,
    id: `${revision.documentId}:r${number}`,
    revision: number,
    state: 'DRAFT',
    requisites: input.requisites ?? revision.requisites,
    content: input.content ?? revision.content,
    map: input.map ?? revision.map,
    attachments: input.attachments ?? revision.attachments,
    sha256: input.sha256,
    supersedes: revision.sha256,
    supersedesRevision: revision.revision,
    supersedeReason: input.reason,
    signatures: [],
    delivery: { state: 'NOT_ISSUED', facts: [] },
    returnComment: undefined,
    previousRevision: { ...revision, state: 'SUPERSEDED' },
  };
  return { ...draft, sha256: computeDocumentSha256Sync(draft) };
}

export function recordDocumentFact(
  revision: DocumentRevision,
  type: DocumentFactType,
  fact: Readonly<{ at: string; actorId: string }>,
): DocumentRevision {
  if (revision.state !== 'ISSUED' && revision.state !== 'SUPERSEDED') throw new Error('Факт получения регистрируется только после выдачи');
  if (!fact.actorId.trim()) throw new Error('Факт документа требует ответственного');
  const at = instant(fact.at, 'Некорректное время факта документа');
  const previous = revision.delivery.facts.at(-1);
  if (previous && at < instant(previous.at, 'Некорректное предыдущее время документа')) throw new Error('Факты документа не переписывают прошлое');
  const expectedPrevious: Record<DocumentFactType, DocumentRevision['delivery']['state']> = {
    DELIVERED: 'ISSUED',
    ACKNOWLEDGED: 'DELIVERED',
    EXECUTION_STARTED: 'ACKNOWLEDGED',
  };
  if (revision.delivery.state !== expectedPrevious[type]) {
    const message = type === 'DELIVERED'
      ? 'Получение уже отражено либо документ ещё не выдан'
      : type === 'ACKNOWLEDGED'
        ? 'Ознакомление регистрируется после получения'
        : 'Исполнение регистрируется после получения и ознакомления';
    throw new Error(message);
  }
  return {
    ...revision,
    delivery: {
      state: type === 'DELIVERED' ? 'DELIVERED' : type === 'ACKNOWLEDGED' ? 'ACKNOWLEDGED' : 'EXECUTION_STARTED',
      facts: [...revision.delivery.facts, { type, at: fact.at, actorId: fact.actorId }],
    },
  };
}
