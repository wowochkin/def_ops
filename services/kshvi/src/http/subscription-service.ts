import { canReadTruth, type VisibilityActor } from '../../../../packages/kshvi/src/projections/visibility-policy';

export type SubscriptionEvent = Readonly<{
  eventId: string;
  sequence: number;
  type: string;
  instanceId?: string;
  organizationId?: string;
  payload: { side?: string; recipients?: readonly string[] } & Record<string, unknown>;
}>;
export type SubscriptionActor = VisibilityActor & Readonly<{ organizationId?: string; instanceIds?: readonly string[]; subscriptionRevision?: number }>;

export class SubscriptionService {
  private readonly delivered = new Set<string>();
  private readonly events: SubscriptionEvent[] = [];
  private readonly waiters = new Set<() => void>();

  payloadFor(event: Pick<SubscriptionEvent, 'eventId' | 'sequence' | 'type' | 'payload'>, actor: VisibilityActor) {
    const recipients = event.payload.recipients;
    const addressed = !recipients?.length || recipients.includes(actor.side) || !!actor.nodeId && recipients.includes(actor.nodeId);
    if (!canReadTruth(actor) && ((event.payload.side && event.payload.side !== actor.side) || !addressed)) {
      return { type: 'projection.refresh' as const };
    }
    return { type: event.type, eventId: event.eventId, sequence: event.sequence, payload: structuredClone(event.payload) };
  }

  seen(eventId: string, sequence: number): boolean {
    const key = `${eventId}/${sequence}`;
    if (this.delivered.has(key)) return false;
    this.delivered.add(key);
    return true;
  }

  async publish(input: Omit<SubscriptionEvent, 'eventId' | 'sequence'> & Partial<Pick<SubscriptionEvent, 'eventId' | 'sequence'>>): Promise<SubscriptionEvent> {
    const sequence = input.sequence ?? (this.events.at(-1)?.sequence ?? 0) + 1;
    if (!Number.isSafeInteger(sequence) || sequence <= (this.events.at(-1)?.sequence ?? 0)) throw new Error('Нарушена последовательность подписки');
    const event: SubscriptionEvent = {
      ...structuredClone(input),
      eventId: input.eventId ?? `subscription-${sequence}`,
      sequence,
    };
    this.events.push(event);
    for (const notify of this.waiters) notify();
    return event;
  }

  after(instanceId: string, sequence: number): readonly SubscriptionEvent[] {
    return this.events.filter(event => event.instanceId === instanceId && event.sequence > sequence);
  }

  minSequence(instanceId: string): number {
    return this.events.find(event => event.instanceId === instanceId)?.sequence ?? 1;
  }

  sequenceOf(instanceId: string, eventId: string): number | null {
    return this.events.find(event => event.instanceId === instanceId && event.eventId === eventId)?.sequence ?? null;
  }

  async waitForChange(instanceId: string, sequence: number, signal: AbortSignal, timeoutMs = 1000): Promise<boolean> {
    if (this.after(instanceId, sequence).length > 0) return true;
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
        if (this.after(instanceId, sequence).length > 0) finish(true);
      };
      const aborted = () => finish(false);
      this.waiters.add(notify);
      signal.addEventListener('abort', aborted, { once: true });
      timer = setTimeout(() => finish(false), timeoutMs);
    });
  }
}
