export type ApprovalStepKind = 'REQUIRED' | 'ADVISORY' | 'FINAL';
export type ApprovalDecisionKind = 'APPROVED' | 'CHANGES_REQUESTED';

export type ApprovalStep = Readonly<{
  id: string;
  approverId: string;
  kind: ApprovalStepKind;
  dueAt?: string;
  remindAt?: string;
}>;

export type ApprovalRoute = Readonly<{
  id: string;
  mode: 'SEQUENTIAL' | 'PARALLEL';
  steps: readonly ApprovalStep[];
  finalApproverId: string;
  escalationTo: string;
  delegations?: Readonly<Record<string, readonly string[]>>;
  substitutions?: Readonly<Record<string, readonly string[]>>;
}>;

export type RouteDecision = Readonly<{
  stepId: string;
  actorId: string;
  decision: ApprovalDecisionKind;
  at: string;
  comment: string;
}>;

export type ApprovalProgress = Readonly<{
  routeId: string;
  state: 'PENDING' | 'IN_REVIEW' | 'APPROVED' | 'CHANGES_REQUESTED';
  decisions: readonly RouteDecision[];
}>;

export function initialApprovalProgress(route: ApprovalRoute): ApprovalProgress {
  if (!route.steps.some(step => step.kind === 'FINAL' && step.approverId === route.finalApproverId)) {
    throw new Error('Маршрут требует финальный шаг назначенной полномочной инстанции');
  }
  return { routeId: route.id, state: 'PENDING', decisions: [] };
}

function allowedActor(route: ApprovalRoute, step: ApprovalStep, actorId: string): boolean {
  return actorId === step.approverId
    || (route.delegations?.[step.approverId]?.includes(actorId) ?? false)
    || (route.substitutions?.[step.approverId]?.includes(actorId) ?? false);
}

function routeState(route: ApprovalRoute, decisions: readonly RouteDecision[]): ApprovalProgress['state'] {
  const byStep = new Map(decisions.map(decision => [decision.stepId, decision]));
  const blockingReturned = route.steps.some(step => step.kind !== 'ADVISORY' && byStep.get(step.id)?.decision === 'CHANGES_REQUESTED');
  if (blockingReturned) return 'CHANGES_REQUESTED';
  const complete = route.steps.filter(step => step.kind !== 'ADVISORY').every(step => byStep.get(step.id)?.decision === 'APPROVED');
  if (complete) return 'APPROVED';
  return decisions.length ? 'IN_REVIEW' : 'PENDING';
}

export function advanceApprovalRoute(route: ApprovalRoute, progress: ApprovalProgress, decision: RouteDecision): ApprovalProgress {
  if (progress.routeId !== route.id) throw new Error('Решение относится к другому маршруту');
  if (!Number.isFinite(Date.parse(decision.at))) throw new Error('Некорректное время решения согласования');
  const step = route.steps.find(candidate => candidate.id === decision.stepId);
  if (!step) throw new Error('Шаг согласования отсутствует в маршруте');
  if (progress.decisions.some(item => item.stepId === step.id)) throw new Error('Повторное решение требует возврата на новый цикл согласования');
  if (step.kind === 'FINAL' && decision.actorId !== route.finalApproverId) throw new Error('Финальное утверждение вне полномочия инстанции');
  if (!allowedActor(route, step, decision.actorId)) throw new Error('Инстанция не назначена на шаг и не имеет делегирования');
  if (decision.decision === 'CHANGES_REQUESTED' && !decision.comment.trim()) throw new Error('Возврат требует замечания');
  if (route.mode === 'SEQUENTIAL' && step.kind !== 'ADVISORY') {
    const blocking = route.steps.filter(candidate => candidate.kind !== 'ADVISORY');
    const current = blocking.find(candidate => !progress.decisions.some(decisionItem => decisionItem.stepId === candidate.id));
    if (current?.id !== step.id) throw new Error('Нарушена последовательная очередь согласования');
  }
  const decisions = [...progress.decisions, { ...decision }];
  return { routeId: route.id, state: routeState(route, decisions), decisions };
}

export type RouteReminder = Readonly<{
  stepId: string;
  kind: 'REMINDER' | 'ESCALATION';
  recipientId: string;
}>;

export function routeReminders(route: ApprovalRoute, progress: ApprovalProgress, now: string): RouteReminder[] {
  const at = Date.parse(now);
  if (!Number.isFinite(at)) throw new Error('Некорректное время напоминания');
  return route.steps.flatMap((step): RouteReminder[] => {
    if (step.kind === 'ADVISORY' || progress.decisions.some(decision => decision.stepId === step.id)) return [];
    if (step.dueAt && at > Date.parse(step.dueAt)) return [{ stepId: step.id, kind: 'ESCALATION' as const, recipientId: route.escalationTo }];
    if (step.remindAt && at >= Date.parse(step.remindAt)) return [{ stepId: step.id, kind: 'REMINDER' as const, recipientId: step.approverId }];
    return [];
  });
}
