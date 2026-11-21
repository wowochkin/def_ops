import { createHash } from 'node:crypto';
import type { JsonValue } from '../model/types';
import { canonicalJson } from './canonical';

export type ChainEventInput = Readonly<{
  eventId: string;
  sequence: number;
  type: string;
  payload: JsonValue;
}>;
export type ChainEvent<T = JsonValue> = ChainEventInput & Readonly<{
  prevHash: string | null;
  hash: string;
  payload: T;
}>;

export function eventHash(event: ChainEventInput & { prevHash?: string | null; hash?: string }, prevHash: string | null): string {
  const { prevHash: ignoredPrevHash, hash: ignoredHash, ...fact } = event;
  void ignoredPrevHash;
  void ignoredHash;
  return createHash('sha256').update(canonicalJson({ ...fact, prevHash })).digest('hex');
}
