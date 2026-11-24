import { expect, it } from 'vitest';
import { createLatencyDistribution, evaluateLoadThresholds, percentile, type LoadReport } from '../../src/performance/latency-collector';

it('считает p50/p95/p99 по распределению, а не по среднему', () => {
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  expect(percentile(values, 0.5)).toBe(50);
  expect(percentile(values, 0.95)).toBe(95);
  expect(percentile(values, 0.99)).toBe(99);
  expect(createLatencyDistribution([100, 1, 50])).toEqual({ samples: 3, p50Ms: 50, p95Ms: 100, p99Ms: 100, maxMs: 100, rawMs: [100, 1, 50] });
  expect(() => createLatencyDistribution([])).toThrow('измерения');
  expect(() => createLatencyDistribution([Number.NaN])).toThrow('конечные');
});

const base: LoadReport = {
  connections: 50,
  activeParticipants: 25,
  deliveryP95Ms: 4999,
  mapP95Ms: 1999,
  confirmedLost: 0,
  duplicateEffects: 0,
  orderingErrors: 0,
  deliveryMissing: 0,
  sustained: { targetRate: 5, achievedRate: 5, durationSeconds: 60, commands: 300 },
  burst: { targetRate: 20, achievedRate: 20, durationSeconds: 60, commands: 1200 },
  dataset: { instances: 100, forces: 1000, events: 10_000 },
  heavyJobs: { attempted: 4, completed: 4, maxRunning: 2 },
};

it('принимает эталонную нагрузку и отклоняет потери и нарушение p95', () => {
  expect(evaluateLoadThresholds(base)).toEqual([]);
  expect(evaluateLoadThresholds({ ...base, deliveryP95Ms: 5001 })).toContain('DELIVERY_P95_EXCEEDED');
  expect(evaluateLoadThresholds({ ...base, mapP95Ms: 2001 })).toContain('MAP_P95_EXCEEDED');
  expect(evaluateLoadThresholds({ ...base, confirmedLost: 1 })).toContain('CONFIRMED_LOST');
  expect(evaluateLoadThresholds({ ...base, duplicateEffects: 1 })).toContain('DUPLICATE_EFFECTS');
  expect(evaluateLoadThresholds({ ...base, orderingErrors: 1 })).toContain('ORDERING_ERRORS');
  expect(evaluateLoadThresholds({ ...base, activeParticipants: 24 })).toContain('INSUFFICIENT_ACTIVE_PARTICIPANTS');
  expect(evaluateLoadThresholds({ ...base, deliveryMissing: 1 })).toContain('DELIVERY_MISSING');
});

it('отклоняет неполный стенд, неподтверждённый темп и отсутствие изолированных заданий', () => {
  expect(evaluateLoadThresholds({ ...base, sustained: { ...base.sustained, achievedRate: 4 } })).toContain('SUSTAINED_RATE_NOT_MET');
  expect(evaluateLoadThresholds({ ...base, burst: { ...base.burst, durationSeconds: 59 } })).toContain('BURST_DURATION_NOT_MET');
  expect(evaluateLoadThresholds({ ...base, burst: { ...base.burst, achievedRate: 19 } })).toContain('BURST_RATE_NOT_MET');
  expect(evaluateLoadThresholds({ ...base, dataset: { ...base.dataset, events: 9999 } })).toContain('DATASET_EVENTS_NOT_MET');
  expect(evaluateLoadThresholds({ ...base, heavyJobs: { attempted: 4, completed: 3, maxRunning: 2 } })).toContain('HEAVY_JOBS_INCOMPLETE');
  expect(evaluateLoadThresholds({ ...base, heavyJobs: { attempted: 4, completed: 4, maxRunning: 3 } })).toContain('HEAVY_JOB_ISOLATION_EXCEEDED');
});
