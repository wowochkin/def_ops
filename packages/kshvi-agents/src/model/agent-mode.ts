import type { ElectronicIntermediaryAssignment } from './assignment';

export type AgentAction = Readonly<{
  kind: string;
  instanceId: string;
  sectorId?: string;
  risk?: number;
  severity?: number;
}>;

export type AgentActionAuthorization =
  | Readonly<{ allowed: true; execution: 'PROPOSE_ONLY' | 'SUBMIT' }>
  | Readonly<{
      allowed: false;
      reason: 'OUTSIDE_DELEGATION' | 'RISK_LIMIT_EXCEEDED' | 'SEVERITY_LIMIT_EXCEEDED' | 'ASSIGNMENT_PAUSED';
    }>;

export function authorizeAgentAction(
  assignment: ElectronicIntermediaryAssignment,
  action: AgentAction,
): AgentActionAuthorization {
  if (assignment.status !== 'ACTIVE') return { allowed: false, reason: 'ASSIGNMENT_PAUSED' };
  const binding = assignment.bindings.find(candidate => candidate.instanceId === action.instanceId);
  const inSector = binding && (!action.sectorId || binding.sectorIds.includes(action.sectorId));
  if (!binding || !inSector || !assignment.allowedActions.includes(action.kind)) {
    return { allowed: false, reason: 'OUTSIDE_DELEGATION' };
  }
  if ((action.risk ?? 0) > assignment.modernProfile.riskLimit) {
    return { allowed: false, reason: 'RISK_LIMIT_EXCEEDED' };
  }
  if ((action.severity ?? 0) > assignment.modernProfile.severityLimit) {
    return { allowed: false, reason: 'SEVERITY_LIMIT_EXCEEDED' };
  }
  return { allowed: true, execution: assignment.mode === 'ADVISORY' ? 'PROPOSE_ONLY' : 'SUBMIT' };
}
