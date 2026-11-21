import { newUUID } from '../model/uuid';

export const DECISION_STATUSES = ['DRAFT', 'ACCEPTED', 'DELIVERED', 'EXECUTING', 'COMPLETED'] as const;
export type DecisionStatus = typeof DECISION_STATUSES[number];
export type DecisionGoal = Readonly<{ id: string; rank: number; title: string }>;
export type DecisionTask = Readonly<{ id: string; assigneeId: string; title: string }>;
export type DecisionResource = Readonly<{ resourceId: string; amount: number; unit: string }>;
export type Decision = Readonly<{
  id: string;
  sideId: string;
  authorId: string;
  revision: number;
  supersedes: string | null;
  intent: string;
  goals: readonly DecisionGoal[];
  tasks: readonly DecisionTask[];
  resources: readonly DecisionResource[];
  deadlines: readonly Readonly<{ taskId: string; operationalAt: string }>[];
  coordination: readonly Readonly<{ withNodeId: string; subject: string }>[];
  reserves: readonly Readonly<{ forceId: string; condition: string }>[];
  transitionConditions: readonly Readonly<{ id: string; expression: string }>[];
  assumptions: readonly Readonly<{ id: string; text: string }>[];
  status: DecisionStatus;
  statusHistory: readonly Readonly<{ status: DecisionStatus; at: string }>[];
}>;
export type DecisionInput = Omit<Decision, 'revision' | 'supersedes' | 'status' | 'statusHistory'>;

const transitions: Record<DecisionStatus, readonly DecisionStatus[]> = {
  DRAFT: ['ACCEPTED'],
  ACCEPTED: ['DELIVERED'],
  DELIVERED: ['EXECUTING'],
  EXECUTING: ['COMPLETED'],
  COMPLETED: [],
};

function copyDecision<T extends Decision>(decision: T): T {
  return structuredClone(decision);
}

export function createDecision(input: DecisionInput): Decision {
  if (!input.id.trim() || !input.sideId.trim() || !input.authorId.trim()) throw new Error('Решение требует идентификатор, сторону и автора');
  if (!input.intent.trim()) throw new Error('В решении нужен замысел');
  if (input.goals.some(goal => !Number.isSafeInteger(goal.rank) || goal.rank < 1)) throw new Error('Цели решения должны быть ранжированы');
  if (new Set(input.goals.map(goal => goal.rank)).size !== input.goals.length) throw new Error('Ранги целей не должны повторяться');
  if (input.resources.some(resource => !Number.isFinite(resource.amount) || resource.amount < 0 || !resource.unit.trim())) throw new Error('Некорректное распределение ресурсов');
  return Object.freeze({
    ...structuredClone(input), revision: 1, supersedes: null, status: 'DRAFT' as const,
    statusHistory: Object.freeze([Object.freeze({ status: 'DRAFT' as const, at: '' })]),
  });
}

export function transitionDecision(decision: Decision, status: DecisionStatus, at: string): Decision {
  if (!transitions[decision.status].includes(status)) throw new Error(`Недопустимый переход решения: ${decision.status} → ${status}`);
  if (!Number.isFinite(Date.parse(at))) throw new Error('Нужно корректное оперативное время перехода');
  const next = copyDecision(decision) as {
    -readonly [K in keyof Decision]: Decision[K];
  };
  return Object.freeze({
    ...next, status,
    statusHistory: Object.freeze([...decision.statusHistory, Object.freeze({ status, at })]),
  });
}

export function reviseDecision(
  decision: Decision,
  changes: Partial<Pick<Decision, 'intent' | 'goals' | 'tasks' | 'resources' | 'deadlines' | 'coordination' | 'reserves' | 'transitionConditions' | 'assumptions'>>,
  revisedAt: string,
  idFactory: () => string = newUUID,
): Decision & { revisedAt: string } {
  if (!Number.isFinite(Date.parse(revisedAt))) throw new Error('Нужно время корректировки решения');
  const revised = createDecision({
    id: idFactory(), sideId: decision.sideId, authorId: decision.authorId,
    intent: changes.intent ?? decision.intent,
    goals: changes.goals ?? decision.goals,
    tasks: changes.tasks ?? decision.tasks,
    resources: changes.resources ?? decision.resources,
    deadlines: changes.deadlines ?? decision.deadlines,
    coordination: changes.coordination ?? decision.coordination,
    reserves: changes.reserves ?? decision.reserves,
    transitionConditions: changes.transitionConditions ?? decision.transitionConditions,
    assumptions: changes.assumptions ?? decision.assumptions,
  });
  return Object.freeze({ ...revised, revision: decision.revision + 1, supersedes: decision.id, revisedAt });
}

export function projectDecision(decision: Decision, actor: { sideId: string; role: 'TRAINEE' | 'INTERMEDIARY' | 'LEADER'; assignedNodeIds?: readonly string[] }) {
  if (actor.role === 'INTERMEDIARY' && actor.sideId !== decision.sideId) {
    const assigned = actor.assignedNodeIds ?? [];
    if (!decision.tasks.some(task => assigned.includes(task.assigneeId))) throw new Error('403: Решение вне закреплённого участка');
  }
  if (actor.sideId === decision.sideId || actor.role === 'LEADER') return copyDecision(decision);
  return { id: decision.id, sideId: decision.sideId, status: decision.status, visibility: 'EXISTS_WITHOUT_CONTENT' as const };
}
