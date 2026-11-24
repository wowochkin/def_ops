import { expect, it } from 'vitest';
import { planUpdate, runSafeUpdate, type UpdatePorts, type UpdatePostChecks } from '../src/admin/update-service';

const migration = {
  version: '2.0.0', rollbackApplicationVersion: '1.4.0', incompatible: true,
  rewritesHistoricalPayload: false, migrationProtocolId: null, sourceArchiveId: null,
};
const passing: UpdatePostChecks = { archives: true, projections: true, environment: true, documents: true, controlCalculation: true };

function ports(calls: string[], postChecks = passing): UpdatePorts {
  return {
    pauseSession: async () => { calls.push('pause'); },
    createSnapshot: async () => { calls.push('snapshot'); return { snapshotId: 'snapshot-1' }; },
    verifySnapshot: async id => { calls.push(`verify:${id}`); return true; },
    createFullBackup: async () => { calls.push('full-backup'); return { backupId: 'backup-1' }; },
    testMigrationOnCopy: async () => { calls.push('copy-test'); },
    checkCompatibility: async () => { calls.push('compatibility'); },
    appendJournal: async () => { calls.push('journal'); return 'event-update-1'; },
    applyMigration: async () => { calls.push('migrate'); },
    runPostChecks: async () => { calls.push('post-checks'); return postChecks; },
    rollback: async () => { calls.push('rollback'); },
    resumeSession: async () => { calls.push('resume'); },
  };
}

it('запрещает обновление активного сеанса без аварийной процедуры', () => {
  expect(planUpdate({ active: true, mode: 'OFFICIAL', emergency: false })).toEqual({ allowed: false, reason: 'Активный официальный сеанс' });
  expect(planUpdate({ active: true, mode: 'TRAINING', emergency: false }).allowed).toBe(false);
  expect(planUpdate({ active: false, mode: 'OFFICIAL', emergency: false }).allowed).toBe(true);
});

it('реально выполняет pause, snapshot, backup, copy-test, migration и post-checks через порты', async () => {
  const calls: string[] = [];
  const report = await runSafeUpdate({ session: { active: true, mode: 'OFFICIAL', emergency: true }, migration }, ports(calls));
  expect(report).toMatchObject({ status: 'COMPLETED', snapshotId: 'snapshot-1', backupId: 'backup-1', journalEventId: 'event-update-1', postChecks: passing });
  expect(calls).toEqual(['pause', 'snapshot', 'verify:snapshot-1', 'full-backup', 'copy-test', 'compatibility', 'journal', 'migrate', 'post-checks', 'resume']);
});

it('откатывает применённую миграцию при неуспешном контрольном примере', async () => {
  const calls: string[] = [];
  await expect(runSafeUpdate(
    { session: { active: true, mode: 'OFFICIAL', emergency: true }, migration },
    ports(calls, { ...passing, controlCalculation: false }),
  )).rejects.toThrow('контрольного примера');
  expect(calls).toContain('rollback');
  expect(calls.at(-1)).toBe('resume');
  expect(calls).not.toContain('COMPLETED');
});

it('не применяет миграцию, если фактическая проверка снимка не прошла', async () => {
  const calls: string[] = [];
  const failing = { ...ports(calls), verifySnapshot: async () => { calls.push('snapshot-invalid'); return false; } };
  await expect(runSafeUpdate({ session: { active: true, mode: 'OFFICIAL', emergency: true }, migration }, failing)).rejects.toThrow(/снимк/);
  expect(calls).not.toContain('migrate');
  expect(calls).toContain('rollback');
});
