import type { ElectronicIntermediaryAssignment } from '../model/assignment';
import type { ServerIntermediaryProjection } from './classify';

export type DecisionConstraint = Readonly<{
  constraintId: string;
  code: 'MISSING_REQUIRED_DATA' | 'UNRESOLVED_CONTRADICTION' | 'LEADER_REQUESTED' | 'RESOURCE_UNAVAILABLE' | 'STALE_OBSERVATION' | 'DEADLINE_EXCEEDED';
  detail: string;
  actionId?: string;
}>;

export type SituationAssessment = Readonly<{
  changes: readonly string[];
  constraints: readonly DecisionConstraint[];
  unknownData: readonly string[];
  overdueTaskIds: readonly string[];
}>;

export function assessSituation(
  assignment: ElectronicIntermediaryAssignment,
  projection: ServerIntermediaryProjection,
): SituationAssessment {
  const constraints: DecisionConstraint[] = [];
  const unknownData = new Set<string>();
  const requiredValues: Record<string, unknown> = {
    activeOrder: projection.activeOrder,
    tasks: projection.tasks.length > 0 ? projection.tasks : undefined,
    observations: projection.observations.length > 0 ? projection.observations : undefined,
    reports: projection.reports.length > 0 ? projection.reports : undefined,
    resources: Object.keys(projection.resources).length > 0 ? projection.resources : undefined,
  };
  for (const required of assignment.escalation.requiredData) {
    if (!requiredValues[required]) {
      constraints.push({ constraintId: `missing:${required}`, code: 'MISSING_REQUIRED_DATA', detail: `Нет обязательных данных: ${required}` });
      unknownData.add(required);
    }
  }
  for (const [index, contradiction] of (projection.contradictions ?? []).entries()) {
    constraints.push({ constraintId: `contradiction:${index}`, code: 'UNRESOLVED_CONTRADICTION', detail: contradiction });
  }
  if (projection.leaderRequested) {
    constraints.push({ constraintId: 'leader-requested', code: 'LEADER_REQUESTED', detail: 'Руководитель запросил перехват управления' });
  }
  for (const observation of projection.observations.filter(candidate => candidate.stale)) {
    constraints.push({ constraintId: `stale:${observation.observationId}`, code: 'STALE_OBSERVATION', detail: `Устарели сведения ${observation.observationId}` });
    unknownData.add(`Актуальные сведения ${observation.observationId}`);
  }
  for (const action of projection.requestedActions) {
    for (const [resource, required] of Object.entries(action.requiredResources ?? {})) {
      const available = projection.resources[resource];
      if (available === undefined || available < required) {
        constraints.push({
          constraintId: `resource:${action.actionId}:${resource}`,
          code: 'RESOURCE_UNAVAILABLE',
          detail: `Ресурс ${resource}: требуется ${required}, доступно ${available ?? 'неизвестно'}`,
          actionId: action.actionId,
        });
        unknownData.add(`Доступность ресурса ${resource}`);
      }
    }
  }
  const overdueTaskIds = projection.tasks
    .filter(task => task.status !== 'COMPLETED' && Date.parse(task.dueAt) < Date.parse(projection.operationalAt))
    .map(task => task.taskId);
  for (const taskId of overdueTaskIds) {
    constraints.push({ constraintId: `deadline:${taskId}`, code: 'DEADLINE_EXCEEDED', detail: `Истёк срок задачи ${taskId}` });
  }
  return {
    changes: [
      `Ревизия проекции ${projection.revision}, последовательность ${projection.sequence}`,
      `Новых запрошенных действий: ${projection.requestedActions.length}`,
    ],
    constraints,
    unknownData: [...unknownData],
    overdueTaskIds,
  };
}
