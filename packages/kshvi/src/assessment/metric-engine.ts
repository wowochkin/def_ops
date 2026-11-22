import { createEvidenceLink, type EvidenceLink } from './evidence-link';
import { validateMetricDefinition, type MetricDefinition, type MetricGroup } from './metric-definition';

export { METRIC_GROUPS } from './metric-definition';
export type { MetricDefinition, MetricGroup } from './metric-definition';
export type { EvidenceLink } from './evidence-link';

export type MetricEvent = {
  eventId: string;
  sequence: number;
  type: string;
  occurredAt: string;
  payload: Record<string, unknown>;
  causeIds?: readonly string[];
};
export type MetricResult = {
  metricId: string;
  group: MetricGroup;
  formula: string;
  version: number;
  unit: string;
  period: MetricDefinition['period'];
  sourceEventTypes: readonly string[];
  methodProfile: MetricDefinition['methodProfile'];
  value: number | 'UNKNOWN';
  missingData: readonly string[];
  evidence: readonly EvidenceLink[];
};

function timestamp(event: MetricEvent, field: string): number | null {
  const value = event.payload[field];
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return null;
  return Date.parse(value);
}

export function calculateMetric(definition: MetricDefinition, events: readonly MetricEvent[]): MetricResult {
  const errors = validateMetricDefinition(definition);
  if (errors.length) throw new Error(errors.join('; '));
  const from = Date.parse(definition.period.from);
  const to = Date.parse(definition.period.to);
  const periodEvents = events.filter(event => {
    const occurredAt = Date.parse(event.occurredAt);
    return Number.isFinite(occurredAt) && occurredAt >= from && occurredAt <= to;
  });
  let value: number | 'UNKNOWN' = 'UNKNOWN';
  const missing = new Set<string>();
  const used: MetricEvent[] = [];
  if (definition.operation === 'DELIVERY_DELAY') {
    const starts = periodEvents.filter(event => event.type === definition.startEventType).sort((left, right) => left.sequence - right.sequence);
    const deliveries = periodEvents.filter(event => event.type === definition.endEventType);
    const delays: number[] = [];
    for (const start of starts) {
      used.push(start);
      const correlation = start.payload[definition.correlationKey!];
      const delivery = deliveries.find(event => event.payload[definition.correlationKey!] === correlation);
      if (!delivery) {
        missing.add('delivery.timestamp');
        continue;
      }
      used.push(delivery);
      const from = timestamp(start, 'timestamp');
      const to = timestamp(delivery, 'timestamp');
      if (from === null) missing.add('message.timestamp');
      if (to === null) missing.add('delivery.timestamp');
      if (from !== null && to !== null) delays.push((to - from) / 1000);
    }
    if (!starts.length) missing.add('message.timestamp');
    if (missing.size === 0 && delays.length) value = delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
  } else if (definition.operation === 'RATIO') {
    const numerator = periodEvents.filter(event => event.type === definition.numeratorEventType);
    const denominator = periodEvents.filter(event => event.type === definition.denominatorEventType);
    used.push(...numerator, ...denominator);
    if (!denominator.length) missing.add('denominator');
    else value = numerator.length / denominator.length * 100;
  } else {
    const matching = periodEvents.filter(event => definition.sourceEventTypes.includes(event.type));
    used.push(...matching);
    value = matching.length;
  }
  const unique = [...new Map(used.map(event => [event.eventId, event])).values()].sort((left, right) => left.sequence - right.sequence);
  return {
    metricId: definition.id,
    group: definition.group,
    formula: definition.formula,
    version: definition.version,
    unit: definition.unit,
    period: structuredClone(definition.period),
    sourceEventTypes: [...definition.sourceEventTypes],
    methodProfile: structuredClone(definition.methodProfile),
    value,
    missingData: [...missing],
    evidence: unique.map(event => createEvidenceLink(event, definition.id, event.type === definition.endEventType ? 'delivery.timestamp' : 'source.event')),
  };
}

export function compareMetricResults(left: MetricResult, right: MetricResult): { warning: string | null } {
  const incompatible = left.methodProfile.id !== right.methodProfile.id || left.methodProfile.revision !== right.methodProfile.revision;
  return { warning: incompatible ? 'Разные методические профили нельзя сравнивать без методического предупреждения' : null };
}
