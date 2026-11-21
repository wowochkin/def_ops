import { useState } from 'react';

export type OrderPanelModel = {
  id: string;
  status: string;
  receivedAt: string | null;
  actualCosts: { timeMinutes: number; resources: Record<string, number> };
  position: { remainingMeters: number; travelledMeters: number } | null;
};

export function OrdersPanel({ order, onCancel }: { order: OrderPanelModel; onCancel?: (input: { reason: string }) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  return <section className="kshvi-conduct-panel" aria-labelledby="orders-panel-title">
    <h2 id="orders-panel-title">Исполнение приказа {order.id}</h2>
    <ol className="kshvi-order-stages">
      {['Доставка', 'Обработка', 'Подготовка', 'Исполнение', 'Доклад'].map(label => <li key={label}>{label}</li>)}
    </ol>
    <p>Текущий статус: {order.status}</p>
    <p>Получение: {order.receivedAt ?? 'не подтверждено'}</p>
    <h3>Фактические затраты</h3>
    <p>{order.actualCosts.timeMinutes} мин</p>
    {Object.entries(order.actualCosts.resources).map(([resource, amount]) => <p key={resource}>{resource}: {amount}</p>)}
    {order.position && <p>Пройдено: {order.position.travelledMeters} м; осталось: {order.position.remainingMeters} м</p>}
    <label>Причина отмены<input value={reason} onChange={event => { setReason(event.target.value); setError(''); }} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="kshvi-danger" onClick={() => {
      if (!reason.trim()) { setError('Укажите основание отмены'); return; }
      onCancel?.({ reason });
    }}>Отменить приказ</button>
    <p>Отмена после получения создаёт новую запись и не изменяет уже учтённые затраты и пройденный путь.</p>
  </section>;
}
