import type { AgentCommandResponse } from './act';
import type { ServerIntermediaryProjection } from './classify';
import type { AgentEscalation } from './escalate';

export type ObservationSheet = Readonly<{
  assignmentId: string;
  operationalAt: string;
  entries: readonly Readonly<{
    entryId: string;
    kind: 'DEADLINE' | 'COMMAND' | 'ESCALATION';
    subjectId: string;
    status: string;
    detail: string;
  }>[];
}>;

export function createObservationSheet(
  projection: ServerIntermediaryProjection,
  responses: readonly AgentCommandResponse[],
  escalation?: AgentEscalation,
): ObservationSheet {
  const deadlines = projection.tasks.map(task => {
    const overdue = task.status !== 'COMPLETED' && Date.parse(task.dueAt) < Date.parse(projection.operationalAt);
    return {
      entryId: `deadline:${task.taskId}`,
      kind: 'DEADLINE' as const,
      subjectId: task.taskId,
      status: overdue ? 'OVERDUE' : task.status,
      detail: `Срок ${task.dueAt}`,
    };
  });
  const commands = responses.map(response => ({
    entryId: `command:${response.commandId}`,
    kind: 'COMMAND' as const,
    subjectId: response.commandId,
    status: response.status,
    detail: response.reason ?? (response.idempotent ? 'Повтор без нового эффекта' : 'Ответ сервера зафиксирован'),
  }));
  const escalations = escalation ? [{
    entryId: `escalation:${escalation.reason}`,
    kind: 'ESCALATION' as const,
    subjectId: escalation.assignmentId,
    status: escalation.reason,
    detail: escalation.detail,
  }] : [];
  return { assignmentId: projection.assignmentId, operationalAt: projection.operationalAt, entries: [...deadlines, ...commands, ...escalations] };
}
