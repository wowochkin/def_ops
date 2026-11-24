// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReplayWorkspace, type ReplayWorkspaceFrame } from '../src/modern/kshvi/replay/ReplayWorkspace';
import { REPLAY_DOMAINS } from '../../../packages/kshvi/src/replay/replay-engine';

afterEach(cleanup);

function frame(sequence: number, perspective: 'PARTICIPANT' | 'TRUTH' = 'PARTICIPANT'): ReplayWorkspaceFrame {
  return {
    sequence,
    operationalAt: `2026-11-21T06:0${sequence}:00.000Z`,
    wallClockAt: `2026-11-21T09:0${sequence}:00.000Z`,
    perspective,
    stateHash: 'a'.repeat(64),
    domains: Object.fromEntries(REPLAY_DOMAINS.map(domain => [domain, { sequence, items: [] }])),
    events: [{ eventId: `event-${sequence}`, type: 'decision', sequence }],
  };
}

it('синхронно меняет все панели и не меняет состояние от скорости', () => {
  const onSeek = vi.fn((sequence: number) => frame(sequence));
  render(<ReplayWorkspace initialFrame={frame(2)} maxSequence={4} onSeek={onSeek} />);
  expect(screen.getAllByTestId('replay-panel')).toHaveLength(REPLAY_DOMAINS.length);
  expect(screen.getAllByTestId('replay-panel').every(panel => panel.getAttribute('data-sequence') === '2')).toBe(true);
  const hash = screen.getByTestId('replay-hash').textContent;
  fireEvent.change(screen.getByLabelText('Скорость просмотра'), { target: { value: '8' } });
  expect(screen.getByTestId('replay-hash').textContent).toBe(hash);
  expect(onSeek).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText('Позиция реплея'), { target: { value: '3' } });
  expect(onSeek).toHaveBeenCalledWith(3);
  expect(screen.getAllByTestId('replay-panel').every(panel => panel.getAttribute('data-sequence') === '3')).toBe(true);
  expect(screen.getByText('Оперативное время: 2026-11-21T06:03:00.000Z')).toBeTruthy();
  expect(screen.getByText('Астрономическое время: 2026-11-21T09:03:00.000Z')).toBeTruthy();
});

it('различает перспективы, маркирует истину и ведёт от ленты к причинам', () => {
  const onPerspectiveChange = vi.fn();
  const onTrace = vi.fn();
  render(<ReplayWorkspace initialFrame={frame(3, 'TRUTH')} maxSequence={4} onSeek={sequence => frame(sequence, 'TRUTH')} onPerspectiveChange={onPerspectiveChange} onTrace={onTrace} />);
  expect(screen.getByRole('status', { name: 'Перспектива реплея' }).textContent).toContain('Истинное состояние');
  expect(screen.getByRole('status', { name: 'Перспектива реплея' }).textContent).toContain('постоянная метка');
  fireEvent.change(screen.getByLabelText('Перспектива'), { target: { value: 'PARTICIPANT' } });
  expect(onPerspectiveChange).toHaveBeenCalledWith('PARTICIPANT');
  fireEvent.click(screen.getByRole('button', { name: 'Причины события event-3' }));
  expect(onTrace).toHaveBeenCalledWith('event-3');
});
