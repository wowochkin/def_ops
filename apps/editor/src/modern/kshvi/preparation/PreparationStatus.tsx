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
  if (!draft) return { environment: 'UNAVAILABLE', forces: 'UNAVAILABLE', initialMap: 'UNAVAILABLE', events: 'UNAVAILABLE', readiness: 'UNAVAILABLE', launch };
  return {
    environment: draft.environmentSnapshotId ? 'DATA_PRESENT' : 'NOT_STARTED',
    forces: draft.forces.length || draft.equipment.length || draft.formation || draft.logistics ? 'DATA_PRESENT' : 'NOT_STARTED',
    initialMap: draft.initialMap ? 'DATA_PRESENT' : 'NOT_STARTED',
    events: draft.autonomy ? 'DATA_PRESENT' : 'NOT_STARTED',
    readiness: draft.readinessStage || draft.readinessStates.length ? 'DATA_PRESENT' : 'NOT_STARTED',
    launch,
  };
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
