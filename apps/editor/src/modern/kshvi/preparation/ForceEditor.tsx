import { useEffect, useState } from 'react';
import type { PreparationDraft, ScenarioForce } from '@def-ops/kshvi/preparation-draft';
import type { MoralePsychState } from '../../../../../../packages/kshvi/src/forces/morale-model';
import { forceTask, initialMoralePsych } from './force-operations';
import { MoralePsychEditor } from './MoralePsychEditor';

function personnelCount(force: ScenarioForce): number | string {
  const first = force.composition.personnel[0];
  return first && typeof first === 'object' && !Array.isArray(first) && typeof first.quantity === 'number' ? first.quantity : '';
}

function taskTitle(force: ScenarioForce): string {
  return forceTask(force).title;
}

export function ForceEditor({ draft, force, onApply, onDelete, onOpenMap }: {
  draft: PreparationDraft;
  force: ScenarioForce;
  onApply(force: ScenarioForce, markerId: string): void;
  onDelete(): void;
  onOpenMap?(): void;
}) {
  const [form, setForm] = useState(() => structuredClone(force));
  const linkedMarker = draft.initialMap?.markers.find(marker => marker.links.forceId === force.id)?.id ?? '';
  const [markerId, setMarkerId] = useState(forceTask(force).markerId ?? linkedMarker);
  useEffect(() => {
    setForm(structuredClone(force));
    setMarkerId(forceTask(force).markerId ?? linkedMarker);
  }, [force, linkedMarker]);
  const markers = draft.initialMap?.markers.filter(marker => marker.geometry) ?? [];
  const morale = form.state.moralePsych && typeof form.state.moralePsych === 'object' && !Array.isArray(form.state.moralePsych)
    ? form.state.moralePsych as unknown as MoralePsychState : initialMoralePsych(form.id, form.source.reportedAt);
  const patchIdentity = (field: keyof ScenarioForce['identity'], value: string) => setForm(previous => ({
    ...previous, identity: { ...previous.identity, [field]: value },
  }));

  return <article className="force-editor" aria-label="Карточка подразделения">
    <div className="force-editor-actions">
      <button type="button" onClick={() => onApply(form, markerId)}>Применить данные силы</button>
      <button type="button" onClick={onDelete}>Удалить силу</button>
      {onOpenMap && <button type="button" onClick={onOpenMap}>Указать на карте</button>}
    </div>
    <div className="force-editor-grid">
      <label>Название подразделения<input value={form.identity.type} onChange={event => patchIdentity('type', event.target.value)} /></label>
      <label>Сторона силы{draft.sides?.length ? <select value={form.identity.sideId} onChange={event => patchIdentity('sideId', event.target.value)}>
        <option value="">Без стороны</option>
        {draft.sides.map(side => <option key={side.id} value={side.id}>{side.name}{side.country ? ` · ${side.country}` : ''}</option>)}
      </select> : <input value={form.identity.sideId} onChange={event => patchIdentity('sideId', event.target.value)} />}</label>
      <label>Инстанция силы<input value={form.identity.nodeId} onChange={event => patchIdentity('nodeId', event.target.value)} /></label>
      <label>Организационный уровень<input value={form.identity.organizationalLevel} onChange={event => patchIdentity('organizationalLevel', event.target.value)} /></label>
      <label>Род войск<input value={form.identity.service} onChange={event => patchIdentity('service', event.target.value)} /></label>
      <label>Родительская инстанция<input value={form.identity.parentId ?? ''} onChange={event => setForm(previous => ({ ...previous, identity: { ...previous.identity, parentId: event.target.value || null } }))} /></label>
      <label>Личный состав<input type="number" min="0" value={personnelCount(form)} onChange={event => setForm(previous => ({
        ...previous, composition: { ...previous.composition, personnel: event.target.value === '' ? [] : [{ quantity: Number(event.target.value), unit: 'person', sourceId: previous.source.sourceId }] },
      }))} /></label>
      <label>Подчинённые подразделения<input value={form.composition.units.join(', ')} onChange={event => setForm(previous => ({
        ...previous, composition: { ...previous.composition, units: event.target.value.split(',').map(item => item.trim()).filter(Boolean) },
      }))} /></label>
      <label>Исходная готовность, 0–1<input type="number" min="0" max="1" step="0.05" value={typeof form.state.readiness === 'number' ? form.state.readiness : 0}
        onChange={event => setForm(previous => ({ ...previous, state: { ...previous.state, readiness: Number(event.target.value) } }))} /></label>
      <label>Обученность, 0–1<input type="number" min="0" max="1" step="0.05" value={typeof form.state.training === 'number' ? form.state.training : 0}
        onChange={event => setForm(previous => ({ ...previous, state: { ...previous.state, training: Number(event.target.value) } }))} /></label>
      <label>Утомление, 0–1<input type="number" min="0" max="1" step="0.05" value={typeof form.state.fatigue === 'number' ? form.state.fatigue : 0}
        onChange={event => setForm(previous => ({ ...previous, state: { ...previous.state, fatigue: Number(event.target.value) } }))} /></label>
      <label><input type="checkbox" checked={form.state.deployed} onChange={event => setForm(previous => ({ ...previous, state: { ...previous.state, deployed: event.target.checked } }))} />Развёрнута</label>
      <label>Источник сведений<input value={form.source.sourceId} onChange={event => setForm(previous => ({ ...previous, source: { ...previous.source, sourceId: event.target.value } }))} /></label>
      <label>Позиция на карте<select value={markerId} onChange={event => setMarkerId(event.target.value)}>
        <option value="">Не выбрана</option>
        {markers.map(marker => <option key={marker.id} value={marker.id}>{marker.name ?? marker.id}</option>)}
      </select></label>
      <label>Боевая задача<input value={taskTitle(form)} onChange={event => setForm(previous => ({
        ...previous, position: { ...previous.position, task: { status: 'KNOWN', value: { title: event.target.value, ...(markerId ? { markerId } : {}) } } },
      }))} /></label>
    </div>
    {!markers.length && <p>Сначала нанесите позицию или район на исходную карту. Самостоятельный идентификатор геометрию не заменяет.</p>}
    <MoralePsychEditor value={morale} onChange={next => setForm(previous => ({ ...previous, state: { ...previous.state, moralePsych: next as unknown as ScenarioForce['state']['moralePsych'] } }))} />
  </article>;
}
