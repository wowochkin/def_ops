import { describe, expect, it } from 'vitest';
import { aggregateEpisode, type EpisodeInput } from '../src/simulation/aggregate';
import { calculate, approveCalculation, applyCalculation, type CalculateOptions } from '../src/simulation/calculation';
import { explainCalculation } from '../src/simulation/explanation';
import { overrideCalculation } from '../src/simulation/manual-override';

const passport = {
  purpose: 'Учебный детерминированный расчёт эпизода',
  limitations: ['Не прогнозирует реальную победу', 'Требует утверждённых входов'],
  source: { kind: 'ASSUMPTION' as const, note: 'Учебное допущение для проверки контура', applicability: 'Только учебный эпизод G2' },
  knownErrors: ['Не учитывает незаданные факторы'],
  examples: [{ input: { onHand: 2, consumption: 3, supplied: 0 }, expected: { onHand: 0, deficit: 1 } }],
  approvedBy: 'Методист КШВИ', version: 1,
};

const episode: EpisodeInput = {
  state: { posture: 'DEFENCE' },
  forces: {
    blue: { components: [{ id: 'infantry', q: 10, r: 0.8, a: 1 }, { id: 'support', q: 4, r: 0.5, a: 1 }] },
    red: { components: [{ id: 'infantry', q: 3, r: 0.5, a: 1 }] },
  },
  task: { id: 'task-1', status: 'IN_PROGRESS', progressPercent: 20 },
  resource: { id: 'fuel', unit: 'L', onHand: 10, consumption: 14, supplied: 2 },
  elapsedMinutes: 30,
  position: { remainingMeters: 5000, travelledMeters: 1000 },
  uncertainty: { weather: 'REPORTED', enemyComposition: 'UNKNOWN' },
  effects: { taskProgressDelta: 50, positionAdvanceMeters: 2500, stateChanges: { posture: 'MOVING' }, uncertaintyChanges: { weather: 'CONFIRMED' } },
};

function options(mode: CalculateOptions['mode'] = 'DETERMINISTIC'): CalculateOptions {
  return {
    id: `calc-${mode.toLowerCase()}-1`, mode, reason: 'Расчёт исполнения приказа order-1', createdAt: '2030-01-01T01:30:00Z',
    inputSnapshot: { worldRevision: 7, episodeId: 'episode-1' }, inputs: { episode, weatherFactor: 0.8 },
    requiredInputs: ['weatherFactor'], units: { fuel: 'L', position: 'm', elapsed: 'min' },
    modelVersion: 'aggregate-v1', profileVersions: { episode: 'episode-profile-v2' }, modelPassport: passport,
  };
}

describe('агрегированный эпизод', () => {
  it('сохраняет ресурсный баланс, дефицит и все измерения исхода без порога 3:1', () => {
    const result = aggregateEpisode(episode);
    expect(result.intermediate.potentialBySide).toEqual({ blue: 10, red: 1.5 });
    expect(result.result.resources.fuel).toEqual({ onHand: 0, consumed: 12, supplied: 2, deficit: 2, unit: 'L' });
    expect(result.result.task).toEqual({ id: 'task-1', status: 'PARTIALLY_COMPLETED', progressPercent: 70 });
    expect(result.result.state).toEqual({ posture: 'MOVING' });
    expect(result.result.elapsedMinutes).toBe(30);
    expect(result.result.position).toEqual({ remainingMeters: 2500, travelledMeters: 3500 });
    expect(result.result.uncertainty).toEqual({ weather: 'CONFIRMED', enemyComposition: 'UNKNOWN' });
    expect(JSON.stringify(result)).not.toContain('winner');
    expect(JSON.stringify(result)).not.toContain('3:1');
  });

  it('не создаёт ресурсы и не откатывает пройденный путь при чрезмерном движении', () => {
    const result = aggregateEpisode({ ...episode, resource: { ...episode.resource, onHand: 0, consumption: 0, supplied: 0 }, effects: { ...episode.effects, positionAdvanceMeters: 9000 } });
    expect(result.result.resources.fuel).toMatchObject({ onHand: 0, consumed: 0, supplied: 0, deficit: 0 });
    expect(result.result.position).toEqual({ remainingMeters: 0, travelledMeters: 6000 });
  });

  it('отклоняет неизвестные обязательные компоненты потенциала', () => {
    expect(() => aggregateEpisode({ ...episode, forces: { blue: { components: [{ id: 'unknown', q: Number.NaN, r: 1, a: 1 }] } } })).toThrow('числов');
  });
});

