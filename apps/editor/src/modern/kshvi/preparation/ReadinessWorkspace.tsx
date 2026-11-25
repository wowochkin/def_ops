import { useState } from 'react';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { ExerciseCard, KshviClient, ReadinessRehearsalResponse } from '../kshvi-api';
import { ReadinessStep, type ReadinessAdvancePayload } from './ReadinessStep';
import { ReadinessActivityEditor } from './ReadinessActivityEditor';

export function ReadinessWorkspace({ card, draft, client, actorId, onCard }: {
  card: ExerciseCard;
  draft: PreparationDraft;
  client: KshviClient;
  actorId: string;
  onCard(card: ExerciseCard): void;
}) {
  const [error, setError] = useState('');
  const [report, setReport] = useState<ReadinessRehearsalResponse | null>(null);
  const [decision, setDecision] = useState({ orderId: '', basis: '', rationale: '' });
  const stage = draft.readinessStage;

  async function advance(input: ReadinessAdvancePayload) {
    setError('');
    try { onCard(await client.advanceReadiness(card.id, { expectedRevision: card.revision, ...input })); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Готовность не обновлена'); }
  }
  async function rehearse(input: ReadinessAdvancePayload) {
    setError('');
    try { setReport(await client.rehearseReadiness(card.id, input)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Репетиция не выполнена'); }
  }
  async function authorize(subjectId: string) {
    setError('');
    try {
      const state = draft.readinessStates.find(item => item.subjectId === subjectId);
      if (!state) return;
      onCard(await client.authorizePartialReadiness(card.id, {
        expectedRevision: card.revision,
        decision: {
          decisionId: crypto.randomUUID(), actorId, orderId: decision.orderId, limitations: [...new Set(state.limitations.map(item => item.code))],
          authorized: true, basis: decision.basis, rationale: decision.rationale, at: stage?.dueAt ?? draft.updatedAt,
        },
      }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Частичная готовность не разрешена'); }
  }

  return <section aria-label="Боевая готовность сил">
    <h2>Сценарная боевая готовность сил</h2>
    <p>Она отличается от технической готовности учения к запуску. Официальное продвижение использует серверное состояние; репетиция выполняется изолированно.</p>
    {error && <p role="alert">{error}</p>}
    <ReadinessActivityEditor card={card} draft={draft} client={client} onCard={onCard} />
    {stage && draft.readinessStates.map(state => {
      const force = draft.forces.find(item => item.id === state.subjectId);
      return <section key={state.subjectId} aria-label={`Готовность: ${force?.identity.type ?? state.subjectId}`}>
        <h3>{force?.identity.type ?? state.subjectId}</h3>
        <ReadinessStep
          stage={{ ...stage, signal: { id: stage.signal.id, receivedAt: state.signalReceipt?.receivedAt ?? null } }}
          activities={stage.activities.map(activity => ({
            id: activity.id, title: activity.title, responsibleNodeId: activity.responsibleNodeId, dueAt: activity.dueAt,
            status: state.completedActivityIds.includes(activity.id) ? 'READY' : state.activityRecords.some(record => record.activityId === activity.id && record.status === 'FAILED') ? 'FAILED' : state.status,
            report: state.reports.find(report => report.activityId === activity.id)?.text ?? null, criterionId: activity.criterion.id,
          }))}
          readiness={{ status: state.status, initialLevel: state.initialLevel, requiredLevel: state.requiredLevel,
            limitations: state.limitations.map(item => item.code),
            ...(state.authorizations[0] ? { authorization: { decisionId: state.authorizations[0].decisionId, basis: state.authorizations[0].basis } } : {}) }}
          onAdvance={input => void advance(input)} onRehearsal={input => void rehearse(input)}
          onAuthorize={actorId ? () => void authorize(state.subjectId) : undefined} />
      </section>;
    })}
    {stage && actorId && <fieldset><legend>Решение о частичной готовности</legend>
      <label>Приказ<input value={decision.orderId} onChange={event => setDecision(previous => ({ ...previous, orderId: event.target.value }))} /></label>
      <label>Основание<input value={decision.basis} onChange={event => setDecision(previous => ({ ...previous, basis: event.target.value }))} /></label>
      <label>Обоснование<textarea value={decision.rationale} onChange={event => setDecision(previous => ({ ...previous, rationale: event.target.value }))} /></label>
      <p>Разрешение оформляется кнопкой в карточке конкретной силы и не удаляет фактические ограничения.</p>
    </fieldset>}
    {report && <section aria-label="Репетиция боевой готовности"><h3>Репетиция боевой готовности</h3>
      <p>Изолированная копия: {String(report.isolated)}; SHA-256 {report.sha256}</p>
      <ul>{report.readinessStates.map(state => <li key={state.subjectId}>{state.subjectId}: {state.status}; ограничений {state.limitations.length}</li>)}</ul>
    </section>}
  </section>;
}
