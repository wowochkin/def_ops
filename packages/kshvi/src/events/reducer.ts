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

type UnknownRecord = Record<string, unknown>;
function record(value: unknown): UnknownRecord {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : {};
}
function requiredString(value: unknown, title: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Не указано: ${title}`);
  return value;
}
function effectAmount(value: unknown, parameters: UnknownRecord): number {
  const resolved = typeof value === 'number' ? value : typeof value === 'object' && value !== null
    ? parameters[requiredString((value as UnknownRecord).parameterId, 'параметр эффекта')] : Number.NaN;
  if (typeof resolved !== 'number' || !Number.isFinite(resolved) || resolved < 0) throw new Error('Некорректное количество в эффекте автономного события');
  return resolved;
}
function applied(world: WorldState, event: WorldEvent, state: WorldState['state']): WorldState {
  return withResourceAlias({
    ...world, state,
    appliedEventIds: [...world.appliedEventIds, event.eventId],
    eventCauses: { ...world.eventCauses, [event.eventId]: [...(event.causeIds ?? [])] },
  });
}
function resourceKey(sideId: unknown, resourceId: unknown): string {
  return `${requiredString(sideId, 'сторона ресурса')}/${requiredString(resourceId, 'ресурс')}`;
}
function adjustResource(resources: WorldState['state']['Resources'], key: string, amount: number, operation: unknown): void {
  const current = resources[key] ?? { onHand: 0, consumed: 0, supplied: 0, deficit: 0 };
  if (operation === 'RESTORE') {
    resources[key] = { ...current, onHand: current.onHand + amount, supplied: current.supplied + amount };
    return;
  }
  if (operation !== 'CONSUME') throw new Error('Неизвестная ресурсная операция автономного события');
  const consumed = Math.min(amount, current.onHand);
  resources[key] = {
    onHand: current.onHand - consumed,
    consumed: current.consumed + consumed,
    supplied: current.supplied,
    deficit: current.deficit + amount - consumed,
  };
}
function applyAutonomyEffects(world: WorldState, event: WorldEvent): WorldState {
  const payload = record(event.payload);
  const parameters = record(payload.parameters);
  const state = structuredClone(world.state);
  const components = state as unknown as UnknownRecord;
  const effects = Array.isArray(payload.effects) ? payload.effects : [];
  for (const raw of effects) {
    const effect = record(raw);
    if (effect.type === 'resource.adjust') {
      adjustResource(state.Resources, resourceKey(effect.ownerSideId, effect.resourceId), effectAmount(effect.amount, parameters), effect.operation);
      continue;
    }
    if (effect.type === 'resource.transfer') {
      const amount = effectAmount(effect.amount, parameters);
      const fromKey = resourceKey(effect.fromSideId, effect.resourceId);
      const toKey = resourceKey(effect.toSideId, effect.resourceId);
      const from = state.Resources[fromKey] ?? { onHand: 0, consumed: 0, supplied: 0, deficit: 0 };
      const transferred = Math.min(amount, from.onHand);
      adjustResource(state.Resources, fromKey, amount, 'CONSUME');
      const to = state.Resources[toKey] ?? { onHand: 0, consumed: 0, supplied: 0, deficit: 0 };
      state.Resources[toKey] = { ...to, onHand: to.onHand + transferred };
      continue;
    }
    const direct = effect.type === 'force.state'
      ? ['Forces', 'forceId'] as const : effect.type === 'equipment.state'
        ? ['Equipment', 'equipmentId'] as const : effect.type === 'terrain.state'
          ? ['Terrain', 'areaId'] as const : effect.type === 'communication.state'
            ? ['Communications', 'channelId'] as const : null;
    if (direct) {
      const [component, identity] = direct;
      const id = requiredString(effect[identity], identity);
      const container = record(components[component]);
      components[component] = { ...container, [id]: { ...record(container[id]), status: requiredString(effect.status, 'статус эффекта') } };
      continue;
    }
    if (effect.type === 'catalog.effect') {
      const scenario = record(components.ScenarioState);
      const previous = Array.isArray(scenario.CatalogEffects) ? scenario.CatalogEffects : [];
      components.ScenarioState = { ...scenario, CatalogEffects: [...previous, { ...effect, eventId: event.eventId, operationalSecond: payload.operationalSecond ?? null }] };
      continue;
    }
    throw new Error(`Неизвестный эффект автономного события: ${String(effect.type)}`);
  }
  return applied(world, event, state);
}
function applyAutonomyRecord(world: WorldState, event: WorldEvent): WorldState {
  const payload = record(event.payload);
  const state = structuredClone(world.state);
  const components = state as unknown as UnknownRecord;
  if (event.type === 'observation.create.v1') {
    const id = requiredString(payload.observationId ?? payload.actionId ?? event.eventId, 'наблюдение');
    components.Observations = { ...record(components.Observations), [id]: structuredClone(payload) };
  } else if (event.type === 'document.revision.create.v1') {
    const id = requiredString(payload.documentId ?? payload.actionId ?? event.eventId, 'документ');
    components.Documents = { ...record(components.Documents), [id]: structuredClone(payload) };
  } else {
    const scenario = record(components.ScenarioState);
    if (event.type === 'input.create.v1') {
      const id = requiredString(payload.inputId ?? payload.actionId ?? event.eventId, 'вводная');
      components.ScenarioState = { ...scenario, Inputs: { ...record(scenario.Inputs), [id]: structuredClone(payload) } };
    } else if (event.type === 'approval.request.create.v1') {
      const id = requiredString(payload.requestId, 'заявка');
      components.ScenarioState = { ...scenario, ApprovalRequests: { ...record(scenario.ApprovalRequests), [id]: { ...structuredClone(payload), status: 'PENDING' } } };
    } else throw new Error(`Неизвестный тип события: ${event.type}`);
  }
  return applied(world, event, state);
}

type TypedDomainRecordRule = Readonly<{
  component: string;
  keys: readonly string[];
  collection?: string;
  status?: string;
}>;
const TYPED_DOMAIN_RECORDS: Readonly<Record<string, TypedDomainRecordRule>> = {
  'input.classify.v1': { component: 'ScenarioState', collection: 'Inputs', keys: ['inputId', 'actionId'], status: 'CLASSIFIED' },
  'projection.workingMap.update.v1': { component: 'ScenarioState', collection: 'WorkingMaps', keys: ['projectionId', 'actionId'], status: 'UPDATED' },
  'assessment.record.v1': { component: 'ScenarioState', collection: 'Assessments', keys: ['assessmentId', 'actionId'] },
  'decision.accept.v1': { component: 'ScenarioState', collection: 'Decisions', keys: ['decisionId', 'actionId'], status: 'ACCEPTED' },
  'task.assign.v1': { component: 'Tasks', keys: ['taskId', 'actionId'], status: 'ASSIGNED' },
  'document.coordinate.v1': { component: 'Documents', keys: ['documentId', 'actionId'], status: 'COORDINATED' },
  'document.issue.v1': { component: 'Documents', keys: ['documentId', 'actionId'], status: 'ISSUED' },
  'report.create.v1': { component: 'ScenarioState', collection: 'Reports', keys: ['reportId', 'actionId'] },
  'calculation.request.v1': { component: 'ScenarioState', collection: 'CalculationRequests', keys: ['calculationId', 'actionId'], status: 'REQUESTED' },
  'order.execute.v1': { component: 'Tasks', keys: ['orderId', 'actionId'], status: 'EXECUTING' },
  'deadline.check.v1': { component: 'ScenarioState', collection: 'DeadlineChecks', keys: ['deadlineId', 'actionId'], status: 'CHECKED' },
  'data.request.v1': { component: 'ScenarioState', collection: 'DataRequests', keys: ['requestId', 'actionId'], status: 'REQUESTED' },
  'observation.record.v1': { component: 'Observations', keys: ['observationId', 'actionId'] },
  'force.advance.v1': { component: 'Forces', keys: ['forceId', 'actionId'], status: 'ADVANCING' },
  'force.defend.v1': { component: 'Forces', keys: ['forceId', 'actionId'], status: 'DEFENDING' },
  'force.withdraw.v1': { component: 'Forces', keys: ['forceId', 'actionId'], status: 'WITHDRAWING' },
  'logistics.support.requested.v1': { component: 'Supply', keys: ['requestId', 'actionId'], status: 'REQUESTED' },
  'agent.escalation.requested.v1': { component: 'ScenarioState', collection: 'Escalations', keys: ['escalationId', 'actionId'], status: 'REQUIRES_REVIEW' },
  'order.continue.v1': { component: 'Tasks', keys: ['orderId', 'actionId'], status: 'EXECUTING' },
};
function applyTypedDomainRecord(world: WorldState, event: WorldEvent, rule: TypedDomainRecordRule): WorldState {
  const payload = record(event.payload);
  const id = rule.keys.map(key => payload[key]).find(value => typeof value === 'string' && value.trim()) as string | undefined ?? event.eventId;
  const value = {
    ...structuredClone(payload), operationType: event.type, eventId: event.eventId,
    status: rule.status ?? (typeof payload.status === 'string' ? payload.status : 'RECORDED'),
  };
  const state = structuredClone(world.state);
  const components = state as unknown as UnknownRecord;
  if (rule.component === 'ScenarioState' && rule.collection) {
    const scenario = record(components.ScenarioState);
    components.ScenarioState = {
      ...scenario,
      [rule.collection]: { ...record(scenario[rule.collection]), [id]: value },
    };
  } else {
    components[rule.component] = { ...record(components[rule.component]), [id]: value };
  }
  return applied(world, event, state);
}

export function reduceWorld(world: WorldState, event: WorldEvent, profile: ReducerProfile): WorldState {
  if (world.appliedEventIds.includes(event.eventId)) throw new Error('Событие уже применено');
  if (profile.reducerVersion !== 1) throw new Error('Неподдерживаемая версия reducer');
  if (event.type === 'autonomy.worldEffects.apply.v1') return applyAutonomyEffects(world, event);
  const domainRule = TYPED_DOMAIN_RECORDS[event.type];
  if (domainRule) return applyTypedDomainRecord(world, event, domainRule);
  if (['observation.create.v1', 'document.revision.create.v1', 'input.create.v1', 'approval.request.create.v1'].includes(event.type)) {
    return applyAutonomyRecord(world, event);
  }
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
