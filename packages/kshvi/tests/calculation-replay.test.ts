import { expect, it } from 'vitest';
import { calculate, type CalculateOptions } from '../src/simulation/calculation';
import { canonicalJson } from '../src/events/canonical';

const base: CalculateOptions = {
  id: 'replay-stochastic-1', mode: 'STOCHASTIC', reason: 'Проверка воспроизведения', createdAt: '2030-01-01T00:00:00Z',
  inputSnapshot: { revision: 1 },
  inputs: {
    episode: {
      state: {}, forces: {}, task: { id: 't', status: 'IN_PROGRESS', progressPercent: 0 },
      resource: { id: 'fuel', unit: 'L', onHand: 5, consumption: 2, supplied: 0 }, elapsedMinutes: 10,
      position: { remainingMeters: 100, travelledMeters: 0 }, uncertainty: {},
      effects: { taskProgressDelta: 10, positionAdvanceMeters: 10, stateChanges: {}, uncertaintyChanges: {} },
    },
  }, requiredInputs: [], units: {}, modelVersion: 'aggregate-v1', profileVersions: {},
  modelPassport: {
    purpose: 'Проверка повтора', limitations: ['Только тест'], source: { kind: 'ASSUMPTION', note: 'Учебное допущение', applicability: 'Тест' },
    knownErrors: [], examples: [{ input: 1, expected: 1 }], approvedBy: 'Методист', version: 1,
  },
  stochastic: {
    key: { seed: 42n, exerciseId: 'e', branchId: 'b', purpose: 'replay', ordinal: 0, algorithmVersion: 1 },
    outcomes: [
      { id: 'a', weight: 1, effects: { taskProgressDelta: 10, positionAdvanceMeters: 10, stateChanges: {}, uncertaintyChanges: {} } },
      { id: 'b', weight: 1, effects: { taskProgressDelta: 20, positionAdvanceMeters: 20, stateChanges: {}, uncertaintyChanges: {} } },
    ],
  },
};

it('повтор в другом порядке сериализации даёт тот же результат и входной хеш', () => {
  const first = calculate(base);
  const replay = calculate({ ...base, inputs: { ...base.inputs }, profileVersions: {}, modelPassport: { ...base.modelPassport } });
  expect(canonicalJson(replay)).toBe(canonicalJson(first));
  expect(replay.inputHash).toBe(first.inputHash);
  expect(replay.randomKeys).toEqual(first.randomKeys);
});

it('другая ветвь получает отдельный случайный результат без перезаписи ключа', () => {
  const official = calculate(base);
  const branch = calculate({ ...base, id: 'replay-stochastic-branch', stochastic: { ...base.stochastic!, key: { ...base.stochastic!.key, branchId: 'branch-new' } } });
  expect(branch.randomKeys[0].branchId).toBe('branch-new');
  expect(branch.randomKeys[0].digest).not.toBe(official.randomKeys[0].digest);
  expect(official.randomKeys[0].branchId).toBe('b');
});
