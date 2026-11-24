import type { DocumentRevision } from './document';

export type CascadeSource = Readonly<{ documentId: string; revision: number; sha256: string }>;
export type CascadeDeliveryState = 'QUEUED' | 'IN_TRANSIT' | 'DELIVERED' | 'ACKNOWLEDGED' | 'EXECUTION_STARTED' | 'FAILED' | 'CANCELLED';
export type CascadeFact = Readonly<{ type: 'DELIVERED' | 'ACKNOWLEDGED' | 'EXECUTION_STARTED'; at: string; actorId: string }>;

export type CascadeLegInput = Readonly<{
  id: string;
  from: string;
  to: string;
  channelId: string;
  delayMinutes: number;
  relayId: string;
  processingDeadlineAt: string;
  copyStatus?: 'FULL' | 'DISTORTED' | 'PARTIAL';
  omittedAttachmentIds?: readonly string[];
}>;

export type CascadeDelivery = Readonly<{
  id: string;
  messageId: string;
  source: CascadeSource;
  from: string;
  to: string;
  channelId: string;
  relayId: string;
  queuedAt: string;
  scheduledDeliveryAt: string;
  processingDeadlineAt: string;
  state: CascadeDeliveryState;
  copyStatus: 'FULL' | 'DISTORTED' | 'PARTIAL';
  omittedAttachmentIds: readonly string[];
  facts: readonly CascadeFact[];
  deliveredAt: string | null;
  acknowledgedAt: string | null;
  executionStartedAt: string | null;
  failureReason: string | null;
}>;

export type CascadeIssue = Readonly<{
  source: CascadeSource;
  deliveries: readonly CascadeDelivery[];
}>;

function instant(value: string, message = 'Некорректное время каскада'): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(message);
  return parsed;
}

