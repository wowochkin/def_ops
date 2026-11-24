import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { SecurityAudit } from '../src/auth/security-audit';
import { LocalDirectory } from '../src/auth/local-directory';
import { AccountService } from '../src/auth/account-service';
import { AssignmentService } from '../src/auth/assignment-service';
import { ConfigCatalog } from '../src/admin/config-catalog';

const roots: string[] = [];
function root(): string {
  const value = mkdtempSync(join(tmpdir(), 'kshvi-admin-security-'));
  roots.push(value);
  return value;
}
afterEach(() => { for (const value of roots.splice(0)) rmSync(value, { recursive: true, force: true }); });

const director = { userId: 'director-1', organizationId: 'org-1', domainPermissions: ['assignment.manage'] } as const;
const assignmentInput = {
  userId: 'user-1', organizationId: 'org-1', instanceId: 'instance-1', postId: 'commander-blue', role: 'TRAINEE',
  sideId: 'blue', areaId: 'area-1', sessionMode: 'OFFICIAL' as const,
  validFrom: '2026-11-22T07:00:00.000Z', validUntil: '2026-11-22T12:00:00.000Z',
  allowedActions: ['document.read'], substituteUserId: 'user-2', critical: true,
};
const blueScope = () => ({ organizationId: 'org-1', instanceId: 'instance-1', sideId: 'blue', areaId: 'area-1' });

describe('регрессии независимой ревизии авторизации', () => {
  it('требует audit.export и возвращает только записи своей организации', () => {
    const audit = new SecurityAudit();
    audit.append({ actorId: 'a1', organizationId: 'org-1', action: 'login.succeeded', outcome: 'ALLOWED', correlationId: 'c1' });
    audit.append({ actorId: 'a2', organizationId: 'org-2', action: 'login.succeeded', outcome: 'ALLOWED', correlationId: 'c2' });
    expect(() => audit.export({ userId: 'a1', organizationId: 'org-1', technicalPermissions: [] }, 'export-denied')).toThrow('audit.export');
    const exported = audit.export({ userId: 'a1', organizationId: 'org-1', technicalPermissions: ['audit.export'] }, 'export-allowed');
    expect(exported.every(event => event.organizationId === 'org-1')).toBe(true);
    expect(exported.map(event => event.action)).toEqual(['login.succeeded', 'audit.export.denied', 'audit.exported']);
    expect(audit.entries().some(event => event.organizationId === 'org-2')).toBe(true);
  });

  it('вычисляет обязательный scope из ресурса и игнорирует подменённые поля запроса', () => {
    const service = new AssignmentService({ now: () => new Date('2026-11-22T08:00:00.000Z') });
    service.assign(director, assignmentInput);
    const request = {
      action: 'document.read', organizationId: 'org-1', instanceId: 'instance-1', resourceId: 'document-1',
      sideId: 'blue', areaId: 'area-1',
    };
    expect(service.authorize('user-1', request).allowed).toBe(false);
    expect(service.authorize('user-1', request, () => ({ organizationId: 'org-1', instanceId: 'instance-1', sideId: 'red', areaId: 'area-1' })).allowed).toBe(false);
    expect(service.authorize('user-1', request, blueScope).allowed).toBe(true);
  });

  it('нормализует username до uniqueness и аутентификации', async () => {
    const directory = new LocalDirectory();
    await directory.createAccount({ userId: 'u1', username: 'Admin', password: 'Локальный-пароль-12', organizationId: 'org-1', technicalPermissions: [] });
    await expect(directory.createAccount({ userId: 'u2', username: ' admin ', password: 'Локальный-пароль-12', organizationId: 'org-1', technicalPermissions: [] })).rejects.toThrow('уже существует');
    expect((await directory.authenticate(' ADMIN ', 'Локальный-пароль-12')).userId).toBe('u1');
  });
});

describe('durable административное состояние и обязательный аудит', () => {
  it('восстанавливает учётные записи, назначения, конфигурацию и append-only аудит после перезапуска', async () => {
    const directoryFile = join(root(), 'directory.jsonl');
    const assignmentFile = join(root(), 'assignments.jsonl');
    const configFile = join(root(), 'config.jsonl');
    const auditFile = join(root(), 'audit.jsonl');
    const now = () => new Date('2026-11-22T08:00:00.000Z');
    const audit = new SecurityAudit({ stateFile: auditFile, now });
    const directory = new LocalDirectory({ stateFile: directoryFile, audit, now });
    await directory.createAccount({ userId: 'admin-1', username: 'admin', password: 'Локальный-пароль-12', organizationId: 'org-1', technicalPermissions: ['backup.create'] });
    const accounts = new AccountService(directory, { audit, now });
    await expect(accounts.login('admin', 'wrong-password', 'org-1')).rejects.toThrow('Требуется вход');
    await accounts.login('admin', 'Локальный-пароль-12', 'org-1');

    const assignments = new AssignmentService({ stateFile: assignmentFile, audit, now });
    const assigned = assignments.assign(director, assignmentInput);
    const catalog = new ConfigCatalog({ stateFile: configFile, audit, organizationId: 'org-1' });
    const imported = catalog.importProfile({ profileId: 'weather', kind: 'WEATHER', content: { factor: 0.8 }, assumption: 'Учебное допущение', testReport: { status: 'PASSED' } });
    catalog.approve({ userId: 'methodist-1', domainPermissions: ['config.approve'] }, 'weather', 1);
    assignments.revoke(director, assigned.id);
    await directory.blockAccount('admin-1');

    expect(readFileSync(auditFile, 'utf8').trim().split('\n').length).toBeGreaterThanOrEqual(8);
    const auditRestarted = new SecurityAudit({ stateFile: auditFile, now });
    expect(auditRestarted.verify()).toEqual([]);
    expect(auditRestarted.entries().map(event => event.action)).toEqual(expect.arrayContaining([
      'account.created', 'login.failed', 'login.succeeded', 'assignment.granted',
      'assignment.revoked', 'config.imported', 'config.approved', 'account.blocked',
    ]));
    const directoryRestarted = new LocalDirectory({ stateFile: directoryFile, now });
    expect(directoryRestarted.publicAccount('admin-1').state).toBe('BLOCKED');
    const assignmentsRestarted = new AssignmentService({ stateFile: assignmentFile, now });
    expect(assignmentsRestarted.history(assigned.id)[0].state).toBe('REVOKED');
    expect(assignmentsRestarted.subscriptionRevision('user-1')).toBe(2);
    const configRestarted = new ConfigCatalog({ stateFile: configFile });
    expect(configRestarted.resolve({ profileId: 'weather', version: 1, sha256: imported.sha256 }).status).toBe('APPROVED');
  });
});
