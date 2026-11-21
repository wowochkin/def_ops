import type { CascadeDelivery } from '../../../../../../packages/kshvi/src/documents/browser';

const stateLabels: Record<CascadeDelivery['state'], string> = {
  QUEUED: 'Ожидает передачи',
  IN_TRANSIT: 'Передаётся',
  DELIVERED: 'Доставлено',
  ACKNOWLEDGED: 'Получение подтверждено',
  EXECUTION_STARTED: 'Исполнение начато',
  FAILED: 'Ошибка доставки',
  CANCELLED: 'Передача отменена',
};

export function CascadePanel(props: { deliveries: readonly CascadeDelivery[] }) {
  return <section aria-label="Каскадная выдача">
    <h2>Каскадная выдача документа</h2>
    {props.deliveries.map(delivery => <article key={delivery.id}>
      <h3>{delivery.from} → {delivery.to}</h3>
      <p>Сообщение: {delivery.messageId}</p>
      <p>Источник: {delivery.source.documentId}; редакция {delivery.source.revision}; SHA-256 {delivery.source.sha256}</p>
      <p>Канал: {delivery.channelId}; ретранслятор: {delivery.relayId}</p>
      <p>Расчётное получение: {delivery.scheduledDeliveryAt}</p>
      <strong>{stateLabels[delivery.state]}</strong>
      {!delivery.acknowledgedAt && <p>Получение не подтверждено</p>}
      <p>{delivery.executionStartedAt ? `Исполнение начато: ${delivery.executionStartedAt}` : 'Исполнение не начато'}</p>
      {delivery.copyStatus !== 'FULL' && <p>Копия: {delivery.copyStatus}; пропущено вложений: {delivery.omittedAttachmentIds.length}</p>}
      {delivery.failureReason && <p>Причина отказа: {delivery.failureReason}</p>}
    </article>)}
  </section>;
}
