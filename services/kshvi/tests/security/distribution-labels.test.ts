import { expect, it } from 'vitest';
import { OrganizationPolicyService } from '../../src/auth/organization-policy';
import { RetentionService } from '../../src/admin/retention-service';

it('настраивает метки и хранение без заявления сертификации секретности', () => {
  const policies = new OrganizationPolicyService();
  expect(() => policies.setPolicy({ organizationId: 'org-1', disseminationLabel: 'ДСП', sharedCatalogs: [], certificationClaim: true })).toThrow('не подтверждается');
  policies.setPolicy({ organizationId: 'org-1', disseminationLabel: 'ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ', sharedCatalogs: [], certificationClaim: false });
  expect(policies.certificationNotice()).toBe('Сертификация для обработки секретных сведений не заявляется.');

  const retention = new RetentionService({ now: () => new Date('2026-11-22T00:00:00.000Z') });
  retention.setPolicy({ organizationId: 'org-1', activeDays: 30, archiveDays: 365, backupDays: 90, auditDays: 365, allowedMedia: ['encrypted-local-disk'], responsibleUserIds: ['admin'] });
  expect(retention.expiresAt('org-1', 'BACKUP')).toBe('2027-02-20T00:00:00.000Z');
  expect(() => retention.assertMediumAllowed('org-1', 'public-cloud')).toThrow('не разрешён');
  expect(retention.canReadArchive('org-1', ['archive.read', 'truth.read'], ['archive.read'], false)).toBe(false);
  expect(retention.canReadArchive('org-1', ['archive.read'], ['archive.read'], false)).toBe(true);
});
