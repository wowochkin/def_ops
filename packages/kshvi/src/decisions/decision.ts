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
  createdAt: string;
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
export type ScopedDecisionProjection = Readonly<{
  id: string;
  sideId: string;
  revision: number;
  status: DecisionStatus;
  visibility: 'ASSIGNED' | 'EXISTS_WITHOUT_CONTENT';
  tasks: readonly DecisionTask[];
  deadlines: Decision['deadlines'];
  coordination: Decision['coordination'];
}>;

const transitions: Record<DecisionStatus, readonly DecisionStatus[]> = {
  DRAFT: ['ACCEPTED'], ACCEPTED: ['DELIVERED'], DELIVERED: ['EXECUTING'], EXECUTING: ['COMPLETED'], COMPLETED: [],
};

function copyDecision<T extends Decision>(decision: T): T { return structuredClone(decision); }
function validAt(at: string, message: string): void {
  if (!Number.isFinite(Date.parse(at))) throw new Error(message);
}

export function createDecision(input: DecisionInput): Decision {
  if (!input.id.trim() || !input.sideId.trim() || !input.authorId.trim()) throw new Error('Решение требует идентификатор, сторону и автора');
  validAt(input.createdAt, 'Нужно корректное время создания решения');
  if (!input.intent.trim()) throw new Error('В решении нужен замысел');
  if (input.goals.some(goal => !Number.isSafeInteger(goal.rank) || goal.rank < 1)) throw new Error('Цели решения должны быть ранжированы');
  if (new Set(input.goals.map(goal => goal.rank)).size !== input.goals.length) throw new Error('Ранги целей не должны повторяться');
  if (input.resources.some(resource => !Number.isFinite(resource.amount) || resource.amount < 0 || !resource.unit.trim())) throw new Error('Некорректное распределение ресурсов');
  return Object.freeze({
    ...structuredClone(input), revision: 1, supersedes: null, status: 'DRAFT' as const,
    statusHistory: Object.freeze([Object.freeze({ status: 'DRAFT' as const, at: input.createdAt })]),
  });
}

export function transitionDecision(decision: Decision, status: DecisionStatus, at: string): Decision {
  if (!transitions[decision.status].includes(status)) throw new Error(`Недопустимый переход решения: ${decision.status} → ${status}`);
  validAt(at, 'Нужно корректное оперативное время перехода');
  const lastAt = decision.statusHistory.at(-1)?.at;
  if (lastAt && Date.parse(at) < Date.parse(lastAt)) throw new Error('Нарушена хронология статусов решения');
  return Object.freeze({
    ...copyDecision(decision), status,
    statusHistory: Object.freeze([...decision.statusHistory, Object.freeze({ status, at })]),
  });
}

export function reviseDecision(
  decision: Decision,
  changes: Partial<Pick<Decision, 'intent' | 'goals' | 'tasks' | 'resources' | 'deadlines' | 'coordination' | 'reserves' | 'transitionConditions' | 'assumptions'>>,
  revisedAt: string,
  idFactory: () => string = newUUID,
): Decision & { revisedAt: string } {
  validAt(revisedAt, 'Нужно время корректировки решения');
  const revised = createDecision({
    id: idFactory(), sideId: decision.sideId, authorId: decision.authorId, createdAt: revisedAt,
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

export function projectDecision(decision: Decision, actor: { sideId: string; role: 'TRAINEE' | 'INTERMEDIARY' | 'LEADER'; assignedNodeIds?: readonly string[] }): (Decision & { visibility: 'TRUTH' }) | ScopedDecisionProjection {
  if (actor.role === 'LEADER') return { ...copyDecision(decision), visibility: 'TRUTH' };
  const assigned = actor.assignedNodeIds ?? [];
  const assignedTasks = decision.tasks.filter(task => assigned.includes(task.assigneeId));
  if (actor.sideId === decision.sideId) {
    if (!assignedTasks.length) throw new Error('403: Решение вне назначенных инстанций');
    const taskIds = new Set(assignedTasks.map(task => task.id));
    return {
      id: decision.id, sideId: decision.sideId, revision: decision.revision, status: decision.status, visibility: 'ASSIGNED',
      tasks: structuredClone(assignedTasks),
      deadlines: structuredClone(decision.deadlines.filter(deadline => taskIds.has(deadline.taskId))),
      coordination: structuredClone(decision.coordination.filter(item => assigned.includes(item.withNodeId))),
    };
  }
  if (actor.role === 'INTERMEDIARY' && !assignedTasks.length) throw new Error('403: Решение вне закреплённого участка');
  return { id: decision.id, sideId: decision.sideId, revision: decision.revision, status: decision.status, visibility: 'EXISTS_WITHOUT_CONTENT', tasks: [], deadlines: [], coordination: [] };
}
