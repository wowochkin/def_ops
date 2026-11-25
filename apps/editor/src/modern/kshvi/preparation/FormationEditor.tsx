import { useState } from 'react';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { validateFormation } from '../../../../../../packages/kshvi/src/forces/formation-validation';
import { addEchelon } from './formation-operations';

export function FormationEditor({ draft, onChange }: { draft: PreparationDraft; onChange(draft: PreparationDraft): void }) {
  const [adding, setAdding] = useState(false);
  const [forceId, setForceId] = useState(draft.forces[0]?.id ?? '');
  const [areaId, setAreaId] = useState('');
  const [readyAt, setReadyAt] = useState(draft.updatedAt);
  const [error, setError] = useState('');
  const plan = draft.formation;
  const issues = plan ? validateFormation(plan).issues : [];

  function apply() {
    try {
      onChange(addEchelon(draft, { forceId, areaId, readyAt }));
      setAdding(false); setAreaId(''); setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Не удалось назначить эшелон');
    }
  }

  return <section aria-label="Редактор оперативного построения">
    <h2>Оперативное построение</h2>
    <p>Эшелоны, резервы и колонны используют реальные силы и геометрию исходной карты. План не перемещает силы до фактического исполнения.</p>
    <button type="button" onClick={() => setAdding(true)}>Добавить эшелон</button>
    {adding && <fieldset><legend>Новый эшелон</legend>
      <label>Сила эшелона<select value={forceId} onChange={event => setForceId(event.target.value)}>
        {draft.forces.map(force => <option key={force.id} value={force.id}>{force.identity.type}</option>)}
      </select></label>
      <label>Район эшелона<input value={areaId} onChange={event => setAreaId(event.target.value)} list="formation-areas" /></label>
      <datalist id="formation-areas">{draft.initialMap?.markers.filter(marker => ['AREA', 'BOUNDARY'].includes(marker.kind)).map(marker => <option key={marker.id} value={marker.id}>{marker.name ?? marker.id}</option>)}</datalist>
      <label>Готовность эшелона<input value={readyAt} onChange={event => setReadyAt(event.target.value)} /></label>
      <button type="button" onClick={apply}>Применить эшелон</button>
    </fieldset>}
    {error && <p role="alert">{error}</p>}
    <h3>Эшелоны</h3>
    {!plan?.echelons.length && <p>Эшелоны ещё не назначены.</p>}
    <ul>{plan?.echelons.map(item => <li key={item.id}>{item.order}: {item.forceIds.map(id => draft.forces.find(force => force.id === id)?.identity.type ?? id).join(', ')} — {item.areaId}, {item.readyAt}</li>)}</ul>
    <h3>Проверка возможности</h3>
    {issues.length ? <ul>{issues.map((issue, index) => <li key={`${issue.code}-${index}`} data-severity={issue.severity}>{issue.message}</li>)}</ul> : <p>Нарушений не выявлено</p>}
  </section>;
}
