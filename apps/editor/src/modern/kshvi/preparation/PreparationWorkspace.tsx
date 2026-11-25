import { useId, useLayoutEffect, useState, type ReactNode } from 'react';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { EnvironmentMapPreparation } from './EnvironmentMapPreparation';
import { isExerciseAccessLost, KshviHttpError, type ExerciseCard, type KshviClient } from '../kshvi-api';
import { stateLabel } from '../library-actions';
import { PreparationStatus, preparationStepStates } from './PreparationStatus';
import { preparationSteps, stepIndex, type PreparationStep } from './preparation-steps';
import { usePreparationDraft } from './usePreparationDraft';
import './preparation.css';

type ExercisePreparationProps = {
  card: ExerciseCard;
  client: KshviClient;
  userId: string;
  role: string;
  initialStep: PreparationStep;
  canRevise: boolean;
  canStart: boolean;
  onCard(card: ExerciseCard): void;
  acceptsCardResponse?(): boolean;
  onAccessLost(cause: KshviHttpError): void;
  onPendingChange?(pending: boolean): void;
  navigationPrompt?(saving: boolean): ReactNode;
  onStart(): void;
};

export function ExercisePreparation({ card, client, userId, role, initialStep, canRevise, canStart, onCard, acceptsCardResponse, onAccessLost, onPendingChange, navigationPrompt, onStart }: ExercisePreparationProps) {
  const preparation = usePreparationDraft(client, card);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState<{ reason: string; refreshed: boolean } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const canEdit = canRevise && ['DRAFT', 'IN_REVIEW', 'APPROVED'].includes(card.state) && preparation.draft !== null;
  const dirty = preparation.draft !== preparation.confirmed.draft || preparation.revision !== preparation.confirmed.revision;

  const pending = dirty || saving || conflict !== null;
  useLayoutEffect(() => {
    onPendingChange?.(pending);
    return () => onPendingChange?.(false);
  }, [onPendingChange, pending]);

  async function refreshConflict(reason: string) {
    setError('');
    setRefreshing(true);
    try {
      const latest = await client.getCard(card.id);
      if (acceptsCardResponse?.() === false) return;
      onCard(latest);
      setConflict({ reason, refreshed: true });
    } catch (cause) {
      if (isExerciseAccessLost(cause)) onAccessLost(cause);
      else setError('Не удалось обновить карточку. Повторите запрос к серверу.');
    } finally {
      setRefreshing(false);
    }
  }

  async function save() {
    if (!canEdit || saving || !dirty || conflict) return;
    setError('');
    setSaving(true);
    try {
      onCard(await preparation.save());
    } catch (cause) {
      if (cause instanceof KshviHttpError && cause.status === 409) {
        setConflict({ reason: cause.message, refreshed: false });
        await refreshConflict(cause.message);
      } else if (isExerciseAccessLost(cause)) {
        onAccessLost(cause);
      } else {
        setError(cause instanceof Error ? cause.message : 'Не удалось сохранить черновик');
      }
    } finally {
      setSaving(false);
    }
  }

  const payload = card.revisions.find(item => item.revision === card.revision)?.payload;
  const legacySnapshotId = card.payloadAccess === 'FULL' && payload && typeof payload === 'object'
    && !Array.isArray(payload) && typeof payload.environmentSnapshotId === 'string' ? payload.environmentSnapshotId : null;
  return <PreparationWorkspace
    card={card}
    draft={preparation.draft}
    confirmedDraft={preparation.confirmed.draft}
    role={role}
    initialStep={initialStep}
    saving={saving}
    dirty={dirty}
    onSave={canEdit && !conflict ? () => void save() : undefined}
    onStartOfficial={canStart ? onStart : undefined}
    launchLocked={pending}
    environment={canEdit && !preparation.draft?.environmentSnapshotId && !conflict && !saving && !dirty ? <>
      <EnvironmentMapPreparation client={client} exerciseId={card.id} revision={card.revision} authorId={userId} truthRole={role} onRevision={onCard} onAccessLost={onAccessLost} acceptsCardResponse={acceptsCardResponse} />
      {legacySnapshotId && <button type="button" onClick={() => {
        preparation.setDraft(draft => draft.environmentSnapshotId ? draft : { ...draft, environmentSnapshotId: legacySnapshotId });
      }}>Добавить сохранённый снимок в черновик</button>}
    </> : undefined}
    feedback={<>
      {navigationPrompt?.(saving)}
      {error && <p role="alert" className="kshvi-error">{error}</p>}
      {conflict && preparation.draft && <section className="preparation-conflict" aria-label="Конфликт редакций">
        <p role="alert">{conflict.reason}</p>
        <p>Локальная правка остаётся в этом окне до вашего решения.</p>
        {!conflict.refreshed && <button type="button" disabled={refreshing}
          onClick={() => void refreshConflict(conflict.reason)}>{refreshing ? 'Обновляем карточку…' : 'Обновить серверную редакцию'}</button>}
        {conflict.refreshed && preparation.confirmed.draft && <>
          <details><summary>Сравнить черновик с редакцией {preparation.confirmed.revision}</summary>
            <div><h3>Ваш черновик</h3><pre>{JSON.stringify(preparation.draft, null, 2)}</pre></div>
            <div><h3>Серверная редакция</h3><pre>{JSON.stringify(preparation.confirmed.draft, null, 2)}</pre></div>
          </details>
          <button type="button" onClick={() => {
            if (preparation.confirmed.draft) preparation.resolveConflict(preparation.confirmed.draft);
            setConflict(null);
          }}>Принять серверную редакцию</button>
        </>}
      </section>}
    </>}
  />;
}