describe('режимы и состояния расчёта', () => {
  it('детерминированный расчёт хранит хеш, версии, единицы, входы и промежуточные результаты', () => {
    const calculation = calculate(options());
    expect(calculation.state).toBe('CALCULATED');
    expect(calculation.mode).toBe('DETERMINISTIC');
    expect(calculation.inputHash).toMatch(/^[0-9a-f]{64}$/);
    expect(calculation.modelVersion).toBe('aggregate-v1');
    expect(calculation.profileVersions).toEqual({ episode: 'episode-profile-v2' });
    expect(calculation.units.position).toBe('m');
    expect(calculation.intermediateResults).toHaveProperty('potentialBySide');
    expect(calculation.appliedEventIds).toEqual([]);
    expect(calculate(options())).toEqual(calculation);
  });

  it('обязательный пробел даёт REQUIRES_REVIEW вместо коэффициента 1', () => {
    const input = options();
    input.inputs.weatherFactor = null;
    const calculation = calculate(input);
    expect(calculation.state).toBe('REQUIRES_REVIEW');
    expect(calculation.unknown).toEqual(['weatherFactor']);
    expect(calculation.result).toBeNull();
    expect(calculation.warnings.join(' ')).toContain('weatherFactor');
    expect(JSON.stringify(calculation.result)).not.toContain('1');
  });

  it('стохастический расчёт сохраняет ключ и выбирает тот же исход при повторе', () => {
    const input: CalculateOptions = {
      ...options('STOCHASTIC'),
      stochastic: {
        key: { seed: 7n, exerciseId: 'exercise-1', branchId: 'branch-1', purpose: 'episode-outcome', ordinal: 4, algorithmVersion: 1 },
        outcomes: [
          { id: 'delayed', weight: 1, effects: { taskProgressDelta: 20, positionAdvanceMeters: 500, stateChanges: {}, uncertaintyChanges: {} } },
          { id: 'planned', weight: 3, effects: episode.effects },
        ],
      },
    };
    const first = calculate(input);
    const replay = calculate(input);
    expect(first).toEqual(replay);
    expect(first.randomKeys).toHaveLength(1);
    expect(first.randomKeys[0]).toMatchObject({ purpose: 'episode-outcome', ordinal: 4, algorithmVersion: 1, seed: '7n' });
    expect(first.randomKeys[0].digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.intermediateResults.selectedOutcomeId).toBe(first.intermediateResults.selectedOutcomeId);
    expect(first.inputHash).toBe(replay.inputHash);
  });

  it('гибрид требует явного рассмотрения перечисленных параметров', () => {
    const calculation = calculate({ ...options('HYBRID'), hybridReviewParameters: ['weatherFactor', 'manualAssumption'] });
    expect(calculation.state).toBe('REQUIRES_REVIEW');
    expect(calculation.reviewParameters).toEqual(['weatherFactor', 'manualAssumption']);
    expect(() => approveCalculation(calculation, { author: 'leader', authorized: true })).toThrow('параметры');
    const approved = approveCalculation(calculation, { author: 'leader', authorized: true, reviewedParameters: { weatherFactor: 0.8, manualAssumption: 'Принято руководителем' } });
    expect(approved.state).toBe('APPROVED');
    expect(approved.approvedBy).toBe('leader');
    expect(approved.hybridReview?.reviewedParameters).toHaveProperty('manualAssumption');
  });

  it('проводит только CALCULATED → APPROVED → APPLIED и не применяет без полномочия', () => {
    const calculated = calculate(options());
    expect(() => applyCalculation(calculated, { authorized: true, appliedEventIds: ['event-1'] })).toThrow('APPROVED');
    expect(() => approveCalculation(calculated, { author: 'leader', authorized: false })).toThrow('403');
    const approved = approveCalculation(calculated, { author: 'leader', authorized: true });
    const applied = applyCalculation(approved, { authorized: true, appliedEventIds: ['event-1', 'event-2'] });
    expect(applied.state).toBe('APPLIED');
    expect(applied.appliedEventIds).toEqual(['event-1', 'event-2']);
    expect(() => approveCalculation(applied, { author: 'leader', authorized: true })).toThrow('CALCULATED');
  });

  it('не принимает модель без паспорта источника и методического утверждения', () => {
    expect(() => calculate({ ...options(), modelPassport: { ...passport, source: null } })).toThrow('источник');
    expect(() => calculate({ ...options(), modelPassport: { ...passport, approvedBy: '' } })).toThrow('утверждение');
  });
});

describe('объяснение и ручная замена', () => {
  it('сохраняет исходный расчёт после ручного решения', () => {
    const original = { id: 'c1', state: 'CALCULATED', result: { delay: 10 } } as const;
    const manual = overrideCalculation(original, { id: 'manual-1', author: 'u1', reason: 'методическое решение', result: { delay: 15 }, createdAt: '2030-01-01T02:00:00Z' });
    expect(manual.supersedes).toBe('c1');
    expect(manual.mode).toBe('MANUAL');
    expect(manual.state).toBe('CALCULATED');
    expect(manual.originalResult).toEqual({ delay: 10 });
    expect(manual.supersededCalculation.state).toBe('SUPERSEDED');
    expect(manual.evaluationEffect).toBe('UNCHANGED');
    expect(original.result.delay).toBe(10);
    expect(original.state).toBe('CALCULATED');
  });

  it('требует автора и основание ручного решения', () => {
    const original = calculate(options());
    expect(() => overrideCalculation(original, { id: 'manual-2', author: '', reason: '', result: {}, createdAt: '2030-01-01T02:00:00Z' })).toThrow('автор');
  });

  it('объясняет факторы качественно, если модель не даёт численных вкладов', () => {
    const calculation = calculate(options());
    const explanation = explainCalculation(calculation);
    expect(explanation.basis).toBe(calculation.reason);
    expect(explanation.inputs).toEqual(calculation.inputs);
    expect(explanation.unknown).toEqual([]);
    expect(explanation.approvedBy).toBeNull();
    expect(explanation.factors).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'potentialBySide', direction: 'CONTEXT', value: null }),
      expect.objectContaining({ name: 'resourceDeficit', direction: 'DECREASE', value: null }),
    ]));
    expect(JSON.stringify(explanation.events)).toContain('draft');
  });
});


it('не утверждает гибрид, пока обязательный вход остаётся неизвестным', () => {
  const input = { ...options('HYBRID'), hybridReviewParameters: ['manualAssumption'] };
  input.inputs.weatherFactor = null;
  const calculation = calculate(input);
  expect(calculation.unknown).toEqual(['weatherFactor']);
  expect(() => approveCalculation(calculation, { author: 'leader', authorized: true, reviewedParameters: { manualAssumption: 'Принято' } })).toThrow('неизвестн');
});
