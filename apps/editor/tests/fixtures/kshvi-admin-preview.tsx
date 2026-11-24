import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { OperationsDashboard } from '../../src/modern/kshvi/admin/OperationsDashboard';
import { AccessibleCommandDialog } from '../../src/modern/kshvi/shared/AccessibleCommandDialog';
import type { OperationsSnapshot } from '../../../../services/kshvi/src/admin/health-service';

const snapshot: OperationsSnapshot = {
  health: 'DEGRADED', readiness: { ready: false, reasons: ['NTP_UNSYNCED'] }, generatedAt: '2026-11-22T08:00:00.000Z',
  services: { kshvi: 'UP', database: 'UP', environment: 'DEGRADED' }, connections: { active: 25, idle: 24, disconnected: 1, total: 50 },
  queues: { events: 12, jobs: 2, heavyJobs: 1 }, latencyMs: { commandP95: 150, sseP95: 800, mapP95: 900 },
  storage: { freeBytes: 500_000_000, journalBytes: 10_000 }, backups: { status: 'VALID', lastVerifiedAt: '2026-11-22T07:55:00.000Z' },
  clock: { serverTime: '2026-11-22T08:00:00.000Z', ntpSynchronized: false, offsetMs: 1200 }, versions: { application: '1.0.0', schema: '1', reducer: '1' },
  errors: [{ code: 'PROJECTION_RETRY', correlationId: 'corr-1' }],
  alerts: [{ code: 'EVENT_QUEUE_HIGH', severity: 'CRITICAL', message: 'Очередь событий превышает порог', correlationId: 'corr-queue' }],
};

function Preview() {
  const [dialog, setDialog] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  return <main>
    <OperationsDashboard snapshot={snapshot} />
    <button onClick={() => setDialog(true)}>Открыть критическую команду</button>
    {confirmed && <p role="status">Команда подтверждена</p>}
    {dialog && <AccessibleCommandDialog title="Аварийная операция" description="Проверка клавиатурного подтверждения" confirmLabel="Подтвердить операцию" confirmationPhrase="ПОДТВЕРЖДАЮ" onConfirm={() => { setConfirmed(true); setDialog(false); }} onCancel={() => setDialog(false)} />}
  </main>;
}

createRoot(document.getElementById('root')!).render(<Preview />);
