import { expect, it } from 'vitest';
import { resourceBalance, resourceBalanceFromLedger, supplyServiceMetrics } from '../src/logistics/balance';
import { projectResourceLedger } from '../src/logistics/ledger';
import { createSupplyRequest, validateSupplyPlan, type SupplyPlan } from '../src/logistics/supply-request';

const T0 = '2030-01-01T06:00:00.000Z';
const T1 = '2030-01-01T07:00:00.000Z';

function request(): ReturnType<typeof createSupplyRequest> {
  return createSupplyRequest({
    id: 'request-1', resourceId: 'fuel', unit: 'tonne', requesterNodeId: 'force-1', sourceNodeId: 'warehouse',
    quantity: 20, totalWeightTonnes: 20, totalVolumeM3: 20, priority: 10, requiredBy: T1, createdAt: T0, taskIds: ['task-1'],
  });
}

function plan(): SupplyPlan {
  return {
    id: 'logistics-plan-1', actionPlanVersion: 3, linkedActionPlanVersion: 3,
    requests: [{ ...request(), status: 'ALLOCATED', allocatedQuantity: 20, deficit: 0, orderId: 'order-1' }],
    actionTasks: [{ taskId: 'task-1', resourceId: 'fuel', requiredQuantity: 20, requiredBy: T1 }],
    routes: [{ routeId: 'route-1', requestIds: ['request-1'], status: 'OPEN' }],
    reserves: { fuel: 5 },
    reportingSchedule: [{ taskId: 'task-1', reportAt: T1 }],
    approved: false,
  };
}

it('LOG-06: выявляет несогласованность плана действий и плана МТО до утверждения', () => {
  const valid = validateSupplyPlan(plan());
  expect(valid.valid).toBe(true);
  const mismatch = validateSupplyPlan({
    ...plan(), linkedActionPlanVersion: 2, approved: true,
    requests: [{ ...plan().requests[0], allocatedQuantity: 10, deficit: 10, requiredBy: '2030-01-01T08:00:00.000Z' }],
    routes: [], reserves: {}, reportingSchedule: [],
  });
  expect(mismatch.valid).toBe(false);
  expect(mismatch.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
    'PLAN_VERSION_MISMATCH', 'REQUEST_QUANTITY_SHORTAGE', 'REQUEST_LATE', 'ROUTE_MISSING', 'RESERVE_NOT_PLANNED', 'REPORT_SCHEDULE_MISSING', 'PLAN_NOT_CONSISTENT',
  ]));
});

it('LOG-08: своевременность не скрывает частичные и непоставленные заявки', () => {
  const metrics = supplyServiceMetrics([
    { requestId: 'on-time', requiredBy: T1, deliveredAt: T0, quantity: 10, deliveredQuantity: 10, status: 'DELIVERED', delayMinutes: 0 },
    { requestId: 'partial', requiredBy: T1, deliveredAt: T1, quantity: 10, deliveredQuantity: 4, status: 'PARTIALLY_DELIVERED', delayMinutes: 20 },
    { requestId: 'missing', requiredBy: T1, deliveredAt: null, quantity: 10, deliveredQuantity: 0, status: 'DELAYED', delayMinutes: 30 },
  ]);
  expect(metrics.onTimeRate).toBe(1 / 3);
  expect(metrics.onTimeRequestIds).toEqual(['on-time']);
  expect(metrics.partialRequestIds).toEqual(['partial']);
  expect(metrics.undeliveredRequestIds).toEqual(['missing']);
  expect(metrics.delayedRequestIds).toEqual(['partial', 'missing']);
  expect(metrics.totalRequested).toBe(30);
  expect(metrics.totalDelivered).toBe(14);
});

it('неизвестный дефицит и отсутствующая номенклатура не возвращаются как нули', () => {
  const balance = resourceBalance({ initial: 10, received: 0, onHand: 10, inTransit: 0, consumed: 0, lost: 0, deficit: null });
  expect(balance.status).toBe('REQUIRES_REVIEW');
  expect(balance.deficit).toBeNull();
  const missing = resourceBalanceFromLedger(projectResourceLedger([]), 'unknown-resource');
  expect(missing.status).toBe('REQUIRES_REVIEW');
  expect(missing.unknown).toContain('resource:missing');
});

it('отличает неизвестный резерв от нулевого или отсутствующего', () => {
  const result = validateSupplyPlan({ ...plan(), reserves: { fuel: null } });
  expect(result.valid).toBe(false);
  expect(result.issues).toContainEqual(expect.objectContaining({ code: 'RESERVE_UNKNOWN', severity: 'REVIEW' }));
  expect(result.issues.map(issue => issue.code)).not.toContain('RESERVE_NOT_PLANNED');
});
