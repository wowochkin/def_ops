import { useState, type ReactNode } from 'react';
import type { ConductProjection } from './types';

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { resolve(); return; }
    const request = window.indexedDB.deleteDatabase(name);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(new Error(`Не удалось очистить ${name}`));
    request.onblocked = () => reject(new Error(`Очистка ${name} заблокирована другой вкладкой`));
  });
}
async function clearPrivilegedBrowserState(): Promise<void> {
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => Boolean(key?.startsWith('kshvi.') || key?.startsWith('def_ops.kshvi.')));
    for (const key of keys) storage.removeItem(key);
  }
  const cacheNames = window.caches ? await window.caches.keys() : [];
  await Promise.all(cacheNames.filter(name => name.startsWith('kshvi')).map(name => window.caches.delete(name)));
  await Promise.all([deleteDatabase('kshvi-projections'), deleteDatabase('kshvi-drafts')]);
}

export function ConductShell({ title, projection, children, onHandover }: {
  title: string;
  projection: ConductProjection;
  children: ReactNode;
  onHandover?: () => void | Promise<void>;
}) {
  const [handover, setHandover] = useState<'ACTIVE' | 'CLEANING' | 'READY' | 'ERROR'>('ACTIVE');
  const [error, setError] = useState('');
  if (handover !== 'ACTIVE') return <main className="kshvi-handover">
    <h1>Рабочее место передано</h1>
    <p>{handover === 'CLEANING' ? 'Завершается очистка приватных проекций, черновиков, кэшей и аудиторного профиля.' : 'Приватные данные очищены. Повторный вход требует подтверждения назначенной роли.'}</p>
    {error && <p role="alert">{error}</p>}
    <button type="button" disabled={handover !== 'READY'} onClick={() => { void onHandover?.(); }}>Подтвердить новую роль</button>
  </main>;
  return <main className="kshvi-conduct-workspace">
    <header className="kshvi-conduct-header"><div><p className="kshvi-kicker">КШВИ · серверная проекция {projection.instanceId}</p><h1>{title}</h1></div>
      <button type="button" onClick={() => {
        setHandover('CLEANING'); setError('');
        void clearPrivilegedBrowserState().then(() => setHandover('READY')).catch(cause => {
          setError(cause instanceof Error ? cause.message : 'Очистка не завершена'); setHandover('ERROR');
        });
      }}>Передать рабочее место</button>
    </header>
    <section className="kshvi-timebar" aria-label="Время и соединение">
      <span>Официальное время: {projection.officialOperationalAt}</span><span>Астрономическое время: {projection.wallClockAt}</span><span>Скорость: {projection.speed}</span>
      <span>Соединение: {projection.connection}</span><span>Синхронизировано: {projection.lastServerSyncAt}</span>
    </section>
    {children}
  </main>;
}
