import type { RoleAssignment } from '../../../../../../services/kshvi/src/auth/assignment-service';
import { sessionModeLabel } from '../../../../../../services/kshvi/src/auth/organization-policy';

function format(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(value));
}

export function RoleAssignments({ assignments, onRevoke }: {
  assignments: readonly RoleAssignment[];
  onRevoke: (assignmentId: string) => void;
}) {
  return <section className="modern-kshvi kshvi-admin" aria-labelledby="roles-heading">
    <h2 id="roles-heading">Предметные назначения</h2>
    <p>Назначения создаются руководителем или уполномоченным методистом отдельно от технических прав.</p>
    {assignments.map(assignment => <article className="kshvi-admin-card" key={assignment.id}>
      <h3>{assignment.postId}</h3>
      <strong>{sessionModeLabel(assignment.sessionMode)}</strong>
      <p>Участник: {assignment.userId} · роль: {assignment.role}</p>
      <p>{`Срок: ${format(assignment.validFrom)} — ${format(assignment.validUntil)}`}</p>
      <p>Инстанция: {assignment.instanceId} · сторона: {assignment.sideId ?? 'не задана'} · участок: {assignment.areaId ?? 'не задан'}</p>
      <p>Заместитель: {assignment.substituteUserId ?? 'не назначен'}</p>
      <p>Допустимые действия: {assignment.allowedActions.join(', ')}</p>
      <button disabled={assignment.state !== 'ACTIVE'} onClick={() => onRevoke(assignment.id)}>Отозвать назначение {assignment.postId}</button>
    </article>)}
  </section>;
}
