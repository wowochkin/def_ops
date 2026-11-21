import { useState, type ReactNode } from 'react';
import { defaultOperationalAt } from './types';

function clearPrivilegedBrowserState(): void {
  try {
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith('kshvi.')));
      for (const key of keys) storage.removeItem(key);
    }
    void window.caches?.keys().then(names => Promise.all(names.filter(name => name.startsWith('kshvi')).map(name => window.caches.delete(name)))).catch(() => undefined);
    window.indexedDB?.deleteDatabase('kshvi-projections');
    window.indexedDB?.deleteDatabase('kshvi-drafts');
  } catch { /* нейтральный экран остаётся даже при ограниченном хранилище браузера */ }
}

export function ConductShell({ title, children, officialOperationalAt = defaultOperationalAt, wallClockAt = '2030-01-01T12:00:00+03:00', speed = '2×', onHandover }: {
  title: string;
  children: ReactNode;
  officialOperationalAt?: string;
  wallClockAt?: string;
  speed?: string;
  onHandover?: () => void;
}) {
  const [handedOver, setHandedOver] = useState(false);
  if (handedOver) return <main className="kshvi-handover">
    <h1>Рабочее место передано</h1>
    <p>Приватные черновики, проекции и аудиторный профиль скрыты. Повторный вход требует подтверждения назначенной роли.</p>
    <button type="button" onClick={onHandover}>Подтвердить новую роль</button>
  </main>;
  return <main className="kshvi-conduct-workspace">
    <header className="kshvi-conduct-header">
      <div><p className="kshvi-kicker">КШВИ · официальное проведение</p><h1>{title}</h1></div>
      <button type="button" onClick={() => { clearPrivilegedBrowserState(); setHandedOver(true); }}>Передать рабочее место</button>
    </header>
    <section className="kshvi-timebar" aria-label="Время и соединение">
      <span>Официальное время: {officialOperationalAt}</span><span>Астрономическое время: {wallClockAt}</span><span>Скорость: {speed}</span>
      <span>Соединение: подключено</span><span>Синхронизировано: {officialOperationalAt}</span>
    </section>
    {children}
  </main>;
}
