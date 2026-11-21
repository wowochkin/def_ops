import type { MetricDefinition, MetricEvent } from '../../src/assessment/metric-engine';

export const deliveryDelayMetric: MetricDefinition = {
  id: 'communication.delivery-delay', group: 'COMMUNICATIONS', formula: 'avg(delivery.timestamp - message.timestamp)',
  version: 1, unit: 's', period: { from: '2026-11-21T00:00:00Z', to: '2026-11-22T00:00:00Z' },
  sourceEventTypes: ['message.sent', 'message.delivered'], missingDataPolicy: 'UNKNOWN', methodProfile: { id: 'default', revision: 1 },
  operation: 'DELIVERY_DELAY', startEventType: 'message.sent', endEventType: 'message.delivered', correlationKey: 'messageId',
};

export const sent: MetricEvent = {
  eventId: 'sent-1', sequence: 1, type: 'message.sent', occurredAt: '2026-11-21T06:00:00.000Z', payload: { messageId: 'm1', timestamp: '2026-11-21T06:00:00.000Z' }, causeIds: [],
};
