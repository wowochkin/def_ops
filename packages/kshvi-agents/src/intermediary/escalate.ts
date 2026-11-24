import type { ElectronicIntermediaryAssignment } from '../model/assignment';
import type { AgentDecisionTrace } from '../model/decision-trace';
import type { AgentRequestedAction } from './classify';

export type EscalationReason =
  | 'OUTSIDE_DELEGATION'
  | 'UNRESOLVED_CONTRADICTION'
  | 'INSUFFICIENT_DATA'
  | 'RESOURCE_UNAVAILABLE'
  | 'RISK_LIMIT_EXCEEDED'
  | 'SEVERITY_LIMIT_EXCEEDED'
  | 'MODEL_FAILURE'
  | 'TIME_BUDGET_EXCEEDED'
  | 'LEADER_REQUESTED'
  | 'ADVISORY_APPROVAL_REQUIRED'
  | 'COMMAND_REJECTED'
  | 'COMMAND_UNAVAILABLE'
  | 'ASSIGNMENT_PAUSED';

export type HumanActor = Readonly<{ kind: 'human'; id: string }>;

export type AgentEscalation = Readonly<{
  assignmentId: string;
  reason: EscalationReason;
  detail: string;
  recipients: readonly string[];
  currentTask?: string;
  usedData: Readonly<{ projectionId: string; revision: number; sequence: number }>;
  proposedAction?: AgentRequestedAction;
  availableInterventions: readonly ['CONFIRM', 'MODIFY', 'REJECT', 'PAUSE'];
  worldContinues: true;
  rollback: false;
}>;

export function escalateAssignment(
  assignment: ElectronicIntermediaryAssignment,
  reason: EscalationReason,
  context: Readonly<{
    detail: string;
    projection: { projectionId: string; revision: number; sequence: number };
    currentTask?: string;
    proposedAction?: AgentRequestedAction;
  }>,
): Readonly<{ assignment: ElectronicIntermediaryAssignment; escalation: AgentEscalation }> {
  return {
    assignment: { ...assignment, status: 'INTERCEPTED', version: assignment.version + 1 },
    escalation: {
      assignmentId: assignment.assignmentId,
      reason,
      detail: context.detail,
      recipients: assignment.escalation.recipients,
      ...(context.currentTask ? { currentTask: context.currentTask } : {}),
      usedData: {
        projectionId: context.projection.projectionId,
        revision: context.projection.revision,
        sequence: context.projection.sequence,
      },
      ...(context.proposedAction ? { proposedAction: context.proposedAction } : {}),
      availableInterventions: ['CONFIRM', 'MODIFY', 'REJECT', 'PAUSE'],
      worldContinues: true,
      rollback: false,
    },
  };
}

export function interceptAssignment(
  assignment: ElectronicIntermediaryAssignment,
  actor: HumanActor,
  worldSequence: number,
): Readonly<{
  assignment: ElectronicIntermediaryAssignment;
  record: Readonly<{ actor: HumanActor; worldSequence: number; worldContinues: true; rollback: false }>;
}> {
  return {
    assignment: { ...assignment, status: 'INTERCEPTED', version: assignment.version + 1 },
    record: { actor, worldSequence, worldContinues: true, rollback: false },
  };
}

export function resumeAssignment(assignment: ElectronicIntermediaryAssignment, actor: HumanActor): ElectronicIntermediaryAssignment {
  void actor;
  return { ...assignment, status: 'ACTIVE', version: assignment.version + 1 };
}

export function modifyAgentDecision(
  trace: AgentDecisionTrace,
  author: HumanActor,
  action: AgentRequestedAction,
): Readonly<{ basedOnTraceId: string; author: HumanActor; action: AgentRequestedAction; rollback: false }> {
  return { basedOnTraceId: trace.traceId, author, action, rollback: false };
}

export type AgentIntervention =
  | Readonly<{ kind: 'CONFIRM' | 'REJECT' | 'PAUSE' }>
  | Readonly<{ kind: 'MODIFY'; action: AgentRequestedAction }>;

export function resolveAgentIntervention(input: Readonly<{
  assignment: ElectronicIntermediaryAssignment;
  trace: AgentDecisionTrace;
  actor: HumanActor;
  worldSequence: number;
  intervention: AgentIntervention;
}>) {
  const { assignment, trace, actor, worldSequence, intervention } = input;
  const record = {
    kind: intervention.kind,
    author: actor,
    basedOnTraceId: trace.traceId,
    worldSequence,
    rollback: false as const,
    worldContinues: true as const,
    ...(intervention.kind === 'MODIFY' ? { action: intervention.action } : {}),
  };
  return {
    assignment: {
      ...assignment,
      status: intervention.kind === 'PAUSE' ? 'PAUSED' as const : 'ACTIVE' as const,
      version: assignment.version + 1,
    },
    record,
  };
}
