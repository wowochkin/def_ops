// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { AccountsWorkspace } from '../src/modern/kshvi/admin/AccountsWorkspace';
import { RoleAssignments } from '../src/modern/kshvi/admin/RoleAssignments';
import { SecurityAudit } from '../src/modern/kshvi/admin/SecurityAudit';
import { ConfigCatalog } from '../src/modern/kshvi/admin/ConfigCatalog';

afterEach(cleanup);

const account = {
  userId: 'admin-1', username: 'tech.admin', organizationId: 'org-1', state: 'ACTIVE' as const,
  technicalPermissions: ['backup.create', 'health.read'], createdAt: '2026-11-22T08:00:00.000Z', updatedAt: '2026-11-22T08:00:00.000Z',
};

it('показывает локальные учётные записи и технические права без содержания учения', () => {
  const onBlock = vi.fn();
  render(<AccountsWorkspace accounts={[account]} disseminationLabel="ДЛЯ СЛУЖЕБНОГО ПОЛЬЗОВАНИЯ" onBlock={onBlock} onArchive={vi.fn()} />);
  expect(screen.getByRole('heading', { name: 'Локальные учётные записи' })).toBeTruthy();
  expect(screen.getByText('Технические права')).toBeTruthy();
  expect(screen.getByText('Сертификация для обработки секретных сведений не заявляется.')).toBeTruthy();
  expect(screen.queryByText('Скрытый замысел стороны')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Заблокировать tech.admin' }));
  expect(onBlock).toHaveBeenCalledWith('admin-1');
});

it('показывает сроки, замещение, официальную метку и немедленный отзыв роли', () => {
  const onRevoke = vi.fn();
  render(<RoleAssignments assignments={[{
    id: 'role-1', userId: 'user-1', organizationId: 'org-1', instanceId: 'instance-1', postId: 'commander-blue',
    role: 'TRAINEE', sideId: 'blue', areaId: 'area-1', sessionMode: 'OFFICIAL', validFrom: '2026-11-22T07:00:00.000Z',
    validUntil: '2026-11-22T12:00:00.000Z', allowedActions: ['document.read'], substituteUserId: 'user-2', critical: true,
    state: 'ACTIVE', revision: 1,
  }]} onRevoke={onRevoke} />);
  expect(screen.getByText('Официальный сеанс')).toBeTruthy();
  expect(screen.getByText('Заместитель: user-2')).toBeTruthy();
  expect(screen.getByText(/22\.11\.2026/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Отозвать назначение commander-blue' }));
  expect(onRevoke).toHaveBeenCalledWith('role-1');
});

it('экспортирует только технический аудит и версии утверждённых профилей', () => {
  const onExport = vi.fn();
  render(<SecurityAudit events={[{
    sequence: 1, eventId: 'audit-1', occurredAt: '2026-11-22T08:00:00.000Z', actorId: 'admin-1', organizationId: 'org-1',
    action: 'backup.created', outcome: 'ALLOWED', correlationId: 'corr-1', prevHash: null, hash: 'a'.repeat(64),
  }]} onExport={onExport} />);
  expect(screen.getByText('backup.created')).toBeTruthy();
  expect(screen.queryByText(/payload/i)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Экспортировать аудит' }));
  expect(onExport).toHaveBeenCalled();

  cleanup();
  render(<ConfigCatalog versions={[{
    profileId: 'weather', kind: 'WEATHER', version: 1, sha256: 'b'.repeat(64), content: { factor: 0.8 },
    assumption: 'Учебное допущение', testReport: { status: 'PASSED' }, status: 'APPROVED', approvedBy: 'methodist-1', createdAt: '2026-11-22T08:00:00.000Z',
  }]} retention={{ activeDays: 30, archiveDays: 365, backupDays: 90, auditDays: 730, allowedMedia: ['encrypted-local-disk'], responsibleUserIds: ['security-1'] }} />);
  expect(screen.getByText('WEATHER · версия 1')).toBeTruthy();
  expect(screen.getByText('Тесты: PASSED')).toBeTruthy();
  expect(screen.getByText('Аудит: 730 дн.')).toBeTruthy();
});
