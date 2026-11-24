import { beforeEach, describe, expect, it } from 'vitest';
import { AssignmentService, copyAssignmentsForSession } from '../src/auth/assignment-service';

const director = { userId: 'director-1', organizationId: 'org-1', domainPermissions: ['assignment.manage'] } as const;
let now: Date;
let service: AssignmentService;

beforeEach(() => {
  now = new Date('2026-11-22T08:00:00.000Z');
  service = new AssignmentService({ now: () => now });
});

function assignment() {
  return service.assign(director, {
    userId: 'user-1', organizationId: 'org-1', instanceId: 'instance-1', postId: 'commander-blue',
    role: 'TRAINEE', sideId: 'blue', areaId: 'area-1', sessionMode: 'OFFICIAL',
    validFrom: '2026-11-22T07:00:00.000Z', validUntil: '2026-11-22T12:00:00.000Z',
    allowedActions: ['document.read', 'command.submit'], substituteUserId: 'user-2', critical: true,
  });
}

describe('предметные назначения', () => {
  it('назначает срок, инстанцию, сторону, участок, действия и замещение только уполномоченным', () => {
    const value = assignment();
    expect(value).toMatchObject({ postId: 'commander-blue', substituteUserId: 'user-2', state: 'ACTIVE' });
    const scope = () => ({ organizationId: 'org-1', instanceId: 'instance-1', sideId: 'blue', areaId: 'area-1' });
    expect(service.authorize('user-1', { action: 'document.read', organizationId: 'org-1', instanceId: 'instance-1', resourceId: 'document-1' }, scope).allowed).toBe(true);
    expect(service.authorize('user-1', { action: 'scenario.approve', organizationId: 'org-1', instanceId: 'instance-1', resourceId: 'scenario-1' }, scope).allowed).toBe(false);
    expect(() => service.assign({ ...director, domainPermissions: [] }, {
      userId: 'user-3', organizationId: 'org-1', instanceId: 'instance-1', postId: 'staff', role: 'TRAINEE',
      sideId: null, areaId: null, sessionMode: 'TRAINING', validFrom: '2026-11-22T07:00:00.000Z', validUntil: '2026-11-22T12:00:00.000Z',
      allowedActions: ['document.read'], substituteUserId: null, critical: false,
    })).toThrow('предметные права');
  });

  it('немедленно отзывает API и SSE, сохраняя сам факт назначения в истории', () => {
    const value = assignment();
    expect(service.subscriptionRevision('user-1')).toBe(1);
    const scope = () => ({ organizationId: 'org-1', instanceId: 'instance-1', sideId: 'blue', areaId: 'area-1' });
    const request = { action: 'document.read', organizationId: 'org-1', instanceId: 'instance-1', resourceId: 'document-1' };
    expect(service.authorize('user-1', request, scope).allowed).toBe(true);
    service.revoke(director, value.id);
    expect(service.authorize('user-1', request, scope).allowed).toBe(false);
    expect(service.subscriptionRevision('user-1')).toBe(2);
    expect(service.history(value.id)[0].state).toBe('REVOKED');
  });

  it('находит конфликт и незамещённое критическое место до запуска', () => {
    assignment();
    expect(() => service.assign(director, {
      userId: 'user-1', organizationId: 'org-1', instanceId: 'instance-1', postId: 'umpire',
      role: 'UMPIRE', sideId: 'red', areaId: 'area-2', sessionMode: 'OFFICIAL',
      validFrom: '2026-11-22T08:30:00.000Z', validUntil: '2026-11-22T11:00:00.000Z',
      allowedActions: ['document.read'], substituteUserId: null, critical: false,
    })).toThrow('Конфликт ролей');
    const issues = service.preflight('instance-1', [{ postId: 'commander-blue', critical: true }, { postId: 'logistics', critical: true }]);
    expect(issues).toContainEqual(expect.objectContaining({ code: 'CRITICAL_POST_UNFILLED', postId: 'logistics' }));
    now = new Date('2026-11-22T13:00:00.000Z');
    expect(service.preflight('instance-1', [{ postId: 'commander-blue', critical: true }])).toContainEqual(expect.objectContaining({ code: 'CRITICAL_POST_UNFILLED' }));
  });

  it('не переносит демонстрационное совмещение ролей в официальный сеанс', () => {
    expect(copyAssignmentsForSession('DEMONSTRATION', 'OFFICIAL')).toEqual([]);
    expect(copyAssignmentsForSession('TRAINING', 'TRAINING')).toEqual(['CREATE_NEW_ASSIGNMENTS']);
  });
});
