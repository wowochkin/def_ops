export type ContinuityEvent = Readonly<{
  eventId: string;
  component: string;
  value: unknown;
  causeIds: readonly string[];
}>;

export type ContinuityMark = Readonly<{
  fromStageId: string;
  toStageId: string;
  operationalAt: string;
  appliedEventIds: readonly string[];
  causeIds: readonly string[];
}>;

/** Новый этап наследует весь снимок; меняются только компоненты явных причинных событий. */
export function carryStageContinuity<T extends Record<string, unknown>>(
  previous: T,
  transition: Readonly<{
    fromStageId: string;
    toStageId: string;
    operationalAt: string;
    events: readonly ContinuityEvent[];
  }>,
): T & { continuity: ContinuityMark } {
  if (!transition.fromStageId.trim() || !transition.toStageId.trim()) throw new Error('Непрерывность требует исходный и следующий этапы');
  if (!Number.isFinite(Date.parse(transition.operationalAt))) throw new Error('Некорректное оперативное время непрерывности');
  const next = structuredClone(previous) as T;
  const eventIds = new Set<string>();
  const causeIds: string[] = [];
  for (const event of transition.events) {
    if (!event.eventId.trim()) throw new Error('Изменение непрерывности требует явного события');
    if (eventIds.has(event.eventId)) throw new Error(`Обнаружен повтор события непрерывности ${event.eventId}`);
    if (!Object.hasOwn(previous, event.component) || event.component === 'continuity') throw new Error(`Событие ${event.eventId} ссылается на неизвестный компонент ${event.component}`);
    eventIds.add(event.eventId);
    causeIds.push(...event.causeIds);
    (next as Record<string, unknown>)[event.component] = structuredClone(event.value);
  }
  return {
    ...next,
    continuity: {
      fromStageId: transition.fromStageId,
      toStageId: transition.toStageId,
      operationalAt: transition.operationalAt,
      appliedEventIds: [...eventIds],
      causeIds,
    },
  };
}
