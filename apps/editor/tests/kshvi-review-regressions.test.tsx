// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ReplayWorkspace, type ReplayWorkspaceFrame } from '../src/modern/kshvi/replay/ReplayWorkspace';

afterEach(cleanup);

function frame(perspective: 'PARTICIPANT' | 'TRUTH', marker: string): ReplayWorkspaceFrame {
  return {
    sequence: 2, operationalAt: '2026-11-21T06:02:00.000Z', wallClockAt: '2026-11-21T09:02:00.000Z',
    perspective, stateHash: marker.repeat(64), domains: { Map: { marker } }, events: [],
  };
}

it('R11: новый initialFrame обновляет перспективу, hash и содержимое без seek', () => {
  const view = render(<ReplayWorkspace initialFrame={frame('PARTICIPANT', 'a')} maxSequence={4} onSeek={() => frame('PARTICIPANT', 'a')} />);
  expect(screen.getByRole('status', { name: 'Перспектива реплея' }).textContent).toContain('Как видел участник');
  view.rerender(<ReplayWorkspace initialFrame={frame('TRUTH', 'b')} maxSequence={4} onSeek={() => frame('TRUTH', 'b')} />);
  expect(screen.getByRole('status', { name: 'Перспектива реплея' }).textContent).toContain('Истинное состояние');
  expect((screen.getByLabelText('Перспектива') as HTMLSelectElement).value).toBe('TRUTH');
  expect(screen.getByTestId('replay-hash').textContent).toContain('b'.repeat(64));
  expect(screen.getByTestId('replay-panel').textContent).toContain('b');
});
