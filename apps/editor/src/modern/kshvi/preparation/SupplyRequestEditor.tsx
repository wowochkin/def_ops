import { useState } from 'react';
import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import { createSupplyRequest } from '../../../../../../packages/kshvi/src/logistics/supply-request';
import { planSupplyDelivery, type SupplyDeliveryPreview } from '../../../../../../packages/kshvi/src/logistics/delivery-plan';
import type { RouteGraph } from '../../../../../../packages/kshvi/src/terrain/route-graph';
import type { TerrainState } from '../../../../../../packages/kshvi/src/terrain/types';
import { applySupplyPreview, emptySupplyPlan } from './logistics-operations';

export function SupplyRequestEditor({ draft, terrain, onSave, onClose }: {
  draft: PreparationDraft;
  terrain?: Readonly<{ state: TerrainState; graph: RouteGraph }>;
  onSave(draft: PreparationDraft): void;
  onClose(): void;
}) {
  const firstEdge = terrain?.graph.edges[0];
  const [plan] = useState(() => draft.logistics ?? emptySupplyPlan());
  const [requestId] = useState(() => crypto.randomUUID());
  const [resourceId, setResourceId] = useState('fuel');
  const [quantity, setQuantity] = useState('0');
  const [availableQuantity, setAvailableQuantity] = useState('');
  const [unit, setUnit] = useState('L');
  const [weight, setWeight] = useState('0');
  const [volume, setVolume] = useState('0');
  const [routeId, setRouteId] = useState(firstEdge?.id ?? '');
  const [sourceNodeId, setSourceNodeId] = useState(firstEdge?.from ?? '');
  const [requesterNodeId, setRequesterNodeId] = useState(firstEdge?.to ?? draft.forces[0]?.identity.nodeId ?? '');
  const [requiredBy, setRequiredBy] = useState(new Date(Date.parse(draft.updatedAt) + 3600000).toISOString());
  const [priority, setPriority] = useState('1');
  const [preview, setPreview] = useState<SupplyDeliveryPreview | null>(null);
  const [error, setError] = useState('');

  function request() {
    return createSupplyRequest({
      id: requestId, resourceId, unit, requesterNodeId, sourceNodeId,
      quantity: Number(quantity), totalWeightTonnes: Number(weight), totalVolumeM3: Number(volume),
      priority: Number(priority), requiredBy, createdAt: draft.updatedAt, taskIds: [],
    });
  }
  function calculate() {
    try {
      if (!terrain) throw new Error('Для расчёта нужен дорожный граф и состояние местности');
      if (availableQuantity === '') throw new Error('Укажите доступный остаток или вернитесь к заполнению запасов');
      const result = planSupplyDelivery({ plan, request: request(), routeId, terrain, availableQuantity: Number(availableQuantity) });
      setPreview(result); setError('');
    } catch (cause) {
      setPreview(null); setError(cause instanceof Error ? cause.message : 'Расчёт доставки не выполнен');
    }
  }
  function save() {
    if (!preview) return;
    onSave(applySupplyPreview(draft, { request: request(), preview, routeId, availableQuantity: Number(availableQuantity) }));
  }

  return <fieldset className="supply-request-editor"><legend>Новая заявка на снабжение</legend>
    <div className="supply-request-grid">
      <label>Номенклатура<input value={resourceId} onChange={event => { setResourceId(event.target.value); setPreview(null); }} /></label>
      <label>Количество<input type="number" min="0" value={quantity} onChange={event => { setQuantity(event.target.value); setPreview(null); }} /></label>
      <label>Доступный остаток<input type="number" min="0" value={availableQuantity} onChange={event => { setAvailableQuantity(event.target.value); setPreview(null); }} /></label>
      <label>Единица измерения<input value={unit} onChange={event => setUnit(event.target.value)} /></label>
      <label>Масса груза, т<input type="number" min="0" step="0.1" value={weight} onChange={event => setWeight(event.target.value)} /></label>
      <label>Объём груза, м³<input type="number" min="0" step="0.1" value={volume} onChange={event => setVolume(event.target.value)} /></label>
      <label>Пункт отправления<input value={sourceNodeId} onChange={event => setSourceNodeId(event.target.value)} /></label>
      <label>Пункт получения<input value={requesterNodeId} onChange={event => setRequesterNodeId(event.target.value)} /></label>
      <label>Маршрут снабжения<select value={routeId} onChange={event => {
        const id = event.target.value; const edge = terrain?.graph.edges.find(item => item.id === id);
        setRouteId(id); if (edge) { setSourceNodeId(edge.from); setRequesterNodeId(edge.to); } setPreview(null);
      }}>
        {terrain?.graph.edges.map(edge => <option key={edge.id} value={edge.id}>{edge.id}</option>)}
      </select></label>
      <label>Требуется к<input value={requiredBy} onChange={event => setRequiredBy(event.target.value)} /></label>
      <label>Приоритет заявки<input type="number" step="1" value={priority} onChange={event => setPriority(event.target.value)} /></label>
    </div>
    <button type="button" onClick={calculate}>Рассчитать доставку</button>
    <button type="button" disabled={!preview} onClick={save}>Сохранить заявку</button>
    <button type="button" onClick={onClose}>Отмена</button>
    {error && <p role="alert">{error}</p>}
    {preview && <section aria-label="Предпросмотр доставки">
      <p role="status">Расчёт: {preview.status}; прибытие: {preview.arrivalAt ?? 'неизвестно'}; Дефицит: {preview.request.deficit} {unit}; выделено: {preview.request.allocatedQuantity} {unit}</p>
      <p>Маршрут: {preview.distanceMeters ?? 'неизвестно'} м; длительность: {preview.durationMinutes ?? 'неизвестно'} мин. Поступление получателю не создаётся до фактического подтверждения.</p>
      {!!preview.issues.length && <ul>{preview.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}
    </section>}
  </fieldset>;
}
