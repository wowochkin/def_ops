import { useEffect, useState } from 'react';
import { ConductShell } from './shared/ConductShell';
import { LinkedPanels } from './shared/LinkedPanels';
import type { ConductCommands, ConductProjection } from './shared/types';

export function AnalystWorkspace({ projection: initial, commands, onHandover }: {
  projection: ConductProjection;
  commands: Pick<ConductCommands, 'saveConclusion' | 'loadPerspective'>;
  onHandover?: () => void | Promise<void>;
}) {
  const [projection, setProjection] = useState(initial);
  const [cause, setCause] = useState('all');
  const [perspective, setPerspective] = useState<'PARTICIPANT' | 'TRUTH'>('PARTICIPANT');
  const [conclusion, setConclusion] = useState('');
  const [evidence, setEvidence] = useState<readonly string[]>([]);
  const [error, setError] = useState('');
  useEffect(() => { setProjection(initial); }, [initial]);
  const events = projection.events.filter(event => cause === 'all' || event.cause === cause);
  return <ConductShell title="Аналитик" projection={projection} onHandover={onHandover}>
    <section className="kshvi-conduct-panel kshvi-analyst-filters"><h2>Фильтры доказательств</h2>
      <label>Инстанция<select><option>Все назначенные</option>{projection.assignedNodeIds.map(id => <option key={id}>{id}</option>)}</select></label>
      <label>Учебный вопрос<select><option>Все вопросы</option></select></label><label>Этап<select><option>{projection.leader?.stage ?? 'Не указан'}</option></select></label>
      <label>Фильтр по причине<select value={cause} onChange={event => setCause(event.target.value)}><option value="all">Все причины</option><option value="supply">supply</option><option value="communication">communication</option></select></label>
      <p>Показаны события с причиной: {cause}</p>
    </section>
    <LinkedPanels events={events} live={projection.live} mapTitle="Карта доказательств" />
    <section className="kshvi-conduct-panel"><h2>Перспективы</h2><button type="button" onClick={() => {
      void commands.loadPerspective('PARTICIPANT').then(next => { setProjection(next); setPerspective('PARTICIPANT'); }).catch(cause => setError(cause instanceof Error ? cause.message : 'Проекция недоступна'));
    }}>Как видел участник</button>{projection.canReadTruth && <button type="button" onClick={() => {
      void commands.loadPerspective('TRUTH').then(next => { setProjection(next); setPerspective('TRUTH'); }).catch(cause => setError(cause instanceof Error ? cause.message : 'Проекция недоступна'));
    }}>Истинное состояние</button>}<p>Перспектива: {perspective === 'TRUTH' ? 'истинное состояние' : 'как видел участник'}</p></section>
    <section className="kshvi-conduct-panel"><h2>Выводы с доказательствами</h2><a href="#evidence-1">Доказательство evidence-1: донесение и расчёт</a>
      <label>Вывод аналитика<textarea value={conclusion} onChange={event => setConclusion(event.target.value)} /></label>
      <button type="button" disabled={!conclusion.trim()} onClick={() => {
        void commands.saveConclusion({ text: conclusion, evidenceIds: ['evidence-1'] }).then(setEvidence).catch(cause => setError(cause instanceof Error ? cause.message : 'Вывод не сохранён'));
      }}>Связать с доказательством evidence-1</button>
      {evidence.length > 0 && <p role="status">Сервер подтвердил проект вывода с {evidence.length} доказательством</p>}{error && <p role="alert">{error}</p>}
    </section>
  </ConductShell>;
}
