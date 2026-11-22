// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DecisionEditor } from '../src/modern/kshvi/conduct/DecisionEditor';
import { OrdersPanel } from '../src/modern/kshvi/conduct/OrdersPanel';
import { kshviCommands, kshviProjection } from './kshvi-fixtures';

afterEach(cleanup);

it('редактор решения поддерживает девять элементов без кнопки эталона и автопобедителя', () => {
  const onChange = vi.fn();
  render(<DecisionEditor decision={kshviProjection().decision} commands={kshviCommands()} onChange={onChange} />);
  expect(screen.getByRole('heading', { name: 'Решение обучаемого' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /Отметить/ })).toHaveLength(9);
  fireEvent.click(screen.getByRole('button', { name: 'Отметить: корректировка решения' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ element: 'DECISION_ADJUSTMENT' }));
  fireEvent.click(screen.getByRole('button', { name: 'Отметить: получение и уточнение задачи' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ element: 'TASK_CLARIFICATION' }));
  expect(screen.queryByText(/эталон/i)).toBeNull();
  expect(screen.queryByText(/победитель/i)).toBeNull();
});

it('панель приказа сохраняет затраты и меняет статус только после callback', async () => {
  const order = kshviProjection().order!;
  const cancelOrder = vi.fn().mockResolvedValue({ ...order, status: 'CANCELLED_AFTER_RECEIPT' });
  render(<OrdersPanel order={order} commands={kshviCommands({ cancelOrder })} />);
  for (const label of ['Доставка', 'Обработка', 'Подготовка', 'Исполнение', 'Доклад']) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText('10 мин')).toBeTruthy();
  expect(screen.getByText('fuel: 2')).toBeTruthy();
  expect(screen.getByText('Пройдено: 1000 м; осталось: 4000 м')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Новая вводная' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить приказ' }));
  expect(cancelOrder).toHaveBeenCalledWith({ orderId: 'order-1', reason: 'Новая вводная' });
  await waitFor(() => expect(screen.getByText(/CANCELLED_AFTER_RECEIPT/)).toBeTruthy());
  expect(screen.getByText('10 мин')).toBeTruthy();
});
