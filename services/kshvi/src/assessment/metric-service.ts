import {
  calculateMetric,
  compareMetricResults,
  type MetricDefinition,
  type MetricEvent,
  type MetricResult,
} from '../../../../packages/kshvi/src/assessment/metric-engine';

export class MetricService {
  calculate(definition: MetricDefinition, events: readonly MetricEvent[]): MetricResult {
    return calculateMetric(definition, events);
  }

  compare(left: MetricResult, right: MetricResult): { warning: string | null } {
    return compareMetricResults(left, right);
  }
}
