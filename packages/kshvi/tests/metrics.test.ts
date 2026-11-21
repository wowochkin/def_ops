import { expect, it } from 'vitest';
import { calculateMetric, compareMetricResults, METRIC_GROUPS, type MetricDefinition, type MetricEvent } from '../src/assessment/metric-engine';
import { validateMetricDefinition } from '../src/assessment/metric-definition';
import { deliveryDelayMetric, sent } from './fixtures/metric-fixture';

it('не заменяет пропущенные события нулевой задержкой', () => {
  const result = calculateMetric(deliveryDelayMetric, [sent]);
  expect(result.value).toBe('UNKNOWN');
  expect(result.missingData).toContain('delivery.timestamp');
  expect(result.evidence.length).toBeGreaterThan(0);
  expect(result.evidence[0]).toMatchObject({ eventId: 'sent-1', sequence: 1, calculationId: deliveryDelayMetric.id });
});

it('вычисляет версионную формулу с единицами и доказательствами', () => {
  const delivered: MetricEvent = { ...sent, eventId: 'delivered-1', sequence: 2, type: 'message.delivered', occurredAt: '2026-11-21T06:00:07.000Z', payload: { messageId: 'm1', timestamp: '2026-11-21T06:00:07.000Z' }, causeIds: ['sent-1'] };
  const result = calculateMetric(deliveryDelayMetric, [sent, delivered]);
  expect(result.value).toBe(7);
  expect(result).toMatchObject({ formula: deliveryDelayMetric.formula, version: 1, unit: 's', period: deliveryDelayMetric.period, missingData: [] });
  expect(result.evidence.map(link => link.eventId)).toEqual(['sent-1', 'delivered-1']);
  expect(compareMetricResults(result, { ...result, methodProfile: { id: 'other', revision: 2 } }).warning).toContain('методические профили');
});

it('охватывает семь групп и требует полный машинный контракт', () => {
  expect(METRIC_GROUPS).toEqual(['TIMELINESS', 'DOCUMENTS', 'COORDINATION', 'COMMUNICATIONS', 'RESOURCES', 'SITUATION', 'INTENT']);
  for (const group of METRIC_GROUPS) expect(validateMetricDefinition({ ...deliveryDelayMetric, id: group, group })).toEqual([]);
  expect(validateMetricDefinition({ ...deliveryDelayMetric, formula: '' })).toContain('Нужна формула метрики');
  expect(validateMetricDefinition({ ...deliveryDelayMetric, sourceEventTypes: [] })).toContain('Нужен источник событий');
});

it('не превращает нулевой знаменатель или пропуск в процент', () => {
  const ratio: MetricDefinition = {
    ...deliveryDelayMetric, id: 'delivery-ratio', formula: 'delivered / sent * 100', unit: '%', operation: 'RATIO',
    numeratorEventType: 'message.delivered', denominatorEventType: 'message.sent',
  };
  const result = calculateMetric(ratio, []);
  expect(result.value).toBe('UNKNOWN');
  expect(result.missingData).toContain('denominator');
  expect(result.value).not.toBe(0);
});
