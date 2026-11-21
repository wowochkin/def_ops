import type { ElectronicIntermediaryAssignment, SystemActor } from '../model/assignment';
import type { AgentRequestedAction, ServerIntermediaryProjection } from './classify';

export type AgentCommand = Readonly<{
  commandId: string;
  idempotencyKey: string;
  kind: string;
  assignmentId: string;
  exerciseId: string;
  instanceId: string;
  sectorId?: string;
  actor: SystemActor;
  expectedProjectionRevision: number;
  issuedAt: string;
  payload: Readonly<Record<string, unknown>>;
}>;

export type AgentCommandResponse = Readonly<{
  commandId: string;
  accepted: boolean;
  idempotent: boolean;
  effectApplied: boolean;
  status: 'APPLIED' | 'DUPLICATE' | 'REJECTED' | 'PENDING';
  eventId?: string;
  serverRevision?: number;
  reason?: string;
}>;

export function createAgentCommand(
  assignment: ElectronicIntermediaryAssignment,
  projection: ServerIntermediaryProjection,
  wakeId: string,
  issuedAt: string,
  action: AgentRequestedAction,
): AgentCommand {
  const commandId = `${assignment.assignmentId}:${wakeId}:${action.actionId}`;
  return {
    commandId,
    idempotencyKey: `agent:${commandId}`,
    kind: action.kind,
    assignmentId: assignment.assignmentId,
    exerciseId: assignment.exerciseId,
    instanceId: action.instanceId,
    ...(action.sectorId ? { sectorId: action.sectorId } : {}),
    actor: assignment.actor,
    expectedProjectionRevision: projection.revision,
    issuedAt,
    payload: { actionId: action.actionId, ...action.payload },
  };
}

export function createAgentCommands(
  assignment: ElectronicIntermediaryAssignment,
  projection: ServerIntermediaryProjection,
  wakeId: string,
  issuedAt: string,
  actions: readonly AgentRequestedAction[],
): readonly AgentCommand[] {
  return actions.map(action => createAgentCommand(assignment, projection, wakeId, issuedAt, action));
}
