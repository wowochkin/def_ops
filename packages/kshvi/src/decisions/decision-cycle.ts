export {
  createDecision,
  projectDecision,
  reviseDecision,
  transitionDecision,
  DECISION_STATUSES,
  type Decision,
  type DecisionInput,
  type DecisionStatus,
} from './decision';

export const DECISION_CYCLE_ELEMENTS = [
  'TASK_CLARIFICATION',
  'SITUATION_REVIEW',
  'CAPABILITY_ASSESSMENT',
  'SUBORDINATE_TASKS',
  'COURSE_COMPARISON',
  'DECISION_FORMALIZATION',
  'DOCUMENT_COORDINATION',
  'EXECUTION_CONTROL',
  'DECISION_ADJUSTMENT',
] as const;
export type DecisionCycleElement = typeof DECISION_CYCLE_ELEMENTS[number];
export type DecisionCycleEntry = Readonly<{
  element: DecisionCycleElement;
  at: string;
  data: Readonly<Record<string, unknown>>;
}>;
export type DecisionCycle = Readonly<{ entries: readonly DecisionCycleEntry[] }>;

export function createDecisionCycle(): DecisionCycle {
  return Object.freeze({ entries: Object.freeze([]) });
}

export function recordDecisionElement(cycle: DecisionCycle, entry: DecisionCycleEntry): DecisionCycle {
  if (!DECISION_CYCLE_ELEMENTS.includes(entry.element)) throw new Error('Неизвестный элемент цикла решения');
  if (!Number.isFinite(Date.parse(entry.at))) throw new Error('Нужно корректное время элемента цикла');
  return Object.freeze({ entries: Object.freeze([...cycle.entries, Object.freeze({ ...entry, data: structuredClone(entry.data) })]) });
}

export function completeExercise<Snapshot>(input: {
  leaderApproved: boolean;
  stageConditionsMet: boolean;
  snapshot: Snapshot;
  unfinishedEvents: readonly Readonly<{ id: string; reason: string }>[];
  reviewMaterials: readonly Readonly<{ id: string; title: string }>[];
}) {
  if (!input.leaderApproved) throw new Error('Завершение требует решения руководителя учения');
  if (!input.stageConditionsMet) throw new Error('Условия завершения этапов ещё не выполнены');
  return Object.freeze({
    status: 'COMPLETED' as const,
    snapshot: structuredClone(input.snapshot),
    unfinishedEvents: structuredClone(input.unfinishedEvents),
    reviewMaterials: structuredClone(input.reviewMaterials),
    outcomeAuthority: 'EXERCISE_LEADER' as const,
  });
}
