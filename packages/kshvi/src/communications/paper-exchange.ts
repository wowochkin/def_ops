export type PaperFactType = 'ISSUED' | 'RECEIVED' | 'EXECUTION_STARTED';

export type PaperExchangeInput = Readonly<{
  documentId: string;
  revision: number;
  sha256: string;
  domainKey: string | null;
  issued: Readonly<{ at: string; actorId: string }>;
  received: Readonly<{ at: string; actorId: string }>;
  execution?: Readonly<{ at: string; actorId: string }>;
  evidence: Readonly<{ kind: 'PAPER_ORIGINAL' | 'SCAN'; reference: string }>;
  enteredAt: string;
  enteredBy: string;
  appliedDomainKeys: readonly string[];
  electronicQueue: readonly Readonly<{ messageId: string; domainKey: string | null; status: 'queued' | 'inTransit' | 'delivered' | 'failed' | 'cancelled' }>[];
}>;

function instant(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error('Фактическое время бумажного обмена обязательно');
  return parsed;
}

export function recordPaperExchange(input: PaperExchangeInput): Readonly<{
  source: Readonly<{ documentId: string; revision: number; sha256: string }>;
  facts: readonly Readonly<{ type: PaperFactType; actualAt: string; recordedAt: string; actorId: string }>[];
  evidence: PaperExchangeInput['evidence'];
  enteredBy: string;
  domainEffectApplied: boolean;
  duplicate: boolean;
  appliedDomainKeys: readonly string[];
  electronicResolution: 'NO_ELECTRONIC_CONFLICT' | 'CANCEL_DUPLICATE' | 'RECONCILED_DUPLICATE';
  cancelledMessageIds: readonly string[];
}> {
  const issuedAt = instant(input.issued.at);
  const receivedAt = instant(input.received.at);
  const executionAt = input.execution ? instant(input.execution.at) : null;
  const enteredAt = instant(input.enteredAt);
  if (issuedAt > receivedAt || (executionAt !== null && receivedAt > executionAt) || enteredAt < Math.max(issuedAt, receivedAt, executionAt ?? 0)) {
    throw new Error('Фактические времена бумажного обмена противоречивы');
  }
  if (!input.enteredBy.trim() || !input.issued.actorId.trim() || !input.received.actorId.trim()) throw new Error('Бумажный обмен требует ответственных и оператора ввода');
  if (!input.evidence.reference.trim()) throw new Error('Нужна ссылка на скан либо отметка о бумажном оригинале');
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !/^[0-9a-f]{64}$/.test(input.sha256)) throw new Error('Бумажный обмен требует исходную редакцию и SHA-256');
  const related = input.electronicQueue.filter(message => message.domainKey === input.domainKey);
  const electronicDelivered = related.some(message => message.status === 'delivered');
  const recorded = input.domainKey !== null && input.appliedDomainKeys.some(key => key === input.domainKey || key.startsWith(`${input.domainKey}:`));
  const alreadyApplied = input.domainKey !== null && (recorded || electronicDelivered);
  const domainEffectApplied = input.domainKey !== null && !alreadyApplied;
  const appliedDomainKeys = input.domainKey !== null && !recorded
    ? [...input.appliedDomainKeys, input.domainKey]
    : [...input.appliedDomainKeys];
  const cancellable = electronicDelivered ? [] : related.filter(message => message.status === 'queued' || message.status === 'inTransit');
  const facts = [
    { type: 'ISSUED' as const, actualAt: input.issued.at, recordedAt: input.enteredAt, actorId: input.issued.actorId },
    { type: 'RECEIVED' as const, actualAt: input.received.at, recordedAt: input.enteredAt, actorId: input.received.actorId },
    ...(input.execution ? [{ type: 'EXECUTION_STARTED' as const, actualAt: input.execution.at, recordedAt: input.enteredAt, actorId: input.execution.actorId }] : []),
  ];
  return {
    source: { documentId: input.documentId, revision: input.revision, sha256: input.sha256 },
    facts,
    evidence: { ...input.evidence },
    enteredBy: input.enteredBy,
    domainEffectApplied,
    duplicate: input.domainKey !== null && alreadyApplied,
    appliedDomainKeys,
    electronicResolution: electronicDelivered ? 'RECONCILED_DUPLICATE' : cancellable.length ? 'CANCEL_DUPLICATE' : 'NO_ELECTRONIC_CONFLICT',
    cancelledMessageIds: cancellable.map(message => message.messageId),
  };
}
