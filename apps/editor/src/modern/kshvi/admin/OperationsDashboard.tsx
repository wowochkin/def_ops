import type { OperationsSnapshot, ServiceState } from '../../../../../../services/kshvi/src/admin/health-service';
import type { TechnicalNotification } from '../../../../../../services/kshvi/src/admin/notification-service';
import { formatBytes } from '../shared/format';
import '../kshvi.css';
import './admin.css';

const stateLabels: Record<ServiceState, string> = { UP: 'Доступен', DEGRADED: 'Ограничения', DOWN: 'Недоступен' };
const serviceLabels = { kshvi: 'Сервис КШВИ', database: 'База данных', environment: 'Адаптер среды' } as const;

export function OperationsDashboard({ snapshot, notifications = [], onAcknowledge }: {
  snapshot: OperationsSnapshot;
  notifications?: readonly TechnicalNotification[];
  onAcknowledge?: (id: string) => void;
}) {
  return <section className="modern-kshvi kshvi-admin" aria-labelledby="operations-heading">
    <header className="kshvi-heading"><div>
      <p className="kshvi-kicker">Без содержания учения</p>
      <h2 id="operations-heading">Техническая эксплуатация</h2>
      <p>Health: {snapshot.health} · readiness: {snapshot.readiness.ready ? 'готов' : 'не готов'}</p>
    </div></header>

    <div className="kshvi-alert-list" aria-live="assertive">{snapshot.alerts.map(alert => <p className="kshvi-error" role="alert" key={alert.code}>
      <strong>{alert.severity === 'CRITICAL' ? 'Критический сбой' : 'Предупреждение'}: </strong><span>{alert.message}</span> · {alert.correlationId}
    </p>)}</div>

    <div className="kshvi-operations-grid">
      <article><h3>Сервисы</h3><dl>{Object.entries(snapshot.services).map(([service, state]) => <div key={service}>
        <dt>{serviceLabels[service as keyof typeof serviceLabels]}</dt><dd>{stateLabels[state]}</dd>
      </div>)}</dl></article>
      <article><h3>Соединения</h3><strong>{snapshot.connections.total} / 50</strong>
        <p>Активные: {snapshot.connections.active} · ожидают: {snapshot.connections.idle} · разорваны: {snapshot.connections.disconnected}</p></article>
      <article><h3>Очереди и задержки</h3><p>События: {snapshot.queues.events} · задания: {snapshot.queues.jobs} · тяжёлые: {snapshot.queues.heavyJobs}</p>
        <p>P95 команды: {snapshot.latencyMs.commandP95} мс · SSE: {snapshot.latencyMs.sseP95} мс · карта: {snapshot.latencyMs.mapP95} мс</p></article>
      <article><h3>Хранение и копии</h3><p>Свободно: {formatBytes(snapshot.storage.freeBytes)} · журнал: {formatBytes(snapshot.storage.journalBytes)}</p>
        <p>Копия: {snapshot.backups.status} · проверена: {snapshot.backups.lastVerifiedAt ?? 'нет данных'}</p></article>
      <article><h3>Серверное время</h3><p>{snapshot.clock.serverTime}</p><p>{`Расхождение часов: ${snapshot.clock.offsetMs} мс`}</p>
        <p>{snapshot.clock.ntpSynchronized ? 'NTP синхронизирован' : 'NTP не синхронизирован'}</p></article>
      <article><h3>Версии и ошибки</h3>{Object.entries(snapshot.versions).map(([name, version]) => <p key={name}>{name}: {version}</p>)}
        {snapshot.errors.map(error => <p key={`${error.code}-${error.correlationId}`}>{error.code} · {error.correlationId}</p>)}</article>
    </div>

    {notifications.length > 0 && <section aria-label="Уведомления"><h3>Уведомления</h3>{notifications.map(notification => <article className="kshvi-notification" key={notification.id}>
      <strong>{notification.priority === 'CRITICAL' ? 'Критическое' : notification.priority === 'HIGH' ? 'Важное' : 'Информационное'}</strong>
      <p>{notification.title}</p><p><span>{`Повторов: ${notification.groupCount}`}</span>{` · срок: ${notification.expiresAt}`}</p>
      {onAcknowledge && <button onClick={() => onAcknowledge(notification.id)}>Подтвердить уведомление {notification.title}</button>}
    </article>)}</section>}
  </section>;
}
