import {
  type ReadinessActivityRecord,
  type ReadinessAuthorization,
  type ReadinessHistoryEntry,
  type ReadinessLimitation,
  type ReadinessLimitationCode,
  type ReadinessReport,
  type ReadinessState,
} from './readiness';

export type ReadinessActivityKind =
  | 'SIGNAL'
  | 'MANNING'
  | 'ORGANIZATION'
  | 'EQUIPMENT'
  | 'AREA'
  | 'COMMAND_POST'
  | 'COMMUNICATIONS'
  | 'SUPPLIES'
  | 'DEPLOYMENT'
  | 'ENGINEERING'
  | 'INTERACTION'
  | 'REPORT';

export type ReadinessActivity = Readonly<{
  id: string;
  kind: ReadinessActivityKind;
  title: string;
  responsibleNodeId: string;
  startAt: string;
  dueAt: string;
  durationMinutes: number;
  dependsOn: readonly string[];
  requiresSignal: boolean;
  preconditions: readonly Readonly<{ id: string; met: boolean | null; details: string }>[];
  resources: readonly Readonly<{ resourceId: string; unit: string; required: number; available: number | null }>[];
  reportRequired: boolean;
  criterion: Readonly<{ id: string; description: string }>;
}>;

export type ReadinessStage = Readonly<{
  id: string;
  title: string;
  startsAt: string;
  dueAt: string;
  signal: Readonly<{ id: string; sentAt: string; senderNodeId: string }>;
  activities: readonly ReadinessActivity[];
  completionCriterionIds: readonly string[];
  adverseOutcomes: readonly ('PARTIAL' | 'FAILED')[];
}>;

export type ReadinessCompletion = Readonly<{
  activityId: string;
  report?: Omit<ReadinessReport, 'activityId'>;
}>;

export type ReadinessAdvanceInput = Readonly<{
  at: string;
  signalReceivedAt?: string | null;
  completions?: readonly ReadinessCompletion[];
  criteria?: Readonly<Record<string, boolean | null>>;
  failures?: readonly Readonly<{ activityId: string; reason: string }>[];
}>;

const calculatedCodes = new Set<ReadinessLimitationCode>([
  'SIGNAL_NOT_RECEIVED', 'DEPENDENCY_NOT_COMPLETED', 'RESOURCE_SHORTAGE', 'RESOURCE_UNKNOWN',
  'REPORT_NOT_RECEIVED', 'CRITERION_NOT_MET', 'PRECONDITION_NOT_MET', 'PRECONDITION_UNKNOWN',
  'ACTIVITY_NOT_DUE', 'DEADLINE_MISSED', 'LEVEL_UNKNOWN', 'ACTIVITY_FAILED', 'UNKNOWN_ACTIVITY',
]);

