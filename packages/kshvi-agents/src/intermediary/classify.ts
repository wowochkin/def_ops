import type { ElectronicIntermediaryAssignment } from '../model/assignment';

export type AgentRequestedAction = Readonly<{
  actionId: string;
  kind: string;
  instanceId: string;
  sectorId?: string;
  payload: Readonly<Record<string, unknown>>;
  risk?: number;
  severity?: number;
  requiredResources?: Readonly<Record<string, number>>;
  dueAt?: string;
}>;

export type ActiveOrder = Readonly<{
  orderId: string;
  version: number;
  intent: string;
  goals: readonly string[];
  tasks: readonly string[];
  resources: Readonly<Record<string, number>>;
  deadlines: readonly string[];
  coordination: readonly string[];
  reserves: readonly string[];
  transitionConditions: readonly string[];
  assumptions: readonly string[];
  status: 'DRAFT' | 'ADOPTED' | 'DELIVERED' | 'EXECUTING' | 'COMPLETED';
}>;

export type ProjectedTask = Readonly<{
  taskId: string;
  instanceId: string;
  status: string;
  dueAt: string;
}>;

export type ProjectedObservation = Readonly<{
  observationId: string;
  source: string;
  observedAt: string;
  deliveredAt: string;
  summary: string;
  confidence: number;
  stale: boolean;
}>;

export type ProjectedReport = Readonly<{
  reportId: string;
  instanceId: string;
  status: string;
  receivedAt: string;
}>;

export type ServerIntermediaryProjection = Readonly<{
  assignmentId: string;
  exerciseId: string;
  projectionId: string;
  revision: number;
  sequence: number;
  operationalAt: string;
  activeOrder?: ActiveOrder;
  tasks: readonly ProjectedTask[];
  observations: readonly ProjectedObservation[];
  reports: readonly ProjectedReport[];
  resources: Readonly<Record<string, number>>;
  requestedActions: readonly AgentRequestedAction[];
  contradictions?: readonly string[];
  leaderRequested?: boolean;
}>;

export type InputClassification = Readonly<{
  projectionId: string;
  revision: number;
  received: Readonly<{ tasks: number; observations: number; reports: number; actions: number }>;
  workingMap: Readonly<{
    updatedAt: string;
    entries: readonly Readonly<{
      entryId: string;
      kind: 'TASK' | 'OBSERVATION' | 'REPORT' | 'REQUESTED_ACTION';
      sourceId: string;
      summary: string;
    }>[];
  }>;
}>;

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
}

