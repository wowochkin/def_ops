import { expect, it } from 'vitest';
import { makeReplayArchive } from '../../../packages/kshvi/tests/fixtures/replay-archive';
import { officialBranch } from '../../../packages/kshvi/tests/fixtures/branch-fixture';
import { ReplayService, type ReplayParticipantFrame } from '../src/replay/replay-service';
import { BranchService } from '../src/replay/branch-service';

it('R05: перспектива участника ограничена владельцем, организацией и отдельным правом чужого кадра', () => {
  const archive = { ...makeReplayArchive(), organizationId: 'org-1' };
  const participantFrames: ReplayParticipantFrame[] = [{
    participantId: 'user-blue', organizationId: 'org-1', sideId: 'blue', branchId: 'official', sequence: 3, policyRevision: 4,
    allowedEventIds: ['event-1'], events: archive.events.slice(0, 1),
    state: { domains: { Map: { items: [{ id: 'private-observation' }] } }, appliedEventIds: [], eventCauses: {} },
  }];
  const service = new ReplayService();
  const own = service.project({
    archive, cursor: 3, participantId: 'user-blue', participantFrames, perspective: 'PARTICIPANT',
    actor: { organizationId: 'org-1', userId: 'user-blue', sideId: 'blue', role: 'TRAINEE', authorities: ['replay.read'] },
  });
  expect(own.perspective).toBe('PARTICIPANT');
  for (const actor of [
    { organizationId: 'org-1', userId: 'user-red', sideId: 'red', role: 'TRAINEE', authorities: ['replay.read'] },
    { organizationId: 'org-2', userId: 'user-blue', sideId: 'blue', role: 'TRAINEE', authorities: ['replay.read'] },
    { organizationId: 'org-1', userId: 'user-blue', sideId: 'blue', role: 'TRAINEE', authorities: [] },
  ]) {
    expect(() => service.project({ archive, cursor: 3, participantId: 'user-blue', participantFrames, actor, perspective: 'PARTICIPANT' })).toThrow('403');
  }
  expect(() => service.project({
    archive, cursor: 3, participantId: 'user-blue', participantFrames, perspective: 'PARTICIPANT',
    actor: { organizationId: 'org-1', userId: 'leader', sideId: 'blue', role: 'LEADER', authorities: ['replay.read.any'] },
  })).not.toThrow();
});

it('R20: BranchService применяет организацию, права и владельца исследовательского контура', () => {
  const service = new BranchService(officialBranch());
  const leader = {
    organizationId: 'org-1', userId: 'leader-1', sideId: 'blue', role: 'LEADER',
    authorities: ['OFFICIAL_READ', 'BRANCH_CREATE', 'BRANCH_READ', 'BRANCH_WRITE', 'OFFICIAL_DECISION'],
  };
  const other = { ...leader, userId: 'other-user' };
  const guest = { ...leader, userId: 'guest', authorities: [] };
  expect(service.official(leader).branchId).toBe('official');
  expect(() => service.official(guest)).toThrow('403');
  expect(() => service.official({ ...leader, organizationId: 'org-2' })).toThrow('403');
  service.createBranch('research-secure', leader);
  expect(service.branch('research-secure', leader).branchId).toBe('research-secure');
  expect(() => service.branch('research-secure', other)).toThrow('403');
  expect(() => service.branch('research-secure', guest)).toThrow('403');
  expect(() => service.createBranch('research-forbidden', guest)).toThrow('403');
  const decision = {
    eventId: 'secure-alt-1', type: 'decision', operationalAt: '2026-11-21T06:03:00.000Z', wallClockAt: '2026-11-21T09:03:00.000Z',
    payload: { text: 'Недоступное решение' }, changes: [{ domain: 'Decisions' as const, value: { selected: 'alt' } }],
  };
  expect(() => service.applyDecision('research-secure', decision, other)).toThrow('403');
  expect(service.applyDecision('research-secure', decision, leader).events).toHaveLength(1);
  const anyReader = { ...other, authorities: [...leader.authorities, 'BRANCH_READ_ANY'] };
  expect(service.branch('research-secure', anyReader).events).toHaveLength(1);
});


function assertObjectSources(value: unknown, source: 'TRUTH' | 'PARTICIPANT'): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    for (const item of value) assertObjectSources(item, source);
    return;
  }
  expect((value as { source?: string }).source).toBe(source);
  for (const [key, nested] of Object.entries(value)) if (key !== 'source') assertObjectSources(nested, source);
}

it('R21: каждый вложенный объект кадра получает источник TRUTH или PARTICIPANT', async () => {
  const { restoreAt } = await import('../../../packages/kshvi/src/replay/replay-engine');
  const truth = restoreAt({ archive: makeReplayArchive(), cursor: 1 });
  assertObjectSources(truth.panels.Map.value, 'TRUTH');

  const archive = { ...makeReplayArchive(), organizationId: 'org-1' };
  const participantFrames: ReplayParticipantFrame[] = [{
    participantId: 'user-blue', organizationId: 'org-1', sideId: 'blue', branchId: 'official', sequence: 1, policyRevision: 1,
    allowedEventIds: [], events: [],
    state: { domains: { Map: { items: [{ id: 'object', geometry: { type: 'Point' }, source: 'FORGED' }] } }, appliedEventIds: [], eventCauses: {} },
  }];
  const participant = new ReplayService().project({
    archive, cursor: 1, participantId: 'user-blue', participantFrames, perspective: 'PARTICIPANT',
    actor: { organizationId: 'org-1', userId: 'user-blue', sideId: 'blue', role: 'TRAINEE', authorities: ['replay.read'] },
  });
  assertObjectSources(participant.panels.Map.value, 'PARTICIPANT');
});
