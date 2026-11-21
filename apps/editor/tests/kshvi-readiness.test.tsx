// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ReadinessStep } from '../src/modern/kshvi/preparation/ReadinessStep';

afterEach(cleanup);

const props = {
  stage: {
    title: 'Обеспечение боевой готовности',
    startsAt: '2030-01-01 06:00',
    dueAt: '2030-01-01 08:00',
    signal: { id: 'Сигнал 101', receivedAt: null },
  },
  activities: [
    { id: 'a1', title: 'Пополнить запасы', responsibleNodeId: 'Штаб', dueAt: '2030-01-01 07:00', status: 'PARTIAL' as const, report: null },
  ],
  readiness: {
    status: 'PARTIAL' as const,
    initialLevel: 0.4,
    requiredLevel: 0.8,
    limitations: ['SUPPLIES_NOT_REPLENISHED', 'AREA_NOT_OCCUPIED'],
    authorization: { decisionId: 'Решение 7', basis: 'Приказ руководителя 2' },
  },
};

it('показывает отдельный этап, сигнал, сроки, доклады и сохранённые ограничения', () => {
  render(<ReadinessStep {...props} />);
  expect(screen.getByRole('heading', { name: 'Обеспечение боевой готовности' })).toBeTruthy();
  expect(screen.getByText('Сигнал не получен')).toBeTruthy();
  expect(screen.getByText('Начало: 2030-01-01 06:00')).toBeTruthy();
  expect(screen.getByText('Срок: 2030-01-01 08:00')).toBeTruthy();
  expect(screen.getByText('Доклад не получен')).toBeTruthy();
  expect(screen.getByText('SUPPLIES_NOT_REPLENISHED')).toBeTruthy();
  expect(screen.getByText('AREA_NOT_OCCUPIED')).toBeTruthy();
  expect(screen.getByText('Решение 7: Приказ руководителя 2')).toBeTruthy();
});

it('команды этапа не выдают разрешение за завершение мероприятий', () => {
  const onAdvance = vi.fn();
  const onAuthorize = vi.fn();
  render(<ReadinessStep {...props} onAdvance={onAdvance} onAuthorize={onAuthorize} />);
  fireEvent.click(screen.getByRole('button', { name: 'Обновить готовность' }));
  expect(onAdvance).toHaveBeenCalledOnce();
  expect(onAuthorize).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Разрешить частичную готовность' }));
  expect(onAuthorize).toHaveBeenCalledOnce();
  expect(screen.getByText('SUPPLIES_NOT_REPLENISHED')).toBeTruthy();
});
