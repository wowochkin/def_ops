import { expect, it } from 'vitest';
import { evaluateLoadThresholds, percentile } from '../../src/performance/latency-collector';

it('считает p50/p95/p99 по распределению, а не по среднему', () => {
  const values = Array.from({ length: 100 }, (_, index) => index + 1);
  expect(percentile(values, 0.5)).toBe(50);
  expect(percentile(values, 0.95)).toBe(95);
  expect(percentile(values, 0.99)).toBe(99);
});

it('принимает эталонную нагрузку и отклоняет потери и нарушение p95', () => {
  const base = { connections: 50, activeParticipants: 25, deliveryP95Ms: 4999, mapP95Ms: 1999, confirmedLost: 0, duplicateEffects: 0, orderingErrors: 0 };
  expect(evaluateLoadThresholds(base)).toEqual([]);
  expect(evaluateLoadThresholds({ ...base, deliveryP95Ms: 5001 })).toContain('DELIVERY_P95_EXCEEDED');
  expect(evaluateLoadThresholds({ ...base, mapP95Ms: 2001 })).toContain('MAP_P95_EXCEEDED');
  expect(evaluateLoadThresholds({ ...base, confirmedLost: 1 })).toContain('CONFIRMED_LOST');
  expect(evaluateLoadThresholds({ ...base, duplicateEffects: 1 })).toContain('DUPLICATE_EFFECTS');
  expect(evaluateLoadThresholds({ ...base, orderingErrors: 1 })).toContain('ORDERING_ERRORS');
  expect(evaluateLoadThresholds({ ...base, activeParticipants: 24 })).toContain('INSUFFICIENT_ACTIVE_PARTICIPANTS');
});
