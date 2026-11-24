import { expect, it } from 'vitest';
import { calculateMetric } from '../src/assessment/metric-engine';
import { deliveryDelayMetric, sent } from './fixtures/metric-fixture';
import { officialBranch } from './fixtures/branch-fixture';
import { makeReplayArchive } from './fixtures/replay-archive';
import { createBranch } from '../src/replay/branch';
import { restoreSnapshot, snapshotStateHash } from '../src/replay/snapshot-restore';

it('RR07: повреждённые occurredAt и period дают UNKNOWN вместо нуля', () => {
  const definition = { ...deliveryDelayMetric, operation: 'EVENT_COUNT' as const };
  const invalidEvent = calculateMetric(definition, [{ ...sent, occurredAt: 'not-a-date' }]);
  expect(invalidEvent.value).toBe('UNKNOWN');
  expect(invalidEvent.missingData).toContain('occurredAt');
  const invalidPeriod = calculateMetric({ ...definition, period: { from: 'broken', to: 'also-broken' } }, [sent]);
  expect(invalidPeriod.value).toBe('UNKNOWN');
  expect(invalidPeriod.missingData).toContain('period');
});

it('RR08: снимок ветви получает новый snapshotId и актуальный stateHash', () => {
  const official = officialBranch();
  official.events = [makeReplayArchive().events[2]];
  official.snapshot = { ...official.snapshot, stateHash: snapshotStateHash(official.snapshot.state) };
  official.state = { ...official.state, domains: { ...official.state.domains, Resources: { changed: true } } };
  const branch = createBranch(official, { branchId: 'snapshot-identity' });
  expect(branch.snapshot.snapshotId).not.toBe(official.snapshot.snapshotId);
  expect(branch.snapshot.stateHash).toBe(snapshotStateHash(branch.state));
  expect(() => restoreSnapshot(branch.snapshot)).not.toThrow();
});
