import { useEffect, useState, type FormEvent } from 'react';
import type { ConductCommands, DecisionEditorDraft, DecisionStatus } from './shared/types';

const elements = [
  ['TASK_CLARIFICATION', 'получение и уточнение задачи'], ['SITUATION_REVIEW', 'изучение обстановки и сроков'],
  ['CAPABILITY_ASSESSMENT', 'оценка сил, ресурсов и неопределённости'], ['SUBORDINATE_TASKS', 'постановка задач инстанциям'],
  ['COURSE_COMPARISON', 'подготовка и сопоставление вариантов'], ['DECISION_FORMALIZATION', 'принятие и оформление решения'],
  ['DOCUMENT_COORDINATION', 'согласование, подписание и доведение'], ['EXECUTION_CONTROL', 'контроль получения и исполнения'],
  ['DECISION_ADJUSTMENT', 'корректировка решения'],
] as const;
const nextStatus: Partial<Record<DecisionStatus, { to: DecisionStatus; label: string }>> = {
  DRAFT: { to: 'ACCEPTED', label: 'Принять решение' }, ACCEPTED: { to: 'DELIVERED', label: 'Довести решение' },
  DELIVERED: { to: 'EXECUTING', label: 'Начать исполнение решения' }, EXECUTING: { to: 'COMPLETED', label: 'Завершить решение' },
};

export function DecisionEditor({ decision, commands, onChange }: {
  decision: DecisionEditorDraft;
  commands: Pick<ConductCommands, 'saveDecision' | 'transitionDecision'>;
  onChange?: (change: { element: typeof elements[number][0]; recordedAt: string }) => void;
}) {
  const [draft, setDraft] = useState<DecisionEditorDraft>(decision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setDraft(decision); }, [decision]);
  function update<K extends keyof DecisionEditorDraft>(key: K, value: DecisionEditorDraft[K]): void {
    setDraft(current => ({ ...current, [key]: value }));
  }
  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true); setError('');
    try { await commands.saveDecision(draft); } catch (cause) { setError(cause instanceof Error ? cause.message : 'Команда сохранения отклонена'); }
    finally { setBusy(false); }
  }
  const transition = nextStatus[draft.status];
  return <section className="kshvi-conduct-panel" aria-labelledby="decision-editor-title">
    <h2 id="decision-editor-title">Решение обучаемого</h2>
    <p>Элементы фиксируются в порядке фактической работы; статус меняется только подтверждённой доменной командой.</p>
    <div className="kshvi-decision-elements" aria-label="Элементы цикла решения">
      {elements.map(([element, label]) => <button key={element} type="button" aria-pressed={draft.completedElements.includes(element)} onClick={() => {
        if (!draft.completedElements.includes(element)) update('completedElements', [...draft.completedElements, element]);
        onChange?.({ element, recordedAt: new Date().toISOString() });
      }}>Отметить: {label}</button>)}
    </div>
    <form onSubmit={save} className="kshvi-decision-form">
      <label>Замысел<textarea required rows={3} value={draft.intent} onChange={event => update('intent', event.target.value)} /></label>
      <p>Статус решения: {draft.status}</p>
      {([
        ['goals', 'Ранжированные цели'], ['tasks', 'Задачи'], ['resources', 'Распределение ресурсов'], ['deadlines', 'Сроки'],
        ['coordination', 'Взаимодействие'], ['reserves', 'Резервы'], ['transitionConditions', 'Условия перехода'], ['assumptions', 'Допущения'],
      ] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={2} value={draft[key]} onChange={event => update(key, event.target.value)} /></label>)}
      <button type="submit" className="kshvi-primary" disabled={busy}>Сохранить проект решения</button>
    </form>
    {transition && <button type="button" disabled={busy} onClick={() => {
      setBusy(true); setError('');
      void commands.transitionDecision({ decisionId: draft.id, from: draft.status, to: transition.to, draft }).catch(cause => {
        setError(cause instanceof Error ? cause.message : 'Доменный переход отклонён');
      }).finally(() => setBusy(false));
    }}>{transition.label}</button>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
