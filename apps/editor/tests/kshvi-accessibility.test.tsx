// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { OperationsDashboard } from '../src/modern/kshvi/admin/OperationsDashboard';
import { DataSetsPanel } from '../src/modern/kshvi/admin/DataSetsPanel';
import { AccessibleCommandDialog } from '../src/modern/kshvi/shared/AccessibleCommandDialog';
import type { OperationsSnapshot } from '../../../services/kshvi/src/admin/health-service';

afterEach(cleanup);

const snapshot: OperationsSnapshot = {
  health: 'DEGRADED', readiness: { ready: false, reasons: ['NTP_UNSYNCED'] }, generatedAt: '2026-11-22T08:00:00.000Z',
  services: { kshvi: 'UP', database: 'UP', environment: 'DEGRADED' }, connections: { active: 25, idle: 24, disconnected: 1, total: 50 },
  queues: { events: 12, jobs: 2, heavyJobs: 1 }, latencyMs: { commandP95: 150, sseP95: 800, mapP95: 900 },
  storage: { freeBytes: 500_000_000, journalBytes: 10_000 }, backups: { status: 'VALID', lastVerifiedAt: '2026-11-22T07:55:00.000Z' },
  clock: { serverTime: '2026-11-22T08:00:00.000Z', ntpSynchronized: false, offsetMs: 1200 },
  versions: { application: '1.0.0', schema: '1', reducer: '1' }, errors: [{ code: 'PROJECTION_RETRY', correlationId: 'corr-1' }],
  alerts: [{ code: 'EVENT_QUEUE_HIGH', severity: 'CRITICAL', message: 'Очередь событий превышает порог', correlationId: 'corr-queue' }, { code: 'NTP_UNSYNCED', severity: 'CRITICAL', message: 'Синхронизация времени потеряна', correlationId: 'corr-ntp' }],
};

it('показывает технический сбой, NTP и состояние 50 мест без скрытого содержания', () => {
  render(<OperationsDashboard snapshot={snapshot} notifications={[{
    id: 'notice-1', recipientId: 'admin-1', priority: 'CRITICAL', title: 'Проверьте очередь событий', deduplicationKey: 'queue', createdAt: '2026-11-22T08:00:00.000Z',
    expiresAt: '2026-11-22T08:05:00.000Z', groupCount: 3, acknowledgedAt: null,
  }]} onAcknowledge={vi.fn()} />);
  expect(screen.getByText('Очередь событий превышает порог')).toBeTruthy();
  expect(screen.getByText('Синхронизация времени потеряна')).toBeTruthy();
  expect(screen.getByText('Расхождение часов: 1200 мс')).toBeTruthy();
  expect(screen.getByText('50 / 50')).toBeTruthy();
  expect(screen.getByText('Повторов: 3')).toBeTruthy();
  expect(screen.getByText('Критическое')).toBeTruthy();
  expect(screen.queryByText('Скрытый замысел стороны')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить уведомление Проверьте очередь событий' }));
});

it('даёт подтвердить критическую команду клавиатурой и закрыть диалог через Escape', () => {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  render(<AccessibleCommandDialog title="Удаление архива" description="Действие необратимо" confirmLabel="Удалить архив" confirmationPhrase="ПОДТВЕРЖДАЮ" onConfirm={onConfirm} onCancel={onCancel} />);
  const dialog = screen.getByRole('dialog', { name: 'Удаление архива' });
  const confirm = screen.getByRole('button', { name: 'Удалить архив' }) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Введите ПОДТВЕРЖДАЮ'), { target: { value: 'ПОДТВЕРЖДАЮ' } });
  expect(confirm.disabled).toBe(false);
  fireEvent.keyDown(confirm, { key: 'Enter' });
  fireEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(dialog, { key: 'Escape' });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(dialog.getAttribute('aria-modal')).toBe('true');
});

it('показывает источник, версию, лицензию, хеш и пригодность автономного архива', () => {
  render(<DataSetsPanel datasets={[{
    id: 'atlas-training', kind: 'ATLAS', name: 'Учебный атлас', source: 'Локальный сценарный набор', version: '1.0.0', license: 'CC0-1.0',
    sha256: 'a'.repeat(64), attribution: 'Учебный набор КШВИ', offlineReady: true, autonomousArchive: 'LINK_ONLY',
  }]} />);
  expect(screen.getByText('Локальный сценарный набор')).toBeTruthy();
  expect(screen.getByText('CC0-1.0')).toBeTruthy();
  expect(screen.getByText(/Полностью автономное воспроизведение невозможно/)).toBeTruthy();
  expect(screen.getByText('Доступно offline')).toBeTruthy();
});
