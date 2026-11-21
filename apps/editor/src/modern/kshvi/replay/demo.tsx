import { useState } from 'react';
import { REPLAY_DOMAINS } from '../../../../../../packages/kshvi/src/replay/types';
import { ReplayWorkspace, type ReplayWorkspaceFrame } from './ReplayWorkspace';

function makeFrame(sequence: number, perspective: 'PARTICIPANT' | 'TRUTH'): ReplayWorkspaceFrame {
  return {
    sequence, perspective,
    operationalAt: `2026-11-21T06:0${sequence}:00.000Z`,
    wallClockAt: `2026-11-21T09:0${sequence}:00.000Z`,
    stateHash: 'a'.repeat(64),
    domains: Object.fromEntries(REPLAY_DOMAINS.map(domain => [domain, { sequence, status: 'Записано' }])),
    events: Array.from({ length: sequence }, (_, index) => ({ eventId: `event-${index + 1}`, type: 'decision', sequence: index + 1 })),
  };
}

export function ReplayDemo() {
  const [perspective, setPerspective] = useState<'PARTICIPANT' | 'TRUTH'>('PARTICIPANT');
  return <ReplayWorkspace initialFrame={makeFrame(2, perspective)} maxSequence={4}
    onSeek={sequence => makeFrame(sequence, perspective)} onPerspectiveChange={setPerspective} />;
}
