import { useEffect, useRef, useState } from 'react';
import { formatDuration, formatRussianDateTime } from './format';

export function OfflineBanner({ connection, lastSyncedAt, outageStartedAt, serverTime, ntpSynchronized, clockOffsetMs }: {
  connection: 'ONLINE' | 'DEGRADED' | 'OFFLINE';
  lastSyncedAt: string;
  outageStartedAt: string | null;
  serverTime: string;
  ntpSynchronized: boolean;
  clockOffsetMs: number;
}) {
  const transitionKey = `${connection}|${outageStartedAt ?? ''}|${serverTime}`;
  const previousTransitionKey = useRef(transitionKey);
  const serverTransitionWallAt = useRef(Date.now());
  if (previousTransitionKey.current !== transitionKey) {
    previousTransitionKey.current = transitionKey;
    serverTransitionWallAt.current = Date.now();
  }
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setNow(Date.now());
    if (connection !== 'OFFLINE' || !outageStartedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [connection, outageStartedAt, serverTime]);
  const parsedStart = outageStartedAt ? Date.parse(outageStartedAt) : 0;
  const parsedServer = Date.parse(serverTime);
  const baseOutage = outageStartedAt && Number.isFinite(parsedStart) && Number.isFinite(parsedServer)
    ? Math.max(0, parsedServer - parsedStart) : 0;
  const liveOutage = connection === 'OFFLINE' && outageStartedAt ? Math.max(0, now - serverTransitionWallAt.current) : 0;
  const outageMs = baseOutage + liveOutage;
  return <aside className="kshvi-offline-banner" role="status" aria-live="polite">
    <strong>{connection === 'OFFLINE' ? 'Нет соединения с сервером' : connection === 'DEGRADED' ? 'Соединение нестабильно' : 'Соединение с сервером активно'}</strong>
    {outageStartedAt && <p>Период потери связи: {formatDuration(outageMs)}</p>}
    <p>Последняя серверная синхронизация: {formatRussianDateTime(lastSyncedAt)}</p>
    {!ntpSynchronized && <p>Синхронизация NTP потеряна</p>}
    <p>Расхождение часов: {clockOffsetMs} мс</p>
  </aside>;
}
