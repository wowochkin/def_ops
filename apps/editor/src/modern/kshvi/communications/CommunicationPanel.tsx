import {
  effectiveChannelCapacity,
  type Channel,
  type MessageAttempt,
} from '../../../../../../packages/kshvi/src/communications/browser';

export function CommunicationPanel(props: {
  channels: readonly Channel[];
  attempts: readonly MessageAttempt[];
}) {
  return <section aria-label="Имитация связи">
    <h2>Каналы и попытки связи</h2>
    <section aria-label="Каналы">
      {props.channels.map(channel => <article key={channel.id}>
        <h3>{channel.id}</h3>
        <p>Канал {channel.id}: {channel.availability}; ёмкость {effectiveChannelCapacity(channel)}/{channel.capacity}</p>
        <p>Задержка: {channel.baseDelayMs} мс; шифрование — сценарный признак: {channel.encrypted ? 'да' : 'нет'}</p>
        <p>Резерв: {channel.reserveChannelIds.join(', ') || 'не задан'}</p>
      </article>)}
    </section>
    <section aria-label="Попытки доставки">
      {props.attempts.map(attempt => <article key={`${attempt.messageId}:${attempt.attempt}`}>
        <h3>{attempt.messageId}</h3>
        <code>{attempt.status}</code>
        <p>Попытка {attempt.attempt}; маршрут {attempt.route.channelId}</p>
        <p>Постановка: {attempt.queuedAt}; начало: {attempt.startedAt ?? 'не начато'}; завершение: {attempt.completedAt ?? 'не завершено'}</p>
        {attempt.failureReason && <p>Причина: {attempt.failureReason}</p>}
        {attempt.duplicate && <p>Дубликат доставки; доменный эффект не повторён</p>}
        {attempt.partial && <p>Частичная доставка адресатам</p>}
      </article>)}
    </section>
  </section>;
}
