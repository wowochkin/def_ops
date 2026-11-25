// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExerciseClient } from '../src/modern/kshvi/kshvi-api';
import { KshviView } from '../src/modern/kshvi/KshviView';

const exercise = {
  id: 'e1', title: 'Сквозное учение', revision: 2, state: 'SEALED', validation: 'OK', scale: 'operational', purpose: 'planned',
  ownerId: 'leader-1', startsAt: null, endsAt: null, readiness: 100, archivedAt: null, createdAt: '2030-01-01T00:00:00Z',
  updatedAt: '2030-01-01T00:00:00Z', lastSessionId: null,
};
const activeSession = {
  id: 's1', exerciseId: 'e1', scenarioRevisionId: 'r2', revision: 2, state: 'ACTIVE', mode: 'NETWORK', authority: 'SERVER',
  confirmedRevision: 0, createdBy: 'leader-1', createdAt: '2030-01-01T00:00:00Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('ведёт выбранное учение через подготовку, серверные состояния, реплей, разбор, архив, показ и администрирование', async () => {
  let session = { ...activeSession };
  let archived = false;
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url.includes('/auth/me')) return json({ userId: 'leader-1', activeRole: 'LEADER', organizationId: 'org-1', authorities: [] });
    if (url.endsWith('/exercises') || url.includes('/exercises?')) return json({ items: archived ? [] : [exercise] });
    if (url.endsWith('/exercises/e1')) return json({ ...exercise, payloadAccess: 'PROJECTED', revisions: [], sessions: [] });
    if (url.endsWith('/exercises/e1/sessions') && method === 'POST') return json(session, 201);
    if (url.endsWith('/sessions/s1/commands')) {
      const command = JSON.parse(String(init?.body)).command as string;
      session = { ...session, state: command === 'PAUSE' ? 'PAUSED' : command === 'RESUME' ? 'ACTIVE' : 'COMPLETED', confirmedRevision: session.confirmedRevision + 1 };
      return json(session);
    }
    if (url.endsWith('/sessions/s1/replay?cursor=3&perspective=PARTICIPANT')) return json({
      sequence: 3, operationalAt: '2030-01-01T03:00:00Z', wallClockAt: '2030-01-01T09:00:00Z', perspective: 'PARTICIPANT',
      source: 'RECORDED_PARTICIPANT_PROJECTION', stateHash: 'a'.repeat(64), domains: { Map: { sequence: 3 }, Weather: { sequence: 3 } },
      events: [{ eventId: 'event-3', type: 'time.change', sequence: 3 }], maxSequence: 3,
    });
    if (url.endsWith('/sessions/s1/debrief?scope=GENERAL')) return json({ scope: 'GENERAL', revision: 2, audience: ['GENERAL'], referenceIntent: 'Замысел руководства' });
    if (url.endsWith('/archives') && method === 'POST') return json({ archiveId: 'archive-s1', manifestSha256: 'b'.repeat(64), mode: 'AUTONOMOUS', missing: [] }, 201);
    if (url.endsWith('/exercises/e1/archive')) { archived = true; return json({ ...exercise, payloadAccess: 'PROJECTED', revisions: [], sessions: [], state: 'ARCHIVED', archivedAt: '2030-01-01T10:00:00Z' }); }
    if (url.endsWith('/expositions/archive-s1')) return json({ demo: false });
    if (url.endsWith('/admin/overview')) return json({ accounts: [], assignments: [], events: [], versions: [], datasets: [], retention: { activeDays: 30, archiveDays: 365, backupDays: 90, auditDays: 730, allowedMedia: ['encrypted-local-disk'], responsibleUserIds: ['security-1'] }, snapshot: { health: 'HEALTHY', readiness: { ready: true, reasons: [] }, generatedAt: '2030-01-01T10:00:00Z', services: { kshvi: 'UP', database: 'UP', environment: 'UP' }, connections: { active: 1, idle: 0, disconnected: 0, total: 1 }, queues: { events: 0, jobs: 0, heavyJobs: 0 }, latencyMs: { commandP95: 1, sseP95: 1, mapP95: 1 }, storage: { freeBytes: 1024, journalBytes: 128 }, backups: { status: 'VALID', lastVerifiedAt: '2030-01-01T09:00:00Z' }, clock: { serverTime: '2030-01-01T10:00:00Z', ntpSynchronized: true, offsetMs: 0 }, versions: { kshvi: '1' }, errors: [], alerts: [] } });
    throw new Error(`Неожиданный запрос ${method} ${url}`);
  });
  const client = new ExerciseClient({ fetch: fetcher, csrfToken: () => 'csrf' });
  render(<KshviView client={client} role="LEADER" authorities={['exercise:read', 'exercise:conduct', 'exercise:archive', 'TRUTH_READ', 'archive.export', 'kshvi:admin']} />);

  fireEvent.click(await screen.findByRole('button', { name: 'Запустить учение Сквозное учение' }));
  expect(await screen.findByRole('heading', { name: 'Проверка перед запуском' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Запустить учение' }));
  expect(await screen.findByRole('heading', { name: 'Руководитель учения' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить: Пауза' }));
  await waitFor(() => expect(session.state).toBe('PAUSED'));
  fireEvent.click(screen.getByRole('button', { name: 'Продолжить' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить: Продолжить' }));
  await waitFor(() => expect(session.state).toBe('ACTIVE'));
  fireEvent.click(screen.getByRole('button', { name: 'Завершение' }));
  fireEvent.click(screen.getByRole('button', { name: 'Подтвердить: Завершение' }));
  await waitFor(() => expect(session.state).toBe('COMPLETED'));

  fireEvent.click(screen.getByRole('button', { name: 'Реплей' }));
  expect(await screen.findByRole('heading', { name: 'Синхронизированный реплей' })).toBeTruthy();
  expect(screen.queryByText('Скрытый эталон')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Разбор' }));
  expect(await screen.findByRole('heading', { name: 'Общий разбор' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Оценка с доказательствами' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Архивировать и перейти в архив' }));
  expect(await screen.findByRole('heading', { name: 'Архив archive-s1' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Показ' }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/expositions/archive-s1'), expect.anything()));
  fireEvent.click(screen.getByRole('button', { name: 'Администрирование' }));
  expect(await screen.findByRole('heading', { name: 'Техническая эксплуатация' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: 'Локальные учётные записи' })).toBeTruthy();
  expect(screen.queryByText(/Раздел открыт по назначенному сервером полномочию/)).toBeNull();
});
