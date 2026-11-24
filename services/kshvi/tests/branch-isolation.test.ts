import { expect, it } from 'vitest';
import { officialBranch } from '../../../packages/kshvi/tests/fixtures/branch-fixture';
import { BranchService } from '../src/replay/branch-service';
import { ResearchService } from '../src/replay/research-service';

const leader = {
  organizationId: 'org-1', userId: 'leader-1', sideId: 'blue', role: 'LEADER',
  authorities: ['OFFICIAL_READ', 'BRANCH_CREATE', 'BRANCH_READ', 'BRANCH_WRITE', 'OFFICIAL_DECISION'],
};

it('хранит альтернативу отдельно и разрешает перенос только новым решением руководителя', () => {
  const service = new BranchService(officialBranch());
  const before = service.official(leader).hash;
  service.createBranch('research-1', leader);
  service.applyDecision('research-1', {
    eventId: 'alt-1', type: 'decision', operationalAt: '2026-11-21T06:03:00.000Z', wallClockAt: '2026-11-21T09:03:00.000Z',
    payload: { decision: 'alt' }, changes: [{ domain: 'Decisions', value: { selected: 'alt' } }],
  }, leader);
  expect(service.official(leader).hash).toBe(before);
  expect(service.branch('research-1', leader).events).toHaveLength(1);
  expect(() => service.publish('research-1', leader)).toThrow('запрещена');
  expect(() => service.adopt('research-1', { organizationId: 'org-1', userId: 'trainee', sideId: 'blue', role: 'TRAINEE', authorities: [] }, 'Недостаточно оснований')).toThrow('403');
  const adopted = service.adopt('research-1', leader, 'Новое решение после разбора последствий');
  expect(adopted.kind).toBe('OFFICIAL');
  expect(adopted.events).toHaveLength(1);
  expect(adopted.events[0].eventId).not.toBe('alt-1');
  expect(adopted.events[0].payload).toMatchObject({ rationale: 'Новое решение после разбора последствий', sourceBranchId: 'research-1' });
});

it('сервер исследования сохраняет ограничение причинности', () => {
  const service = new ResearchService();
  const card = service.create({
    question: 'Вопрос', hypothesis: 'Гипотеза', variables: ['x'], method: 'Наблюдение', design: 'OBSERVATIONAL', owners: ['owner'],
    requiredData: ['events'], observationPlan: ['plan'], startsAt: '2026-11-21', endsAt: '2026-11-22', evidenceIds: ['e1'], calculationIds: [],
  });
  expect(() => service.conclude(card.id, { results: [], limitations: ['Нет контроля'], conclusion: 'Причина', causalClaim: 'CAUSAL' })).toThrow('причинность');
});
