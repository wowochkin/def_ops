import { createHash } from 'node:crypto';
import type { ActorRef } from '../model/entities';
import { operationalAt, wallClockAt } from '../model/unknown';
import { versionRef, type JsonValue, type OperationalTime, type VersionRef } from '../model/types';
import { canonicalJson } from './canonical';

export type EventActor = Readonly<{ id: string; kind: ActorRef['kind']; assignmentId?: string }>;
export type ChainEventInput = Readonly<{
  eventId: string;
  organizationId: string;
  instanceId: string;
  branchId: string;
  sequence: number;
  type: string;
  schemaVersion: number;
  wallClockAt: string;
  operationalAt: OperationalTime;
  actor: EventActor;
  causeIds: readonly string[];
  versions: Readonly<Record<string, VersionRef>>;
  reducerVersion: number;
  payload: JsonValue;
}>;
export type ChainEvent<T = JsonValue> = Readonly<Omit<ChainEventInput, 'payload'> & {
  prevHash: string | null;
  hash: string;
  hashVersion: 1 | 2;
  payload: T;
}>;

export function assertCompleteEvent(event: unknown): asserts event is ChainEventInput {
  if (!event || typeof event !== 'object') throw new Error('Нужен полный конверт DomainEvent');
  const value = event as Partial<ChainEventInput>;
  for (const key of ['eventId', 'organizationId', 'instanceId', 'branchId', 'type', 'wallClockAt'] as const) {
    if (typeof value[key] !== 'string' || !(value[key] as string).trim()) throw new Error(`Полный конверт DomainEvent требует ${key}`);
  }
  if (!Number.isSafeInteger(value.sequence) || (value.sequence as number) < 1) throw new Error('Конверт DomainEvent требует положительный sequence');
  if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) throw new Error('Конверт DomainEvent требует schemaVersion');
  if (!Number.isSafeInteger(value.reducerVersion) || (value.reducerVersion as number) < 1) throw new Error('Конверт DomainEvent требует reducerVersion');
  if (wallClockAt(value.wallClockAt as string) !== value.wallClockAt) throw new Error('wallClockAt события должен быть нормализован в UTC');
  if (!value.operationalAt || typeof value.operationalAt !== 'object') throw new Error('Конверт DomainEvent требует operationalAt');
  const operational = operationalAt(value.operationalAt.originalAt, value.operationalAt.zone);
  if (operational.normalizedAt !== value.operationalAt.normalizedAt || operational.offset !== value.operationalAt.offset) {
    throw new Error('Оперативное время события не соответствует зоне и смещению');
  }
  if (!value.actor || typeof value.actor.id !== 'string' || !value.actor.id.trim() || !['HUMAN', 'SYSTEM'].includes(value.actor.kind)) {
    throw new Error('Конверт DomainEvent требует корректного actor');
  }
  if (!Array.isArray(value.causeIds) || value.causeIds.some(id => typeof id !== 'string' || !id.trim())) {
    throw new Error('Конверт DomainEvent требует causeIds');
  }
  if (new Set(value.causeIds).size !== value.causeIds.length || value.causeIds.includes(value.eventId)) {
    throw new Error('Причинные ссылки события должны быть уникальными и не ссылаться на само событие');
  }
  if (!value.versions || typeof value.versions !== 'object' || Array.isArray(value.versions)) throw new Error('Конверт DomainEvent требует versions');
  for (const reference of Object.values(value.versions)) versionRef(reference);
  if (!('payload' in value)) throw new Error('Конверт DomainEvent требует payload');
}

function legacyHash(event: ChainEvent, prevHash: string | null): string {
  const fact = {
    eventId: event.eventId,
    sequence: event.sequence,
    type: event.type,
    payload: event.payload,
    prevHash,
  };
  return createHash('sha256').update(canonicalJson(fact)).digest('hex');
}

export function eventHash(
  event: ChainEventInput & { prevHash?: string | null; hash?: string; hashVersion?: 1 | 2 },
  prevHash: string | null,
): string {
  if (event.hashVersion === 1) return legacyHash(event as ChainEvent, prevHash);
  assertCompleteEvent(event);
  const fact = {
    eventId: event.eventId,
    organizationId: event.organizationId,
    instanceId: event.instanceId,
    branchId: event.branchId,
    sequence: event.sequence,
    type: event.type,
    schemaVersion: event.schemaVersion,
    wallClockAt: event.wallClockAt,
    operationalAt: event.operationalAt,
    actor: event.actor,
    causeIds: event.causeIds,
    versions: event.versions,
    reducerVersion: event.reducerVersion,
    payload: event.payload,
    hashVersion: 2 as const,
    prevHash,
  };
  return createHash('sha256').update(canonicalJson(fact)).digest('hex');
}

export function deepFreeze<T>(value: T): T {
  const frozen = new WeakSet<object>();
  const freeze = (current: T): T => {
    if (!current || typeof current !== 'object' || frozen.has(current)) return current;
    frozen.add(current);
    for (const child of Object.values(current)) freeze(child);
    return Object.freeze(current);
  };
  return freeze(value);
}
