import { createElectronicIntermediaryAssignment, type ElectronicIntermediaryAssignment } from '../model/assignment';
import { authorizeAgentAction } from '../model/agent-mode';
import { createDecisionTrace, hashProjection, type AgentDecisionTrace } from '../model/decision-trace';
import { createAgentCommands, type AgentCommand, type AgentCommandResponse } from './act';
import { assessSituation, type SituationAssessment } from './assess';
import {
  classifyProjection,
  normalizeServerProjection,
  type AgentRequestedAction,
  type InputClassification,
  type ServerIntermediaryProjection,
} from './classify';
import { escalateAssignment, type AgentEscalation, type EscalationReason } from './escalate';
import { createObservationSheet, type ObservationSheet } from './observe';
import { createDecisionPlan, type DecisionModelPort, type DecisionPlan, type IntermediaryDecision } from './plan';
import { formulateGuardedText, type GuardedTextResult } from '../llm/guarded-text';
import type { OptionalLanguagePort } from '../llm/optional-language-port';

export type AgentWake = Readonly<{
  wakeId: string;
  kind: 'EVENT' | 'SCHEDULE' | 'RECOVERY';
  requestedAt: string;
}>;

export type AgentProjectionQuery = Readonly<{
  assignmentId: string;
  exerciseId: string;
  actor: ElectronicIntermediaryAssignment['actor'];
  projection: ElectronicIntermediaryAssignment['projection'];
  bindings: ElectronicIntermediaryAssignment['bindings'];
}>;

export type IntermediaryServerPort = {
  loadProjection(query: AgentProjectionQuery): Promise<unknown>;
  submit(command: AgentCommand): Promise<AgentCommandResponse>;
};

export type IntermediaryCycle = Readonly<{
  cycleId: string;
  status: 'COMPLETED' | 'ESCALATED' | 'AWAITING_HUMAN';
  assignment: ElectronicIntermediaryAssignment;
  projection: ServerIntermediaryProjection;
  classification: InputClassification;
  assessment: SituationAssessment;
  decision: IntermediaryDecision;
  options: DecisionPlan['options'];
  selectedOptionId: string | null;
  proposedCommands: readonly AgentCommand[];
  commands: readonly AgentCommand[];
  responses: readonly AgentCommandResponse[];
  appliedForbiddenEffects: readonly AgentCommandResponse[];
  escalation?: AgentEscalation;
  observationSheet: ObservationSheet;
  language: GuardedTextResult;
  trace: AgentDecisionTrace;
}>;

export type RunIntermediaryCycleInput = Readonly<{
  assignment: ElectronicIntermediaryAssignment;
  wake: AgentWake;
  server: IntermediaryServerPort;
  decisionModel?: DecisionModelPort;
  languagePort?: OptionalLanguagePort;
  now?: () => number;
  rngSeed?: string;
}>;

const emptyDecision = (projection: ServerIntermediaryProjection): IntermediaryDecision => ({
  intent: projection.activeOrder?.intent ?? 'Решение не принято',
  goals: projection.activeOrder?.goals ?? [],
  tasks: projection.activeOrder?.tasks ?? [],
  resourceAllocation: projection.activeOrder?.resources ?? {},
  deadlines: projection.activeOrder?.deadlines ?? [],
  coordination: projection.activeOrder?.coordination ?? [],
  reserves: projection.activeOrder?.reserves ?? [],
  transitionConditions: projection.activeOrder?.transitionConditions ?? [],
  assumptions: projection.activeOrder?.assumptions ?? [],
  status: 'DRAFT',
});

