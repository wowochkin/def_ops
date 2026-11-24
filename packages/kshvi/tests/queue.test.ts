import { expect, it } from 'vitest';
import { orderActions } from '../src/runtime/queue';

it('упорядочивает действия независимо от сетевого порядка', () => {
  const actions = [
    { operationalAt: '2030-01-01T00:00:00Z', priority: 2, dependencyOrder: 0, sequence: 9 },
    { operationalAt: '2030-01-01T00:00:00Z', priority: 1, dependencyOrder: 0, sequence: 10 },
    { operationalAt: '2030-01-01T00:00:00Z', priority: 1, dependencyOrder: 1, sequence: 8 },
  ];
  expect(orderActions(actions).map(action => action.sequence)).toEqual([10, 8, 9]);
});

it('не изменяет исходный массив сетевых действий', () => {
  const actions = [{ operationalAt: '2030-01-01T00:00:00Z', priority: 2, dependencyOrder: 0, sequence: 9 }, { operationalAt: '2030-01-01T00:00:00Z', priority: 1, dependencyOrder: 0, sequence: 10 }];
  const original = structuredClone(actions);
  orderActions(actions);
  expect(actions).toEqual(original);
});
