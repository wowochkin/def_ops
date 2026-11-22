// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AsyncState, type AsyncStatus } from '../src/modern/kshvi/shared/AsyncState';
import { OfflineBanner } from '../src/modern/kshvi/shared/OfflineBanner';
import { formatBytes, formatDuration, formatNumber, formatRussianDateTime } from '../src/modern/kshvi/shared/format';

afterEach(() => { cleanup(); vi.useRealTimers(); });

const cases: [AsyncStatus, RegExp][] = [
  ['loading', /Загрузка данных/], ['empty', /Ничего не найдено/], ['forbidden', /Недостаточно прав/],
  ['no-data', /Нет данных/], ['unknown', /Неизвестное состояние данных/], ['stale', /Данные устарели/],
  ['partial-error', /Часть данных недоступна/], ['unavailable', /Сервис недоступен/],
];

it('различает все русские состояния и предлагает понятное действие', () => {
  for (const [status, text] of cases) {
    cleanup();
    render(<AsyncState status={status} onRetry={vi.fn()} onReconnect={vi.fn()} onOpenJournal={vi.fn()} />);
    expect(screen.getByText(text)).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
  }
});

it('вызывает повтор, восстановление соединения и переход к журналу', () => {
  const onRetry = vi.fn();
  const onReconnect = vi.fn();
  const onOpenJournal = vi.fn();
  render(<AsyncState status="partial-error" onRetry={onRetry} onReconnect={onReconnect} onOpenJournal={onOpenJournal} />);
  fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
  fireEvent.click(screen.getByRole('button', { name: 'Восстановить соединение' }));
  fireEvent.click(screen.getByRole('button', { name: 'Перейти к журналу' }));
  expect(onRetry).toHaveBeenCalled();
  expect(onReconnect).toHaveBeenCalled();
  expect(onOpenJournal).toHaveBeenCalled();
});

it('показывает период обрыва, последнюю серверную синхронизацию и потерю NTP', () => {
  render(<OfflineBanner connection="OFFLINE" lastSyncedAt="2026-11-22T08:00:00.000Z" outageStartedAt="2026-11-22T07:59:55.000Z" serverTime="2026-11-22T08:00:04.000Z" ntpSynchronized={false} clockOffsetMs={1250} />);
  expect(screen.getByText(/Нет соединения с сервером/)).toBeTruthy();
  expect(screen.getByText(/Период потери связи: 9 с/)).toBeTruthy();
  expect(screen.getByText(/Синхронизация NTP потеряна/)).toBeTruthy();
  expect(screen.getByText(/Расхождение часов: 1250 мс/)).toBeTruthy();
  expect(screen.getByText(/Последняя серверная синхронизация:/)).toBeTruthy();
});

it('увеличивает offline-длительность по таймеру даже без обновления serverTime', () => {
  vi.useFakeTimers();
  render(<OfflineBanner connection="OFFLINE" lastSyncedAt="2026-11-22T08:00:00.000Z" outageStartedAt="2026-11-22T07:59:55.000Z" serverTime="2026-11-22T08:00:04.000Z" ntpSynchronized={false} clockOffsetMs={1250} />);
  expect(screen.getByText(/Период потери связи: 9 с/)).toBeTruthy();
  act(() => { vi.advanceTimersByTime(3000); });
  expect(screen.getByText(/Период потери связи: 12 с/)).toBeTruthy();
});

it('считает длительность только от OFFLINE/serverTime без двойного учёта и роста в ONLINE', () => {
  vi.useFakeTimers();
  const initial = {
    connection: 'ONLINE' as const, lastSyncedAt: '2026-11-22T08:00:00.000Z', outageStartedAt: null,
    serverTime: '2026-11-22T08:00:00.000Z', ntpSynchronized: true, clockOffsetMs: 0,
  };
  const view = render(<OfflineBanner {...initial} />);
  act(() => { vi.advanceTimersByTime(60_000); });
  view.rerender(<OfflineBanner {...initial} connection="OFFLINE" outageStartedAt="2026-11-22T07:59:55.000Z" serverTime="2026-11-22T08:00:04.000Z" />);
  expect(screen.getByText(/Период потери связи: 9 с/)).toBeTruthy();
  act(() => { vi.advanceTimersByTime(3000); });
  expect(screen.getByText(/Период потери связи: 12 с/)).toBeTruthy();
  view.rerender(<OfflineBanner {...initial} connection="OFFLINE" outageStartedAt="2026-11-22T07:59:55.000Z" serverTime="2026-11-22T08:00:07.000Z" />);
  expect(screen.getByText(/Период потери связи: 12 с/)).toBeTruthy();
  act(() => { vi.advanceTimersByTime(2000); });
  expect(screen.getByText(/Период потери связи: 14 с/)).toBeTruthy();
  view.rerender(<OfflineBanner {...initial} outageStartedAt="2026-11-22T07:59:55.000Z" serverTime="2026-11-22T08:00:09.000Z" />);
  expect(screen.getByText(/Период потери связи: 14 с/)).toBeTruthy();
  act(() => { vi.advanceTimersByTime(10_000); });
  expect(screen.getByText(/Период потери связи: 14 с/)).toBeTruthy();
});

it('единообразно форматирует русские даты, числа, длительность и единицы', () => {
  expect(formatRussianDateTime('2026-11-22T08:00:00.000Z')).toContain('22.11.2026');
  expect(formatNumber(12345.6)).toBe('12 345,6');
  expect(formatDuration(5000)).toBe('5 с');
  expect(formatBytes(1536)).toBe('1,5 КиБ');
});
