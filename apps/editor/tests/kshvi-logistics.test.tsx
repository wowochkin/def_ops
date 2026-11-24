// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { LogisticsStep } from '../src/modern/kshvi/preparation/LogisticsStep';

afterEach(cleanup);

const props = {
  requests: [
    { id: 'Заявка 1', resourceId: 'ГСМ', priority: 10, quantity: 100, allocatedQuantity: 60, deficit: 40, status: 'PARTIALLY_ALLOCATED' },
  ],
  movements: [
    { id: 'Поставка 1', status: 'DELAYED', sentQuantity: 60, deliveredQuantity: 0, delayMinutes: 30, remainingMeters: 1200 },
  ],
  balances: [
    { resourceId: 'ГСМ', expected: 120, actual: 120, onHand: 70, inTransit: 30, consumed: 15, lost: 5, deficit: 5 },
  ],
  repairs: [
    { id: 'Ремонт 1', equipmentId: 'Машина 4', status: 'AWAITING_EVACUATION', evacuationRequired: true },
  ],
};

it('показывает дефицит, путь поставки, баланс и эвакуацию', () => {
  render(<LogisticsStep {...props} />);
  expect(screen.getByRole('heading', { name: 'Материально-техническое обеспечение' })).toBeTruthy();
  expect(screen.getByText('Отправлено: 60; подтверждено: 0')).toBeTruthy();
  expect(screen.getByText('Дефицит: 40')).toBeTruthy();
  expect(screen.getByText('Остаток пути: 1200 м; задержка: 30 мин')).toBeTruthy();
  expect(screen.getByText('Баланс: 120 / 120')).toBeTruthy();
  expect(screen.getByText('Требуется эвакуация')).toBeTruthy();
});

it('не выдает отправку за поступление при команде продвижения', () => {
  const onAdvanceSupply = vi.fn();
  render(<LogisticsStep {...props} onAdvanceSupply={onAdvanceSupply} />);
  fireEvent.click(screen.getByRole('button', { name: 'Продвинуть поставку Поставка 1' }));
  expect(onAdvanceSupply).toHaveBeenCalledWith('Поставка 1');
  expect(screen.getByText('Отправлено: 60; подтверждено: 0')).toBeTruthy();
});
