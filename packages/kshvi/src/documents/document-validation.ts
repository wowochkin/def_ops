import {
  computeDocumentSha256Sync,
  type DocumentRecipient,
  type DocumentRevision,
  type VisibilityScope,
} from './document';

export type DocumentValidationIssue = Readonly<{
  code: string;
  severity: 'ERROR' | 'WARNING';
  field: string;
  message: string;
  ownerIds?: readonly string[];
}>;

const requiredRequisites = [
  'exerciseId',
  'scenarioRevisionId',
  'instanceId',
  'authorId',
  'title',
  'number',
  'operationalAt',
  'place',
  'validFrom',
  'validUntil',
  'stageId',
  'sideId',
  'sourceRole',
  'deliveryChannelId',
  'basis',
  'executorId',
  'deadlineAt',
  'templateVersion',
] as const;

export function validateDocumentReadiness(revision: DocumentRevision): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  for (const key of requiredRequisites) {
    const value = revision.requisites[key];
    if (typeof value !== 'string' || !value.trim()) {
      issues.push({
        code: `${key.toUpperCase()}_REQUIRED`,
        severity: 'ERROR',
        field: `requisites.${key}`,
        message: `Поле requisites.${key} обязательно для утверждения`,
      });
    }
  }
  if (revision.requisites.addressees.length === 0) {
    issues.push({
      code: 'ADDRESSEE_REQUIRED',
      severity: 'ERROR',
      field: 'requisites.addressees',
      message: 'Поле requisites.addressees обязательно для утверждения',
    });
  }
  if (!revision.content.body.trim()) {
    issues.push({ code: 'CONTENT_REQUIRED', severity: 'ERROR', field: 'content.body', message: 'Документ должен содержать редактируемое содержимое' });
  }
  if (!/^[0-9a-f]{64}$/.test(revision.sha256) || computeDocumentSha256Sync(revision) !== revision.sha256) {
    issues.push({ code: 'SHA256_INVALID', severity: 'ERROR', field: 'sha256', message: 'Нужен пересчитанный SHA-256 фактического содержимого редакции' });
  }
  const from = Date.parse(revision.requisites.validFrom);
  const until = Date.parse(revision.requisites.validUntil);
  if (Number.isFinite(from) && Number.isFinite(until) && from > until) {
    issues.push({ code: 'VALIDITY_PERIOD_INVALID', severity: 'ERROR', field: 'requisites.validUntil', message: 'Окончание действия раньше начала' });
  }
  return issues;
}

export function assertDocumentReady(revision: DocumentRevision): void {
  const issue = validateDocumentReadiness(revision)[0];
  if (issue) throw new Error(issue.message);
}

export function scopeIncludes(scope: VisibilityScope, recipient: DocumentRecipient): boolean {
  return (scope.sideIds.length === 0 || scope.sideIds.includes(recipient.sideId))
    && (scope.instanceIds.length === 0 || scope.instanceIds.includes(recipient.instanceId))
    && (scope.roles.length === 0 || scope.roles.some(role => recipient.roles.includes(role)));
}

export type DocumentIssueContext = Readonly<{
  recipient: DocumentRecipient;
  knownInstanceIds: readonly string[];
  availableChannelIds: readonly string[];
  senderHasAuthority: boolean;
  at: string;
}>;

/** Проверка выполняется до выдачи; скрыть вложение только в браузере недостаточно. */
export function assertDocumentIssue(revision: DocumentRevision, context: DocumentIssueContext): void {
  const { requisites } = revision;
  if (!context.senderHasAuthority) throw new Error('Отправитель не имеет полномочия на выдачу документа');
  if (!context.knownInstanceIds.includes(requisites.instanceId)) throw new Error('Отправитель отсутствует в дереве инстанций');
  const addressee = requisites.addressees.find(item => item.instanceId === context.recipient.instanceId);
  if (!addressee) throw new Error('Адресат не выбран из дерева инстанций документа');
  for (const target of requisites.addressees) {
    if (!context.knownInstanceIds.includes(target.instanceId)) throw new Error(`Адресат ${target.instanceId} отсутствует в дереве инстанций`);
    if (!context.availableChannelIds.includes(target.channelId)) throw new Error(`Канал ${target.channelId} недоступен`);
  }
  if (!context.availableChannelIds.includes(requisites.deliveryChannelId)) throw new Error('Выбранный канал доставки недоступен');
  if (!scopeIncludes(requisites.visibility, context.recipient)) throw new Error('Документ вне области видимости адресата');
  if (revision.map && !scopeIncludes(revision.map.visibility, context.recipient)) throw new Error('Карта вне области видимости адресата');
  const hidden = revision.attachments.find(attachment => !scopeIncludes(attachment.visibility, context.recipient));
  if (hidden) throw new Error(`Вложение ${hidden.id} вне области видимости адресата`);
  const at = Date.parse(context.at);
  if (!Number.isFinite(at)) throw new Error('Некорректное время выдачи');
  if (at < Date.parse(requisites.validFrom) || at > Date.parse(requisites.validUntil)) {
    throw new Error('Документ выдаётся вне периода действия');
  }
}

