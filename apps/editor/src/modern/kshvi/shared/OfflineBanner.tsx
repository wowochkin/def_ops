import { formatDuration, formatRussianDateTime } from './format';

export function OfflineBanner({ connection, lastSyncedAt, outageStartedAt, serverTime, ntpSynchronized, clockOffsetMs }: {
  connection: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  lastSyncedAt: string;
  outageStartedAt: string | null;
  serverTime: string;
  ntpSynchronized: boolean;
  clockOffsetMs: number;
}) {
  const outageMs = outageStartedAt ? Math.max(0, Date.parse(serverTime) - Date.parse(outageStartedAt)) : 0;
  return <aside className="kshvi-offline-banner" role="status" aria-live="polite">
    <strong>{connection === 'OFFLINE' ? 'Нет соединения с сервером' : connection === 'DEGRADED' ? 'Соединение нестабильно' : 'Соединение с сервером активно'}</strong>
    {outageStartedAt && <p>Период потери связи: {formatDuration(outageMs)}</p>}
    <p>Последняя серверная синхронизация: {formatRussianDateTime(lastSyncedAt)}</p>
    {!ntpSynchronized && <p>Синхронизация NTP потеряна</p>}
    <p>Расхождение часов: {clockOffsetMs} мс</p>
  </aside>;
}
