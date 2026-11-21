export type ResumeInput = { lastSequence: number; projectionRevision: number };
export type ResumeState = { minAvailableSequence: number; policyRevision: number; currentPolicyRevision: number };

export async function resumeProjection(input: ResumeInput, state: ResumeState): Promise<{ kind: 'SNAPSHOT_REQUIRED'; reason: 'POLICY_CHANGED' | 'SEQUENCE_GAP' } | { kind: 'EVENTS'; fromSequence: number }> {
  if (input.projectionRevision !== state.currentPolicyRevision) return { kind: 'SNAPSHOT_REQUIRED', reason: 'POLICY_CHANGED' };
  if (state.minAvailableSequence > input.lastSequence + 1) return { kind: 'SNAPSHOT_REQUIRED', reason: 'SEQUENCE_GAP' };
  return { kind: 'EVENTS', fromSequence: input.lastSequence + 1 };
}
