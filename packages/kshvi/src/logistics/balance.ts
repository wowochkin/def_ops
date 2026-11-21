import type { ResourceLedgerProjection } from './ledger';

export type ResourceBalanceInput = Readonly<{
  initial: number | null;
  received: number | null;
  onHand: number | null;
  inTransit: number | null;
  consumed: number | null;
  lost: number | null;
  adjustments?: number | null;
  deficit?: number | null;
}>;

export type ResourceBalance = Readonly<{
  status: 'BALANCED' | 'UNBALANCED' | 'REQUIRES_REVIEW';
  expected: number | null;
  actual: number | null;
  balanced: boolean;
  unknown: readonly string[];
  deficit: number | null;
}>;

const keys = ['initial', 'received', 'onHand', 'inTransit', 'consumed', 'lost'] as const;

function sum(values: readonly (number | null)[]): number | null {
  return values.some(value => value === null) ? null : Number((values as number[]).reduce((total, value) => total + value, 0).toFixed(12));
}

/** Invariant: onHand + inTransit + consumed + lost = initial + received + adjustments. */
export function resourceBalance(input: ResourceBalanceInput): ResourceBalance {
  const unknown: string[] = keys.filter(key => input[key] === null || !Number.isFinite(input[key]));
  if (input.adjustments === null || input.deficit === null) unknown.push(input.adjustments === null ? 'adjustments' : 'deficit');
  const negative: string[] = keys.filter(key => typeof input[key] === 'number' && (input[key] as number) < 0);
  if (negative.length) unknown.push(...negative.map(key => `${key}:negative`));
  const expected = unknown.some(key => key === 'initial' || key === 'received' || key === 'adjustments')
    ? null : sum([input.initial, input.received, input.adjustments ?? 0]);
  const actual = unknown.some(key => ['onHand', 'inTransit', 'consumed', 'lost'].includes(key))
    ? null : sum([input.onHand, input.inTransit, input.consumed, input.lost]);
  const uniqueUnknown = [...new Set(unknown)];
  if (uniqueUnknown.length) return { status: 'REQUIRES_REVIEW', expected, actual, balanced: false, unknown: uniqueUnknown, deficit: input.deficit === null ? null : input.deficit ?? 0 };
  const balanced = Math.abs(expected! - actual!) < 1e-9;
  return { status: balanced ? 'BALANCED' : 'UNBALANCED', expected, actual, balanced, unknown: [], deficit: input.deficit ?? 0 };
}

export function resourceBalanceFromLedger(projection: ResourceLedgerProjection, resourceId: string): ResourceBalance & ResourceBalanceInput {
  const accounts = Object.values(projection.accounts).filter(account => account.resourceId === resourceId);
  const total = (select: (account: (typeof accounts)[number]) => number): number => Number(accounts.reduce((sumValue, account) => sumValue + select(account), 0).toFixed(12));
  const input: ResourceBalanceInput = {
    initial: total(account => account.initial),
    received: total(account => account.received),
    onHand: total(account => account.onHand),
    inTransit: total(account => account.inTransit),
    consumed: total(account => account.consumed),
    lost: total(account => account.lost),
    adjustments: total(account => account.adjustments),
    deficit: total(account => account.deficit),
  };
  if (!accounts.length) return { ...input, status: 'REQUIRES_REVIEW', expected: null, actual: null, balanced: false, unknown: ['resource:missing'], deficit: null };
  return { ...input, ...resourceBalance(input) };
}

export type SupplyServiceRecord = Readonly<{
  requestId: string;
  requiredBy: string;
  deliveredAt: string | null;
  quantity: number;
  deliveredQuantity: number;
  status: string;
  delayMinutes: number;
}>;

/** Доля своевременных считается по всем заявкам; частичные и непоставленные перечисляются отдельно. */
export function supplyServiceMetrics(records: readonly SupplyServiceRecord[]): Readonly<{
  onTimeRate: number | null;
  onTimeRequestIds: readonly string[];
  partialRequestIds: readonly string[];
  undeliveredRequestIds: readonly string[];
  delayedRequestIds: readonly string[];
  totalRequested: number;
  totalDelivered: number;
  requiresReview: boolean;
}> {
  const onTimeRequestIds = records.filter(record => record.status === 'DELIVERED'
    && record.deliveredQuantity === record.quantity
    && record.deliveredAt !== null
    && Number.isFinite(Date.parse(record.deliveredAt))
    && Number.isFinite(Date.parse(record.requiredBy))
    && Date.parse(record.deliveredAt) <= Date.parse(record.requiredBy)).map(record => record.requestId);
  const partialRequestIds = records.filter(record => record.status === 'PARTIALLY_DELIVERED' || record.deliveredQuantity > 0 && record.deliveredQuantity < record.quantity).map(record => record.requestId);
  const undeliveredRequestIds = records.filter(record => record.deliveredQuantity < record.quantity && !partialRequestIds.includes(record.requestId)).map(record => record.requestId);
  const delayedRequestIds = records.filter(record => record.delayMinutes > 0).map(record => record.requestId);
  return {
    onTimeRate: records.length ? onTimeRequestIds.length / records.length : null,
    onTimeRequestIds,
    partialRequestIds,
    undeliveredRequestIds,
    delayedRequestIds,
    totalRequested: records.reduce((sumValue, record) => sumValue + record.quantity, 0),
    totalDelivered: records.reduce((sumValue, record) => sumValue + record.deliveredQuantity, 0),
    requiresReview: records.some(record => !Number.isFinite(Date.parse(record.requiredBy)) || record.deliveredAt !== null && !Number.isFinite(Date.parse(record.deliveredAt))
      || ![record.quantity, record.deliveredQuantity, record.delayMinutes].every(Number.isFinite) || record.deliveredQuantity < 0 || record.deliveredQuantity > record.quantity),
  };
}
