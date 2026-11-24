export type TechnicalMetric = Readonly<{
  correlationId: string;
  action: string;
  durationMs: number;
  queueDepth: number;
  sseDeliveryMs: number;
  projectionErrors: number;
  calculationMs: number;
  journalBytes: number;
  backupBytes: number;
  componentVersion: string;
}>;

export function percentile(values: readonly number[], percentileRatio: number): number {
  if (!values.length) throw new Error('Для распределения нужны измерения');
  if (percentileRatio <= 0 || percentileRatio > 1) throw new Error('Процентиль должен быть в интервале (0; 1]');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * percentileRatio) - 1)];
}

export class MetricsService {
  private readonly records = new Map<string, TechnicalMetric[]>();

  record(input: TechnicalMetric & Record<string, unknown>): void {
    const metric: TechnicalMetric = Object.freeze({
      correlationId: input.correlationId, action: input.action, durationMs: input.durationMs,
      queueDepth: input.queueDepth, sseDeliveryMs: input.sseDeliveryMs, projectionErrors: input.projectionErrors,
      calculationMs: input.calculationMs, journalBytes: input.journalBytes, backupBytes: input.backupBytes,
      componentVersion: input.componentVersion,
    });
    this.records.set(metric.correlationId, [...(this.records.get(metric.correlationId) ?? []), metric]);
  }

  trace(correlationId: string): TechnicalMetric[] {
    return (this.records.get(correlationId) ?? []).map(metric => structuredClone(metric));
  }

  distribution(correlationId: string, field: 'durationMs' | 'sseDeliveryMs' | 'calculationMs'): { count: number; p95: number; max: number } | null {
    const values = this.trace(correlationId).map(metric => metric[field]);
    return values.length ? { count: values.length, p95: percentile(values, 0.95), max: Math.max(...values) } : null;
  }
}
