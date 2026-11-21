import { expect, it } from 'vitest';
import { makeReplayArchive } from '../../../packages/kshvi/tests/fixtures/replay-archive';
import { ReplayService, type ReplayParticipantFrame } from '../src/replay/replay-service';
import { reconcileReplayProjection } from '../src/replay/replay-projection';

const participantFrames: ReplayParticipantFrame[] = [{
  participantId: 'user-blue', branchId: 'official', sequence: 3, policyRevision: 4,
  allowedEventIds: ['event-1', 'event-2', 'event-3'],
  events: makeReplayArchive().events.slice(0, 3).map(event => ({ ...event, changes: [], payload: { sequence: event.sequence }, randomKey: null })),
  state: { domains: { Map: { items: [{ id: 'observation-blue', source: 'PARTICIPANT' }] } }, appliedEventIds: [], eventCauses: {} },
}];

it('строит кадр участника только из сохранённой серверной проекции без скрытого мира', () => {
  const service = new ReplayService();
  const frame = service.project({
    archive: makeReplayArchive(), cursor: 3, participantId: 'user-blue', participantFrames,
    actor: { role: 'TRAINEE', authorities: [] }, perspective: 'PARTICIPANT',
  });
  expect(frame.perspective).toBe('PARTICIPANT');
  expect(frame.source).toBe('RECORDED_PARTICIPANT_PROJECTION');
  expect(JSON.stringify(frame)).toContain('observation-blue');
  expect(JSON.stringify(frame)).not.toContain('saved-choice');
  expect(JSON.stringify(frame)).not.toContain('snapshot-2');
  expect(frame.events.map(event => event.eventId)).toEqual(['event-1', 'event-2', 'event-3']);
});

it('выдаёт истину только по отдельному праву и постоянно маркирует её', () => {
  const service = new ReplayService();
  const input = { archive: makeReplayArchive(), cursor: 3, participantFrames, participantId: 'leader' };
  expect(() => service.project({ ...input, actor: { role: 'TECH_ADMIN', authorities: ['TRUTH_READ'] }, perspective: 'TRUTH' })).toThrow('403');
  expect(() => service.project({ ...input, actor: { role: 'LEADER', authorities: [] }, perspective: 'TRUTH' })).toThrow('403');
  const truth = service.project({ ...input, actor: { role: 'LEADER', authorities: ['TRUTH_READ'] }, perspective: 'TRUTH' });
  expect(truth.perspective).toBe('TRUTH');
  expect(truth.label).toBe('Истинное состояние');
  expect(truth.panels.Map.source).toBe('TRUTH');
});

it('при reconnect применяет новую политику, отсекает пропуски и дубликаты', () => {
  const events = makeReplayArchive().events;
  expect(reconcileReplayProjection({ lastSequence: 2, projectionRevision: 3, policyRevision: 3, currentPolicyRevision: 4, minAvailableSequence: 1, incoming: events })).toEqual({ kind: 'SNAPSHOT_REQUIRED', reason: 'POLICY_CHANGED' });
  expect(reconcileReplayProjection({ lastSequence: 1, projectionRevision: 4, policyRevision: 4, currentPolicyRevision: 4, minAvailableSequence: 3, incoming: events })).toEqual({ kind: 'SNAPSHOT_REQUIRED', reason: 'SEQUENCE_GAP' });
  const resumed = reconcileReplayProjection({ lastSequence: 1, projectionRevision: 4, policyRevision: 4, currentPolicyRevision: 4, minAvailableSequence: 1, incoming: [events[1], events[1], events[2]] });
  expect(resumed).toMatchObject({ kind: 'EVENTS' });
  if (resumed.kind !== 'EVENTS') throw new Error('Ожидалась досылка');
  expect(resumed.events.map(event => event.eventId)).toEqual(['event-2', 'event-3']);
  const gap = reconcileReplayProjection({ lastSequence: 1, projectionRevision: 4, policyRevision: 4, currentPolicyRevision: 4, minAvailableSequence: 1, incoming: [events[2]] });
  expect(gap).toEqual({ kind: 'SNAPSHOT_REQUIRED', reason: 'SEQUENCE_GAP' });
});
