export type MigrationPlan = Readonly<{
  version: string;
  testedOnCopy: boolean;
  rollbackApplicationVersion: string;
  incompatible: boolean;
  fullBackupId: string | null;
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

export function planUpdate(session: { active: boolean; mode: 'DEMONSTRATION' | 'TRAINING' | 'OFFICIAL'; emergency: boolean }): { allowed: boolean; reason?: string } {
  if (session.active && !session.emergency) return { allowed: false, reason: session.mode === 'OFFICIAL' ? 'Активный официальный сеанс' : 'Активный сеанс' };
  return { allowed: true };
}

export function assertMigrationPlan(plan: MigrationPlan): void {
  if (!plan.testedOnCopy) throw new Error('Миграция должна быть проверена на копии');
  if (!plan.rollbackApplicationVersion) throw new Error('Требуется план отката приложения');
  if (plan.incompatible && !plan.fullBackupId) throw new Error('Перед несовместимой миграцией нужна полная копия');
  if (plan.rewritesHistoricalPayload && (!plan.migrationProtocolId || !plan.sourceArchiveId)) {
    throw new Error('Перезапись исторических payload требует протокол миграции и исходный архив');
  }
}

export function runSafeUpdate(input: {
  session: { active: boolean; mode: 'DEMONSTRATION' | 'TRAINING' | 'OFFICIAL'; emergency: boolean };
  emergencyProcedure: { paused: boolean; snapshotVerified: boolean; compatibilityChecked: boolean; journalEventId: string | null };
  migration: MigrationPlan;
  postChecks: UpdatePostChecks;
}): { status: 'COMPLETED'; migrationVersion: string; postChecks: UpdatePostChecks; journalEventId: string | null } {
  const plan = planUpdate(input.session);
  if (!plan.allowed) throw new Error(`Обновление запрещено: ${plan.reason ?? 'активный сеанс'}`);
  assertMigrationPlan(input.migration);
  if (input.session.active) {
    const procedure = input.emergencyProcedure;
    if (!procedure.paused) throw new Error('Аварийное обновление: пауза сеанса обязательна');
    if (!procedure.snapshotVerified) throw new Error('Аварийное обновление требует проверенный снимок');
    if (!procedure.compatibilityChecked) throw new Error('Совместимость обновления не проверена');
    if (!procedure.journalEventId) throw new Error('Аварийная процедура должна быть записана в журнал');
  }
  for (const [check, passed] of Object.entries(input.postChecks)) {
    if (!passed) throw new Error(check === 'controlCalculation' ? 'Не пройден повторный расчёт контрольного примера' : `После обновления не пройдена проверка: ${check}`);
  }
  return { status: 'COMPLETED', migrationVersion: input.migration.version, postChecks: input.postChecks, journalEventId: input.emergencyProcedure.journalEventId };
}
