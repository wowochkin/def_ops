import { canReadTruth, type VisibilityActor } from '../../../../packages/kshvi/src/projections/visibility-policy';
import type { ChainEvent } from '../../../../packages/kshvi/src/events/envelope';

export type SubscriptionEvent = Readonly<{
  eventId: string;
  sequence: number;
  type: string;
  branchId: string;
  instanceId?: string;
  organizationId?: string;
  payload: { side?: string; recipients?: readonly string[] } & Record<string, unknown>;
}>;
export type SubscriptionActor = VisibilityActor & Readonly<{ organizationId?: string; instanceIds?: readonly string[]; subscriptionRevision?: number }>;

export class SubscriptionService {
  private readonly delivered = new Set<string>();
  private readonly events: SubscriptionEvent[] = [];
  private readonly waiters = new Set<() => void>();

  payloadFor(event: Pick<SubscriptionEvent, 'eventId' | 'sequence' | 'type' | 'payload' | 'instanceId' | 'organizationId'>, actor: VisibilityActor) {
    const recipients = event.payload.recipients;
    const addressed = !recipients?.length || recipients.includes(actor.side) || !!actor.nodeId && recipients.includes(actor.nodeId);
    const side = event.payload.side;
    const hasSide = typeof side === 'string' && side.length > 0;
    const hasExplicitAudience = hasSide || !!recipients?.length;
    if (!canReadTruth(actor) && (!hasExplicitAudience || !addressed || hasSide && side !== actor.side)) {
      return { type: 'projection.refresh' as const };
    }
    return {
      type: event.type, eventId: event.eventId, sequence: event.sequence,
      instanceId: event.instanceId, organizationId: event.organizationId,
      payload: structuredClone(event.payload),
    };
  }

  seen(eventId: string, sequence: number): boolean {
    const key = `${eventId}/${sequence}`;
    if (this.delivered.has(key)) return false;
    this.delivered.add(key);
    return true;
  }

  async publish(input: Omit<SubscriptionEvent, 'eventId' | 'sequence' | 'branchId'> & Partial<Pick<SubscriptionEvent, 'eventId' | 'sequence' | 'branchId'>>): Promise<SubscriptionEvent> {
    const branchId = input.branchId ?? 'main';
    const previousSequence = this.events.filter(event => event.instanceId === input.instanceId && event.branchId === branchId).at(-1)?.sequence ?? 0;
    const sequence = input.sequence ?? previousSequence + 1;
    if (!Number.isSafeInteger(sequence) || sequence <= previousSequence) throw new Error('Нарушена последовательность подписки');
    const event: SubscriptionEvent = {
      ...structuredClone(input), branchId,
      eventId: input.eventId ?? `subscription-${sequence}`,
      sequence,
    };
    this.events.push(event);
    for (const notify of this.waiters) notify();
    return event;
  }

  after(instanceId: string, sequence: number, branchId = 'main'): readonly SubscriptionEvent[] {
    return this.events.filter(event => event.instanceId === instanceId && event.branchId === branchId && event.sequence > sequence);
  }

  minSequence(instanceId: string, branchId = 'main'): number {
    return this.events.find(event => event.instanceId === instanceId && event.branchId === branchId)?.sequence ?? 1;
  }

  latestSequence(instanceId: string, branchId = 'main'): number {
    return this.events.filter(event => event.instanceId === instanceId && event.branchId === branchId).at(-1)?.sequence ?? 0;
  }

  sequenceOf(instanceId: string, eventId: string, branchId = 'main'): number | null {
    return this.events.find(event => event.instanceId === instanceId && event.branchId === branchId && event.eventId === eventId)?.sequence ?? null;
  }

  async waitForChange(instanceId: string, sequence: number, signal: AbortSignal, timeoutMs = 1000, branchId = 'main'): Promise<boolean> {
    if (this.after(instanceId, sequence, branchId).length > 0) return true;
    if (signal.aborted) return false;
    return new Promise(resolve => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (changed: boolean) => {
        if (timer) clearTimeout(timer);
        signal.removeEventListener('abort', aborted);
        this.waiters.delete(notify);
        resolve(changed);
      };
      const notify = () => {
        if (this.after(instanceId, sequence, branchId).length > 0) finish(true);
      };
      const aborted = () => finish(false);
      this.waiters.add(notify);
      signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => finish(false), timeoutMs);
    });
  }
}


export async function publishChainEvent(subscriptions: SubscriptionService, event: ChainEvent): Promise<void> {
  const payload = event.payload as Record<string, unknown>;
  const nestedDecision = payload.decision && typeof payload.decision === 'object' && !Array.isArray(payload.decision)
    ? payload.decision as Record<string, unknown> : {};
  const observation = payload.observation && typeof payload.observation === 'object' && !Array.isArray(payload.observation)
    ? payload.observation as Record<string, unknown> : {};
  const observationSource = observation.source && typeof observation.source === 'object' && !Array.isArray(observation.source)
    ? observation.source as Record<string, unknown> : {};
  const side = (payload.side ?? payload.sideId ?? nestedDecision.sideId ?? observationSource.sideId) as string | undefined;
  await subscriptions.publish({
    eventId: event.eventId,
    instanceId: event.instanceId,
    branchId: event.branchId,
    organizationId: event.organizationId,
    sequence: event.sequence,
    type: event.type,
    payload: { ...payload, side },
  });
}
