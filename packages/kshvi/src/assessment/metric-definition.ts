export const METRIC_GROUPS = ['TIMELINESS', 'DOCUMENTS', 'COORDINATION', 'COMMUNICATIONS', 'RESOURCES', 'SITUATION', 'INTENT'] as const;
export type MetricGroup = typeof METRIC_GROUPS[number];
export type MetricOperation = 'DELIVERY_DELAY' | 'RATIO' | 'EVENT_COUNT';
export type MetricDefinition = {
  id: string;
  group: MetricGroup;
  formula: string;
  version: number;
  unit: string;
  period: { from: string; to: string };
  sourceEventTypes: readonly string[];
  missingDataPolicy: 'UNKNOWN';
  methodProfile: { id: string; revision: number };
  operation: MetricOperation;
  startEventType?: string;
  endEventType?: string;
  correlationKey?: string;
  numeratorEventType?: string;
  denominatorEventType?: string;
};

export function validateMetricDefinition(definition: MetricDefinition): string[] {
  const errors: string[] = [];
  if (!definition.id.trim()) errors.push('Нужен идентификатор метрики');
  if (!definition.formula.trim()) errors.push('Нужна формула метрики');
  if (!Number.isSafeInteger(definition.version) || definition.version < 1) errors.push('Нужна версия метрики');
  if (!definition.unit.trim()) errors.push('Нужны единицы метрики');
  if (!definition.period.from || !definition.period.to) errors.push('Нужен период метрики');
  if (!definition.sourceEventTypes.length) errors.push('Нужен источник событий');
  if (definition.missingDataPolicy !== 'UNKNOWN') errors.push('Пропуски должны давать UNKNOWN');
  if (definition.operation === 'DELIVERY_DELAY' && (!definition.startEventType || !definition.endEventType || !definition.correlationKey)) {
    errors.push('Метрике задержки нужны типы событий и ключ сопоставления');
  }
  if (definition.operation === 'RATIO' && (!definition.numeratorEventType || !definition.denominatorEventType)) {
    errors.push('Метрике отношения нужны числитель и знаменатель');
  }
  return errors;
}
