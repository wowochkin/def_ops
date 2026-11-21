import { expect, it } from 'vitest';
import { resumeProjection } from '../../../apps/editor/src/modern/kshvi/live/event-stream';
import { SubscriptionService } from '../src/http/subscription-service';

it('требует новый снимок при смене политики и пропуске sequence', async () => {
  expect(await resumeProjection({ lastSequence: 8, projectionRevision: 2 }, { minAvailableSequence: 10, policyRevision: 3, currentPolicyRevision: 4 })).toEqual({ kind: 'SNAPSHOT_REQUIRED', reason: 'POLICY_CHANGED' });
  expect(await resumeProjection({ lastSequence: 8, projectionRevision: 4 }, { minAvailableSequence: 10, policyRevision: 4, currentPolicyRevision: 4 })).toEqual({ kind: 'SNAPSHOT_REQUIRED', reason: 'SEQUENCE_GAP' });
  expect(await resumeProjection({ lastSequence: 8, projectionRevision: 4 }, { minAvailableSequence: 9, policyRevision: 4, currentPolicyRevision: 4 })).toEqual({ kind: 'EVENTS', fromSequence: 9 });
});

it('создаёт отдельный payload и не включает скрытые UUID в обобщённое уведомление', () => {
  const service = new SubscriptionService();
  const event = { eventId: 'secret-event', sequence: 1, type: 'force.updated', payload: { id: 'secret-force', side: 'red', position: [1, 1] } };
  const payload = service.payloadFor(event, { side: 'blue', role: 'TRAINEE', scope: 'own', operationalAt: '2030-01-01T00:00:00Z' });
  expect(JSON.stringify(payload)).not.toContain('secret-force');
  expect(payload).toEqual({ type: 'projection.refresh' });
  expect(service.seen(event.eventId, event.sequence)).toBe(true);
  expect(service.seen(event.eventId, event.sequence)).toBe(false);
});
