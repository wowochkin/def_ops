import { expect, it } from 'vitest';
import { auditRecord } from '../../src/auth/audit';
import { SecurityAudit } from '../../src/auth/security-audit';
import { MetricsService } from '../../src/admin/metrics-service';

it('не сохраняет пароли, токены и закрытое содержание в технических записях и метриках', () => {
  const secrets = ['secret-password', 'raw-token', 'Скрытая обстановка'];
  const audit = auditRecord({ actorId: 'admin', action: 'document.read', correlationId: 'corr-1', password: secrets[0], token: secrets[1], content: secrets[2] });
  const metrics = new MetricsService();
  metrics.record({
    correlationId: 'corr-1', action: 'document.read', durationMs: 5, queueDepth: 0, sseDeliveryMs: 2,
    projectionErrors: 0, calculationMs: 1, journalBytes: 100, backupBytes: 50, componentVersion: '1.0.0',
    password: secrets[0], token: secrets[1], payload: secrets[2],
  });
  for (const serialized of [JSON.stringify(audit), JSON.stringify(metrics.trace('corr-1'))]) {
    for (const secret of secrets) expect(serialized).not.toContain(secret);
  }
  expect(metrics.trace('corr-1')[0]).toMatchObject({ correlationId: 'corr-1', durationMs: 5 });
});

it('сохраняет только разрешённые поля append-only аудита и аудирует его экспорт', () => {
  const audit = new SecurityAudit();
  audit.append({ actorId: 'admin', organizationId: 'org-1', action: 'login.failed', outcome: 'DENIED', correlationId: 'corr-2', password: 'secret-password', payload: 'Скрытая обстановка' });
  const exported = audit.export({ userId: 'security-officer', organizationId: 'org-1', technicalPermissions: ['audit.export'] }, 'corr-3');
  expect(exported.at(-1)?.action).toBe('audit.exported');
  expect(JSON.stringify(exported)).not.toContain('secret-password');
  expect(JSON.stringify(exported)).not.toContain('Скрытая обстановка');
  expect(audit.verify()).toEqual([]);
});
