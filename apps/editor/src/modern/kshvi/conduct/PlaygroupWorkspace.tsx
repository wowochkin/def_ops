import { useState } from 'react';
import { ConductShell } from './shared/ConductShell';
import { LinkedPanels } from './shared/LinkedPanels';
import type { ConductCommands, ConductProjection, MassOperationResult } from './shared/types';

export function PlaygroupWorkspace({ projection, commands, onHandover }: {
  projection: ConductProjection;
  commands: Pick<ConductCommands, 'previewInputs' | 'applyInputs'>;
  onHandover?: () => void | Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [selected, setSelected] = useState<string[]>(projection.massOperation.objects.map(object => object.id));
  const [preview, setPreview] = useState<readonly MassOperationResult[]>([]);
  const [applied, setApplied] = useState<readonly MassOperationResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  function selectedIds(): string[] { return selected; }
  async function run(kind: 'PREVIEW' | 'APPLY'): Promise<void> {
    if (!reason.trim()) { setError('Укажите единое обоснование массовой операции'); return; }
    if (!selectedIds().length) { setError('Выберите хотя бы один объект'); return; }
    setBusy(true); setError('');
    try {
      if (kind === 'PREVIEW') { setPreview(await commands.previewInputs({ objectIds: selectedIds(), reason })); setApplied([]); }
      else setApplied(await commands.applyInputs({ objectIds: selectedIds(), reason }));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Серверная команда отклонена'); }
    finally { setBusy(false); }
  }
  return <ConductShell title="Группа розыгрыша" projection={projection} onHandover={onHandover}>
    <LinkedPanels mapTitle="Карта розыгрыша" events={projection.events} live={projection.live} />
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Очередь вводных и расчётов</h2><p>{projection.playgroup?.queue ?? 'Нет данных'}</p></section>
      <section className="kshvi-conduct-panel"><h2>План наращивания</h2><p>{projection.playgroup?.buildup ?? 'Нет данных'}</p></section>
      <section className="kshvi-conduct-panel"><h2>Дерево инстанций и связь</h2><p>{projection.playgroup?.tree ?? 'Нет данных'}</p></section>
      <section className="kshvi-conduct-panel"><h2>Причинные связи</h2><p>{projection.playgroup?.causal ?? 'Нет данных'}</p></section>
    </div>
    <section className="kshvi-conduct-panel"><h2>Массовая операция</h2>
      {projection.massOperation.objects.map(object => <label key={object.id}><input type="checkbox" checked={selected.includes(object.id)} onChange={() => {
        setSelected(current => current.includes(object.id) ? current.filter(id => id !== object.id) : [...current, object.id]); setPreview([]); setApplied([]);
      }} />{object.id}</label>)}
      <label>Единое обоснование<input value={reason} onChange={event => { setReason(event.target.value); setPreview([]); setApplied([]); }} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="button" disabled={busy} onClick={() => void run('PREVIEW')}>Предварительная проверка</button>
      {preview.length > 0 && <section aria-label="Результат предварительной проверки">{preview.map(result => <p key={result.objectId}>{result.objectId}: {result.message}</p>)}</section>}
      <button type="button" disabled={busy || preview.length === 0} onClick={() => void run('APPLY')}>Применить выбранное</button>
      {applied.length > 0 && <section aria-label="Подтверждённый сервером результат">{applied.map(result => <p key={result.objectId}>{result.objectId}: {result.message}</p>)}</section>}
    </section>
  </ConductShell>;
}
