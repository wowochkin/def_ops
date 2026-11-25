import { useState } from 'react';
import type { ReadinessAdvanceInput } from '../../../../../../packages/kshvi/src/forces/readiness-stage';
import type { ReadinessReport } from '../../../../../../packages/kshvi/src/forces/readiness';
import { readinessLimitationLabel, readinessStatusLabel } from './readiness-labels';

type Activity = Readonly<{
  id: string;
  title: string;
  responsibleNodeId: string;
  dueAt: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'PARTIAL' | 'FAILED';
  report: string | null;
  criterionId?: string;
}>;
export type ReadinessAdvancePayload = ReadinessAdvanceInput & Readonly<{ signalReport?: ReadinessReport }>;
type ReadinessStepProps = Readonly<{
  stage: Readonly<{
    title: string;
    startsAt: string;
    dueAt: string;
    signal: Readonly<{ id: string; receivedAt: string | null }>;
  }>;
  activities: readonly Activity[];
  readiness: Readonly<{
    status: 'NOT_STARTED' | 'IN_PROGRESS' | 'READY' | 'PARTIAL' | 'FAILED';
    initialLevel: number | null;
    requiredLevel: number | null;
    limitations: readonly string[];
    authorization?: Readonly<{ decisionId: string; basis: string }>;
  }>;
  onAdvance?: (input: ReadinessAdvancePayload) => void;
  onRehearsal?: (input: ReadinessAdvancePayload) => void;
  onAuthorize?: () => void;
}>;

/** Браузерная проекция: команды передаются наружу, доменное состояние здесь не пересчитывается. */
export function ReadinessStep({ stage, activities, readiness, onAdvance, onRehearsal, onAuthorize }: ReadinessStepProps) {
  const [at, setAt] = useState(stage.dueAt);
  const [signal, setSignal] = useState({ id: `signal-report:${stage.signal.id}`, authorId: '', submittedAt: stage.dueAt, text: '' });
  const [reports, setReports] = useState<Record<string, { text: string; authorId: string; submittedAt: string; criterion: boolean }>>(() => Object.fromEntries(activities.map(activity => [activity.id, {
    text: activity.report ?? '', authorId: activity.responsibleNodeId, submittedAt: activity.dueAt, criterion: false,
  }])));
  const patchReport = (id: string, patch: Partial<(typeof reports)[string]>) => setReports(previous => ({ ...previous, [id]: { ...previous[id]!, ...patch } }));

  function advance(handler = onAdvance) {
    if (!handler) return;
    const completions = activities.filter(activity => reports[activity.id]?.text.trim()).map(activity => {
      const report = reports[activity.id]!;
      return { activityId: activity.id, report: { id: `report:${activity.id}`, authorId: report.authorId, submittedAt: report.submittedAt, text: report.text } };
    });
    const criteria = Object.fromEntries(activities.filter(activity => activity.criterionId).map(activity => [activity.criterionId!, reports[activity.id]?.criterion ?? false]));
    const signalReport = signal.id.trim() && signal.authorId.trim() && signal.text.trim() ? { ...signal } : undefined;
    handler({ at, ...(signalReport ? { signalReport } : {}), completions, criteria });
  }

  return <section aria-label="Этап боевой готовности">
    <h2>{stage.title}</h2>
    <p>Начало: {stage.startsAt}</p>
    <p>Срок: {stage.dueAt}</p>
    <p>{stage.signal.id}</p>
    <p>{stage.signal.receivedAt ? `Сигнал получен ${stage.signal.receivedAt}` : 'Сигнал не получен'}</p>
    <p>Исходный уровень: {readiness.initialLevel ?? 'неизвестен'}; требуемый: {readiness.requiredLevel ?? 'неизвестен'}</p>
    <p>Состояние: {readinessStatusLabel(readiness.status)}</p>
    {onAdvance && <details><summary>Подтверждение получения сигнала</summary>
      <label>Идентификатор сигнального доклада<input value={signal.id} onChange={event => setSignal(previous => ({ ...previous, id: event.target.value }))} /></label>
      <label>Автор сигнального доклада<input value={signal.authorId} onChange={event => setSignal(previous => ({ ...previous, authorId: event.target.value }))} /></label>
      <label>Время сигнального доклада<input value={signal.submittedAt} onChange={event => setSignal(previous => ({ ...previous, submittedAt: event.target.value }))} /></label>
      <label>Текст сигнального доклада<textarea value={signal.text} onChange={event => setSignal(previous => ({ ...previous, text: event.target.value }))} /></label>
    </details>}
    <table>
      <caption>Мероприятия и донесения</caption>
      <thead><tr><th>Мероприятие</th><th>Ответственный</th><th>Срок</th><th>Состояние</th><th>Доклад</th></tr></thead>
      <tbody>{activities.map(activity => <tr key={activity.id}>
        <td>{activity.title}</td><td>{activity.responsibleNodeId}</td><td>{activity.dueAt}</td><td>{readinessStatusLabel(activity.status)}</td>
        <td>{onAdvance ? <div className="readiness-report-fields">
          <label>Доклад: {activity.title}<textarea value={reports[activity.id]?.text ?? ''} onChange={event => patchReport(activity.id, { text: event.target.value })} /></label>
          <label>Автор: {activity.title}<input value={reports[activity.id]?.authorId ?? ''} onChange={event => patchReport(activity.id, { authorId: event.target.value })} /></label>
          <label>Время: {activity.title}<input value={reports[activity.id]?.submittedAt ?? ''} onChange={event => patchReport(activity.id, { submittedAt: event.target.value })} /></label>
          {activity.criterionId && <label><input type="checkbox" checked={reports[activity.id]?.criterion ?? false} onChange={event => patchReport(activity.id, { criterion: event.target.checked })} />Критерий: {activity.title}</label>}
          {!activity.report && <span>Доклад не получен</span>}
        </div> : activity.report ?? 'Доклад не получен'}</td>
      </tr>)}</tbody>
    </table>
    <h3>Ограничения первого приказа</h3>
    {readiness.limitations.length ? <ul>{readiness.limitations.map(code => <li key={code}><code>{code}</code><span>{readinessLimitationLabel(code)}</span></li>)}</ul> : <p>Ограничений нет</p>}
    {readiness.authorization && <p>{readiness.authorization.decisionId}: {readiness.authorization.basis}</p>}
    <div>
      {(onAdvance || onRehearsal) && <><label>Оперативное время<input value={at} onChange={event => setAt(event.target.value)} /></label>
        {onRehearsal && <button type="button" onClick={() => advance(onRehearsal)}>Репетиция готовности</button>}
        {onAdvance && <button type="button" onClick={() => advance()}>Обновить готовность</button>}</>}
      {onAuthorize && <button type="button" onClick={onAuthorize} disabled={readiness.status !== 'PARTIAL'}>Разрешить частичную готовность</button>}
    </div>
  </section>;
}