function strings(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function numbers(value: unknown): Readonly<Record<string, number>> {
  return Object.fromEntries(Object.entries(record(value)).filter((entry): entry is [string, number] => typeof entry[1] === 'number'));
}

function normalizeAction(value: unknown): AgentRequestedAction {
  const input = record(value);
  return {
    actionId: String(input.actionId ?? ''),
    kind: String(input.kind ?? ''),
    instanceId: String(input.instanceId ?? ''),
    ...(typeof input.sectorId === 'string' ? { sectorId: input.sectorId } : {}),
    payload: { ...record(input.payload) },
    ...(typeof input.risk === 'number' ? { risk: input.risk } : {}),
    ...(typeof input.severity === 'number' ? { severity: input.severity } : {}),
    ...(input.requiredResources ? { requiredResources: numbers(input.requiredResources) } : {}),
    ...(typeof input.dueAt === 'string' ? { dueAt: input.dueAt } : {}),
  };
}

export function normalizeServerProjection(
  assignment: ElectronicIntermediaryAssignment,
  value: unknown,
): ServerIntermediaryProjection {
  const input = record(value);
  if (input.assignmentId !== assignment.assignmentId || input.exerciseId !== assignment.exerciseId) {
    throw new Error('Сервер вернул проекцию другого назначения');
  }
  if (input.projectionId !== assignment.projection.projectionId) {
    throw new Error('Сервер вернул проекцию вне назначенной видимости');
  }
  const order = record(input.activeOrder);
  const activeOrder: ActiveOrder | undefined = input.activeOrder ? {
    orderId: String(order.orderId ?? ''),
    version: Number(order.version ?? 0),
    intent: String(order.intent ?? ''),
    goals: strings(order.goals),
    tasks: strings(order.tasks),
    resources: numbers(order.resources),
    deadlines: strings(order.deadlines),
    coordination: strings(order.coordination),
    reserves: strings(order.reserves),
    transitionConditions: strings(order.transitionConditions),
    assumptions: strings(order.assumptions),
    status: ['DRAFT', 'ADOPTED', 'DELIVERED', 'EXECUTING', 'COMPLETED'].includes(String(order.status))
      ? order.status as ActiveOrder['status']
      : 'DRAFT',
  } : undefined;
  return {
    assignmentId: assignment.assignmentId,
    exerciseId: assignment.exerciseId,
    projectionId: assignment.projection.projectionId,
    revision: Number(input.revision ?? 0),
    sequence: Number(input.sequence ?? 0),
    operationalAt: String(input.operationalAt ?? ''),
    ...(activeOrder ? { activeOrder } : {}),
    tasks: Array.isArray(input.tasks) ? input.tasks.map(item => {
      const task = record(item);
      return { taskId: String(task.taskId ?? ''), instanceId: String(task.instanceId ?? ''), status: String(task.status ?? ''), dueAt: String(task.dueAt ?? '') };
    }) : [],
    observations: Array.isArray(input.observations) ? input.observations.map(item => {
      const observation = record(item);
      return {
        observationId: String(observation.observationId ?? ''),
        source: String(observation.source ?? ''),
        observedAt: String(observation.observedAt ?? ''),
        deliveredAt: String(observation.deliveredAt ?? ''),
        summary: String(observation.summary ?? ''),
        confidence: Number(observation.confidence ?? 0),
        stale: observation.stale === true,
      };
    }) : [],
    reports: Array.isArray(input.reports) ? input.reports.map(item => {
      const report = record(item);
      return { reportId: String(report.reportId ?? ''), instanceId: String(report.instanceId ?? ''), status: String(report.status ?? ''), receivedAt: String(report.receivedAt ?? '') };
    }) : [],
    resources: numbers(input.resources),
    requestedActions: Array.isArray(input.requestedActions) ? input.requestedActions.map(normalizeAction) : [],
    ...(Array.isArray(input.contradictions) ? { contradictions: strings(input.contradictions) } : {}),
    ...(input.leaderRequested === true ? { leaderRequested: true } : {}),
  };
}

export function classifyProjection(projection: ServerIntermediaryProjection): InputClassification {
  const entries: InputClassification['workingMap']['entries'][number][] = [
    ...projection.tasks.map(task => ({ entryId: `task:${task.taskId}`, kind: 'TASK' as const, sourceId: task.taskId, summary: `${task.instanceId}: ${task.status}` })),
    ...projection.observations.map(observation => ({ entryId: `observation:${observation.observationId}`, kind: 'OBSERVATION' as const, sourceId: observation.observationId, summary: observation.summary })),
    ...projection.reports.map(report => ({ entryId: `report:${report.reportId}`, kind: 'REPORT' as const, sourceId: report.reportId, summary: `${report.instanceId}: ${report.status}` })),
    ...projection.requestedActions.map(action => ({ entryId: `action:${action.actionId}`, kind: 'REQUESTED_ACTION' as const, sourceId: action.actionId, summary: action.kind })),
  ];
  return {
    projectionId: projection.projectionId,
    revision: projection.revision,
    received: {
      tasks: projection.tasks.length,
      observations: projection.observations.length,
      reports: projection.reports.length,
      actions: projection.requestedActions.length,
    },
    workingMap: { updatedAt: projection.operationalAt, entries },
  };
}
