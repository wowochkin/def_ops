import { describe, expect, it } from 'vitest';
import { createObservation, type CreateObservationInput, type Observation } from '../src/simulation/observation';
import { mergeObservations } from '../src/simulation/observation-merge';
import { markStale, projectObservation, projectObservationChannels } from '../src/simulation/observation-projection';

const input: CreateObservationInput = {
  id: 'observation-1', trueForceId: 'secret-force-id', trueGeometry: { lon: 37.6, lat: 55.7 },
  trueAttributes: { type: 'motorized', readiness: 'hidden-readiness', personnel: 1000 },
  observedAt: '2030-01-01T00:00:00Z',
  source: {
    id: 'sensor-1', kind: 'UAV', sideId: 'blue', profileVersion: 'uav-profile-v2',
    errorMeters: { min: 20, max: 100 }, delaySeconds: { min: 10, max: 60 },
    completeness: 0.75, reliability: 0.8, validitySeconds: 600, attributeKeys: ['type'],
  },
  environment: { snapshotId: 'environment-1', errorMultiplier: 1.5, delayMultiplier: 2 },
  randomKey: { seed: 11n, exerciseId: 'exercise-1', branchId: 'branch-1', purpose: 'observation', ordinal: 0, algorithmVersion: 1 },
};

describe('создание наблюдения', () => {
  it('создаёт донесение с источником, задержкой, точностью и сроком, а не копию истинного объекта', () => {
    const observation = createObservation(input);
    expect(observation.id).toBe('observation-1');
    expect(observation.trueForceId).toBe('secret-force-id');
    expect(observation.source).toMatchObject({ id: 'sensor-1', kind: 'UAV', profileVersion: 'uav-profile-v2' });
    expect(observation.reportedAttributes).toEqual({ type: 'motorized' });
    expect(observation.reportedAttributes).not.toHaveProperty('readiness');
    expect(observation.reportedAccuracyMeters).toBe(150);
    expect(observation.actualErrorMeters).toBeGreaterThanOrEqual(30);
    expect(observation.actualErrorMeters).toBeLessThanOrEqual(150);
    expect(Date.parse(observation.deliveredAt)).toBeGreaterThan(Date.parse(observation.observedAt));
    expect(Date.parse(observation.deliveredAt)).toBeLessThanOrEqual(Date.parse(observation.observedAt) + 120_000);
    expect(observation.validUntil).toBe('2030-01-01T00:10:00.000Z');
    expect(observation.completeness).toBe(0.75);
    expect(observation.reliability).toBe(0.8);
    expect(observation.randomKeys.map(key => key.ordinal)).toEqual([0, 1, 2]);
    expect(observation.reportedGeometry).not.toEqual(input.trueGeometry);
  });

  it('повторяет ошибку и задержку по сохранённым ключам и меняет их в другой ветви', () => {
    const first = createObservation(input);
    const replay = createObservation(input);
    const branch = createObservation({ ...input, randomKey: { ...input.randomKey, branchId: 'branch-2' } });
    expect(replay).toEqual(first);
    expect(branch.actualErrorMeters).not.toBe(first.actualErrorMeters);
    expect(first.randomKeys[0].branchId).toBe('branch-1');
  });

  it('не подставляет нулевую погоду или идеальную точность при пробеле профиля', () => {
    expect(() => createObservation({ ...input, environment: { ...input.environment, errorMultiplier: Number.NaN } })).toThrow('среды');
    expect(() => createObservation({ ...input, source: { ...input.source, reliability: 0 } })).toThrow('достоверность');
  });
});

describe('проекция и устаревание', () => {
  it('не раскрывает истинный id и фактическую ошибку', () => {
    const result = projectObservation({ id: 'o1', trueForceId: 'secret', actualErrorMeters: 12, reportedAccuracyMeters: 100, observedAt: 't1' });
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(JSON.stringify(result)).not.toContain('actualErrorMeters');
    expect(result).toEqual({ id: 'o1', reportedAccuracyMeters: 100, observedAt: 't1' });
  });

  it('использует один санитизированный контракт для API, SSE, поиска, реплея и агента', () => {
    const observation = createObservation(input);
    const channels = projectObservationChannels(observation);
    for (const channel of Object.values(channels)) {
      expect(JSON.stringify(channel)).not.toContain('secret-force-id');
      expect(JSON.stringify(channel)).not.toContain('actualErrorMeters');
      expect(JSON.stringify(channel)).not.toContain('hidden-readiness');
      expect(JSON.stringify(channel)).not.toContain('randomKeys');
    }
    expect(channels.agentInput).toEqual(channels.api);
  });

  it('устаревание помечает наблюдение, но не удаляет его', () => {
    const observation = createObservation(input);
    const stale = markStale(observation, '2030-01-01T00:11:00Z');
    expect(stale.status).toBe('STALE');
    expect(stale.id).toBe(observation.id);
    expect(stale.reportedGeometry).toEqual(observation.reportedGeometry);
    expect(projectObservation(stale)).toMatchObject({ status: 'STALE', staleSince: '2030-01-01T00:11:00.000Z' });
    expect(observation.status).toBe('CURRENT');
  });
});

describe('версионное слияние', () => {
  it('сохраняет исходные доклады и связывает объединённое наблюдение', () => {
    const first = createObservation(input);
    const second = createObservation({ ...input, id: 'observation-2', observedAt: '2030-01-01T00:01:00Z', randomKey: { ...input.randomKey, ordinal: 10 } });
    const result = mergeObservations([first, second], { id: 'merged-1', ruleVersion: 1 });
    expect(result.merged.mergedFrom).toEqual(['observation-1', 'observation-2']);
    expect(result.merged.mergeRuleVersion).toBe(1);
    expect(result.originals).toEqual([first, second]);
    expect(result.originals[0]).not.toBe(first);
    expect(result.merged.reportedAccuracyMeters).toBe(150);
    expect(result.originals[0].id).toBe('observation-1');
    expect(JSON.stringify(projectObservation(result.merged))).not.toContain('secret-force-id');
    expect(JSON.stringify(projectObservation(result.merged))).not.toContain('actualErrorMeters');
  });

  it('не смешивает наблюдения разных сторон и требует поддерживаемую версию правила', () => {
    const first = createObservation(input);
    const other = createObservation({ ...input, id: 'observation-red', source: { ...input.source, sideId: 'red' } });
    expect(() => mergeObservations([first, other], { id: 'bad', ruleVersion: 1 })).toThrow('сторон');
    expect(() => mergeObservations([first], { id: 'bad-version', ruleVersion: 99 })).toThrow('версия');
  });
});

it('не изменяет исходное наблюдение при сериализации проекции', () => {
  const observation: Observation = createObservation(input);
  const before = structuredClone(observation);
  const projected = projectObservation(observation);
  expect(observation).toEqual(before);
  expect(Object.keys(projected)).not.toContain('trueForceId');
});
