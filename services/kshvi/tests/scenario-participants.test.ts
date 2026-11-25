import { expect, it } from 'vitest';
import type { AccountRecord } from '../src/auth/sessions';
import { participantCandidates, resolveParticipantRoster } from '../src/store/scenario-participants';

const account: AccountRecord = {
  userId: 'actual-user', username: 'Участник', passwordHash: 'private-password-hash', organizationId: 'org', state: 'ACTIVE',
  roles: [{ id: 'actual-assignment', role: 'TRAINEE', sideId: 'blue', authorities: ['private-capability'], assignedInstanceIds: ['actual-instance'] }],
};

it('перечисляет только действительно назначенные инстанции своей организации без секретов', () => {
  const candidates = participantCandidates([account, { ...account, userId: 'foreign', organizationId: 'other' },
    { ...account, userId: 'blocked', state: 'BLOCKED' }, { ...account, userId: 'unassigned', roles: [{ ...account.roles[0], assignedInstanceIds: [] }] }], 'org');
  expect(candidates).toEqual([expect.objectContaining({ userId: 'actual-user', roleAssignmentId: 'actual-assignment', instanceId: 'actual-instance', role: 'TRAINEE', sideId: 'blue' })]);
  expect(JSON.stringify(candidates)).not.toContain('private-password-hash');
  expect(JSON.stringify(candidates)).not.toContain('private-capability');
});

it('привязка разрешает серверные роли по исходным ID и не принимает роль от клиента', () => {
  const reference = { userId: 'actual-user', roleAssignmentId: 'actual-assignment', instanceId: 'actual-instance' };
  expect(resolveParticipantRoster([account], 'org', [reference])[0].role).toBe('TRAINEE');
  expect(() => resolveParticipantRoster([account], 'org', [{ ...reference, role: 'DIRECTOR' }])).toThrow();
  expect(() => resolveParticipantRoster([account], 'org', [{ ...reference, instanceId: 'invented-instance' }])).toThrow();
  expect(() => resolveParticipantRoster([account], 'org', [reference, reference])).toThrow();
});
