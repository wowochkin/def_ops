export type PotentialComponent = Readonly<{ id: string; q: number; r: number; a: number }>;
export type EpisodeEffects = Readonly<{
  taskProgressDelta: number;
  positionAdvanceMeters: number;
  stateChanges: Readonly<Record<string, unknown>>;
  uncertaintyChanges: Readonly<Record<string, string>>;
}>;
export type EpisodeInput = Readonly<{
  state: Readonly<Record<string, unknown>>;
  forces: Readonly<Record<string, Readonly<{ components: readonly PotentialComponent[] }>>>;
  task: Readonly<{ id: string; status: string; progressPercent: number }>;
  resource: Readonly<{ id: string; unit: string; onHand: number; consumption: number; supplied: number }>;
  elapsedMinutes: number;
  position: Readonly<{ remainingMeters: number; travelledMeters: number }>;
  uncertainty: Readonly<Record<string, string>>;
  effects: EpisodeEffects;
}>;

function finiteNonNegative(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${name} должно быть конечным неотрицательным числовым значением`);
}
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

export function aggregateEpisode(input: EpisodeInput, effects: EpisodeEffects = input.effects) {
  for (const [sideId, force] of Object.entries(input.forces)) {
    for (const component of force.components) {
      finiteNonNegative(component.q, `Потенциал ${sideId}/${component.id}/q`);
      finiteNonNegative(component.r, `Потенциал ${sideId}/${component.id}/r`);
      finiteNonNegative(component.a, `Потенциал ${sideId}/${component.id}/a`);
    }
  }
  for (const [name, value] of Object.entries({
    onHand: input.resource.onHand, consumption: input.resource.consumption, supplied: input.resource.supplied,
    elapsedMinutes: input.elapsedMinutes, remainingMeters: input.position.remainingMeters, travelledMeters: input.position.travelledMeters,
    taskProgressDelta: effects.taskProgressDelta, positionAdvanceMeters: effects.positionAdvanceMeters,
  })) finiteNonNegative(value, name);
  finiteNonNegative(input.task.progressPercent, 'progressPercent');

  const potentialBySide = Object.fromEntries(Object.entries(input.forces).map(([sideId, force]) => [
    sideId,
    force.components.reduce((sum, component) => sum + component.q * component.r * component.a, 0),
  ]));
  const available = input.resource.onHand + input.resource.supplied;
  const consumed = Math.min(input.resource.consumption, available);
  const onHand = Math.max(0, input.resource.onHand - input.resource.consumption + input.resource.supplied);
  const deficit = Math.max(0, input.resource.consumption - input.resource.onHand - input.resource.supplied);
  const progressPercent = clampPercent(input.task.progressPercent + effects.taskProgressDelta);
  const taskStatus = deficit > 0
    ? progressPercent > input.task.progressPercent ? 'PARTIALLY_COMPLETED' : 'NOT_COMPLETED'
    : progressPercent >= 100 ? 'COMPLETED' : 'IN_PROGRESS';
  const actualAdvance = Math.min(input.position.remainingMeters, effects.positionAdvanceMeters);
  const resourceTransition = { onHand, consumed, supplied: input.resource.supplied, deficit, unit: input.resource.unit };

  return {
    intermediate: {
      potentialBySide,
      resourceTransition,
      actualAdvanceMeters: actualAdvance,
      aggregation: 'VERSIONED_COMPONENT_SUM_NOT_PROBABILITY',
    },
    result: {
      state: { ...structuredClone(input.state), ...structuredClone(effects.stateChanges) },
      task: { id: input.task.id, status: taskStatus, progressPercent },
      resources: { [input.resource.id]: resourceTransition },
      elapsedMinutes: input.elapsedMinutes,
      position: {
        remainingMeters: input.position.remainingMeters - actualAdvance,
        travelledMeters: input.position.travelledMeters + actualAdvance,
      },
      uncertainty: { ...input.uncertainty, ...effects.uncertaintyChanges },
    },
  };
}
