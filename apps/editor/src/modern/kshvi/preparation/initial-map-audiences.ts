import type { InitialMapAudience } from './InitialMapStep';

/** Состав участников существует независимо от наличия объектов на карте. */
export function initialMapAudiences(
  participants: readonly InitialMapAudience[],
): readonly InitialMapAudience[] {
  const byInstance = new Map<string, InitialMapAudience>();
  const sides = new Map<string, string>();
  for (const participant of participants) {
    if (![participant.instanceId, participant.sideId, participant.role, participant.label].every(value => typeof value === 'string' && value.trim())) {
      throw new Error('Состав участников содержит неполное назначение');
    }
    if (sides.has(participant.instanceId) && sides.get(participant.instanceId) !== participant.sideId) throw new Error(`AMBIGUOUS_INSTANCE_SIDE: ${participant.instanceId}`);
    sides.set(participant.instanceId, participant.sideId);
    const key = participant.audienceId ?? JSON.stringify([participant.instanceId, participant.role]);
    if (!byInstance.has(key)) byInstance.set(key, { ...participant });
  }
  return [...byInstance.values()].sort((left, right) => left.sideId.localeCompare(right.sideId) || left.instanceId.localeCompare(right.instanceId));
}
