import { useState, type FormEvent } from 'react';

const elements = [
  ['TASK_CLARIFICATION', 'получение и уточнение задачи'],
  ['SITUATION_REVIEW', 'изучение обстановки и сроков'],
  ['CAPABILITY_ASSESSMENT', 'оценка сил, ресурсов и неопределённости'],
  ['SUBORDINATE_TASKS', 'постановка задач инстанциям'],
  ['COURSE_COMPARISON', 'подготовка и сопоставление вариантов'],
  ['DECISION_FORMALIZATION', 'принятие и оформление решения'],
  ['DOCUMENT_COORDINATION', 'согласование, подписание и доведение'],
  ['EXECUTION_CONTROL', 'контроль получения и исполнения'],
  ['DECISION_ADJUSTMENT', 'корректировка решения'],
] as const;

export type DecisionEditorChange = { element: typeof elements[number][0]; recordedAt: string };

export function DecisionEditor({ onChange, onSave }: {
  onChange?: (change: DecisionEditorChange) => void;
  onSave?: (draft: { intent: string; status: string; completedElements: readonly string[] }) => void;
}) {
  const [intent, setIntent] = useState('');
  const [status, setStatus] = useState('DRAFT');
  const [completed, setCompleted] = useState<string[]>([]);
  const [details, setDetails] = useState({ goals: '', tasks: '', resources: '', deadlines: '', coordination: '', reserves: '', conditions: '', assumptions: '' });
  function save(event: FormEvent): void {
    event.preventDefault();
    onSave?.({ intent, status, completedElements: completed });
  }
  return <section className="kshvi-conduct-panel" aria-labelledby="decision-editor-title">
    <h2 id="decision-editor-title">Решение обучаемого</h2>
    <p>Элементы фиксируются в порядке фактической работы; сокращение цикла определяется профилем учения.</p>
    <div className="kshvi-decision-elements" aria-label="Элементы цикла решения">
      {elements.map(([element, label]) => <button key={element} type="button" aria-pressed={completed.includes(element)} onClick={() => {
        setCompleted(current => current.includes(element) ? current : [...current, element]);
        onChange?.({ element, recordedAt: new Date().toISOString() });
      }}>Отметить: {label}</button>)}
    </div>
    <form onSubmit={save} className="kshvi-decision-form">
      <label>Замысел<textarea required rows={3} value={intent} onChange={event => setIntent(event.target.value)} /></label>
      <label>Статус решения<select value={status} onChange={event => setStatus(event.target.value)}>
        <option value="DRAFT">Проект</option><option value="ACCEPTED">Принято</option><option value="DELIVERED">Доведено</option><option value="EXECUTING">Исполняется</option><option value="COMPLETED">Завершено</option>
      </select></label>
      {([
        ['goals', 'Ранжированные цели'], ['tasks', 'Задачи'], ['resources', 'Распределение ресурсов'], ['deadlines', 'Сроки'],
        ['coordination', 'Взаимодействие'], ['reserves', 'Резервы'], ['conditions', 'Условия перехода'], ['assumptions', 'Допущения'],
      ] as const).map(([key, label]) => <label key={key}>{label}<textarea rows={2} value={details[key]} onChange={event => setDetails(current => ({ ...current, [key]: event.target.value }))} /></label>)}
      <button type="submit" className="kshvi-primary">Сохранить проект решения</button>
    </form>
  </section>;
}
