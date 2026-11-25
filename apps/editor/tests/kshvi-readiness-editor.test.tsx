// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadinessStep } from '../src/modern/kshvi/preparation/ReadinessStep';

afterEach(cleanup);

const props = {
  stage: { title: 'Обеспечение боевой готовности', startsAt: '2026-11-25T05:00:00Z', dueAt: '2026-11-25T08:00:00Z',
    signal: { id: 'signal-1', receivedAt: null } },
  activities: [{ id: 'deploy', title: 'Занять район', responsibleNodeId: 'hq-blue', dueAt: '2026-11-25T07:00:00Z',
    status: 'IN_PROGRESS' as const, report: null, criterionId: 'c1' }],
  readiness: { status: 'IN_PROGRESS' as const, initialLevel: 0.5, requiredLevel: 1, limitations: [] },
};

it('передаёт фактический доклад и критерий в серверное продвижение', () => {
  const onAdvance = vi.fn();
  render(<ReadinessStep {...props} onAdvance={onAdvance} />);
  fireEvent.change(screen.getByLabelText('Доклад: Занять район'), { target: { value: 'Район занят' } });
  fireEvent.change(screen.getByLabelText('Автор: Занять район'), { target: { value: 'hq-blue' } });
  fireEvent.change(screen.getByLabelText('Время: Занять район'), { target: { value: '2026-11-25T06:00:00Z' } });
  fireEvent.click(screen.getByLabelText('Критерий: Занять район'));
  fireEvent.click(screen.getByRole('button', { name: 'Обновить готовность' }));
  expect(onAdvance).toHaveBeenCalledWith(expect.objectContaining({
    completions: [expect.objectContaining({ activityId: 'deploy', report: expect.objectContaining({ authorId: 'hq-blue', submittedAt: '2026-11-25T06:00:00Z', text: 'Район занят' }) })],
    criteria: { c1: true },
  }));
});
