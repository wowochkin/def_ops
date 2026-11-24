import { expect, it } from 'vitest';
import { assertRestartAllowed, runPreflight } from '../src/admin/preflight-check';
import { IncidentService } from '../src/admin/incident-service';

const passing = {
  disk: { freeBytes: 500_000_000, requiredBytes: 100_000_000 },
  backups: { verified: true, trialRestorePassed: true },
  certificate: { valid: true, expiresAt: '2027-01-01T00:00:00.000Z' },
  time: { ntpSynchronized: true, offsetMs: 20 },
  localResources: { allAvailable: true, externalUrls: [] as string[] },
  workstations: { available: 25, required: 25 },
  printing: { passed: true },
};

it('выполняет предстартовый контроль диска, копий, сертификата, NTP, ресурсов, мест, восстановления и печати', () => {
  const report = runPreflight(passing, { now: '2026-11-22T08:00:00.000Z', maxClockOffsetMs: 500 });
  expect(report.ready).toBe(true);
  expect(report.checks.map(check => check.code).sort()).toEqual(['BACKUPS', 'CERTIFICATE', 'DISK', 'LOCAL_RESOURCES', 'NTP', 'PRINTING', 'TRIAL_RESTORE', 'WORKSTATIONS']);

  const degraded = runPreflight({
    ...passing,
    disk: { freeBytes: 10, requiredBytes: 100 },
    time: { ntpSynchronized: false, offsetMs: 1500 },
    localResources: { allAvailable: false, externalUrls: ['https://example.invalid/font.ttf'] },
  }, { now: '2026-11-22T08:00:00.000Z', maxClockOffsetMs: 500 });
  expect(degraded.ready).toBe(false);
  expect(degraded.checks.filter(check => check.status === 'FAIL').map(check => check.code)).toEqual(expect.arrayContaining(['DISK', 'NTP', 'LOCAL_RESOURCES']));
  expect(JSON.stringify(degraded)).not.toContain('Скрытый замысел');
});

it('защищает активный официальный сеанс от обычной перезагрузки', () => {
  expect(() => assertRestartAllowed({ activeOfficialSession: true, directorConfirmed: false, emergency: false, emergencyReason: null })).toThrow('руководителя');
  expect(() => assertRestartAllowed({ activeOfficialSession: true, directorConfirmed: true, emergency: false, emergencyReason: null })).not.toThrow();
  expect(() => assertRestartAllowed({ activeOfficialSession: true, directorConfirmed: false, emergency: true, emergencyReason: 'Аварийная изоляция неисправного узла' })).not.toThrow();
});

it('сохраняет факты инцидента и не приравнивает техническое восстановление к методическому разрешению', () => {
  const service = new IncidentService();
  const incident = service.open({ startedAt: '2026-11-22T08:00:00.000Z', scope: 'Узел КШВИ', technicalDescription: 'Потеря соединения с БД', conductImpact: 'Перерыв доставки событий' });
  const recovered = service.completeRecovery(incident.id, { recoveredAt: '2026-11-22T08:04:00.000Z', actions: ['Перезапуск', 'Проверка журнала'], result: 'Последнее событие восстановлено' });
  expect(recovered).toMatchObject({ methodologicalDecision: 'PENDING', interruptionMs: 240_000 });
  expect(recovered.technicalDescription).toBe('Потеря соединения с БД');
  expect(() => service.decideContinuation(incident.id, { actorRole: 'ADMIN', decision: 'ALLOWED', reason: 'Продолжить' })).toThrow('руководитель');
  expect(service.decideContinuation(incident.id, { actorRole: 'DIRECTOR', decision: 'ALLOWED', reason: 'Перерыв не повлиял на условия проверки' }).methodologicalDecision).toBe('ALLOWED');
});
