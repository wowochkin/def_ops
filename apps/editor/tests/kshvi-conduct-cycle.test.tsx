// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { TraineeWorkspace } from '../src/modern/kshvi/conduct/TraineeWorkspace';
import { LeaderWorkspace } from '../src/modern/kshvi/conduct/LeaderWorkspace';
import { kshviCommands, kshviProjection } from './kshvi-fixtures';

afterEach(cleanup);

it('G2 UI: решение, просмотр прошлого и отмена не меняют официальные часы и затраты напрямую', async () => {
  const cancelOrder = vi.fn().mockImplementation(async ({ orderId }) => ({ ...kshviProjection().order!, id: orderId, status: 'CANCELLED_AFTER_RECEIPT' }));
  render(<TraineeWorkspace projection={kshviProjection()} commands={kshviCommands({ cancelOrder })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Просмотреть событие event-1' }));
  expect(screen.getByText('Режим просмотра прошлого')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('Причина отмены'), { target: { value: 'Корректировка G2' } });
  fireEvent.click(screen.getByRole('button', { name: 'Отменить приказ' }));
  expect(cancelOrder).toHaveBeenCalledWith({ orderId: 'order-1', reason: 'Корректировка G2' });
  await waitFor(() => expect(screen.getByText(/CANCELLED_AFTER_RECEIPT/)).toBeTruthy());
  expect(screen.getByText('10 мин')).toBeTruthy();
  expect(screen.getByText('Официальное время: 2030-01-01T02:00:00Z')).toBeTruthy();
});

it('G2 UI: отклонённая критическая команда не считается применённой', async () => {
  const executeCritical = vi.fn().mockRejectedValue(new Error('Команда не отправлялась: требуется серверное подтверждение'));
  render(<LeaderWorkspace projection={kshviProjection()} commands={kshviCommands({ executeCritical })} />);
  fireEvent.click(screen.getByRole('button', { name: 'Общий отбой' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить: Общий отбой' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('Команда не отправлялась'));
  expect(screen.queryByText(/Серверная ревизия .*зафиксирован/)).toBeNull();
});
