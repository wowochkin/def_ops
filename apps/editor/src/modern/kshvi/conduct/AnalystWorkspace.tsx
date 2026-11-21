import { useState } from 'react';
import { ConductShell, LinkedPanels, defaultConductEvents } from './shared/browser';

export function AnalystWorkspace({ canReadTruth = false, onHandover }: { canReadTruth?: boolean; onHandover?: () => void }) {
  const [cause, setCause] = useState('all');
  const [perspective, setPerspective] = useState<'PARTICIPANT' | 'TRUTH'>('PARTICIPANT');
  const [conclusion, setConclusion] = useState('');
  const [evidence, setEvidence] = useState<string[]>([]);
  const events = defaultConductEvents.filter(event => cause === 'all' || event.cause === cause);
  return <ConductShell title="Аналитик" onHandover={onHandover}>
    <section className="kshvi-conduct-panel kshvi-analyst-filters"><h2>Фильтры доказательств</h2>
      <label>Инстанция<select><option>node-1</option><option>node-2</option></select></label>
      <label>Учебный вопрос<select><option>Управление</option><option>МТО</option></select></label>
      <label>Этап<select><option>Этап 2</option></select></label>
      <label>Фильтр по причине<select value={cause} onChange={event => setCause(event.target.value)}><option value="all">Все причины</option><option value="supply">supply</option><option value="communication">communication</option></select></label>
      <p>Показаны события с причиной: {cause}</p>
    </section>
    <LinkedPanels events={events} mapTitle="Карта доказательств" />
    <section className="kshvi-conduct-panel"><h2>Перспективы</h2><button type="button" onClick={() => setPerspective('PARTICIPANT')}>Как видел участник</button>{canReadTruth && <button type="button" onClick={() => setPerspective('TRUTH')}>Истинное состояние</button>}
      <p>Перспектива: {perspective === 'TRUTH' ? 'истинное состояние' : 'как видел участник'}</p>
      <p>Ресурсы · связь · решения · оценки синхронизированы по оперативному времени.</p>
    </section>
    <section className="kshvi-conduct-panel"><h2>Выводы с доказательствами</h2><a href="#evidence-1">Доказательство evidence-1: донесение и расчёт</a>
      <label>Вывод аналитика<textarea value={conclusion} onChange={event => setConclusion(event.target.value)} /></label>
      <button type="button" disabled={!conclusion.trim()} onClick={() => setEvidence(current => current.includes('evidence-1') ? current : [...current, 'evidence-1'])}>Связать с доказательством evidence-1</button>
      {evidence.length > 0 && <p role="status">Сохранён проект вывода с {evidence.length} доказательством</p>}
    </section>
  </ConductShell>;
}