function isoWithOffset(base: string, delayMinutes: number): string {
  const match = base.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) throw new Error('Каскад требует оперативное время с явным часовым поясом');
  const sign = match[1] === '+' ? 1 : -1;
  const offsetMinutes = sign * (Number(match[2]) * 60 + Number(match[3]));
  const shifted = new Date(instant(base) + (delayMinutes + offsetMinutes) * 60_000);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}${match[1]}${match[2]}:${match[3]}`;
}

function makeDelivery(source: CascadeSource, leg: CascadeLegInput, issuedAt: string): CascadeDelivery {
  if (!leg.id.trim() || !leg.from.trim() || !leg.to.trim() || !leg.relayId.trim()) throw new Error('Плечо каскада требует инстанции и ретранслятор');
  if (!Number.isFinite(leg.delayMinutes) || leg.delayMinutes < 0) throw new Error('Задержка плеча каскада неотрицательна');
  instant(leg.processingDeadlineAt, 'Некорректный срок обработки плеча каскада');
  return {
    id: leg.id,
    messageId: `cascade:${source.documentId}:r${source.revision}:${leg.id}`,
    source: { ...source },
    from: leg.from,
    to: leg.to,
    channelId: leg.channelId,
    relayId: leg.relayId,
    queuedAt: issuedAt,
    scheduledDeliveryAt: isoWithOffset(issuedAt, leg.delayMinutes),
    processingDeadlineAt: leg.processingDeadlineAt,
    state: 'QUEUED',
    copyStatus: leg.copyStatus ?? 'FULL',
    omittedAttachmentIds: [...(leg.omittedAttachmentIds ?? [])],
    facts: [],
    deliveredAt: null,
    acknowledgedAt: null,
    executionStartedAt: null,
    failureReason: null,
  };
}

export function issueCascade(input: {
  revision: DocumentRevision;
  originInstanceId: string;
  issuedAt: string;
  availableChannelIds: readonly string[];
  treeEdges: readonly Readonly<{ from: string; to: string }>[];
  legs: readonly CascadeLegInput[];
}): CascadeIssue {
  if (input.revision.state !== 'ISSUED') throw new Error('Каскад выдаёт только редакцию ISSUED');
  instant(input.issuedAt);
  const source = { documentId: input.revision.documentId, revision: input.revision.revision, sha256: input.revision.sha256 };
  const ids = new Set<string>();
  const messages = new Set<string>();
  const deliveries = input.legs.map(leg => {
    if (ids.has(leg.id)) throw new Error('Идентификатор плеча каскада повторяется');
    ids.add(leg.id);
    if (!input.treeEdges.some(edge => edge.from === leg.from && edge.to === leg.to)) throw new Error(`Адресат ${leg.to} отсутствует в дереве инстанций`);
    if (!input.availableChannelIds.includes(leg.channelId)) throw new Error(`Недоступен канал ${leg.channelId} для каскада`);
    if (leg.from !== input.originInstanceId && !input.legs.some(parent => parent.to === leg.from)) throw new Error('Ретранслятор не связан с исходным отправителем');
    const delivery = makeDelivery(source, leg, input.issuedAt);
    if (messages.has(delivery.messageId)) throw new Error('Сообщение плеча каскада повторяется');
    messages.add(delivery.messageId);
    return delivery;
  });
  return { source, deliveries };
}

export function advanceCascadeDelivery(
  delivery: CascadeDelivery,
  action: 'BEGIN' | 'DELIVER' | 'FAIL' | 'CANCEL',
  input: Readonly<{ at: string; actorId?: string; reason?: string }>,
): CascadeDelivery {
  const at = instant(input.at);
  if (action === 'BEGIN') {
    if (delivery.state !== 'QUEUED') throw new Error('Передача начинается только из QUEUED');
    return { ...delivery, state: 'IN_TRANSIT' };
  }
  if (action === 'DELIVER') {
    if (delivery.state !== 'IN_TRANSIT') throw new Error('Доставляется только плечо IN_TRANSIT');
    if (at < instant(delivery.scheduledDeliveryAt)) throw new Error('Фактическая доставка раньше рассчитанной задержки канала');
    const actorId = input.actorId ?? delivery.to;
    return {
      ...delivery,
      state: 'DELIVERED',
      deliveredAt: input.at,
      facts: [...delivery.facts, { type: 'DELIVERED', at: input.at, actorId }],
    };
  }
  if (delivery.state === 'DELIVERED' || delivery.state === 'ACKNOWLEDGED' || delivery.state === 'EXECUTION_STARTED') throw new Error('Завершённая доставка не переписывается отказом');
  if (action === 'FAIL' && !input.reason?.trim()) throw new Error('Отказ плеча каскада требует причины');
  return { ...delivery, state: action === 'FAIL' ? 'FAILED' : 'CANCELLED', failureReason: input.reason ?? null };
}

export function recordCascadeFact(
  delivery: CascadeDelivery,
  type: 'ACKNOWLEDGED' | 'EXECUTION_STARTED',
  input: Readonly<{ at: string; actorId: string }>,
): CascadeDelivery {
  instant(input.at);
  if (!input.actorId.trim()) throw new Error('Факт каскада требует ответственного');
  if (type === 'ACKNOWLEDGED') {
    if (delivery.state !== 'DELIVERED') throw new Error('Подтверждение возможно только после самостоятельной доставки плеча');
    return { ...delivery, state: 'ACKNOWLEDGED', acknowledgedAt: input.at, facts: [...delivery.facts, { type, ...input }] };
  }
  if (delivery.state !== 'ACKNOWLEDGED') throw new Error('Получение и подтверждение не означают начало исполнения');
  return { ...delivery, state: 'EXECUTION_STARTED', executionStartedAt: input.at, facts: [...delivery.facts, { type, ...input }] };
}

export function relayCascade(
  cascade: CascadeIssue,
  parentDeliveryId: string,
  leg: CascadeLegInput,
  context: Readonly<{ issuedAt: string; availableChannelIds: readonly string[] }>,
): CascadeIssue {
  const parent = cascade.deliveries.find(delivery => delivery.id === parentDeliveryId);
  if (!parent || !parent.deliveredAt) throw new Error('Ретрансляция возможна после фактического получения родительского плеча');
  if (leg.from !== parent.to) throw new Error('Ретранслятор должен совпадать с получателем родительского плеча');
  if (!context.availableChannelIds.includes(leg.channelId)) throw new Error(`Канал ${leg.channelId} недоступен для ретрансляции`);
  if (cascade.deliveries.some(delivery => delivery.id === leg.id)) throw new Error('Плечо ретрансляции уже существует');
  return { ...cascade, deliveries: [...cascade.deliveries, makeDelivery(cascade.source, leg, context.issuedAt)] };
}

export function cascadeReminders(delivery: CascadeDelivery, now: string): readonly Readonly<{ deliveryId: string; kind: 'ESCALATION'; recipientId: string }>[] {
  if (delivery.acknowledgedAt || !delivery.deliveredAt || Date.parse(now) <= Date.parse(delivery.processingDeadlineAt)) return [];
  return [{ deliveryId: delivery.id, kind: 'ESCALATION', recipientId: delivery.relayId }];
}
