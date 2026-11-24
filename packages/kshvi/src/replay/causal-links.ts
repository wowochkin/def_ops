import type { ReplayArchive, ReplayEvent } from './types';

export function traceCauses(archive: ReplayArchive, eventId: string): ReplayEvent[] {
  const byId = new Map(archive.events.map(event => [event.eventId, event]));
  const first = byId.get(eventId);
  if (!first) throw new Error('Исходное событие не найдено в журнале');
  const result: ReplayEvent[] = [];
  const visited = new Set<string>();
  const visit = (event: ReplayEvent): void => {
    if (visited.has(event.eventId)) return;
    visited.add(event.eventId);
    result.push(event);
    for (const causeId of event.causeIds ?? []) {
      const cause = byId.get(causeId);
      if (!cause) throw new Error(`Причинное событие отсутствует: ${causeId}`);
      visit(cause);
    }
  };
  visit(first);
  return result;
}
