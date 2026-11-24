import { useState } from 'react';

export function RerunDialog({ sourceSessionId, onConfirm }: { sourceSessionId: string; onConfirm: (sessionId: string) => void }) {
  const [sessionId, setSessionId] = useState('');
  return <form onSubmit={event => {
    event.preventDefault();
    if (sessionId.trim() && sessionId !== sourceSessionId) onConfirm(sessionId);
  }}>
    <h2>Повторное прохождение</h2>
    <p>Исходный сеанс: {sourceSessionId}. Сценарная редакция копируется, назначения участников создаются заново.</p>
    <label>Новый идентификатор сеанса<input value={sessionId} onChange={event => setSessionId(event.currentTarget.value)} required /></label>
    <p>Единый рейтинг разных учений не создаётся; сравнение требует перечня различий среды, модели, состава и ролей.</p>
    <button type="submit">Создать повторное прохождение</button>
  </form>;
}
