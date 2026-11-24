import { beforeEach, describe, expect, it } from 'vitest';
import { HealthService } from '../src/admin/health-service';
import { MetricsService, percentile } from '../src/admin/metrics-service';
import { NotificationService } from '../src/admin/notification-service';

const input = {
  services: { kshvi: 'UP' as const, database: 'UP' as const, environment: 'UP' as const },
  connections: { active: 25, idle: 24, disconnected: 1 },
  queues: { events: 2, jobs: 1, heavyJobs: 1 },
  latencyMs: { commandP95: 150, sseP95: 800, mapP95: 900 },
  storage: { freeBytes: 500_000_000, journalBytes: 10_000 },
  backups: { status: 'VALID' as const, lastVerifiedAt: '2026-11-22T07:55:00.000Z' },
  clock: { serverTime: '2026-11-22T08:00:00.000Z', ntpSynchronized: true, offsetMs: 20 },
  versions: { application: '1.0.0', schema: '1', reducer: '1' },
  errors: [{ code: 'NONE', correlationId: 'corr-health' }],
};

describe('health, readiness и технические метрики', () => {
  it('показывает расхождение NTP, перегрузку очереди и недоступность readiness без содержания', () => {
    const service = new HealthService({ eventQueueThreshold: 10, maxClockOffsetMs: 500 });
    expect(service.evaluate(input)).toMatchObject({ health: 'HEALTHY', readiness: { ready: true } });
    const degraded = service.evaluate({
      ...input,
      queues: { ...input.queues, events: 12 },
      clock: { ...input.clock, ntpSynchronized: false, offsetMs: 1200 },
      services: { ...input.services, environment: 'DEGRADED' },
      payload: { intent: 'Скрытый замысел стороны' },
    });
    expect(degraded.health).toBe('DEGRADED');
    expect(degraded.readiness.ready).toBe(false);
    expect(degraded.alerts.map(alert => alert.message)).toContain('Очередь событий превышает порог');
    expect(degraded.alerts.map(alert => alert.code)).toEqual(expect.arrayContaining(['NTP_UNSYNCED', 'CLOCK_SKEW', 'ENVIRONMENT_DEGRADED']));
    expect(JSON.stringify(degraded)).not.toContain('Скрытый замысел');
    expect(JSON.stringify(degraded)).not.toContain('payload');
  });

  it('восстанавливает технический путь по correlationId без секретов и скрытого payload', () => {
    const metrics = new MetricsService();
    metrics.record({
      correlationId: 'corr-1', action: 'command.completed', durationMs: 20, queueDepth: 2,
      sseDeliveryMs: 30, projectionErrors: 0, calculationMs: 5, journalBytes: 1000, backupBytes: 2000,
      componentVersion: '1.0.0', password: 'secret-password', token: 'secret-token', payload: { intent: 'Скрытая вводная' },
    });
    const trace = metrics.trace('corr-1');
    expect(trace[0]).toMatchObject({ correlationId: 'corr-1', durationMs: 20, calculationMs: 5 });
    expect(JSON.stringify(trace)).not.toContain('secret-password');
    expect(JSON.stringify(trace)).not.toContain('secret-token');
    expect(JSON.stringify(trace)).not.toContain('Скрытая вводная');
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
  });
});

describe('приоритетные уведомления', () => {
  let now: Date;
  let service: NotificationService;
  beforeEach(() => {
    now = new Date('2026-11-22T08:00:00.000Z');
    service = new NotificationService({ now: () => now });
  });

  it('группирует повторы, не скрывает критическое без подтверждения и работает без звука', () => {
    const first = service.publish({ recipientId: 'user-1', priority: 'CRITICAL', title: 'Потеряна синхронизация времени', deduplicationKey: 'ntp-user-1', expiresAt: '2026-11-22T08:01:00.000Z' });
    const second = service.publish({ recipientId: 'user-1', priority: 'CRITICAL', title: 'Потеряна синхронизация времени', deduplicationKey: 'ntp-user-1', expiresAt: '2026-11-22T08:02:00.000Z' });
    expect(second.id).toBe(first.id);
    expect(second.groupCount).toBe(2);
    service.setPreferences('user-1', { sound: false, popup: false });
    now = new Date('2026-11-22T08:03:00.000Z');
    expect(service.visibleFor('user-1')).toHaveLength(1);
    expect(service.visibleFor('user-1')[0].groupCount).toBe(2);
    service.acknowledge(first.id, 'user-1');
    expect(service.visibleFor('user-1')).toHaveLength(0);
  });

  it('скрывает истёкшее обычное уведомление и не даёт подтвердить чужое', () => {
    const notification = service.publish({ recipientId: 'user-1', priority: 'NORMAL', title: 'Копия проверена', deduplicationKey: 'backup-1', expiresAt: '2026-11-22T08:01:00.000Z' });
    expect(() => service.acknowledge(notification.id, 'user-2')).toThrow('адресат');
    now = new Date('2026-11-22T08:02:00.000Z');
    expect(service.visibleFor('user-1')).toHaveLength(0);
  });
});