function validTime(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function limitation(code: ReadinessLimitationCode, at: string, details: string, activityId?: string): ReadinessLimitation {
  return { code, since: at, details, ...(activityId ? { activityId } : {}) };
}

function addLimitation(target: ReadinessLimitation[], value: ReadinessLimitation): void {
  if (!target.some(item => item.code === value.code && item.activityId === value.activityId && item.details === value.details)) target.push(value);
}

function activityStart(activity: ReadinessActivity, signalReceivedAt: string | null): number {
  return Math.max(Date.parse(activity.startAt), activity.requiresSignal && signalReceivedAt ? Date.parse(signalReceivedAt) : Number.NEGATIVE_INFINITY);
}

/** Продвигает только фактические мероприятия, донесения и критерии; повтор completion идемпотентен. */
export function advanceReadiness(stage: ReadinessStage, previous: ReadinessState, input: ReadinessAdvanceInput): ReadinessState {
  if (!validTime(stage.startsAt) || !validTime(stage.dueAt) || !validTime(input.at)) throw new Error('Некорректные сроки этапа боевой готовности');
  if (Date.parse(input.at) < Date.parse(stage.startsAt)) return previous;
  if (Date.parse(stage.dueAt) < Date.parse(stage.startsAt)) throw new Error('Срок этапа боевой готовности раньше начала');

  const signalReceivedAt = input.signalReceivedAt === undefined
    ? previous.signalReceipt?.receivedAt ?? null
    : input.signalReceivedAt;
  if (signalReceivedAt !== null && !validTime(signalReceivedAt)) throw new Error('Некорректное время получения сигнала');
  const limitations = previous.limitations.filter(item => !calculatedCodes.has(item.code));
  const records = new Map(previous.activityRecords.map(record => [record.activityId, record]));
  const completed = new Set(previous.completedActivityIds);
  const reports = [...previous.reports];
  const history = [...previous.history];
  const criteria = { ...previous.criterionResults, ...input.criteria };
  const completions = new Map((input.completions ?? []).map(item => [item.activityId, item]));

  if (previous.initialLevel === null || previous.requiredLevel === null) {
    addLimitation(limitations, limitation('LEVEL_UNKNOWN', input.at, 'Исходный или требуемый уровень готовности неизвестен'));
  }
  if (!signalReceivedAt) addLimitation(limitations, limitation('SIGNAL_NOT_RECEIVED', input.at, `Сигнал ${stage.signal.id} не доведён через связь`));
  else if (!previous.signalReceipt && !previous.history.some(item => item.id === `signal:${stage.signal.id}`)) {
    history.push({ id: `signal:${stage.signal.id}`, at: signalReceivedAt, kind: 'SIGNAL_RECEIVED', causeId: stage.signal.id, details: 'Сигнал получен исполнителем через связь' });
  }

  for (const failure of input.failures ?? []) {
    const activity = stage.activities.find(item => item.id === failure.activityId);
    if (!activity || completed.has(failure.activityId)) continue;
    const record: ReadinessActivityRecord = {
      activityId: failure.activityId,
      status: 'FAILED',
      startedAt: previous.actualStartedAt ?? input.at,
      completedAt: input.at,
      reportId: null,
    };
    records.set(failure.activityId, record);
    addLimitation(limitations, limitation('ACTIVITY_FAILED', input.at, failure.reason, failure.activityId));
    if (!history.some(item => item.id === `failure:${failure.activityId}:${input.at}`)) {
      history.push({ id: `failure:${failure.activityId}:${input.at}`, at: input.at, kind: 'ACTIVITY_FAILED', causeId: failure.activityId, details: failure.reason });
    }
  }

  // Повторный проход позволяет перечислять зависимые донесения в любом порядке.
  for (let pass = 0; pass < stage.activities.length + 1; pass += 1) {
    let changed = false;
    for (const completion of completions.values()) {
      if (completed.has(completion.activityId)) continue;
      const activity = stage.activities.find(item => item.id === completion.activityId);
      if (!activity) {
        addLimitation(limitations, limitation('UNKNOWN_ACTIVITY', input.at, 'Мероприятие не принадлежит этапу', completion.activityId));
        continue;
      }
      const blockers: ReadinessLimitation[] = [];
      if (activity.requiresSignal && !signalReceivedAt) blockers.push(limitation('SIGNAL_NOT_RECEIVED', input.at, 'Мероприятие требует полученный сигнал', activity.id));
      const missingDependencies = activity.dependsOn.filter(id => !completed.has(id));
      if (missingDependencies.length) blockers.push(limitation('DEPENDENCY_NOT_COMPLETED', input.at, `Не завершены: ${missingDependencies.join(', ')}`, activity.id));
      if (!Number.isFinite(activity.durationMinutes) || activity.durationMinutes < 0 || !validTime(activity.startAt)) {
        blockers.push(limitation('ACTIVITY_NOT_DUE', input.at, 'Некорректная длительность или начало мероприятия', activity.id));
      }
      const completedAt = completion.report?.submittedAt ?? input.at;
      if (!validTime(completedAt) || Date.parse(completedAt) > Date.parse(input.at)) {
        blockers.push(limitation('ACTIVITY_NOT_DUE', input.at, 'Доклад датирован после текущего оперативного времени', activity.id));
      } else {
        const start = activityStart(activity, signalReceivedAt);
        if (!Number.isFinite(start) || Date.parse(completedAt) < start + activity.durationMinutes * 60000) {
          blockers.push(limitation('ACTIVITY_NOT_DUE', input.at, 'Не выдержана длительность мероприятия', activity.id));
        }
      }
      for (const precondition of activity.preconditions) {
        if (precondition.met === null) blockers.push(limitation('PRECONDITION_UNKNOWN', input.at, precondition.details, activity.id));
        else if (!precondition.met) blockers.push(limitation('PRECONDITION_NOT_MET', input.at, precondition.details, activity.id));
      }
      for (const resource of activity.resources) {
        if (resource.available === null) blockers.push(limitation('RESOURCE_UNKNOWN', input.at, `Неизвестен запас ${resource.resourceId}`, activity.id));
        else if (!Number.isFinite(resource.available) || resource.available < resource.required) {
          blockers.push(limitation('RESOURCE_SHORTAGE', input.at, `Дефицит ${resource.resourceId}: требуется ${resource.required} ${resource.unit}`, activity.id));
        }
      }
      if (activity.reportRequired && !completion.report) blockers.push(limitation('REPORT_NOT_RECEIVED', input.at, 'Нет донесения ответственной инстанции', activity.id));
      if (completion.report && (!completion.report.id.trim() || !completion.report.authorId.trim() || completion.report.authorId !== activity.responsibleNodeId || !completion.report.text.trim())) {
        blockers.push(limitation('REPORT_NOT_RECEIVED', input.at, 'Донесение не содержит автора, идентификатор или проверяемый результат', activity.id));
      }
      if (criteria[activity.criterion.id] !== true) blockers.push(limitation('CRITERION_NOT_MET', input.at, activity.criterion.description, activity.id));
      if (Date.parse(completedAt) > Date.parse(activity.dueAt)) blockers.push(limitation('DEADLINE_MISSED', input.at, 'Фактический срок позже назначенного', activity.id));

      // Сначала ждём зависимости: на следующем проходе остальные блокеры будут проверены снова.
      if (missingDependencies.length && pass < stage.activities.length) continue;
      if (blockers.length) {
        for (const blocker of blockers) addLimitation(limitations, blocker);
        continue;
      }
      const record: ReadinessActivityRecord = {
        activityId: activity.id,
        status: 'COMPLETED',
        startedAt: new Date(activityStart(activity, signalReceivedAt)).toISOString(),
        completedAt,
        reportId: completion.report?.id ?? null,
      };
      records.set(activity.id, record);
      completed.add(activity.id);
      changed = true;
      if (completion.report && !reports.some(report => report.id === completion.report!.id)) reports.push({ ...completion.report, activityId: activity.id });
      const historyId = `completion:${activity.id}:${record.completedAt}`;
      if (!history.some(item => item.id === historyId)) {
        history.push({ id: historyId, at: completedAt, kind: 'ACTIVITY_COMPLETED', causeId: activity.id, details: completion.report?.text ?? activity.title });
      }
    }
    if (!changed && pass >= stage.activities.length) break;
  }

  const allCompleted = stage.activities.every(activity => completed.has(activity.id));
  const allCriteria = stage.completionCriterionIds.every(id => criteria[id] === true);
  const failed = records.size > 0 && [...records.values()].some(record => record.status === 'FAILED');
  const overdue = Date.parse(input.at) > Date.parse(stage.dueAt) && !allCompleted;
  if (overdue) addLimitation(limitations, limitation('DEADLINE_MISSED', input.at, 'Этап не завершён к назначенному сроку'));
  const status = allCompleted && allCriteria && limitations.length === 0
    ? 'READY'
    : completed.size > 0 || previous.status === 'PARTIAL'
      ? 'PARTIAL'
      : failed || overdue ? 'FAILED' : 'IN_PROGRESS';
  const completionTimes = [...records.values()].filter(record => record.status === 'COMPLETED').map(record => Date.parse(record.completedAt));

  return {
    ...previous,
    status,
    actualStartedAt: previous.actualStartedAt ?? input.at,
    ...(status === 'READY' && completionTimes.length ? { actualCompletedAt: new Date(Math.max(...completionTimes)).toISOString() } : {}),
    ...(signalReceivedAt
      ? { signalReceipt: { signalId: stage.signal.id, receivedAt: signalReceivedAt } }
      : previous.signalReceipt ? { signalReceipt: previous.signalReceipt } : {}),
    completedActivityIds: stage.activities.filter(activity => completed.has(activity.id)).map(activity => activity.id),
    activityRecords: [...records.values()].sort((a, b) => a.activityId.localeCompare(b.activityId)),
    reports,
    criterionResults: criteria,
    limitations,
    history,
  };
}

export type ReadinessActor = Readonly<{
  userId: string;
  activeRole: string;
  organizationId: string;
  authorities: readonly string[];
}>;

/** Официальное решение разрешает переход, но не завершает мероприятия и не удаляет последствия. */
export function authorizePartialReadiness(state: ReadinessState, decision: ReadinessAuthorization, actor: ReadinessActor): ReadinessState {
  if (state.status !== 'PARTIAL') throw new Error('Разрешение оформляется только для частичной готовности');
  if (actor.userId !== decision.actorId || !actor.organizationId) throw new Error('Решение должен принять уполномоченный руководитель');
  decision = { ...decision, actorRole: actor.activeRole, authorities: [...actor.authorities] };
  if (!decision.authorized || decision.actorRole !== 'LEADER' || !decision.authorities.includes('readiness.partial.override')) {
    throw new Error('Решение должен принять уполномоченный руководитель');
  }
  if (!decision.decisionId.trim() || !decision.actorId.trim() || !decision.orderId.trim() || !decision.basis.trim() || !decision.rationale.trim() || !validTime(decision.at)) {
    throw new Error('Решение требует идентификатор, руководителя, приказ, основание, обоснование и время');
  }
  const actualLimitations = new Set(state.limitations.map(item => item.code));
  if (actualLimitations.size === 0 || [...actualLimitations].some(code => !decision.limitations.includes(code))) {
    throw new Error('Разрешение должно перечислять все фактические ограничения первого приказа');
  }
  if (state.authorizations.some(item => item.orderId === decision.orderId && item.decisionId !== decision.decisionId)) {
    throw new Error('Для этого приказа уже оформлено другое разрешение');
  }
  const duplicate = state.authorizations.find(item => item.decisionId === decision.decisionId);
  if (duplicate) {
    if (JSON.stringify(duplicate) !== JSON.stringify(decision)) throw new Error('Идентификатор решения уже использован');
    return state;
  }
  const entry: ReadinessHistoryEntry = {
    id: `authorization:${decision.decisionId}`,
    at: decision.at,
    kind: 'PARTIAL_AUTHORIZED',
    causeId: decision.decisionId,
    details: `${decision.basis}: ${decision.rationale}; ограничения сохранены`,
  };
  return {
    ...state,
    authorizations: [...state.authorizations, decision],
    history: [...state.history, entry],
  };
}
