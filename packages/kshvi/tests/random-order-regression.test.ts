import { expect, it } from 'vitest';
import { chooseStochasticOutcome } from '../src/simulation/stochastic';

const key = { seed: 7n, exerciseId: 'e', branchId: 'b', purpose: 'contact', ordinal: 4, algorithmVersion: 1 } as const;
const effects = { taskProgressDelta: 0, positionAdvanceMeters: 0, stateChanges: {}, uncertaintyChanges: {} } as const;
const a = { id: 'a', weight: 1, effects };
const b = { id: 'b', weight: 1, effects };

it('не зависит от сетевого порядка одинакового набора стохастических исходов', () => {
  const first = chooseStochasticOutcome([a, b], key);
  const reordered = chooseStochasticOutcome([b, a], key);
  expect(reordered.outcome.id).toBe(first.outcome.id);
  expect(reordered.randomKey).toEqual(first.randomKey);
});
