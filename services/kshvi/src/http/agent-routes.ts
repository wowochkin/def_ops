import { HttpError, reply, type Ctx, type Router } from '@def-ops/service-kit';
import type { AgentCommand, AgentCommandResponse } from '../../../../packages/kshvi-agents/src/intermediary/act';
import type { InstanceCommand } from '../instances/command-service';
import type { DomainOperationType, TypedInstanceCommandPort } from '../instances/typed-command-port';

export const AGENT_OPERATION_TYPES: Readonly<Record<string, DomainOperationType>> = {
  classifyInput: 'input.classify.v1',
  updateWorkingMap: 'projection.workingMap.update.v1',
  recordAssessment: 'assessment.record.v1',
  makeDecision: 'decision.accept.v1',
  assignTask: 'task.assign.v1',
  createDocument: 'document.revision.create.v1',
  coordinateDocument: 'document.coordinate.v1',
  issueDocument: 'document.issue.v1',
  sendInput: 'input.create.v1',
  sendReport: 'report.create.v1',
  requestCalculation: 'calculation.request.v1',
  executeOrder: 'order.execute.v1',
  checkDeadline: 'deadline.check.v1',
  requestData: 'data.request.v1',
  reportToLeader: 'report.create.v1',
  recordObservation: 'observation.record.v1',
};

export type AgentDelegation = Readonly<{
  actor: InstanceCommand['actor'];
  branchId: string;
  expectedRevision: number;
  allowedActions: readonly string[];
}>;
export type AgentDelegationResolver = (ctx: Ctx, command: AgentCommand) => Promise<AgentDelegation>;

async function missingResolver(): Promise<never> {
  throw new HttpError(401, 'unauthorized', '401: Требуется вход в систему');
}

export function registerAgentRoutes(router: Router, options: {
  commands: TypedInstanceCommandPort;
  resolveDelegation?: AgentDelegationResolver;
}): void {
  const resolve = options.resolveDelegation ?? missingResolver;
  router.post('/agents/commands', async ctx => {
    const command = await ctx.json<AgentCommand>();
    const delegation = await resolve(ctx, command);
    const type = AGENT_OPERATION_TYPES[command.kind];
    if (!type || !delegation.allowedActions.includes(command.kind)) {
      return reply(403, { code: 'OUTSIDE_DELEGATION', message: 'Действие вне серверной делегации агента' });
    }
    const result = await options.commands.execute({
      instanceId: command.instanceId,
      branchId: delegation.branchId,
      expectedRevision: delegation.expectedRevision,
      idempotencyKey: command.idempotencyKey,
      type,
      actor: delegation.actor,
      payload: {
        ...command.payload,
        agentAssignmentId: command.assignmentId,
        agentExerciseId: command.exerciseId,
        expectedProjectionRevision: command.expectedProjectionRevision,
        issuedAt: command.issuedAt,
      },
    });
    const response: AgentCommandResponse = {
      commandId: command.commandId,
      accepted: true,
      idempotent: result.idempotent,
      effectApplied: !result.idempotent,
      status: result.idempotent ? 'DUPLICATE' : 'APPLIED',
      eventId: result.eventId,
      serverRevision: result.revision,
    };
    return response;
  });
}
