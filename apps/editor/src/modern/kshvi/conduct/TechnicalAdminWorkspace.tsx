import { useState } from 'react';

export function TechnicalAdminWorkspace({ onAudit }: { onAudit?: (entry: { reason: string; scope: 'RECOVERY'; contentGranted: false }) => void }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [audited, setAudited] = useState(false);
  return <main className="kshvi-conduct-workspace"><header className="kshvi-conduct-header"><h1>Технический администратор</h1></header>
    <p>Соединение: подключено · Синхронизировано: 2030-01-01T02:00:00Z</p>
    <div className="kshvi-conduct-grid">
      <section className="kshvi-conduct-panel"><h2>Учётные записи и назначения</h2><p>25 активных участников · роли назначаются отдельной командой</p></section>
      <section className="kshvi-conduct-panel"><h2>Состояние узлов и очереди</h2><p>Узлы доступны · инфраструктурная очередь: 2 задания</p></section>
      <section className="kshvi-conduct-panel"><h2>Резервные копии</h2><p>Последняя проверенная копия: ревизия 8</p></section>
      <section className="kshvi-conduct-panel"><h2>Журнал доступа</h2><p>Скрытый payload в технический журнал не записывается</p></section>
    </div>
    <section className="kshvi-conduct-panel"><h2>Временное раскрытие для восстановления</h2><label>Причина временного раскрытия<input value={reason} onChange={event => { setReason(event.target.value); setError(''); setAudited(false); }} /></label>
      {error && <p role="alert">{error}</p>}
      <button type="button" onClick={() => {
        if (!reason.trim()) { setError('Укажите причину временного раскрытия'); return; }
        onAudit?.({ reason, scope: 'RECOVERY', contentGranted: false }); setAudited(true);
      }}>Зарегистрировать временное раскрытие</button>
      {audited && <p>Аудит: причина записана, содержание не раскрыто</p>}
    </section>
  </main>;
}
