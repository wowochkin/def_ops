import { assertRoleCombination, canReadTruth, type VisibilityActor } from './visibility-policy';

export type ProjectedForce = { id: string; side: string; position?: unknown };
export type ProjectedInput = { id: string; availableAt: string; recipients: readonly string[] };
export type ProjectableWorld = {
  forces: readonly ProjectedForce[];
  observations?: readonly unknown[];
  inputs?: readonly ProjectedInput[];
  reference?: unknown;
  truth?: unknown;
};

export function projectWorld(world: ProjectableWorld, actor: VisibilityActor) {
  assertRoleCombination(actor);
  if (actor.scope === 'truth' && !canReadTruth(actor)) throw new Error('403: Истинное состояние недоступно');
  const truth = canReadTruth(actor);
  return {
    forces: truth ? world.forces.map(force => ({ ...force })) : world.forces.filter(force => force.side === actor.side).map(force => ({ ...force })),
    observations: (world.observations ?? []).map(observation => structuredClone(observation)),
    inputs: (world.inputs ?? []).filter(input => Date.parse(input.availableAt) <= Date.parse(actor.operationalAt) && input.recipients.includes(actor.side)).map(input => ({ ...input })),
    perspective: truth ? 'TRUTH' as const : 'PARTICIPANT' as const,
  };
}
