import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudienceProjector, type AudienceProjectionView } from './AudienceProjector';
import { ExpositionClient } from './exposition-client';
import './exposition.css';

export function ProjectorApp() {
  const [projection, setProjection] = useState<AudienceProjectionView | null>(null);
  const [error, setError] = useState('');
  const sessionId = new URLSearchParams(location.search).get('session') ?? '';
  const projectorId = new URLSearchParams(location.search).get('projector') ?? 'exposition-projector';

  useEffect(() => {
    if (!sessionId) return;
    const client = new ExpositionClient();
    let disposed = false;
    const update = () => {
      void client.projector(sessionId, projectorId)
        .then(next => { if (!disposed) { setProjection(next); setError(''); } })
        .catch(reason => { if (!disposed) setError(reason instanceof Error ? reason.message : String(reason)); });
    };
    update();
    const timer = globalThis.setInterval(update, 200);
    return () => { disposed = true; globalThis.clearInterval(timer); };
  }, [sessionId, projectorId]);

  return <main className="exposition-projector-shell">
    {!sessionId && <p role="alert">Укажите идентификатор сеанса в адресе проектора.</p>}
    {error && <p className="exposition-error" role="alert">{error}</p>}
    {projection ? <AudienceProjector projection={projection} /> : sessionId && !error && <p role="status">Подключение к серверному каналу проектора…</p>}
  </main>;
}

const root = document.getElementById('exposition-projector-root');
if (root) createRoot(root).render(<ProjectorApp />);
