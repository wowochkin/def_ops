import { randomUUID } from 'node:crypto';
import type { AuditSink, OperationAuditContext } from '../auth/durable-jsonl';

export type MigrationPlan = Readonly<{
  version: string;
  rollbackApplicationVersion: string;
  incompatible: boolean;
  rewritesHistoricalPayload: boolean;
  migrationProtocolId: string | null;
  sourceArchiveId: string | null;
}>;
export type UpdatePostChecks = Readonly<{
  archives: boolean;
  projections: boolean;
  environment: boolean;
  documents: boolean;
  controlCalculation: boolean;
}>;
export type UpdatePorts = Readonly<{
  pauseSession: () => Promise<void>;
  createSnapshot: () => Promise<{ snapshotId: string }>;
  verifySnapshot: (snapshotId: string) => Promise<boolean>;
  createFullBackup: () => Promise<{ backupId: string }>;
  testMigrationOnCopy: (migration: MigrationPlan) => Promise<void>;
  checkCompatibility: (migration: MigrationPlan) => Promise<void>;
  appendJournal: (event: { type: string; migrationVersion: string }) => Promise<string>;
  applyMigration: (migration: MigrationPlan) => Promise<void>;
  runPostChecks: () => Promise<UpdatePostChecks>;
  rollback: (context: { snapshotId: string | null; backupId: string | null; migrationApplied: boolean; rollbackApplicationVersion: string }) => Promise<void>;
  resumeSession: () => Promise<void>;
}>;

export function planUpdate(session: { active: boolean; mode: 'DEMONSTRATION' | 'TRAINING' | 'OFFICIAL'; emergency: boolean }): { allowed: boolean; reason?: string } {
  if (session.active && !session.emergency) return { allowed: false, reason: session.mode === 'OFFICIAL' ? 'Активный официальный сеанс' : 'Активный сеанс' };
  return { allowed: true };
}

export function assertMigrationPlan(plan: MigrationPlan): void {
  if (!plan.rollbackApplicationVersion) throw new Error('Требуется план отката приложения');
  if (plan.rewritesHistoricalPayload && (!plan.migrationProtocolId || !plan.sourceArchiveId)) {
    throw new Error('Перезапись исторических payload требует протокол миграции и исходный архив');
  }
}

export async function runSafeUpdate(input: {
  session: { active: boolean; mode: 'DEMONSTRATION' | 'TRAINING' | 'OFFICIAL'; emergency: boolean };
  migration: MigrationPlan;
  auditContext?: OperationAuditContext;
}, ports: UpdatePorts, audit?: AuditSink): Promise<{
  status: 'COMPLETED';
  migrationVersion: string;
  postChecks: UpdatePostChecks;
  journalEventId: string;
  snapshotId: string;
  backupId: string | null;
}> {
  if (audit && !input.auditContext) throw new Error('Для аудита обновления требуется actor/org операции');
  const plan = planUpdate(input.session);
  if (!plan.allowed) throw new Error(`Обновление запрещено: ${plan.reason ?? 'активный сеанс'}`);
  assertMigrationPlan(input.migration);
  let paused = false;
  let snapshotId: string | null = null;
  let backupId: string | null = null;
  let migrationApplied = false;
  try {
    if (input.session.active) {
      await ports.pauseSession();
      paused = true;
    }
    const snapshot = await ports.createSnapshot();
    snapshotId = snapshot.snapshotId;
    if (!(await ports.verifySnapshot(snapshotId))) throw new Error('Фактическая проверка снимка не прошла');
    if (input.migration.incompatible) backupId = (await ports.createFullBackup()).backupId;
    await ports.testMigrationOnCopy(input.migration);
    await ports.checkCompatibility(input.migration);
    const journalEventId = await ports.appendJournal({ type: 'update.started', migrationVersion: input.migration.version });
    await ports.applyMigration(input.migration);
    migrationApplied = true;
    const postChecks = await ports.runPostChecks();
    for (const [check, passed] of Object.entries(postChecks)) {
      if (!passed) throw new Error(check === 'controlCalculation' ? 'Не пройден повторный расчёт контрольного примера' : `После обновления не пройдена проверка: ${check}`);
    }
    audit?.append({ actorId: input.auditContext!.actorId, organizationId: input.auditContext!.organizationId, action: 'update.completed', outcome: 'ALLOWED', correlationId: journalEventId, resourceId: input.migration.version });
    return { status: 'COMPLETED', migrationVersion: input.migration.version, postChecks, journalEventId, snapshotId, backupId };
  } catch (error) {
    await ports.rollback({ snapshotId, backupId, migrationApplied, rollbackApplicationVersion: input.migration.rollbackApplicationVersion });
    audit?.append({ actorId: input.auditContext!.actorId, organizationId: input.auditContext!.organizationId, action: 'update.rolled_back', outcome: 'DENIED', correlationId: randomUUID(), resourceId: input.migration.version });
    throw error;
  } finally {
    if (paused) await ports.resumeSession();
  }
}