export async function runIntermediaryCycle(input: RunIntermediaryCycleInput): Promise<IntermediaryCycle> {
  const assignment = createElectronicIntermediaryAssignment(input.assignment);
  const now = input.now ?? Date.now;
  const startedAt = now();
  const cycleId = `${assignment.assignmentId}:${input.wake.wakeId}`;
  const rawProjection = await input.server.loadProjection({
    assignmentId: assignment.assignmentId,
    exerciseId: assignment.exerciseId,
    actor: assignment.actor,
    projection: assignment.projection,
    bindings: assignment.bindings,
  });
  const projection = normalizeServerProjection(assignment, rawProjection);
  const classification = classifyProjection(projection);
  const assessment = assessSituation(assignment, projection);
  const projectionHash = hashProjection(projection);
  const expired = () => now() - startedAt > assignment.schedule.timeBudgetMs;
  let language: GuardedTextResult = {
    text: '',
    status: 'DISABLED',
    source: 'LOCAL',
    claimsVerified: false,
    executable: false,
  };

  const finish = (
    plan: DecisionPlan | undefined,
    proposedCommands: readonly AgentCommand[],
    commands: readonly AgentCommand[],
    responses: readonly AgentCommandResponse[],
    escalated?: ReturnType<typeof escalateAssignment>,
  ): IntermediaryCycle => {
    const observationSheet = createObservationSheet(projection, responses, escalated?.escalation);
    const trace = createDecisionTrace({
      cycleId,
      assignmentId: assignment.assignmentId,
      actor: assignment.actor,
      projection,
      projectionHash,
      ...(projection.activeOrder ? { activeOrder: projection.activeOrder } : {}),
      options: plan?.options ?? [],
      constraints: assessment.constraints,
      selectedOptionId: plan?.selectedOptionId ?? null,
      versions: {
        profile: `${assignment.modernProfile.profileId}@${assignment.modernProfile.version}`,
        algorithm: 'intermediary-cycle@1.0.0',
        projectionSchema: 'kshvi-agent-projection@1',
        timeBudget: 1,
      },
      rngKeys: plan?.rngKeys ?? [],
      commands,
      responses,
      ...(escalated ? { escalationReason: escalated.escalation.reason } : {}),
      unknownData: assessment.unknownData,
    });
    return {
      cycleId,
      status: escalated
        ? escalated.escalation.reason === 'ADVISORY_APPROVAL_REQUIRED' ? 'AWAITING_HUMAN' : 'ESCALATED'
        : 'COMPLETED',
      assignment: escalated?.assignment ?? assignment,
      projection,
      classification,
      assessment,
      decision: plan?.decision ?? emptyDecision(projection),
      options: plan?.options ?? [],
      selectedOptionId: plan?.selectedOptionId ?? null,
      proposedCommands,
      commands,
      responses,
      appliedForbiddenEffects: [],
      ...(escalated ? { escalation: escalated.escalation } : {}),
      observationSheet,
      language,
      trace,
    };
  };

  const escalateOnly = (reason: EscalationReason, detail: string, proposedAction?: AgentRequestedAction) => finish(
    undefined,
    [],
    [],
    [],
    escalateAssignment(assignment, reason, {
      detail,
      projection,
      currentTask: projection.activeOrder?.orderId,
      ...(proposedAction ? { proposedAction } : {}),
    }),
  );

  if (expired()) return escalateOnly('TIME_BUDGET_EXCEEDED', 'Истёк тайм-бюджет до формирования решения');
  if (projection.leaderRequested) return escalateOnly('LEADER_REQUESTED', 'Руководитель запросил перехват управления');
  if (assessment.constraints.some(constraint => constraint.code === 'MISSING_REQUIRED_DATA')) {
    return escalateOnly('INSUFFICIENT_DATA', 'Отсутствуют обязательные данные для решения');
  }
  if (assessment.constraints.some(constraint => constraint.code === 'UNRESOLVED_CONTRADICTION')) {
    return escalateOnly('UNRESOLVED_CONTRADICTION', 'Противоречие не разрешено доступными данными');
  }
  if (assessment.constraints.some(constraint => constraint.code === 'RESOURCE_UNAVAILABLE')) {
    return escalateOnly('RESOURCE_UNAVAILABLE', 'Доступных ресурсов недостаточно для запрошенного действия');
  }

  let plan: DecisionPlan;
  try {
    plan = await (input.decisionModel ?? { createPlan: createDecisionPlan }).createPlan({
      assignment,
      projection,
      assessment,
      ...(input.rngSeed ? { rngSeed: input.rngSeed } : {}),
    });
  } catch {
    return escalateOnly('MODEL_FAILURE', 'Вычислительная модель не сформировала проверяемый вариант');
  }
  if (expired()) return escalateOnly('TIME_BUDGET_EXCEEDED', 'Истёк тайм-бюджет при оценке вариантов');

  const selected = plan.options.find(option => option.optionId === plan.selectedOptionId);
  const actions = selected?.actions ?? [];
  language = await formulateGuardedText(input.languagePort, {
    kind: 'LEADER_REPORT',
    assignmentId: assignment.assignmentId,
    projectionHash,
    instruction: 'Сформулировать краткий доклад без новых фактов и команд',
    facts: { orderId: projection.activeOrder?.orderId ?? '', revision: projection.revision },
  }, () => `Доклад по приказу ${projection.activeOrder?.orderId ?? 'не задан'}; ревизия проекции ${projection.revision}.`);
  const baseCommands = createAgentCommands(assignment, projection, input.wake.wakeId, input.wake.requestedAt, actions);
  const proposedCommands = baseCommands.map(command => (
    ['createDocument', 'coordinateDocument', 'issueDocument', 'sendInput', 'sendReport', 'reportToLeader'].includes(command.kind)
      ? {
          ...command,
          payload: {
            ...command.payload,
            narrative: language.text,
            narrativeSource: language.source,
            narrativeExecutable: false as const,
          },
        }
      : command
  ));
  const allowed: { action: AgentRequestedAction; command: AgentCommand }[] = [];
  let authorizationFailure: { reason: EscalationReason; action: AgentRequestedAction } | undefined;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const command = proposedCommands[index];
    const authorization = authorizeAgentAction(assignment, action);
    if (!authorization.allowed) {
      authorizationFailure ??= { reason: authorization.reason, action };
    } else {
      allowed.push({ action, command });
    }
  }

  if (assignment.mode === 'ADVISORY' && !authorizationFailure) {
    return finish(plan, proposedCommands, [], [], escalateAssignment(assignment, 'ADVISORY_APPROVAL_REQUIRED', {
      detail: 'Команды подготовлены и ожидают решения человека',
      projection,
      currentTask: projection.activeOrder?.orderId,
    }));
  }

  const commands: AgentCommand[] = [];
  const responses: AgentCommandResponse[] = [];
  let commandFailure: { reason: EscalationReason; detail: string; action: AgentRequestedAction } | undefined;
  for (const candidate of allowed) {
    if (expired()) {
      commandFailure ??= { reason: 'TIME_BUDGET_EXCEEDED', detail: 'Истёк тайм-бюджет при подаче команд', action: candidate.action };
      break;
    }
    commands.push(candidate.command);
    try {
      const response = await input.server.submit(candidate.command);
      responses.push(response);
      if (!response.accepted) {
        commandFailure ??= {
          reason: response.reason === 'OUTSIDE_DELEGATION' ? 'OUTSIDE_DELEGATION' : 'COMMAND_REJECTED',
          detail: response.reason ?? 'Сервер отклонил команду',
          action: candidate.action,
        };
        break;
      }
    } catch {
      const response: AgentCommandResponse = {
        commandId: candidate.command.commandId,
        accepted: false,
        idempotent: false,
        effectApplied: false,
        status: 'PENDING',
        reason: 'COMMAND_UNAVAILABLE',
      };
      responses.push(response);
      commandFailure ??= { reason: 'COMMAND_UNAVAILABLE', detail: 'Команда оставлена для восстановления с прежним ключом', action: candidate.action };
      break;
    }
  }

  const failure = commandFailure ?? (authorizationFailure ? {
    reason: authorizationFailure.reason,
    detail: `Действие ${authorizationFailure.action.kind} не применено: ${authorizationFailure.reason}`,
    action: authorizationFailure.action,
  } : undefined);
  const escalated = failure ? escalateAssignment(assignment, failure.reason, {
    detail: failure.detail,
    projection,
    currentTask: projection.activeOrder?.orderId,
    proposedAction: failure.action,
  }) : undefined;
  return finish(plan, proposedCommands, commands, responses, escalated);
}
