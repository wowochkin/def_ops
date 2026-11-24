export function percentile(values: readonly number[], quantile: number): number {
  if (!values.length) throw new Error('Для перцентиля нужны измерения');
  if (quantile <= 0 || quantile > 1) throw new Error('Квантиль должна быть в диапазоне (0; 1]');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export type LatencyDistribution = Readonly<{
  samples: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  rawMs: readonly number[];
}>;

export function createLatencyDistribution(values: readonly number[]): LatencyDistribution {
  if (!values.length) throw new Error('Для распределения нужны измерения');
  if (values.some(value => !Number.isFinite(value) || value < 0)) throw new Error('Измерения должны быть конечные и неотрицательные');
  return {
    samples: values.length,
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
    p99Ms: percentile(values, 0.99),
    maxMs: Math.max(...values),
    rawMs: [...values],
  };
}

export type LoadPhaseReport = Readonly<{
  targetRate: number;
  achievedRate: number;
  durationSeconds: number;
  commands: number;
}>;

export type LoadReport = Readonly<{
  connections: number;
  activeParticipants: number;
  deliveryP95Ms: number;
  mapP95Ms: number;
  confirmedLost: number;
  duplicateEffects: number;
  orderingErrors: number;
  deliveryMissing: number;
  sustained: LoadPhaseReport;
  burst: LoadPhaseReport;
  dataset: Readonly<{ instances: number; forces: number; events: number }>;
  heavyJobs: Readonly<{ attempted: number; completed: number; maxRunning: number }>;
}>;

export function evaluateLoadThresholds(report: LoadReport): string[] {
  const issues: string[] = [];
  if (report.connections !== 50) issues.push('CONNECTIONS_REQUIRED');
  if (report.activeParticipants < 25) issues.push('INSUFFICIENT_ACTIVE_PARTICIPANTS');
  if (!Number.isFinite(report.deliveryP95Ms)) issues.push('DELIVERY_MEASUREMENTS_MISSING');
  else if (report.deliveryP95Ms > 5000) issues.push('DELIVERY_P95_EXCEEDED');
  if (!Number.isFinite(report.mapP95Ms)) issues.push('MAP_MEASUREMENTS_MISSING');
  else if (report.mapP95Ms > 2000) issues.push('MAP_P95_EXCEEDED');
  if (report.confirmedLost > 0) issues.push('CONFIRMED_LOST');
  if (report.duplicateEffects > 0) issues.push('DUPLICATE_EFFECTS');
  if (report.orderingErrors > 0) issues.push('ORDERING_ERRORS');
  if (report.deliveryMissing > 0) issues.push('DELIVERY_MISSING');
  if (report.sustained.achievedRate <= report.sustained.targetRate * 0.95) issues.push('SUSTAINED_RATE_NOT_MET');
  if (report.burst.achievedRate <= report.burst.targetRate * 0.95) issues.push('BURST_RATE_NOT_MET');
  if (report.burst.durationSeconds < 60) issues.push('BURST_DURATION_NOT_MET');
  if (report.burst.commands < report.burst.targetRate * 60) issues.push('BURST_COMMANDS_NOT_MET');
  if (report.dataset.instances < 100) issues.push('DATASET_INSTANCES_NOT_MET');
  if (report.dataset.forces < 1000) issues.push('DATASET_FORCES_NOT_MET');
  if (report.dataset.events < 10_000) issues.push('DATASET_EVENTS_NOT_MET');
  if (report.heavyJobs.attempted < 4 || report.heavyJobs.completed !== report.heavyJobs.attempted) issues.push('HEAVY_JOBS_INCOMPLETE');
  if (report.heavyJobs.maxRunning > 2) issues.push('HEAVY_JOB_ISOLATION_EXCEEDED');
  return issues;
}
