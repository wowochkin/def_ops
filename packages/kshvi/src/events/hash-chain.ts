import { assertCompleteEvent, deepFreeze, eventHash, type ChainEvent, type ChainEventInput } from './envelope';

export function appendToChain(history: readonly ChainEvent[], input: ChainEventInput): ChainEvent {
  const previous = history.at(-1);
  const expectedSequence = (previous?.sequence ?? 0) + 1;
  if (input.sequence !== expectedSequence) throw new Error(`Ожидалась последовательность ${expectedSequence}`);
  if (previous && (previous.organizationId !== input.organizationId || previous.instanceId !== input.instanceId || previous.branchId !== input.branchId)) {
    throw new Error('Область события не совпадает с областью цепочки');
  }
  const prevHash = previous?.hash ?? null;
  const hash = eventHash(input, prevHash);
  return deepFreeze(structuredClone({ ...input, prevHash, hash, hashVersion: 2 as const }));
}

export function verifyEventChain(events: readonly ChainEvent[]): string[] {
  const issues: string[] = [];
  let previous: ChainEvent | undefined;
  for (const event of events) {
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    if (event.sequence !== expectedSequence) issues.push(`SEQUENCE:${event.sequence}`);
    if (previous && (previous.organizationId !== event.organizationId || previous.instanceId !== event.instanceId || previous.branchId !== event.branchId)) {
      issues.push(`SCOPE:${event.sequence}`);
    }
    if (event.hashVersion !== 1) {
      try {
        assertCompleteEvent(event);
      } catch {
        issues.push(`ENVELOPE:${event.sequence}`);
      }
      if (Array.isArray(event.causeIds) && (new Set(event.causeIds).size !== event.causeIds.length || event.causeIds.includes(event.eventId))) {
        issues.push(`CAUSE_IDS:${event.sequence}`);
      }
    }
    const prevHash = previous?.hash ?? null;
    if (event.prevHash !== prevHash) issues.push(`PREV_HASH:${event.sequence}`);
    try {
      if (eventHash(event, event.prevHash) !== event.hash) issues.push(`HASH:${event.sequence}`);
    } catch {
      if (!issues.includes(`HASH:${event.sequence}`)) issues.push(`HASH:${event.sequence}`);
    }
    previous = event;
  }
  return [...new Set(issues)];
}
