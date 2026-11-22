import { useEffect, useState } from 'react';
import { PerspectiveBadge } from './PerspectiveBadge';
import { ReplayTimeline } from './ReplayTimeline';
import { SynchronizedPanels } from './SynchronizedPanels';

export type ReplayWorkspaceFrame = {
  sequence: number;
  operationalAt: string;
  wallClockAt: string;
  perspective: 'PARTICIPANT' | 'TRUTH';
  stateHash: string | null;
  domains: Record<string, unknown>;
  events: readonly { eventId: string; type: string; sequence: number }[];
};

export function ReplayWorkspace({ initialFrame, maxSequence, onSeek, onPerspectiveChange, onTrace }: {
  initialFrame: ReplayWorkspaceFrame;
  maxSequence: number;
  onSeek: (sequence: number) => ReplayWorkspaceFrame;
  onPerspectiveChange?: (perspective: 'PARTICIPANT' | 'TRUTH') => void;
  onTrace?: (eventId: string) => void;
}) {
  const [frame, setFrame] = useState(initialFrame);
  useEffect(() => { setFrame(initialFrame); }, [initialFrame]);
  const seek = (sequence: number): void => setFrame(onSeek(sequence));
  return <main className="kshvi-replay-workspace" style={{ display: 'grid', gap: 14, padding: 16, color: '#edf2f4', background: '#111a20', minHeight: '100vh', boxSizing: 'border-box' }}>
    <h1 style={{ margin: 0 }}>Синхронизированный реплей</h1>
    <PerspectiveBadge perspective={frame.perspective} />
    <label>Перспектива
      <select aria-label="Перспектива" value={frame.perspective}
        onChange={event => onPerspectiveChange?.(event.currentTarget.value as 'PARTICIPANT' | 'TRUTH')}>
        <option value="PARTICIPANT">Как видел участник</option>
        <option value="TRUTH">Истинное состояние</option>
      </select>
    </label>
    <ReplayTimeline sequence={frame.sequence} maxSequence={maxSequence} operationalAt={frame.operationalAt}
      wallClockAt={frame.wallClockAt} onSeek={seek} />
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
