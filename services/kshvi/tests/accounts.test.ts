import { describe, expect, it } from 'vitest';
import { LocalDirectory } from '../src/auth/local-directory';
import { AccountService } from '../src/auth/account-service';
import { TemporaryAccessService } from '../src/auth/temporary-access';

const at = new Date('2026-11-22T08:00:00.000Z');

describe('локальный каталог и технические права', () => {
  it('хеширует пароль, блокирует и архивирует учётную запись', async () => {
    const directory = new LocalDirectory({ now: () => at });
    const account = await directory.createAccount({
      userId: 'admin-1', username: 'tech.admin', password: 'Локальный-пароль-12',
      organizationId: 'org-1', technicalPermissions: ['backup.create', 'health.read'],
    });
    expect(account.passwordHash).toMatch(/^scrypt\$/);
    expect(account.passwordHash).not.toContain('Локальный-пароль-12');
    expect(directory.publicAccount('admin-1')).not.toHaveProperty('passwordHash');
    expect((await directory.authenticate('tech.admin', 'Локальный-пароль-12')).userId).toBe('admin-1');

    await directory.blockAccount('admin-1');
    await expect(directory.authenticate('tech.admin', 'Локальный-пароль-12')).rejects.toThrow('Требуется вход');
    await directory.archiveAccount('admin-1');
    expect(directory.publicAccount('admin-1').state).toBe('ARCHIVED');
  });

  it('не даёт техническому администратору содержание и предметные права', async () => {
    const directory = new LocalDirectory({ now: () => at });
    await directory.createAccount({
      userId: 'admin-1', username: 'tech.admin', password: 'Локальный-пароль-12',
      organizationId: 'org-1', technicalPermissions: ['backup.create'],
    });
    const service = new AccountService(directory, { now: () => at });
    const session = await service.login('tech.admin', 'Локальный-пароль-12', 'org-1');
    expect(service.authorize(session.token, { action: 'scenario.approve', organizationId: 'org-1' }).allowed).toBe(false);
    expect(service.authorize(session.token, { action: 'document.read', organizationId: 'org-1', resourceId: 'secret' }).allowed).toBe(false);
    expect(service.authorize(session.token, { action: 'backup.create', organizationId: 'org-1' }).allowed).toBe(true);
    expect(service.authorize(session.token, { action: 'backup.create', organizationId: 'org-2' }).allowed).toBe(false);
    expect(JSON.stringify(service.listSessions('admin-1'))).not.toContain(session.token);
  });

  it('разрешает grant только для технических метаданных и запрещает любое предметное содержание', async () => {
    let now = at;
    const directory = new LocalDirectory({ now: () => now });
    await directory.createAccount({
      userId: 'admin-1', username: 'tech.admin', password: 'Локальный-пароль-12',
      organizationId: 'org-1', technicalPermissions: ['temporary-access.grant'],
    });
    const temporary = new TemporaryAccessService({ now: () => now });
    const grant = temporary.grant(
      { userId: 'security-1', organizationId: 'org-1', technicalPermissions: ['temporary-access.grant'] },
      { subjectUserId: 'admin-1', organizationId: 'org-1', resourceId: 'backup-1', resourceKind: 'BACKUP_METADATA', reason: 'Проверка манифеста и хешей восстановления', validFrom: '2026-11-22T08:00:00.000Z', validUntil: '2026-11-22T09:00:00.000Z' },
    );
    const service = new AccountService(directory, { now: () => now, temporaryAccess: temporary });
    const session = await service.login('tech.admin', 'Локальный-пароль-12', 'org-1');
    const request = { action: 'recovery.manifest.read', organizationId: 'org-1', resourceId: 'backup-1' };
    for (const action of ['document.read', 'recovery.content.read', 'scenario.read', 'assessment.read']) {
      expect(service.authorize(session.token, { ...request, action }).allowed).toBe(false);
    }
    expect(service.authorize(session.token, request).allowed).toBe(true);
    expect(service.authorize(session.token, { ...request, resourceId: 'backup-2' }).allowed).toBe(false);
    temporary.revoke(grant.id, 'security-1');
    expect(service.authorize(session.token, request).allowed).toBe(false);

    const second = temporary.grant(
      { userId: 'security-1', organizationId: 'org-1', technicalPermissions: ['temporary-access.grant'] },
      { subjectUserId: 'admin-1', organizationId: 'org-1', resourceId: 'backup-1', resourceKind: 'BACKUP_METADATA', reason: 'Повторная проверка технических хешей', validFrom: '2026-11-22T08:00:00.000Z', validUntil: '2026-11-22T09:00:00.000Z' },
    );
    now = new Date('2026-11-22T09:00:01.000Z');
    expect(temporary.canAccess(second.id, request)).toBe(false);
  });
});
