import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ExerciseCard } from '../kshvi-api';
import { stateLabel } from '../library-actions';
import type { PreparationStep } from './preparation-steps';
import { launchActionFor, type LaunchCommand } from './launch-labels';

export { launchActionFor } from './launch-labels';

export function LaunchChecklist({ card, draft, onAction, onStart, onValidate, onOpenStep, launchLocked = false }: {
  card: ExerciseCard;
  draft: PreparationDraft;
  onAction?(command: LaunchCommand): void;
  onStart?(): void;
  onValidate?(): void;
  onOpenStep?(step: PreparationStep): void;
  launchLocked?: boolean;
}) {
  const action = launchActionFor(card.state);
  const areas = [
    { step: 'environment' as const, title: 'Среда и исходная карта', ready: !!draft.environmentSnapshotId && draft.initialMapStatus === 'APPROVED', present: !!draft.environmentSnapshotId && !!draft.initialMap },
    { step: 'forces' as const, title: 'Силы и оснащение', ready: draft.forces.length > 0 && draft.equipment.length > 0, present: draft.forces.length > 0 },
    { step: 'forces' as const, title: 'Оперативное построение', ready: !!draft.formation, present: !!draft.formation },
    { step: 'forces' as const, title: 'Материально-техническое обеспечение', ready: !!draft.logistics?.requests.length, present: !!draft.logistics },
    { step: 'events' as const, title: 'Профиль событий', ready: !!draft.autonomy, present: !!draft.autonomy },
    { step: 'readiness' as const, title: 'Боевая готовность сил', ready: !!draft.readinessStage && draft.readinessStates.length > 0 && draft.readinessStates.every(state => state.status === 'READY' || state.authorizations.length > 0), present: !!draft.readinessStage },
  ];
  return <section className="preparation-launch" aria-label="Проверка перед запуском">
    <h2>Проверка перед запуском</h2>
    <dl>
      <div><dt>Сводная проверка сценария</dt><dd>{stateLabel(card.validation)}</dd></div>
      <div><dt>Редакция</dt><dd>{card.revision}; {stateLabel(card.state)}</dd></div>
      <div><dt>Фиксация</dt><dd>{card.state === 'SEALED' ? 'Сценарий зафиксирован' : 'Сценарий ещё не зафиксирован'}</dd></div>
    </dl>
    <div className="launch-area-list">{areas.map(area => <article key={area.title}>
      <strong>{area.title}</strong><span>{area.ready ? 'Подтверждено' : area.present ? 'Требует проверки' : 'Данные отсутствуют'}</span>
      {onOpenStep && <button type="button" onClick={() => onOpenStep(area.step)}>Открыть</button>}
    </article>)}</div>
    {onValidate && <button type="button" onClick={onValidate}>Проверить комплект локально</button>}
    <p>Локальная проверка показывает только недостающие данные и не разблокирует запуск. Решение фиксируется сервером.</p>
    <button className="kshvi-primary" type="button" disabled={launchLocked || (action.command === 'START' ? !onStart : !onAction)}
      onClick={() => action.command === 'START' ? onStart?.() : onAction?.(action.command)}>{action.label}</button>
  </section>;
}
