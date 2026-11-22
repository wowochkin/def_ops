import { expect, it } from 'vitest';
import { SecurityAudit } from '../../src/auth/security-audit';

it('фиксирует обязательные действия безопасности и обнаруживает редактирование цепочки', () => {
  const audit = new SecurityAudit({ now: () => new Date('2026-11-22T08:00:00.000Z') });
  const actions = [
    'login.succeeded', 'login.failed', 'role.changed', 'access.granted', 'access.revoked',
    'admin.content.read', 'configuration.changed', 'backup.created', 'restore.completed', 'export.completed', 'deletion.requested',
  ];
  for (const [index, action] of actions.entries()) audit.append({
    actorId: 'admin', organizationId: 'org-1', action, outcome: action === 'login.failed' ? 'DENIED' : 'ALLOWED', correlationId: `corr-${index}`,
  });
  expect(audit.entries().map(event => event.action)).toEqual(actions);
  expect(audit.verify()).toEqual([]);
  const tampered = audit.entries();
  tampered[4] = { ...tampered[4]!, outcome: 'DENIED' };
  expect(audit.verify(tampered)).toContain('HASH:5');
  tampered.splice(2, 1);
  expect(audit.verify(tampered)).toContain('SEQUENCE:4');
});
