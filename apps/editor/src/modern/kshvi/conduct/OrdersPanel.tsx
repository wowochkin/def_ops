import { useEffect, useState } from 'react';
import type { ConductCommands } from './shared/types';

export type OrderPanelModel = {
  id: string;
  status: string;
  receivedAt: string | null;
  actualCosts: { timeMinutes: number; resources: Record<string, number> };
  position: { remainingMeters: number; travelledMeters: number } | null;
};

export function OrdersPanel({ order, commands }: { order: OrderPanelModel; commands: Pick<ConductCommands, 'cancelOrder'> }) {
  const [current, setCurrent] = useState(order);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setCurrent(order); }, [order]);
  return <section className="kshvi-conduct-panel" aria-labelledby="orders-panel-title">
    <h2 id="orders-panel-title">Исполнение приказа {current.id}</h2>
    <ol className="kshvi-order-stages">{['Доставка', 'Обработка', 'Подготовка', 'Исполнение', 'Доклад'].map(label => <li key={label}>{label}</li>)}</ol>
    <p>Текущий статус: {current.status}</p><p>Получение: {current.receivedAt ?? 'не подтверждено'}</p>
    <h3>Фактические затраты</h3><p>{current.actualCosts.timeMinutes} мин</p>
    {Object.entries(current.actualCosts.resources).map(([resource, amount]) => <p key={resource}>{resource}: {amount}</p>)}
    {current.position && <p>Пройдено: {current.position.travelledMeters} м; осталось: {current.position.remainingMeters} м</p>}
    <label>Причина отмены<input value={reason} onChange={event => { setReason(event.target.value); setError(''); }} /></label>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="kshvi-danger" disabled={busy} onClick={() => {
      if (!reason.trim()) { setError('Укажите основание отмены'); return; }
      setBusy(true); setError('');
      void commands.cancelOrder({ orderId: current.id, reason }).then(setCurrent).catch(cause => {
        setError(cause instanceof Error ? cause.message : 'Отмена приказа отклонена сервером');
      }).finally(() => setBusy(false));
    }}>Отменить приказ</button>
    <p>Новый статус и сохранённые затраты отображаются только после подтверждения серверной команды.</p>
  </section>;
}
