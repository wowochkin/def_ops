import { assertRoleCombination, canReadTruth, type VisibilityActor } from './visibility-policy';

export type ProjectedForce = { id: string; side: string; position?: unknown };
export type ProjectedInput = { id: string; availableAt: string; recipients: readonly string[] };
export type ProjectedObservation = {
  id: string;
  side?: string;
  sideId?: string;
  observerSideId?: string;
  availableAt?: string;
  recipients?: readonly string[];
  recipientIds?: readonly string[];
  recipientSideIds?: readonly string[];
  visibility?: Readonly<{ sideIds?: readonly string[]; instanceIds?: readonly string[]; roles?: readonly string[] }>;
} & Record<string, unknown>;
export type ProjectableWorld = {
  forces: readonly ProjectedForce[];
  observations?: readonly ProjectedObservation[];
  inputs?: readonly ProjectedInput[];
  reference?: unknown;
  truth?: unknown;
};

function observationVisible(observation: ProjectedObservation, actor: VisibilityActor, truth: boolean): boolean {
  if (observation.availableAt && Date.parse(observation.availableAt) > Date.parse(actor.operationalAt)) return false;
  if (truth) return true;
  const visibility = observation.visibility;
  if (visibility?.sideIds?.length && !visibility.sideIds.includes(actor.side)) return false;
  if (visibility?.instanceIds?.length && (!actor.nodeId || !visibility.instanceIds.includes(actor.nodeId))) return false;
  if (visibility?.roles?.length && !visibility.roles.includes(actor.role)) return false;
  const recipients = [
    ...(observation.recipients ?? []),
    ...(observation.recipientIds ?? []),
    ...(observation.recipientSideIds ?? []),
  ];
  const owned = [observation.side, observation.sideId, observation.observerSideId].includes(actor.side);
  const addressed = recipients.includes(actor.side) || !!actor.nodeId && recipients.includes(actor.nodeId);
  // Отсутствие адресации не превращает служебную запись в публичную.
  const explicitlyShared = !observation.side && !observation.sideId && !observation.observerSideId
    && recipients.length === 0 && !!visibility?.sideIds?.includes(actor.side);
  return owned || addressed || explicitlyShared;
}

export function projectWorld(world: ProjectableWorld, actor: VisibilityActor) {
  assertRoleCombination(actor);
  if (!Number.isFinite(Date.parse(actor.operationalAt))) throw new Error('422: Некорректное оперативное время проекции');
  if (actor.scope === 'truth' && !canReadTruth(actor)) throw new Error('403: Истинное состояние недоступно');
  const truth = canReadTruth(actor);
  return {
    forces: truth ? world.forces.map(force => ({ ...force })) : world.forces.filter(force => force.side === actor.side).map(force => ({ ...force })),
    observations: (world.observations ?? []).filter(observation => observationVisible(observation, actor, truth)).map(observation => structuredClone(observation)),
    inputs: (world.inputs ?? []).filter(input => Date.parse(input.availableAt) <= Date.parse(actor.operationalAt) && input.recipients.includes(actor.side)).map(input => ({ ...input })),
    perspective: truth ? 'TRUTH' as const : 'PARTICIPANT' as const,
  };
}
