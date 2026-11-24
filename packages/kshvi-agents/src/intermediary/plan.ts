import type { ElectronicIntermediaryAssignment } from '../model/assignment';
import { hashProjection, type AgentDecisionOption, type RandomKey } from '../model/decision-trace';
import type { SituationAssessment } from './assess';
import type { ActiveOrder, ServerIntermediaryProjection } from './classify';

export type IntermediaryDecision = Readonly<{
  intent: string;
  goals: readonly string[];
  tasks: readonly string[];
  resourceAllocation: Readonly<Record<string, number>>;
  deadlines: readonly string[];
  coordination: readonly string[];
  reserves: readonly string[];
  transitionConditions: readonly string[];
  assumptions: readonly string[];
  status: 'DRAFT' | 'ADOPTED';
}>;

export type DecisionPlan = Readonly<{
  options: readonly AgentDecisionOption[];
  selectedOptionId: string | null;
  decision: IntermediaryDecision;
  rngKeys: readonly RandomKey[];
}>;

export type DecisionPlanContext = Readonly<{
  assignment: ElectronicIntermediaryAssignment;
  projection: ServerIntermediaryProjection;
  assessment: SituationAssessment;
  rngSeed?: string;
}>;

export type DecisionModelPort = Readonly<{
  createPlan(context: DecisionPlanContext): DecisionPlan | Promise<DecisionPlan>;
}>;

function decisionFromOrder(order: ActiveOrder | undefined, mode: ElectronicIntermediaryAssignment['mode']): IntermediaryDecision {
  return {
    intent: order?.intent ?? 'Продолжить безопасное состояние до получения данных',
    goals: order ? [...order.goals] : [],
    tasks: order ? [...order.tasks] : [],
    resourceAllocation: { ...(order?.resources ?? {}) },
    deadlines: order ? [...order.deadlines] : [],
    coordination: order ? [...order.coordination] : [],
    reserves: order ? [...order.reserves] : [],
    transitionConditions: order ? [...order.transitionConditions] : [],
    assumptions: order ? [...order.assumptions] : ['Новых разрешённых действий не требуется'],
    status: mode === 'ADVISORY' ? 'DRAFT' : 'ADOPTED',
  };
}

function replay(optionId: string, projectionHash: string, actions: AgentDecisionOption['actions']) {
  return {
    replayId: `fork-${hashProjection({ optionId, projectionHash }).slice(0, 20)}`,
    inputHash: projectionHash,
    outcomeHash: hashProjection({ optionId, projectionHash, actions: actions.map(action => action.actionId) }),
    officialProjectionHash: projectionHash,
    isolated: true as const,
    writeAccess: false as const,
    officialWorldChanged: false as const,
  };
}

export function createDecisionPlan(context: DecisionPlanContext): DecisionPlan {
  const { assignment, projection, assessment } = context;
  const projectionHash = hashProjection(projection);
  const requestedRisk = projection.requestedActions.reduce((sum, action) => sum + (action.risk ?? 0), 0);
  const delegated: AgentDecisionOption = {
    optionId: 'delegated-actions',
    title: 'Выполнить делегированные действия',
    actions: projection.requestedActions,
    utility: {
      score: projection.requestedActions.length - requestedRisk - assessment.unknownData.length,
      reasons: [
        `Разрешённых кандидатов до проверки полномочий: ${projection.requestedActions.length}`,
        `Суммарный заявленный риск вычтен из полезности: ${requestedRisk}`,
        `Неизвестных данных: ${assessment.unknownData.length}`,
      ],
    },
    replay: replay('delegated-actions', projectionHash, projection.requestedActions),
  };
  const continueOrder: AgentDecisionOption = {
    optionId: 'continue-order',
    title: 'Продолжить действующий приказ',
    actions: [],
    utility: {
      score: (projection.activeOrder ? 0 : -1) - assessment.unknownData.length,
      reasons: [projection.activeOrder ? 'Сохраняется действующий приказ без новых эффектов' : 'Действующий приказ отсутствует'],
    },
    replay: replay('continue-order', projectionHash, []),
  };
  const options = [delegated, continueOrder]
    .sort((left, right) => right.utility.score - left.utility.score || left.optionId.localeCompare(right.optionId))
    .slice(0, Math.max(1, assignment.modernProfile.maxOptions));
  const seed = context.rngSeed ?? projectionHash;
  const rngKeys: RandomKey[] = [{
    seed,
    stream: 'intermediary-option-order',
    key: hashProjection({ seed, assignmentId: assignment.assignmentId, sequence: projection.sequence, stream: 'intermediary-option-order' }),
    cursor: 0,
  }];
  return {
    options,
    selectedOptionId: options[0]?.optionId ?? null,
    decision: decisionFromOrder(projection.activeOrder, assignment.mode),
    rngKeys,
  };
}
