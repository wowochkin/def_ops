import { eventHash, type ChainEvent, type ChainEventInput } from './envelope';

export function appendToChain(history: readonly ChainEvent[], input: ChainEventInput): ChainEvent {
  const previous = history.at(-1);
  const expectedSequence = (previous?.sequence ?? 0) + 1;
  if (input.sequence !== expectedSequence) throw new Error(`Ожидалась последовательность ${expectedSequence}`);
  const prevHash = previous?.hash ?? null;
  const hash = eventHash(input, prevHash);
  return Object.freeze({ ...input, prevHash, hash });
}

export function verifyEventChain(events: readonly ChainEvent[]): string[] {
  const issues: string[] = [];
  let previous: ChainEvent | undefined;
  for (const event of events) {
    const expectedSequence = (previous?.sequence ?? 0) + 1;
    if (event.sequence !== expectedSequence) issues.push(`SEQUENCE:${event.sequence}`);
    const prevHash = previous?.hash ?? null;
    if (event.prevHash !== prevHash) issues.push(`PREV_HASH:${event.sequence}`);
    if (eventHash(event, event.prevHash) !== event.hash) issues.push(`HASH:${event.sequence}`);
    previous = event;
  }
  return issues;
}
