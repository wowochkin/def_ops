export type PreflightInput = Readonly<{
  disk: { freeBytes: number; requiredBytes: number };
  backups: { verified: boolean; trialRestorePassed: boolean };
  certificate: { valid: boolean; expiresAt: string };
  time: { ntpSynchronized: boolean; offsetMs: number };
  localResources: { allAvailable: boolean; externalUrls: readonly string[] };
  workstations: { available: number; required: number };
  printing: { passed: boolean };
}>;
export type PreflightReport = Readonly<{
  ready: boolean;
  checks: readonly { code: string; status: 'PASS' | 'FAIL'; message: string }[];
}>;

export function runPreflight(input: PreflightInput, options: { now: string; maxClockOffsetMs: number }): PreflightReport {
  const checks = [
    { code: 'DISK', passed: input.disk.freeBytes >= input.disk.requiredBytes, message: 'Свободное место на диске' },
    { code: 'BACKUPS', passed: input.backups.verified, message: 'Хеши резервных копий проверены' },
    { code: 'CERTIFICATE', passed: input.certificate.valid && Date.parse(input.certificate.expiresAt) > Date.parse(options.now), message: 'Локальный TLS-сертификат действителен' },
    { code: 'NTP', passed: input.time.ntpSynchronized && Math.abs(input.time.offsetMs) <= options.maxClockOffsetMs, message: 'Локальное NTP-время синхронизировано' },
    { code: 'LOCAL_RESOURCES', passed: input.localResources.allAvailable && input.localResources.externalUrls.length === 0, message: 'Все ресурсы доступны локально' },
    { code: 'WORKSTATIONS', passed: input.workstations.available >= input.workstations.required, message: 'Рабочие места доступны' },
    { code: 'TRIAL_RESTORE', passed: input.backups.trialRestorePassed, message: 'Пробное восстановление выполнено' },
    { code: 'PRINTING', passed: input.printing.passed, message: 'Локальная печать проверена' },
  ].map(check => ({ code: check.code, status: check.passed ? 'PASS' as const : 'FAIL' as const, message: check.passed ? check.message : `${check.message}: проверка не пройдена` }));
  return { ready: checks.every(check => check.status === 'PASS'), checks };
}

export function assertRestartAllowed(input: {
  activeOfficialSession: boolean;
  directorConfirmed: boolean;
  emergency: boolean;
  emergencyReason: string | null;
}): void {
  if (!input.activeOfficialSession || input.directorConfirmed) return;
  if (input.emergency && input.emergencyReason?.trim()) return;
  if (input.emergency) throw new Error('Аварийная перезагрузка требует указания причины');
  throw new Error('Перезагрузка активного официального сеанса требует подтверждения руководителя');
}
