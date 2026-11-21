import { useState } from 'react';
import { ConductShell, LinkedPanels } from './shared/browser';

const objects = [{ id: 'input-1', allowed: true }, { id: 'input-2', allowed: true }, { id: 'input-3', allowed: false }];

export function PlaygroupWorkspace({ onHandover }: { onHandover?: () => void }) {
  const [reason, setReason] = useState('');
  const [checked, setChecked] = useState(false);
  const [applied, setApplied] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string[]>(objects.map(object => object.id));
  const selectedObjects = objects.filter(object => selected.includes(object.id));
  const allowedCount = selectedObjects.filter(object => object.allowed).length;
  const deniedCount = selectedObjects.length - allowedCount;
  const unselectedCount = objects.length - selectedObjects.length;
  function validate(): boolean {
    if (!reason.trim()) { setError('Укажите единое обоснование массовой операции'); return false; }
    setError(''); return true;
  }
  return <ConductShell title="Группа розыгрыша" onHandover={onHandover}>
    <LinkedPanels mapTitle="Карта розыгрыша" />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Очередь вводных и расчётов</h2><p>3 вводные · 2 расчёта · 1 требует утверждения</p></section>
      <section className="kshvi-conduct-panel"><h2>План наращивания</h2><p>stage-2 · каталог и профиль зафиксированы</p></section>
      <section className="kshvi-conduct-panel"><h2>Дерево инстанций и связь</h2><p>node-command → node-1, node-2 · резервный канал доступен</p></section>
      <section className="kshvi-conduct-panel"><h2>Причинные связи</h2><p>order-1 → delivery-1 → task-1 → calculation-1 → report-1</p></section>
    </div>
    <section className="kshvi-conduct-panel"><h2>Сравнение изменения</h2><div className="kshvi-compare-three"><p>Текущий мир</p><p>Предлагаемое изменение</p><p>Затронутые события: event-2, event-3</p></div></section>
    <section className="kshvi-conduct-panel"><h2>Массовая операция</h2>
      {objects.map(object => <label key={object.id}><input type="checkbox" checked={selected.includes(object.id)} onChange={() => { setSelected(current => current.includes(object.id) ? current.filter(id => id !== object.id) : [...current, object.id]); setChecked(false); setApplied(false); }} />{object.id}</label>)}
      <label>Единое обоснование<input value={reason} onChange={event => { setReason(event.target.value); setChecked(false); setApplied(false); }} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => { if (validate()) setChecked(true); }}>Предварительная проверка</button>
      {checked && <p>Проверено: {allowedCount} допустимо, {deniedCount} требует отдельного утверждения</p>}
      <button type="button" disabled={!checked} onClick={() => setApplied(true)}>Применить выбранное</button>
      {applied && <div role="status"><p>Результат: {allowedCount} успешно, {deniedCount} отклонено{unselectedCount > 0 ? `, ${unselectedCount} не выбрано` : ''}</p>{objects.map(object => <p key={object.id}>{object.id}: {!selected.includes(object.id) ? 'не выбрано' : object.allowed ? 'применено' : 'не применено — вне делегирования'}</p>)}</div>}
    </section>
  </ConductShell>;
}
