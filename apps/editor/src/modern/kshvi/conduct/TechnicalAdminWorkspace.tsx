import { useState } from 'react';
import type { ConductProjection } from './shared/types';

export function TechnicalAdminWorkspace({ projection, onTemporaryAccess }: {
  projection: ConductProjection;
  onTemporaryAccess: (entry: { reason: string; scope: 'RECOVERY' }) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [audited, setAudited] = useState(false);
  return <main className="kshvi-conduct-workspace"><header className="kshvi-conduct-header"><h1>Технический администратор</h1></header>
    <p>Соединение: {projection.connection} · Синхронизировано: {projection.lastServerSyncAt}</p>
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Учётные записи и назначения</h2><p>Управление выполняется серверными командами администрирования.</p></section>
      <section className="kshvi-conduct-panel"><h2>Состояние узлов и очереди</h2><p>Техническая проекция {projection.instanceId}</p></section>
      <section className="kshvi-conduct-panel"><h2>Резервные копии</h2><p>Отображаются только проверенные серверные факты.</p></section>
      <section className="kshvi-conduct-panel"><h2>Журнал доступа</h2><p>Скрытый payload в технический журнал не записывается.</p></section>
    </div>
    <section className="kshvi-conduct-panel"><h2>Временное раскрытие для восстановления</h2><label>Причина временного раскрытия<input value={reason} onChange={event => { setReason(event.target.value); setError(''); setAudited(false); }} /></label>
      {error && <p role="alert">{error}</p>}<button type="button" onClick={() => {
        if (!reason.trim()) { setError('Укажите причину временного раскрытия'); return; }
        void onTemporaryAccess({ reason, scope: 'RECOVERY' }).then(() => setAudited(true)).catch(cause => setError(cause instanceof Error ? cause.message : 'Доступ не выдан'));
      }}>Зарегистрировать временное раскрытие</button>
      {audited && <p>Аудит: причина записана, содержание не раскрыто</p>}
    </section>
  </main>;
}
