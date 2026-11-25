import { useState } from 'react';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ReadinessActivityKind, ReadinessStage } from '../../../../../../packages/kshvi/src/forces/readiness-stage';
import type { ExerciseCard, KshviClient } from '../kshvi-api';

const kinds: Record<ReadinessActivityKind, string> = {
  SIGNAL: 'Доведение сигнала', MANNING: 'Укомплектование', ORGANIZATION: 'Организация', EQUIPMENT: 'Подготовка техники',
  AREA: 'Занятие района', COMMAND_POST: 'Развёртывание пункта управления', COMMUNICATIONS: 'Организация связи',
  SUPPLIES: 'Пополнение запасов', DEPLOYMENT: 'Выдвижение', ENGINEERING: 'Инженерное обеспечение',
  INTERACTION: 'Взаимодействие', REPORT: 'Доклад о готовности',
};

export function ReadinessActivityEditor({ card, draft, client, onCard }: {
  card: ExerciseCard;
  draft: PreparationDraft;
  client: KshviClient;
  onCard(card: ExerciseCard): void;
}) {
  const current = draft.readinessStage;
  const [title, setTitle] = useState(current?.title ?? 'Обеспечение боевой готовности');
  const [startsAt, setStartsAt] = useState(current?.startsAt ?? draft.updatedAt);
  const [dueAt, setDueAt] = useState(current?.dueAt ?? new Date(Date.parse(draft.updatedAt) + 3 * 3600000).toISOString());
  const [signalId, setSignalId] = useState(current?.signal.id ?? 'signal-readiness');
  const [senderNodeId, setSenderNodeId] = useState(current?.signal.senderNodeId ?? 'hq-command');
  const [activityTitle, setActivityTitle] = useState('Занять исходный район');
  const [kind, setKind] = useState<ReadinessActivityKind>('DEPLOYMENT');
  const [responsibleNodeId, setResponsibleNodeId] = useState(current?.activities.at(-1)?.responsibleNodeId ?? draft.forces[0]?.identity.nodeId ?? '');
  const [activityStart, setActivityStart] = useState(current?.activities.at(-1)?.startAt ?? draft.updatedAt);
  const [activityDue, setActivityDue] = useState(current?.activities.at(-1)?.dueAt ?? new Date(Date.parse(draft.updatedAt) + 2 * 3600000).toISOString());
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [criterion, setCriterion] = useState('Фактический результат подтверждён докладом ответственной инстанции');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true); setError('');
    try {
      const activityId = crypto.randomUUID();
      const criterionId = crypto.randomUUID();
      const base: ReadinessStage = current ?? {
        id: crypto.randomUUID(), title, startsAt, dueAt,
        signal: { id: signalId, sentAt: startsAt, senderNodeId }, activities: [], completionCriterionIds: [], adverseOutcomes: ['PARTIAL', 'FAILED'],
      };
      const stage: ReadinessStage = {
        ...base, title, startsAt, dueAt, signal: { id: signalId, sentAt: startsAt, senderNodeId },
        activities: [...base.activities, {
          id: activityId, kind, title: activityTitle, responsibleNodeId, startAt: activityStart, dueAt: activityDue,
          durationMinutes, dependsOn: base.activities.length ? [base.activities.at(-1)!.id] : [], requiresSignal: true,
          preconditions: [], resources: [], reportRequired: true, criterion: { id: criterionId, description: criterion },
        }],
        completionCriterionIds: [...base.completionCriterionIds, criterionId],
      };
      onCard(await client.saveReadinessStage(card.id, { expectedRevision: card.revision, stage }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Этап не сохранён'); }
    finally { setBusy(false); }
  }

  return <details className="readiness-activity-editor" open={!current}>
    <summary>{current ? 'Добавить мероприятие и обновить этап' : 'Создать этап боевой готовности'}</summary>
    {error && <p role="alert">{error}</p>}
    <fieldset><legend>Этап и сигнал</legend>
      <label>Название этапа<input value={title} onChange={event => setTitle(event.target.value)} /></label>
      <label>Начало этапа<input value={startsAt} onChange={event => setStartsAt(event.target.value)} /></label>
      <label>Срок этапа<input value={dueAt} onChange={event => setDueAt(event.target.value)} /></label>
      <label>Идентификатор сигнала<input value={signalId} onChange={event => setSignalId(event.target.value)} /></label>
      <label>Отправитель сигнала<input value={senderNodeId} onChange={event => setSenderNodeId(event.target.value)} /></label>
    </fieldset>
    <fieldset><legend>Новое мероприятие</legend>
      <label>Название мероприятия<input value={activityTitle} onChange={event => setActivityTitle(event.target.value)} /></label>
      <label>Тип мероприятия<select value={kind} onChange={event => setKind(event.target.value as ReadinessActivityKind)}>
        {Object.entries(kinds).map(([id, label]) => <option key={id} value={id}>{label}</option>)}
      </select></label>
      <label>Ответственная инстанция<input value={responsibleNodeId} onChange={event => setResponsibleNodeId(event.target.value)} /></label>
      <label>Начало мероприятия<input value={activityStart} onChange={event => setActivityStart(event.target.value)} /></label>
      <label>Срок мероприятия<input value={activityDue} onChange={event => setActivityDue(event.target.value)} /></label>
      <label>Длительность, мин<input type="number" min="0" value={durationMinutes} onChange={event => setDurationMinutes(Number(event.target.value))} /></label>
      <label>Критерий завершения<input value={criterion} onChange={event => setCriterion(event.target.value)} /></label>
    </fieldset>
    <button type="button" disabled={busy || !responsibleNodeId} onClick={() => void save()}>Сохранить этап готовности</button>
  </details>;
}
