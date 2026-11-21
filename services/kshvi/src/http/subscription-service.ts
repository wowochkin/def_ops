import type { VisibilityActor } from '../../../../packages/kshvi/src/projections/visibility-policy';

export class SubscriptionService {
  private readonly delivered = new Set<string>();

  payloadFor(event: { eventId: string; sequence: number; type: string; payload: { side?: string } & Record<string, unknown> }, actor: VisibilityActor) {
    if (actor.role !== 'LEADER' && event.payload.side && event.payload.side !== actor.side) return { type: 'projection.refresh' as const };
    return { type: event.type, eventId: event.eventId, sequence: event.sequence, payload: event.payload };
  }

  seen(eventId: string, sequence: number): boolean {
    const key = `${eventId}/${sequence}`;
    if (this.delivered.has(key)) return false;
    this.delivered.add(key);
    return true;
  }
}
