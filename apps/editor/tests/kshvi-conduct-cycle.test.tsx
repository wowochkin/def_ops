// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TraineeWorkspace } from '../src/modern/kshvi/conduct/TraineeWorkspace';
import { LeaderWorkspace } from '../src/modern/kshvi/conduct/LeaderWorkspace';

afterEach(cleanup);

it('G2 UI: решение, просмотр прошлого и отмена не меняют официальные часы и затраты напрямую', () => {
  const onCancel = vi.fn();
  render(<TraineeWorkspace onOrderCancel={onCancel} />);
  fireEvent.click(screen.getByRole('button', { name: 'Просмотреть событие' }));
  expect(screen.getByText('Режим просмотра прошлого')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Корректировка G2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить приказ' }));
  expect(onCancel).toHaveBeenCalledWith({ reason: 'Корректировка G2' });
  expect(screen.getByText('10 мин')).toBeTruthy();
  expect(screen.getByText('Официальное время: 2030-01-01T02:00:00Z')).toBeTruthy();
});

it('G2 UI: критическая команда без серверного обработчика явно не считается применённой', () => {
  render(<LeaderWorkspace />);
  fireEvent.click(screen.getByRole('button', { name: 'Общий отбой' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить: Общий отбой' }));
  expect(screen.getByText(/Команда не отправлялась: требуется серверное подтверждение/)).toBeTruthy();
  expect(screen.queryByText(/Серверная ревизия .*зафиксирован/)).toBeNull();
});
