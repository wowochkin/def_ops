import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AudienceProjector, type AudienceProjectionView } from './AudienceProjector';
import { ExpositionClient, type ExpositionApi } from './exposition-client';
import './exposition.css';

export function ProjectorApp({ client: providedClient, projectorId }: Readonly<{
  client?: Pick<ExpositionApi, 'activeProjector'>;
  projectorId?: string;
}>) {
  const [projection, setProjection] = useState<AudienceProjectionView | null>(null);
  const [error, setError] = useState('');
  const configuredId = projectorId ?? new URLSearchParams(location.search).get('projector') ?? 'exposition-projector';

  useEffect(() => {
    const client = providedClient ?? new ExpositionClient();
    let disposed = false;
    let sequence = 0;
    let acceptedGeneration = 0;
    const update = () => {
      const current = ++sequence;
      void client.activeProjector(configuredId)
        .then(next => {
          if (disposed || current !== sequence || next.handoffGeneration < acceptedGeneration) return;
          acceptedGeneration = next.handoffGeneration;
          setProjection(next);
          setError('');
        })
        .catch(reason => { if (!disposed && current === sequence) setError(reason instanceof Error ? reason.message : String(reason)); });
    };
    update();
    const timer = globalThis.setInterval(update, 200);
    return () => { disposed = true; sequence += 1; globalThis.clearInterval(timer); };
  }, [providedClient, configuredId]);

  return <main className="exposition-projector-shell">
    {error && <p className="exposition-error" role="alert">{error}</p>}
    {projection ? <AudienceProjector projection={projection} /> : !error && <p role="status">Подключение к активному серверному каналу проектора…</p>}
  </main>;
}

const root = document.getElementById('exposition-projector-root');
if (root) createRoot(root).render(<ProjectorApp />);
