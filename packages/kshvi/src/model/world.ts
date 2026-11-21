export const WORLD_COMPONENTS = [
  'Time', 'Forces', 'Equipment', 'Tasks', 'Resources', 'Supply', 'Readiness', 'MoralePsych',
  'Formation', 'Terrain', 'Weather', 'Observations', 'Communications', 'Documents', 'ScenarioState',
  'EventScheduler', 'AgentStates',
] as const;

export type WorldComponent = typeof WORLD_COMPONENTS[number];
export type ResourceState = { onHand: number; consumed: number; supplied: number; deficit: number };
export type WorldComponents = Record<WorldComponent, unknown>;
export type WorldState = {
  scenarioId: string;
  state: WorldComponents;
  resources: Record<string, ResourceState>;
  appliedEventIds: readonly string[];
  eventCauses: Readonly<Record<string, readonly string[]>>;
};

export function emptyWorld(scenarioId: string): WorldState {
  if (!scenarioId.trim()) throw new Error('Для мира нужен идентификатор сценария');
  const resources: Record<string, ResourceState> = {};
  return {
    scenarioId,
    state: {
      Time: { operationalAt: null, wallClockAt: null },
      Forces: {},
      Equipment: {},
      Tasks: {},
      Resources: resources,
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
    resources,
    appliedEventIds: [],
    eventCauses: {},
  };
}
