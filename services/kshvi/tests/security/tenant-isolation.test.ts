import { expect, it } from 'vitest';
import { assertOrganizationAccess, OrganizationPolicyService } from '../../src/auth/organization-policy';

it('отклоняет чужую организацию для объектов, файлов, заданий и подписок', () => {
  for (const kind of ['object', 'file', 'job', 'subscription'] as const) {
    expect(() => assertOrganizationAccess('org-1', { organizationId: 'org-2', kind })).toThrow('Действие недоступно');
    expect(() => assertOrganizationAccess('org-1', { organizationId: 'org-1', kind })).not.toThrow();
  }
});

it('не наследует роль в другой организации и публикует общий каталог только по разрешённой версии', () => {
  const policies = new OrganizationPolicyService();
  policies.setPolicy({
    organizationId: 'org-1',
    disseminationLabel: 'ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ',
    certificationClaim: false,
    sharedCatalogs: [{ catalogId: 'symbols', version: 7, sha256: 'a'.repeat(64), allowedOrganizationIds: ['org-2'] }],
  });
  expect(policies.catalogFor('org-2', 'symbols', 7)).toMatchObject({ version: 7, sha256: 'a'.repeat(64) });
  expect(() => policies.catalogFor('org-1', 'symbols', 7)).toThrow('Действие недоступно');
  expect(() => policies.catalogFor('org-2', 'symbols', 8)).toThrow('версионная ссылка');
});
