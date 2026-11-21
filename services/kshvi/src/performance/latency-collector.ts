export function percentile(values: readonly number[], quantile: number): number {
  if (!values.length) throw new Error('Для перцентиля нужны измерения');
  if (quantile <= 0 || quantile > 1) throw new Error('Квантиль должна быть в диапазоне (0; 1]');
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * quantile) - 1)];
}

export type LoadReport = {
  connections: number;
  activeParticipants: number;
  deliveryP95Ms: number;
  mapP95Ms: number;
  confirmedLost: number;
  duplicateEffects: number;
  orderingErrors: number;
};

export function evaluateLoadThresholds(report: LoadReport): string[] {
  const issues: string[] = [];
  if (report.connections !== 50) issues.push('CONNECTIONS_REQUIRED');
  if (report.activeParticipants < 25) issues.push('INSUFFICIENT_ACTIVE_PARTICIPANTS');
  if (report.deliveryP95Ms > 5000) issues.push('DELIVERY_P95_EXCEEDED');
  if (report.mapP95Ms > 2000) issues.push('MAP_P95_EXCEEDED');
  if (report.confirmedLost > 0) issues.push('CONFIRMED_LOST');
  if (report.duplicateEffects > 0) issues.push('DUPLICATE_EFFECTS');
  if (report.orderingErrors > 0) issues.push('ORDERING_ERRORS');
  return issues;
}
