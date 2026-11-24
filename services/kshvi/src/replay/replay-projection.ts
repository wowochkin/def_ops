import { canonicalJson } from '../../../../packages/kshvi/src/events/canonical';
import type { ReplayEvent } from '../../../../packages/kshvi/src/replay/types';

export type ReplayResumeInput = {
  lastSequence: number;
  projectionRevision: number;
  policyRevision: number;
  currentPolicyRevision: number;
  minAvailableSequence: number;
  incoming: readonly ReplayEvent[];
};
export type ReplayResumeResult =
  | { kind: 'SNAPSHOT_REQUIRED'; reason: 'POLICY_CHANGED' | 'SEQUENCE_GAP' }
  | { kind: 'EVENTS'; events: readonly ReplayEvent[] };

export function reconcileReplayProjection(input: ReplayResumeInput): ReplayResumeResult {
  if (input.projectionRevision !== input.currentPolicyRevision || input.policyRevision !== input.currentPolicyRevision) {
    return { kind: 'SNAPSHOT_REQUIRED', reason: 'POLICY_CHANGED' };
  }
  if (input.minAvailableSequence > input.lastSequence + 1) {
    return { kind: 'SNAPSHOT_REQUIRED', reason: 'SEQUENCE_GAP' };
  }
  const unique = new Map<string, ReplayEvent>();
  const sequences = new Set<number>();
  for (const event of input.incoming) {
    const previous = unique.get(event.eventId);
    if (previous && canonicalJson(previous) !== canonicalJson(event)) throw new Error('Конфликт повторного события реплея');
    if (sequences.has(event.sequence) && previous?.sequence !== event.sequence) throw new Error('Конфликт sequence событий реплея');
    unique.set(event.eventId, event);
    sequences.add(event.sequence);
  }
  const events = [...unique.values()]
    .filter(event => event.sequence > input.lastSequence)
    .sort((left, right) => left.sequence - right.sequence);
  if (events.some((event, index) => event.sequence !== input.lastSequence + index + 1)) {
    return { kind: 'SNAPSHOT_REQUIRED', reason: 'SEQUENCE_GAP' };
  }
  return { kind: 'EVENTS', events: events.map(event => structuredClone(event)) };
}
