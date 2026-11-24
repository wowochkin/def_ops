import { useState } from 'react';

export function ArchiveImportDialog({ onImport }: { onImport: (serialized: string) => Promise<void> }) {
  const [serialized, setSerialized] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  return <form onSubmit={async event => {
    event.preventDefault();
    setPending(true); setError('');
    try { await onImport(serialized); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setPending(false); }
  }}>
    <h2>Импорт архива</h2>
    <p>Проверка хешей, схемы и ссылок выполняется до публикации.</p>
    <label>Содержимое архивного пакета<textarea value={serialized} onChange={event => setSerialized(event.currentTarget.value)} required /></label>
    <button type="submit" disabled={pending}>{pending ? 'Проверка…' : 'Проверить и импортировать'}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
