import { expect, it } from 'vitest';
import { assertMigrationPlan, planUpdate, runSafeUpdate } from '../src/admin/update-service';

const migration = {
  version: '2.0.0', testedOnCopy: true, rollbackApplicationVersion: '1.4.0', incompatible: true,
  fullBackupId: 'backup-full-1', rewritesHistoricalPayload: false, migrationProtocolId: null, sourceArchiveId: null,
};
const postChecks = { archives: true, projections: true, environment: true, documents: true, controlCalculation: true };

it('запрещает обновление активного официального сеанса без аварийной процедуры', () => {
  expect(planUpdate({ active: true, mode: 'OFFICIAL', emergency: false })).toEqual({ allowed: false, reason: 'Активный официальный сеанс' });
  expect(planUpdate({ active: true, mode: 'TRAINING', emergency: false }).allowed).toBe(false);
  expect(planUpdate({ active: false, mode: 'OFFICIAL', emergency: false }).allowed).toBe(true);
});

it('проверяет миграции на копии, откат приложения и запрет перезаписи исторических payload', () => {
  expect(() => assertMigrationPlan({ ...migration, testedOnCopy: false })).toThrow('на копии');
  expect(() => assertMigrationPlan({ ...migration, fullBackupId: null })).toThrow('полная копия');
  expect(() => assertMigrationPlan({ ...migration, rewritesHistoricalPayload: true })).toThrow('протокол');
  expect(() => assertMigrationPlan({
    ...migration, rewritesHistoricalPayload: true, migrationProtocolId: 'protocol-1', sourceArchiveId: 'original-archive-1',
  })).not.toThrow();
});

it('требует паузу, снимок, совместимость, событие журнала и все проверки после аварийного обновления', () => {
  const input = {
    session: { active: true, mode: 'OFFICIAL' as const, emergency: true },
    emergencyProcedure: { paused: true, snapshotVerified: true, compatibilityChecked: true, journalEventId: 'event-update-1' },
    migration, postChecks,
  };
  expect(runSafeUpdate(input)).toMatchObject({ status: 'COMPLETED', postChecks });
  expect(() => runSafeUpdate({ ...input, emergencyProcedure: { ...input.emergencyProcedure, paused: false } })).toThrow('пауза');
  expect(() => runSafeUpdate({ ...input, postChecks: { ...postChecks, controlCalculation: false } })).toThrow('контрольного примера');
});
