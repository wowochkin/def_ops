export type AsyncStatus = 'loading' | 'empty' | 'forbidden' | 'no-data' | 'unknown' | 'stale' | 'partial-error' | 'unavailable';

const messages: Record<AsyncStatus, string> = {
  loading: 'Загрузка данных…',
  empty: 'Ничего не найдено. Измените условия поиска.',
  forbidden: 'Недостаточно прав. Обратитесь к администратору.',
  'no-data': 'Нет данных для выбранных условий.',
  unknown: 'Неизвестное состояние данных. Требуется проверка, а не подстановка значения по умолчанию.',
  stale: 'Данные устарели. Повторите серверную синхронизацию.',
  'partial-error': 'Часть данных недоступна. Можно повторить запрос или перейти к журналу.',
  unavailable: 'Сервис недоступен. Восстановите соединение или обратитесь к администратору.',
};

export function AsyncState({ status, lastSyncedAt, onRetry, onReconnect, onOpenJournal }: {
  status: AsyncStatus;
  lastSyncedAt?: string;
  onRetry?: () => void;
  onReconnect?: () => void;
  onOpenJournal?: () => void;
}) {
  return <section className="kshvi-async-state" role="status" aria-live="polite">
    <p>{messages[status]}</p>
    {lastSyncedAt && <p>Последняя серверная синхронизация: {lastSyncedAt}</p>}
    <div className="kshvi-dialog-actions">
      {onRetry && <button onClick={onRetry}>Повторить</button>}
      {onReconnect && <button onClick={onReconnect}>Восстановить соединение</button>}
      {onOpenJournal && <button onClick={onOpenJournal}>Перейти к журналу</button>}
    </div>
  </section>;
}
