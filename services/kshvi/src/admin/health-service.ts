export type ServiceState = 'UP' | 'DEGRADED' | 'DOWN';
export type TechnicalAlert = Readonly<{
  code: string;
  severity: 'WARNING' | 'CRITICAL';
  message: string;
  correlationId: string;
}>;
export type HealthInput = Readonly<{
  services: { kshvi: ServiceState; database: ServiceState; environment: ServiceState };
  connections: { active: number; idle: number; disconnected: number };
  queues: { events: number; jobs: number; heavyJobs: number };
  latencyMs: { commandP95: number; sseP95: number; mapP95: number };
  storage: { freeBytes: number; journalBytes: number };
  backups: { status: 'VALID' | 'STALE' | 'FAILED'; lastVerifiedAt: string | null };
  clock: { serverTime: string; ntpSynchronized: boolean; offsetMs: number };
  versions: Record<string, string>;
  errors: readonly { code: string; correlationId: string }[];
}>;
export type OperationsSnapshot = Readonly<{
  health: 'HEALTHY' | 'DEGRADED' | 'DOWN';
  readiness: { ready: boolean; reasons: readonly string[] };
  generatedAt: string;
  services: HealthInput['services'];
  connections: HealthInput['connections'] & { total: number };
  queues: HealthInput['queues'];
  latencyMs: HealthInput['latencyMs'];
  storage: HealthInput['storage'];
  backups: HealthInput['backups'];
  clock: HealthInput['clock'];
  versions: Record<string, string>;
  errors: readonly { code: string; correlationId: string }[];
  alerts: readonly TechnicalAlert[];
}>;

export class HealthService {
  constructor(private readonly limits: { eventQueueThreshold: number; maxClockOffsetMs: number }) {}

  evaluate(value: HealthInput & Record<string, unknown>): OperationsSnapshot {
    const alerts: TechnicalAlert[] = [];
    const reasons: string[] = [];
    for (const [service, state] of Object.entries(value.services)) {
      if (state === 'UP') continue;
      const code = `${service.toUpperCase()}_${state}`;
      reasons.push(code);
      alerts.push({
        code, severity: state === 'DOWN' ? 'CRITICAL' : 'WARNING', correlationId: `health:${service}`,
        message: service === 'environment'
          ? state === 'DOWN' ? 'Адаптер среды недоступен' : 'Адаптер среды работает с ограничениями'
          : `${service}: ${state === 'DOWN' ? 'недоступен' : 'работает с ограничениями'}`,
      });
    }
    if (value.queues.events > this.limits.eventQueueThreshold) {
      alerts.push({ code: 'EVENT_QUEUE_HIGH', severity: 'CRITICAL', message: 'Очередь событий превышает порог', correlationId: 'queue:events' });
    }
    if (!value.clock.ntpSynchronized) {
      reasons.push('NTP_UNSYNCED');
      alerts.push({ code: 'NTP_UNSYNCED', severity: 'CRITICAL', message: 'Синхронизация времени потеряна', correlationId: 'clock:ntp' });
    }
    if (Math.abs(value.clock.offsetMs) > this.limits.maxClockOffsetMs) {
      reasons.push('CLOCK_SKEW');
      alerts.push({ code: 'CLOCK_SKEW', severity: 'CRITICAL', message: 'Расхождение часов превышает допустимый порог', correlationId: 'clock:offset' });
    }
    if (value.backups.status !== 'VALID') {
      reasons.push('BACKUP_NOT_VALID');
      alerts.push({ code: 'BACKUP_NOT_VALID', severity: 'CRITICAL', message: 'Резервная копия требует проверки', correlationId: 'backup:latest' });
    }
    const health = Object.values(value.services).some(state => state === 'DOWN')
      ? 'DOWN'
      : alerts.length || Object.values(value.services).some(state => state !== 'UP') ? 'DEGRADED' : 'HEALTHY';
    return {
      health,
      readiness: { ready: reasons.length === 0, reasons },
      generatedAt: value.clock.serverTime,
      services: { ...value.services },
      connections: { ...value.connections, total: value.connections.active + value.connections.idle + value.connections.disconnected },
      queues: { ...value.queues }, latencyMs: { ...value.latencyMs }, storage: { ...value.storage },
      backups: { ...value.backups }, clock: { ...value.clock }, versions: { ...value.versions },
      errors: value.errors.map(error => ({ code: error.code, correlationId: error.correlationId })), alerts,
    };
  }
}
