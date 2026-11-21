import { expect, it } from 'vitest';
import { applyBranchDecision, createBranch, publishBranch } from '../src/replay/branch';
import { compareBranches } from '../src/replay/branch-diff';
import { officialBranch } from './fixtures/branch-fixture';

const alternativeDecision = {
  eventId: 'alternative-1', type: 'decision', operationalAt: '2026-11-21T06:03:00.000Z',
  wallClockAt: '2026-11-21T09:03:00.000Z', payload: { text: 'Альтернативное решение' },
  changes: [{ domain: 'Resources' as const, value: { fuel: 10 } }, { domain: 'Decisions' as const, value: { outcome: 'alternative' } }],
};

it('не меняет официальные документы, оценку и хеш', () => {
  const official = officialBranch();
  const before = official.hash;
  const branch = createBranch(official, { branchId: 'research-1' });
  const changed = applyBranchDecision(branch, alternativeDecision);
  expect(changed.branchId).not.toBe(official.branchId);
  expect(changed.events[0].branchId).toBe('research-1');
  expect(changed.assessment).toEqual(official.assessment);
  expect(official.hash).toBe(before);
  expect(official.events).toEqual([]);
  expect(official.documents).toEqual([{ id: 'signed-order', signed: true, text: 'Исходный приказ' }]);
  expect(official.assessment).toEqual({ grade: 'Утверждено руководителем' });
  expect(official.state.domains.Resources).not.toEqual({ fuel: 10 });
});

it('явно фиксирует замену версий как новое допущение и запрещает обычную публикацию', () => {
  const official = officialBranch();
  const model = { id: 'model', revision: 2, sha256: 'b'.repeat(64) };
  const branch = createBranch(official, { branchId: 'research-2', versionChanges: { model }, assumption: 'Исследовательская замена модели' });
  expect(branch.versions.model).toEqual(model);
  expect(branch.assumptions).toContain('Исследовательская замена модели');
  expect(official.versions.model.revision).toBe(1);
  expect(() => publishBranch(branch)).toThrow('обычная публикация ветви запрещена');
});

it('сравнение сначала показывает среду и модель и не приписывает эффект решению', () => {
  const official = officialBranch();
  const environment = { id: 'environment', revision: 2, sha256: 'c'.repeat(64) };
  const model = { id: 'model', revision: 2, sha256: 'b'.repeat(64) };
  const branch = applyBranchDecision(createBranch(official, {
    branchId: 'research-3', versionChanges: { environment, model }, assumption: 'Другие условия',
  }), alternativeDecision);
  const diff = compareBranches(official, branch);
  expect(diff.differences.slice(0, 2).map(item => item.kind)).toEqual(['MODEL_VERSION', 'ENVIRONMENT_VERSION']);
  expect(diff.differences.findIndex(item => item.kind === 'RESOURCES')).toBeGreaterThan(1);
  expect(diff.causalAttribution).toBe('NOT_CAUSALLY_COMPARABLE');
});


it('получает собственное воспроизводимое зерно, отделённое от официальной линии', () => {
  const official = officialBranch();
  const first = createBranch(official, { branchId: 'research-seed' });
  const second = createBranch(official, { branchId: 'research-seed' });
  expect(first.seed).not.toBe(official.seed);
  expect(first.seed).toBe(second.seed);
  expect(official.seed).toBe('official-seed');
});
