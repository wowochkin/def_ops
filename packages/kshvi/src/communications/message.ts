import type { CommunicationMessage, MessageRoute } from './channel';

export type TransportStatus = 'queued' | 'inTransit' | 'delivered' | 'failed' | 'cancelled';

export type DeliveryJournalEntry = Readonly<{
  messageId: string;
  attempt: number;
  domainKey: string | null;
  duplicate: boolean;
  at?: string;
}>;

export type MessageAttempt = Readonly<{
  messageId: string;
  attempt: number;
  senderRole: string;
  fromInstanceId: string;
  recipients: readonly string[];
  priority: number;
  sizeBytes: number;
  domainKey: string | null;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  route: MessageRoute;
  status: TransportStatus;
  result: 'DELIVERED' | 'FAILED' | 'CANCELLED' | null;
  failureReason: string | null;
  appliedDomainKeys: readonly string[];
  duplicate: boolean;
  domainEffectApplied: boolean;
  partial: boolean;
  recipientResults: Readonly<Record<string, 'queued' | 'delivered' | 'failed'>>;
  previousAttempt?: MessageAttempt;
  deliveryJournalEntry?: DeliveryJournalEntry;
}>;

export function createMessageAttempt(
  message: CommunicationMessage,
  route: MessageRoute,
  queuedAt: string,
  previousAttempt?: MessageAttempt,
): MessageAttempt {
  if (!Number.isFinite(Date.parse(queuedAt))) throw new Error('Некорректное время постановки сообщения');
  return {
    messageId: message.id,
    attempt: previousAttempt ? previousAttempt.attempt + 1 : 1,
    senderRole: message.senderRole,
    fromInstanceId: message.fromInstanceId,
    recipients: [...message.recipientIds],
    priority: message.priority,
    sizeBytes: message.sizeBytes,
    domainKey: message.domainKey,
    queuedAt,
    startedAt: null,
    completedAt: null,
    route: { ...route, nodeIds: [...route.nodeIds], events: [...route.events] },
    status: 'queued',
    result: null,
    failureReason: null,
    appliedDomainKeys: [...(previousAttempt?.appliedDomainKeys ?? [])],
    duplicate: false,
    domainEffectApplied: false,
    partial: false,
    recipientResults: Object.fromEntries(message.recipientIds.map(recipient => [recipient, 'queued'])),
    ...(previousAttempt ? { previousAttempt } : {}),
  };
}

export type DeliveryInput = Readonly<{
  messageId: string;
  attempt: number;
  domainKey: string | null;
  appliedDomainKeys: readonly string[];
  recipientIds?: readonly string[];
  duplicate?: boolean;
}>;

export type DeliveryOutcome = Readonly<{
  status: 'delivered';
  duplicate: boolean;
  appliedDomainKeys: readonly string[];
  domainEffectApplied: boolean;
  domainEffect: 'APPLIED' | 'SKIPPED_DUPLICATE' | 'NONE';
  deliveryJournalEntry: DeliveryJournalEntry;
}>;

/** Доменный эффект отделён от видимого транспортного дубликата. */
export function deliverAttempt<T extends DeliveryInput>(input: T): Omit<T, keyof DeliveryOutcome> & DeliveryOutcome {
  const effectKeys = input.domainKey === null ? [] : input.recipientIds?.length
    ? input.recipientIds.map(recipient => `${input.domainKey}:${recipient}`)
    : [input.domainKey];
  const newEffectKeys = effectKeys.filter(key => !input.appliedDomainKeys.includes(key));
  const alreadyApplied = effectKeys.length > 0 && newEffectKeys.length === 0;
  const duplicate = input.duplicate === true || alreadyApplied;
  const domainEffectApplied = newEffectKeys.length > 0;
  const appliedDomainKeys = [...input.appliedDomainKeys, ...newEffectKeys];
  return {
    ...input,
    status: 'delivered',
    duplicate,
    appliedDomainKeys,
    domainEffectApplied,
    domainEffect: input.domainKey === null ? 'NONE' : domainEffectApplied ? 'APPLIED' : 'SKIPPED_DUPLICATE',
    deliveryJournalEntry: { messageId: input.messageId, attempt: input.attempt, domainKey: input.domainKey, duplicate },
  };
}

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Некорректное время попытки сообщения');
  return parsed;
}

export function advanceMessage(
  attempt: MessageAttempt,
  action: 'START' | 'DELIVER' | 'FAIL' | 'CANCEL',
  input: Readonly<{ at: string; reason?: string; recipientIds?: readonly string[] }>,
): MessageAttempt {
  const at = instant(input.at);
  if (action === 'START') {
    if (attempt.status !== 'queued') throw new Error('Передача начинается только из queued');
    return { ...attempt, status: 'inTransit', startedAt: input.at, failureReason: null };
  }
  if (action === 'DELIVER') {
    if (attempt.status !== 'inTransit' || !attempt.startedAt) throw new Error('Доставляется только попытка inTransit');
    if (at < instant(attempt.startedAt) + attempt.route.delayMs) throw new Error('Доставка раньше версионной задержки канала');
    const recipientIds = input.recipientIds ?? attempt.recipients;
    if (!recipientIds.length || recipientIds.some(recipient => !attempt.recipients.includes(recipient))) throw new Error('Получатели доставки не принадлежат сообщению');
    const partial = recipientIds.length < attempt.recipients.length;
    const delivered = deliverAttempt({ ...attempt, recipientIds });
    return {
      ...delivered,
      status: partial ? 'failed' : 'delivered',
      partial,
      completedAt: input.at,
      result: partial ? 'FAILED' : 'DELIVERED',
      failureReason: partial ? 'Доставлено не всем получателям; требуется повтор оставшимся' : null,
      recipientResults: Object.fromEntries(attempt.recipients.map(recipient => [recipient, recipientIds.includes(recipient) ? 'delivered' : 'failed'])),
      deliveryJournalEntry: { ...delivered.deliveryJournalEntry, at: input.at },
    };
  }
  if (attempt.status !== 'queued' && attempt.status !== 'inTransit') throw new Error('Завершённую попытку нельзя изменить');
  if (action === 'FAIL' && !input.reason?.trim()) throw new Error('Отказ сообщения требует причины');
  return {
    ...attempt,
    status: action === 'FAIL' ? 'failed' : 'cancelled',
    result: action === 'FAIL' ? 'FAILED' : 'CANCELLED',
    completedAt: input.at,
    failureReason: input.reason ?? (action === 'CANCEL' ? 'Отменено' : null),
  };
}

export function retryMessage(attempt: MessageAttempt, queuedAt: string): MessageAttempt {
  if (attempt.status !== 'failed' && attempt.status !== 'cancelled') throw new Error('Повтор создаётся после failed или cancelled');
  const recipients = attempt.partial
    ? attempt.recipients.filter(recipient => attempt.recipientResults[recipient] !== 'delivered')
    : attempt.recipients;
  if (!recipients.length) throw new Error('Все получатели уже получили сообщение');
  return createMessageAttempt({
    id: attempt.messageId,
    type: 'ORDER',
    senderRole: attempt.senderRole,
    fromInstanceId: attempt.fromInstanceId,
    recipientIds: recipients,
    sizeBytes: attempt.sizeBytes,
    priority: attempt.priority,
    domainKey: attempt.domainKey,
    createdAt: attempt.queuedAt,
  }, attempt.route, queuedAt, attempt);
}
