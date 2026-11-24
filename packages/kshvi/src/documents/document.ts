import { sha256Hex } from '../scenario/initial-map-hash';

export type DocumentCategory = 'PREPARATORY' | 'ORGANIZATIONAL' | 'EDUCATIONAL' | 'OPERATIONAL' | 'FINAL';

export type DocumentType =
  | 'ORDER'
  | 'COMBAT_ORDER'
  | 'DIRECTIVE'
  | 'PLAN'
  | 'REPORT'
  | 'BRIEFING'
  | 'REQUEST'
  | 'INTELLIGENCE_SUMMARY'
  | 'OPERATIONAL_ASSIGNMENT'
  | 'INJECT'
  | 'DUTY_JOURNAL'
  | 'ASSESSMENT_SHEET'
  | 'DEBRIEF_MATERIAL';

export type DocumentState = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'ISSUED' | 'SUPERSEDED' | 'CANCELLED';
export type DocumentDeliveryState = 'NOT_ISSUED' | 'ISSUED' | 'DELIVERED' | 'ACKNOWLEDGED' | 'EXECUTION_STARTED';
export type DocumentFactType = 'DELIVERED' | 'ACKNOWLEDGED' | 'EXECUTION_STARTED';

export type VisibilityScope = Readonly<{
  sideIds: readonly string[];
  instanceIds: readonly string[];
  roles: readonly string[];
}>;

export type DocumentRecipient = Readonly<{
  instanceId: string;
  sideId: string;
  roles: readonly string[];
}>;

export type DocumentAddressee = Readonly<{
  instanceId: string;
  channelId: string;
}>;

export type DocumentRequisites = Readonly<{
  exerciseId: string;
  scenarioRevisionId: string;
  instanceId: string;
  authorId: string;
  category: DocumentCategory;
  type: DocumentType;
  title: string;
  number: string;
  operationalAt: string;
  place: string;
  validFrom: string;
  validUntil: string;
  stageId: string;
  sideId: string;
  visibility: VisibilityScope;
  addressees: readonly DocumentAddressee[];
  copies: readonly string[];
  sourceRole: string;
  deliveryChannelId: string;
  basis: string;
  executorId: string;
  deadlineAt: string;
  linkedEventIds: readonly string[];
  linkedDecisionIds: readonly string[];
  linkedTaskIds: readonly string[];
  templateVersion: string;
}>;

export type DocumentMap = Readonly<{
  environmentSnapshotId: string;
  legend: readonly string[];
  attribution: readonly string[];
  visibility: VisibilityScope;
}>;

export type DocumentAttachment = Readonly<{
  id: string;
  title: string;
  sha256: string;
  contentRef: string | null;
  paperOriginal: boolean;
  visibility: VisibilityScope;
}>;

export type ExternalCryptographicSignature = Readonly<{
  provider: string;
  certificateRef: string;
  value: string;
}>;

export type ApprovalSignature = Readonly<{
  userId: string;
  role: string;
  signedAt: string;
  revision: number;
  sha256: string;
  external?: ExternalCryptographicSignature;
}>;

export type DocumentFact = Readonly<{
  type: DocumentFactType;
  at: string;
  actorId: string;
}>;

export type DocumentDelivery = Readonly<{
  state: DocumentDeliveryState;
  facts: readonly DocumentFact[];
}>;

export type DocumentContent = Readonly<{
  body: string;
  units: Readonly<Record<string, string>>;
}>;

export type DocumentRevision = Readonly<{
  id: string;
  documentId: string;
  revision: number;
  state: DocumentState;
  requisites: DocumentRequisites;
  content: DocumentContent;
  map: DocumentMap | null;
  attachments: readonly DocumentAttachment[];
  approvalRouteId: string;
  sha256: string;
  supersedes: string | null;
  supersedesRevision: number | null;
  supersedeReason: string | null;
  signatures: readonly ApprovalSignature[];
  delivery: DocumentDelivery;
  returnComment?: string;
  previousRevision?: DocumentRevision;
}>;

/** Единое версионное хранилище всех категорий документов одного учения. */
export type ExerciseDocument = Readonly<{
  exerciseId: string;
  documentId: string;
  revisions: readonly DocumentRevision[];
}>;

function canonical(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number') {
      if (!Number.isFinite(input)) throw new Error('Хеш документа требует конечных чисел');
      return Object.is(input, -0) ? 0 : input;
    }
    if (Array.isArray(input)) return input.map(normalize);
    if (input && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalize(item)]));
    }
    throw new Error('Содержимое документа не поддерживает канонический JSON');
  };
  return JSON.stringify(normalize(value));
}

function documentContent(revision: DocumentRevision): unknown {
  return {
    documentId: revision.documentId,
    requisites: revision.requisites,
    content: revision.content,
    map: revision.map,
    attachments: revision.attachments,
    approvalRouteId: revision.approvalRouteId,
    supersedes: revision.supersedes,
    supersedesRevision: revision.supersedesRevision,
    supersedeReason: revision.supersedeReason,
  };
}

/** Синхронный пересчёт нужен всем переходам и не зависит от node:* или WebCrypto. */
export function computeDocumentSha256Sync(revision: DocumentRevision): string {
  // Локальный импорт исключён из браузерного графа node:*: это чистая реализация SHA-256.
  return sha256Hex(canonical(documentContent(revision)));
}

/** SHA-256 считается только от содержимого, а не от состояния, подписей или журнала выдачи. */
export async function computeDocumentSha256(revision: DocumentRevision): Promise<string> {
  return computeDocumentSha256Sync(revision);
}
