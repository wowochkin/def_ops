export const WORLD_COMPONENTS = [
  'Time', 'Forces', 'Equipment', 'Tasks', 'Resources', 'Supply', 'Readiness', 'MoralePsych',
  'Formation', 'Terrain', 'Weather', 'Observations', 'Communications', 'Documents', 'ScenarioState',
  'EventScheduler', 'AgentStates',
] as const;

export type WorldComponent = typeof WORLD_COMPONENTS[number];
export type ResourceState = { onHand: number; consumed: number; supplied: number; deficit: number };
export type WorldComponents = {
  [K in WorldComponent]: K extends 'Resources' ? Record<string, ResourceState> : unknown
};
export type WorldState = {
  scenarioId: string;
  state: WorldComponents;
  /** Вычисляемый alias state.Resources; отдельного сериализуемого представления нет. */
  readonly resources: Record<string, ResourceState>;
  appliedEventIds: readonly string[];
  eventCauses: Readonly<Record<string, readonly string[]>>;
};

type WorldCore = Omit<WorldState, 'resources'> & { resources?: Record<string, ResourceState> };

export function withResourceAlias(world: WorldCore): WorldState {
  const { resources: ignoredResources, ...core } = world;
  void ignoredResources;
  return Object.defineProperty(core, 'resources', {
    enumerable: false,
    configurable: false,
    get(this: WorldCore) { return this.state.Resources; },
  }) as WorldState;
}

export function cloneWorld(world: WorldState): WorldState {
  return withResourceAlias(structuredClone(world));
}

export function emptyWorld(scenarioId: string): WorldState {
  if (!scenarioId.trim()) throw new Error('Для мира нужен идентификатор сценария');
  return withResourceAlias({
    scenarioId,
    state: {
      Time: { operationalAt: null, wallClockAt: null },
      Forces: {},
      Equipment: {},
      Tasks: {},
      Resources: {},
      Supply: {},
      Readiness: {},
      MoralePsych: {},
      Formation: {},
      Terrain: {},
      Weather: {},
      Observations: {},
      Communications: {},
      Documents: {},
      ScenarioState: { scenarioId, status: 'DRAFT' },
      EventScheduler: { cursor: 0 },
      AgentStates: {},
    },
    appliedEventIds: [],
    eventCauses: {},
  });
}