export function assertApprovedSignaturesMatch(revision: DocumentRevision): void {
  if (revision.signatures.length === 0) throw new Error('Утверждение требует подписи');
  const actualSha256 = computeDocumentSha256Sync(revision);
  const changed = actualSha256 !== revision.sha256
    || revision.signatures.some(signature => signature.revision !== revision.revision || signature.sha256 !== actualSha256);
  if (changed) throw new Error('Содержимое подписанной редакции изменилось; создайте новую редакцию');
}

export type DocumentAnalysisContext = Readonly<{
  tasks?: readonly Readonly<{ id: string; orderId: string | null; contradictsSuperior: boolean; justification: string }>[];
  stages?: readonly Readonly<{ id: string; endsAt: string; nextStartsAt: string; ownerIds: readonly string[] }>[];
  recipient?: DocumentRecipient;
  receiptDeadlineAt?: string;
  now?: string;
  serviceDecisions?: readonly string[];
  requiredResourceIds?: readonly string[];
  availableResourceIds?: readonly string[];
  availableChannelIds?: readonly string[];
}>;

export function analyzeDocument(revision: DocumentRevision, context: DocumentAnalysisContext): DocumentValidationIssue[] {
  const issues: DocumentValidationIssue[] = [];
  for (const task of context.tasks ?? []) {
    if (task.orderId !== revision.documentId) {
      issues.push({ code: 'TASK_ORDER_LINK_REQUIRED', severity: 'WARNING', field: `tasks.${task.id}.orderId`, message: `Задача ${task.id} не связана с приказом ${revision.documentId}` });
    }
    if (task.contradictsSuperior && !task.justification.trim()) {
      issues.push({ code: 'TASK_SUPERIOR_CONTRADICTION', severity: 'WARNING', field: `tasks.${task.id}.justification`, message: `Для исключения из вышестоящей задачи ${task.id} нужно обоснование` });
    }
  }
  for (const stage of context.stages ?? []) {
    if (Date.parse(stage.endsAt) > Date.parse(stage.nextStartsAt)) {
      issues.push({ code: 'STAGE_PERIOD_CONFLICT', severity: 'ERROR', field: `stages.${stage.id}`, message: 'Сроки соседних этапов не согласованы', ownerIds: stage.ownerIds });
    }
  }
  if (context.recipient && !scopeIncludes(revision.requisites.visibility, context.recipient)) {
    issues.push({ code: 'DOCUMENT_VISIBILITY_CONFLICT', severity: 'ERROR', field: 'requisites.visibility', message: 'Документ содержит данные вне видимости адресата' });
  }
  if (context.recipient) {
    const hidden = revision.attachments.find(attachment => !scopeIncludes(attachment.visibility, context.recipient as DocumentRecipient));
    if (hidden) issues.push({ code: 'ATTACHMENT_VISIBILITY_CONFLICT', severity: 'ERROR', field: `attachments.${hidden.id}.visibility`, message: 'Вложение содержит данные вне видимости адресата' });
  }
  if (context.receiptDeadlineAt && context.now && revision.delivery.state !== 'DELIVERED'
    && revision.delivery.state !== 'ACKNOWLEDGED' && revision.delivery.state !== 'EXECUTION_STARTED'
    && Date.parse(context.now) > Date.parse(context.receiptDeadlineAt)) {
    issues.push({ code: 'RECEIPT_OVERDUE', severity: 'WARNING', field: 'delivery', message: 'Получение не подтверждено к сроку; нужны напоминание и эскалация, а не отметка исполнения' });
  }
  const decisions = new Set(context.serviceDecisions ?? []);
  if (decisions.has('CHANGES_REQUESTED') && (decisions.has('APPROVED') || decisions.size > 1)) {
    issues.push({ code: 'SERVICE_CONFLICT', severity: 'ERROR', field: 'approvalRoute', message: 'Несовместимые указания служб направляются по маршруту разрешения' });
  }
  const availableResources = new Set(context.availableResourceIds ?? []);
  for (const resourceId of context.requiredResourceIds ?? []) {
    if (!availableResources.has(resourceId)) issues.push({ code: 'RESOURCE_MISSING', severity: 'ERROR', field: 'resources', message: `Для задачи отсутствует ресурс ${resourceId}` });
  }
  if (context.availableChannelIds && !context.availableChannelIds.includes(revision.requisites.deliveryChannelId)) {
    issues.push({ code: 'CHANNEL_UNAVAILABLE', severity: 'ERROR', field: 'requisites.deliveryChannelId', message: 'Выбранный канал недоступен' });
  }
  if (computeDocumentSha256Sync(revision) !== revision.sha256
    || revision.signatures.some(signature => signature.sha256 !== revision.sha256 || signature.revision !== revision.revision)) {
    issues.push({ code: 'SIGNED_CONTENT_CHANGED', severity: 'ERROR', field: 'sha256', message: 'Изменённый подписанный документ требует новой редакции' });
  }
  return issues;
}
