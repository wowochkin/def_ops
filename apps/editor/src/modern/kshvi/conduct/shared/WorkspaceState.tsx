import type { WorkspaceStatus } from './types';

const content: Record<WorkspaceStatus, { text: string; action: string }> = {
  LOADING: { text: 'Загрузка данных', action: 'Повторить' },
  EMPTY: { text: 'Пусто: события ещё не созданы', action: 'Повторить' },
  FORBIDDEN: { text: 'Нет прав', action: 'Обратиться к администратору' },
  NO_DATA: { text: 'Нет данных', action: 'Повторить' },
  STALE: { text: 'Данные устарели', action: 'Повторить' },
  PARTIAL_FAILURE: { text: 'Частичный сбой', action: 'Перейти к журналу' },
  UNAVAILABLE: { text: 'Сервис недоступен', action: 'Восстановить соединение' },
};

export function WorkspaceState({ status, onAction }: { status: WorkspaceStatus; onAction?: () => void }) {
  const current = content[status];
  return <section className={`kshvi-workspace-state kshvi-state-${status.toLowerCase()}`} role={status === 'LOADING' || status === 'EMPTY' ? 'status' : 'alert'}>
    <strong>{current.text}</strong>
    <p>{status === 'PARTIAL_FAILURE' ? 'Доступная часть проекции сохранена; отказавшие источники перечислены в журнале.' : 'Официальное состояние не подменяется локальной догадкой.'}</p>
    <button type="button" onClick={onAction}>{current.action}</button>
  </section>;
}
