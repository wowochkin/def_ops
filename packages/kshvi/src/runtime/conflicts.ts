export function resolveConflict(conflict: { kind: 'DEADLINE' | 'AUTHORITY'; existing: unknown; requested: unknown }) {
  return { status: 'NEW_DECISION_REQUIRED' as const, preserveHistory: true, conflict };
}
