export type AdaptiveInput = { id: string; kind: 'ADAPTIVE'; severity: number; areaId: string; stageId: string; effects: readonly { type: string; amount: number }[] };
export type Delegation = { allowedSeverities: readonly number[]; allowedAreas: readonly string[]; allowedStages: readonly string[]; allowEffects: boolean };

export function applyDelegation(delegation: Delegation, input: AdaptiveInput) {
  const allowed = delegation.allowEffects
    && delegation.allowedSeverities.includes(input.severity)
    && delegation.allowedAreas.includes(input.areaId)
    && delegation.allowedStages.includes(input.stageId);
  if (allowed) return { status: 'APPLIED' as const, input };
  return { status: 'APPROVAL_REQUIRED' as const, request: { kind: 'INPUT' as const, reason: 'OUTSIDE_DELEGATION', input } };
}

export function proposeInput(input: { kind: 'PLANNED'; sourceRole: string; recipients: readonly string[]; scheduledAt: string; actualAt: string; channelId: string }) {
  const early = Date.parse(input.actualAt) < Date.parse(input.scheduledAt);
  return { ...input, deviation: early ? 'EARLY' as const : 'ON_TIME' as const, approval: { status: early ? 'REVIEW_REQUIRED' as const : 'PLANNED' as const } };
}
