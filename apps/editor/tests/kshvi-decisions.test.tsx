// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { DecisionEditor } from '../src/modern/kshvi/conduct/DecisionEditor';
import { OrdersPanel } from '../src/modern/kshvi/conduct/OrdersPanel';

afterEach(cleanup);

it('редактор решения поддерживает девять элементов без кнопки эталона и автопобедителя', () => {
  const onChange = vi.fn();
  render(<DecisionEditor onChange={onChange} />);
  expect(screen.getByRole('heading', { name: 'Решение обучаемого' })).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /Отметить/ })).toHaveLength(9);
  fireEvent.click(screen.getByRole('button', { name: 'Отметить: корректировка решения' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ element: 'DECISION_ADJUSTMENT' }));
  fireEvent.click(screen.getByRole('button', { name: 'Отметить: получение и уточнение задачи' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ element: 'TASK_CLARIFICATION' }));
  expect(screen.queryByText(/эталон/i)).toBeNull();
  expect(screen.queryByText(/победитель/i)).toBeNull();
});

it('панель приказа показывает этапы, причину отмены и не стирает понесённые затраты', () => {
  const onCancel = vi.fn();
  render(<OrdersPanel order={{
    id: 'order-1', status: 'EXECUTING', receivedAt: '2030-01-01T01:05:00Z',
    actualCosts: { timeMinutes: 10, resources: { fuel: 2 } },
    position: { remainingMeters: 4000, travelledMeters: 1000 },
  }} onCancel={onCancel} />);
  for (const label of ['Доставка', 'Обработка', 'Подготовка', 'Исполнение', 'Доклад']) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByText('10 мин')).toBeTruthy();
  expect(screen.getByText('fuel: 2')).toBeTruthy();
  expect(screen.getByText('Пройдено: 1000 м; осталось: 4000 м')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Новая вводная' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить приказ' }));
  expect(onCancel).toHaveBeenCalledWith({ reason: 'Новая вводная' });
  expect(screen.getByText('10 мин')).toBeTruthy();
});
