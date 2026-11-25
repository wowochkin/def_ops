import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ExerciseCard } from '../kshvi-api';
import { stateLabel, type PreparationStepState } from '../library-actions';
import { roleNames } from '../LoginPanel';
import type { PreparationStep } from './preparation-steps';

export function preparationStepStates(
  card: ExerciseCard,
  draft: PreparationDraft | null,
): Record<PreparationStep, PreparationStepState> {
  const launch = card.state === 'SEALED' ? 'CONFIRMED'
    : card.validation === 'ERROR' ? 'HAS_ERRORS'
    : card.state === 'APPROVED' && card.validation === 'OK' ? 'READY_FOR_REVIEW' : 'NEEDS_DATA';
  if (!draft) return { environment: 'UNAVAILABLE', forces: 'UNAVAILABLE', events: 'UNAVAILABLE', readiness: 'UNAVAILABLE', launch };
  const environment = draft.initialMapStatus === 'APPROVED' ? 'CONFIRMED'
    : draft.initialMapStatus === 'MAPPED' ? 'READY_FOR_REVIEW'
    : draft.environmentSnapshotId ? 'NEEDS_DATA' : 'NOT_STARTED';
  const forces = draft.forces.length && draft.formation && draft.logistics ? 'READY_FOR_REVIEW'
    : draft.forces.length || draft.equipment.length || draft.formation || draft.logistics ? 'NEEDS_DATA' : 'NOT_STARTED';
  const readiness = !draft.readinessStage && !draft.readinessStates.length ? 'NOT_STARTED'
    : draft.readinessStage && draft.readinessStates.length ? 'READY_FOR_REVIEW' : 'NEEDS_DATA';
  return { environment, forces, events: draft.autonomy ? 'READY_FOR_REVIEW' : 'NOT_STARTED', readiness, launch };
}

const timeFormat = new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'medium', timeZone: 'UTC' });

export function PreparationStatus({ card, role, dirty, saving }: {
  card: ExerciseCard;
  role: string;
  dirty: boolean;
  saving: boolean;
}) {
  const revision = card.revisions.find(item => item.revision === card.revision);
  const savedAt = revision ? Date.parse(revision.createdAt) : NaN;
  return <div className="preparation-status">
    <div>
      <h2>{card.title}</h2>
      <p>Редакция {card.revision} · {stateLabel(card.state)} · {roleNames[role] ?? 'Роль не указана'}</p>
    </div>
    <div className="preparation-save-status" role="status">
      <p>{saving ? 'Сохраняем на сервере…' : dirty ? 'Есть несохранённые изменения' : `Сохранена редакция ${card.revision}`}</p>
      {revision && Number.isFinite(savedAt) && <time dateTime={revision.createdAt}>{timeFormat.format(savedAt)} UTC</time>}
    </div>
  </div>;
}
