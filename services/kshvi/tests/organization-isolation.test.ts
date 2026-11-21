import { expect, it } from 'vitest';
import { OrganizationPolicyService, assertOrganizationAccess, sessionModeLabel } from '../src/auth/organization-policy';

it('проверяет организацию каждого объекта, файла и задания без раскрытия чужого объекта', () => {
  for (const kind of ['object', 'file', 'job', 'subscription'] as const) {
    expect(() => assertOrganizationAccess('org-1', { organizationId: 'org-2', kind })).toThrow('Действие недоступно');
    expect(() => assertOrganizationAccess('org-1', { organizationId: 'org-1', kind })).not.toThrow();
  }
});

it('публикует общий справочник только явной версией и разрешённым организациям', () => {
  const service = new OrganizationPolicyService();
  service.setPolicy({
    organizationId: 'org-1', disseminationLabel: 'ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ',
    sharedCatalogs: [{ catalogId: 'symbols', version: 3, sha256: 'a'.repeat(64), allowedOrganizationIds: ['org-2'] }],
    certificationClaim: false,
  });
  expect(service.catalogFor('org-2', 'symbols', 3)).toMatchObject({ version: 3 });
  expect(() => service.catalogFor('org-3', 'symbols', 3)).toThrow('Действие недоступно');
  expect(() => service.catalogFor('org-2', 'symbols', 4)).toThrow('версионная ссылка');
  expect(service.certificationNotice()).toContain('не заявляется');
});

it('различает демонстрационный, тренировочный и официальный сеансы', () => {
  expect(sessionModeLabel('DEMONSTRATION')).toBe('Демонстрационный сеанс');
  expect(sessionModeLabel('TRAINING')).toBe('Тренировочный сеанс');
  expect(sessionModeLabel('OFFICIAL')).toBe('Официальный сеанс');
});