type WorkspaceProps = {
  card?: ExerciseCard;
  draft?: PreparationDraft | null;
  confirmedDraft?: PreparationDraft | null;
  role?: string;
  initialStep?: PreparationStep;
  dirty?: boolean;
  saving?: boolean;
  environment?: ReactNode;
  feedback?: ReactNode;
  onSave?(): void;
  onStartOfficial?(): void;
  launchLocked?: boolean;
};

export function PreparationWorkspace({
  card, draft = null, confirmedDraft = null, role = '', initialStep = 'environment',
  dirty = false, saving = false, environment, feedback, onSave, onStartOfficial, launchLocked = false,
}: WorkspaceProps) {
  const [step, setStep] = useState(initialStep);
  const contentId = useId();
  const index = stepIndex(step);
  const current = preparationSteps[index]!;
  const states = card ? preparationStepStates(card, confirmedDraft) : null;
  const sealed = card?.state === 'SEALED';

  return <section className="kshvi-preparation-workspace">
    <div className="preparation-top">
      {card && <PreparationStatus card={card} role={role} dirty={dirty} saving={saving} />}
      <nav className="preparation-steps" aria-label="Этапы подготовки">
        {preparationSteps.map(item => <button key={item.id} type="button" aria-label={item.label}
          aria-description={states ? stateLabel(states[item.id]) : undefined} aria-controls={contentId}
          aria-current={step === item.id ? 'step' : undefined} onClick={() => setStep(item.id)}>
          <strong>{item.label}</strong>
          {states && <span>{stateLabel(states[item.id])}</span>}
        </button>)}
      </nav>
    </div>

    <div id={contentId} className="preparation-step-content" tabIndex={0} role="region" aria-label={current.label}>
      <div className="preparation-step-heading"><h2>{current.label}</h2><p>{current.description}</p></div>
      {feedback}
      {!draft && card && <p className="preparation-empty">Полный черновик подготовки недоступен для этой роли.</p>}
      {step === 'environment' && (environment ?? (draft && <section className="preparation-empty">
        {draft.environmentSnapshotId ? <>
          {dirty
            ? <p>{onSave ? 'Снимок выбран. Сохраните черновик, чтобы связать его с редакцией.' : 'Выбранный снимок остаётся в локальной правке.'}</p>
            : <p>Снимок среды связан с черновиком. Проверьте состояние исходной карты перед запуском.</p>}
        </> : <p>Снимок среды отсутствует. Изменение среды доступно автору редактируемой редакции.</p>}
      </section>))}
      {step === 'forces' && draft && <section className="preparation-empty">
        <p>{draft.forces.length || draft.equipment.length || draft.formation || draft.logistics
          ? 'В редакции есть данные о силах и МТО. Редактирование этого шага пока недоступно.'
          : 'Сведения о силах и МТО отсутствуют. Пока можно заполнить среду или проверить условия запуска.'}</p>
      </section>}
      {step === 'events' && draft && <section className="preparation-empty">
        <p>{draft.autonomy
          ? 'В редакции сохранён профиль событий. Редактирование этого шага пока недоступно.'
          : 'Профиль событий ещё не задан. Проверьте условия запуска на итоговом шаге.'}</p>
      </section>}
      {step === 'readiness' && draft && <section className="preparation-empty">
        <p>{draft.readinessStage || draft.readinessStates.length
          ? 'В редакции есть сведения о готовности. Редактирование этого шага пока недоступно.'
          : 'Сведения о готовности отсутствуют. Посмотрите сводную проверку сценария на шаге «Запуск».'}</p>
      </section>}
      {step === 'launch' && card && <section className="preparation-launch">
        <h3>Проверка перед запуском</h3>
        <dl>
          <div><dt>Сводная проверка сценария</dt><dd>{stateLabel(card.validation)}</dd></div>
          <div><dt>Фиксация</dt><dd>{sealed ? 'Сценарий зафиксирован' : 'Сценарий ещё не зафиксирован'}</dd></div>
        </dl>
        {!sealed && <p>Для запуска нужна серверная фиксация текущей редакции. <button type="button" onClick={() => setStep('readiness')}>Открыть готовность</button></p>}
        {card.state === 'APPROVED' && <p>Здесь доступна сводная проверка. Команда фиксации в этом экране пока недоступна.</p>}
        {sealed && !onStartOfficial && <p>{card.lastSessionId ? 'Откройте существующий сеанс из библиотеки.' : 'Запуск доступен участнику с серверным полномочием проведения.'}</p>}
        <button className="kshvi-primary" type="button" disabled={!sealed || !onStartOfficial || launchLocked} onClick={onStartOfficial}>Запустить официальный сеанс</button>
      </section>}
    </div>

    <footer className="preparation-footer">
      <button type="button" aria-controls={contentId} disabled={index === 0} onClick={() => setStep(preparationSteps[index - 1]!.id)}>Назад</button>
      <div>{onSave && <button type="button" disabled={!dirty || saving} onClick={onSave}>Сохранить черновик</button>}</div>
      <button type="button" aria-controls={contentId} disabled={index === preparationSteps.length - 1} onClick={() => setStep(preparationSteps[index + 1]!.id)}>Далее</button>
    </footer>
  </section>;
}
