import { useEffect, useState } from 'react';
import { PerspectiveBadge } from './PerspectiveBadge';
import { ReplayTimeline } from './ReplayTimeline';
import { SynchronizedPanels } from './SynchronizedPanels';

export type ReplayWorkspaceFrame = Readonly<{
  sequence: number;
  operationalAt: string | null;
  wallClockAt: string | null;
  perspective: 'PARTICIPANT' | 'TRUTH';
  stateHash: string | null;
  domains: Record<string, unknown>;
  events: readonly { eventId: string; type: string; sequence: number }[];
}>;

export function ReplayWorkspace({ initialFrame, maxSequence, onSeek, onPerspectiveChange, onTrace, canReadTruth = true }: {
  initialFrame: ReplayWorkspaceFrame;
  maxSequence: number;
  onSeek: (sequence: number) => ReplayWorkspaceFrame | Promise<ReplayWorkspaceFrame>;
  onPerspectiveChange?: (perspective: 'PARTICIPANT' | 'TRUTH') => void | Promise<void>;
  onTrace?: (eventId: string) => void;
  canReadTruth?: boolean;
}) {
  const [frame, setFrame] = useState(initialFrame);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setFrame(initialFrame); }, [initialFrame]);
  function seek(sequence: number): void {
    const result = onSeek(sequence);
    if (result instanceof Promise) {
      setPending(true);
      setError('');
      void result.then(setFrame).catch((cause: unknown) => setError(cause instanceof Error ? cause.message : 'Кадр реплея недоступен')).finally(() => setPending(false));
    } else setFrame(result);
  }
  return <main className="kshvi-replay-workspace" style={{ display: 'grid', gap: 14, padding: 16, color: '#edf2f4', background: '#111a20', minHeight: '100vh', boxSizing: 'border-box' }}>
    <h1 style={{ margin: 0 }}>Синхронизированный реплей</h1>
    {pending && <p role="status">Загружаем серверный кадр…</p>}
    {error && <p role="alert">{error}</p>}
    <PerspectiveBadge perspective={frame.perspective} />
    <label>Перспектива
      <select aria-label="Перспектива" value={frame.perspective}
        onChange={event => void onPerspectiveChange?.(event.currentTarget.value as 'PARTICIPANT' | 'TRUTH')}>
        <option value="PARTICIPANT">Как видел участник</option>
        {canReadTruth && <option value="TRUTH">Истинное состояние</option>}
      </select>
    </label>
    <ReplayTimeline sequence={frame.sequence} maxSequence={maxSequence} operationalAt={frame.operationalAt ?? 'Нет данных'}
      wallClockAt={frame.wallClockAt ?? 'Нет данных'} onSeek={seek} />
    <div data-testid="replay-hash">SHA-256 состояния: {frame.stateHash ?? 'Несовместимое чтение — идентичность не заявляется'}</div>
    <SynchronizedPanels domains={frame.domains} sequence={frame.sequence} />
    <section aria-label="Лента событий">
      <h2>Лента событий и причинные связи</h2>
      {frame.events.map(event => <button key={event.eventId} onClick={() => onTrace?.(event.eventId)}>
        Причины события {event.eventId}
      </button>)}
    </section>
  </main>;
}
