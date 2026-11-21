import { expect, it } from 'vitest';
import { SecurityAudit } from '../src/auth/security-audit';

it('создаёт append-only хеш-цепочку без payload, паролей и токенов', () => {
  const audit = new SecurityAudit({ now: () => new Date('2026-11-22T08:00:00.000Z') });
  audit.append({
    actorId: 'admin-1', organizationId: 'org-1', action: 'login.failed', outcome: 'DENIED',
    correlationId: 'corr-1', resourceType: 'session', resourceId: 'session-1',
    payload: { intent: 'Скрытый замысел' }, password: 'secret-password', token: 'secret-token',
  });
  audit.append({ actorId: 'admin-1', organizationId: 'org-1', action: 'backup.created', outcome: 'ALLOWED', correlationId: 'corr-2' });
  const snapshot = audit.entries();
  expect(snapshot).toHaveLength(2);
  expect(snapshot[0].sequence).toBe(1);
  expect(snapshot[1].prevHash).toBe(snapshot[0].hash);
  expect(audit.verify()).toEqual([]);
  const serialized = JSON.stringify(snapshot);
  expect(serialized).not.toContain('Скрытый замысел');
  expect(serialized).not.toContain('secret-password');
  expect(serialized).not.toContain('secret-token');
  expect(serialized).not.toContain('payload');

  Reflect.set(snapshot[0], 'action', 'tampered');
  expect(audit.entries()[0].action).toBe('login.failed');
  expect(audit.verify([{ ...audit.entries()[0], action: 'tampered' }])).toContain('HASH:1');
});

it('аудирует экспорт аудита и сохраняет записи после запроса удаления', () => {
  const audit = new SecurityAudit({ now: () => new Date('2026-11-22T08:00:00.000Z') });
  audit.append({ actorId: 'admin-1', organizationId: 'org-1', action: 'deletion.requested', outcome: 'ALLOWED', correlationId: 'del-1', resourceId: 'exercise-1' });
  const exported = audit.export('security-2', 'org-1', 'export-1');
  expect(exported.at(-1)?.action).toBe('audit.exported');
  expect(exported[0].action).toBe('deletion.requested');
  expect(audit.entries().map(event => event.action)).toEqual(['deletion.requested', 'audit.exported']);
});
