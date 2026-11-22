import { withResourceAlias, type WorldState } from '../model/world';

export type WorldEvent = {
  eventId: string;
  type: string;
  payload?: unknown;
  causeIds?: readonly string[];
  reducerVersion?: number;
};
export type ReducerProfile = {
  reducerVersion: number;
  registry?: { get(version: number): typeof reduceWorld };
};

const MAP_COMPONENTS: Readonly<Record<string, string>> = {
  weather: 'Weather', terrain: 'Terrain', logistics: 'Supply', forces: 'Forces', 'modern-symbols': 'Forces', modernSymbols: 'Forces', routes: 'Tasks',
};

export function reduceWorld(world: WorldState, event: WorldEvent, profile: ReducerProfile): WorldState {
  if (world.appliedEventIds.includes(event.eventId)) throw new Error('Событие уже применено');
  if (profile.reducerVersion !== 1) throw new Error('Неподдерживаемая версия reducer');
  if (event.type === 'map.layer.updated.v1') {
    const payload = event.payload as { layer?: unknown; value?: unknown };
    const component = typeof payload?.layer === 'string' ? MAP_COMPONENTS[payload.layer] : undefined;
    if (!component) throw new Error('Неизвестный слой карты в событии');
    return {
      ...world,
      state: { ...world.state, [component]: structuredClone(payload.value) },
      appliedEventIds: [...world.appliedEventIds, event.eventId],
      eventCauses: { ...world.eventCauses, [event.eventId]: [...(event.causeIds ?? [])] },
    };
  }
  if (event.type !== 'resource.consumed.v1') throw new Error(`Неизвестный тип события: ${event.type}`);
  const payload = event.payload as { resourceId?: unknown; amount?: unknown; supplied?: unknown };
  if (typeof payload.resourceId !== 'string' || !payload.resourceId) throw new Error('Не указан ресурс');
  if (typeof payload.amount !== 'number' || !Number.isSafeInteger(payload.amount) || payload.amount <= 0) throw new Error('Некорректный расход ресурса');
  const supplied = payload.supplied ?? 0;
  if (typeof supplied !== 'number' || !Number.isSafeInteger(supplied) || supplied < 0) throw new Error('Некорректное поступление ресурса');
  const current = world.state.Resources[payload.resourceId] ?? { onHand: 0, consumed: 0, supplied: 0, deficit: 0 };
  const available = current.onHand + supplied;
  const consumed = Math.min(payload.amount, available);
  const deficit = payload.amount - consumed;
  const resources = {
    ...world.state.Resources,
    [payload.resourceId]: {
      onHand: available - consumed,
      consumed: current.consumed + consumed,
      supplied: current.supplied + supplied,
      // Накопленный неудовлетворённый спрос не исчезает при следующем событии.
      deficit: current.deficit + deficit,
    },
  };
  return withResourceAlias({
    ...world,
    state: { ...world.state, Resources: resources },
    appliedEventIds: [...world.appliedEventIds, event.eventId],
    eventCauses: { ...world.eventCauses, [event.eventId]: [...(event.causeIds ?? [])] },
  });
}

export function replayWorld(initial: WorldState, events: readonly WorldEvent[], profile: ReducerProfile): WorldState {
  return events.reduce((world, event) => {
    const reducerVersion = event.reducerVersion ?? profile.reducerVersion;
    const reducer = profile.registry?.get(reducerVersion) ?? reduceWorld;
    return reducer(world, event, { ...profile, reducerVersion });
  }, initial);
}
