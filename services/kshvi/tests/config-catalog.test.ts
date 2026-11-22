import { beforeEach, describe, expect, it } from 'vitest';
import { ConfigCatalog } from '../src/admin/config-catalog';
import { RetentionService } from '../src/admin/retention-service';
import { DeletionService, type DeletionPorts } from '../src/admin/deletion-service';
import { SecurityAudit } from '../src/auth/security-audit';

let now: Date;
beforeEach(() => { now = new Date('2026-11-22T08:00:00.000Z'); });

function ports(retained = false): DeletionPorts {
  return {
    lockExercise: async () => {}, scheduleDeletion: async () => {},
    hasRetentionHold: async () => retained, deleteExercise: async () => {},
  };
}

describe('версионный каталог конфигурации', () => {
  it('требует источник или допущение, пройденные тесты и утверждение', () => {
    const catalog = new ConfigCatalog();
    expect(() => catalog.importProfile({ profileId: 'weather', kind: 'WEATHER', content: { factor: 0.8 }, testReport: { status: 'PASSED' } })).toThrow('источник');
    expect(() => catalog.importProfile({ profileId: 'weather', kind: 'WEATHER', content: { factor: 0.8 }, assumption: 'Учебное допущение', testReport: { status: 'FAILED' } })).toThrow('тесты');
    const draft = catalog.importProfile({ profileId: 'weather', kind: 'WEATHER', content: { factor: 0.8 }, assumption: 'Учебное допущение', testReport: { status: 'PASSED' } });
    expect(() => catalog.activate('weather', draft.version)).toThrow('APPROVED');
    const approved = catalog.approve({ userId: 'methodist-1', domainPermissions: ['config.approve'] }, 'weather', 1);
    expect(approved.status).toBe('APPROVED');
    expect(catalog.activate('weather', 1).sha256).toBe(approved.sha256);
    catalog.importProfile({ profileId: 'weather', kind: 'WEATHER', content: { factor: 0.9 }, assumption: 'Новое учебное допущение', testReport: { status: 'PASSED' } });
    expect(catalog.resolve({ profileId: 'weather', version: 1, sha256: approved.sha256 }).content).toEqual({ factor: 0.8 });
  });
});

describe('хранение и удаление', () => {
  it('применяет организационные сроки, носители и доступ архива не шире исходного', () => {
    const service = new RetentionService({ now: () => now });
    service.setPolicy({ organizationId: 'org-1', activeDays: 30, archiveDays: 365, backupDays: 90, auditDays: 730, allowedMedia: ['encrypted-local-disk'], responsibleUserIds: ['security-1'] });
    expect(service.expiresAt('org-1', 'BACKUP', '2026-11-22T08:00:00.000Z')).toBe('2027-02-20T08:00:00.000Z');
    expect(() => service.assertMediumAllowed('org-1', 'public-cloud')).toThrow('носитель');
    expect(service.canReadArchive('org-1', ['exercise.read'], ['exercise.read'], false)).toBe(true);
    expect(service.canReadArchive('org-1', ['exercise.read', 'assessment.read'], ['exercise.read'], false)).toBe(false);
    expect(service.canReadArchive('org-1', ['exercise.read', 'assessment.read'], ['exercise.read'], true)).toBe(true);
  });

  it('требует специальное право, второе лицо, отсутствие удержания и отложенное удаление', async () => {
    const audit = new SecurityAudit({ now: () => now });
    const service = new DeletionService({ now: () => now, audit, ports: ports() });
    const requester = { userId: 'security-1', organizationId: 'org-1', domainPermissions: ['exercise.delete'] };
    const confirmer = { userId: 'security-2', organizationId: 'org-1', domainPermissions: ['deletion.confirm'] };
    await expect(service.request({ ...requester, domainPermissions: [] }, { exerciseId: 'exercise-1', organizationId: 'org-1' })).rejects.toThrow('специальное полномочие');
    const request = await service.request(requester, { exerciseId: 'exercise-1', organizationId: 'org-1' });
    expect(request.status).toBe('LOCKED');
    await expect(service.confirm(requester, request.id)).rejects.toThrow('втор');
    await expect(service.execute(request.id)).rejects.toThrow('не подтверждено');
    const scheduled = await service.confirm(confirmer, request.id);
    expect(scheduled.status).toBe('SCHEDULED');
    await expect(service.execute(request.id)).rejects.toThrow('отложено');
    now = new Date(scheduled.executeAfter);
    expect((await service.execute(request.id)).status).toBe('EXECUTED');
    expect(audit.entries().map(event => event.action)).toEqual(['deletion.requested', 'deletion.confirmed', 'deletion.executed']);
  });

  it('не разрешает удаление при организационном удержании', async () => {
    const service = new DeletionService({ now: () => now, audit: new SecurityAudit({ now: () => now }), ports: ports(true) });
    await expect(service.request(
      { userId: 'security-1', organizationId: 'org-1', domainPermissions: ['exercise.delete'] },
      { exerciseId: 'exercise-1', organizationId: 'org-1' },
    )).rejects.toThrow('удержание');
  });
});
