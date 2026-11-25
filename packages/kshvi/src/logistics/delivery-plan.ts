import { recalculateRoute, type RouteGraph } from '../terrain/route-graph';
import type { TerrainState } from '../terrain/types';
import {
  allocateSupplyRequests,
  type SupplyAllocation,
  type SupplyPlan,
  type SupplyRequest,
  type SupplyTransport,
} from './supply-request';

export type SupplyDeliveryPreview = Readonly<{
  status: 'OPEN' | 'CLOSED' | 'REQUIRES_REVIEW' | 'LATE';
  request: SupplyRequest;
  allocations: readonly SupplyAllocation[];
  transports: readonly SupplyTransport[];
  routeStatus: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  remainingQuantity: number | null;
  distanceMeters: number | null;
  durationMinutes: number | null;
  arrivalAt: string | null;
  issues: readonly string[];
  explanation: readonly string[];
}>;

/** Плановый расчёт не создаёт движение и не увеличивает запас получателя. */
export function planSupplyDelivery(input: Readonly<{
  plan: SupplyPlan | null;
  request: SupplyRequest;
  routeId: string;
  terrain: Readonly<{ state: TerrainState; graph: RouteGraph }>;
  transports?: readonly SupplyTransport[];
  availableQuantity?: number | null;
}>): SupplyDeliveryPreview {
  const request = input.request;
  const route = recalculateRoute({
    state: input.terrain.state,
    graph: input.terrain.graph,
    from: request.sourceNodeId,
    to: request.requesterNodeId,
    movement: { movementClass: 'WHEELED', loadTonnes: request.totalWeightTonnes },
    travelledMeters: 0,
    elapsedMinutes: 0,
    purpose: 'SUPPLY',
  });
  const routeStatus: SupplyDeliveryPreview['routeStatus'] = route.status === 'OPEN' ? 'OPEN' : route.status === 'CLOSED' ? 'CLOSED' : 'UNKNOWN';
  const distanceMeters = route.remainingMeters;
  const durationMinutes = route.costMinutes;
  const arrivalAt = durationMinutes === null ? null : new Date(Date.parse(request.createdAt) + durationMinutes * 60000).toISOString();
  const base = {
    allocations: [], transports: input.transports ?? input.plan?.transports ?? [], routeStatus,
    distanceMeters, durationMinutes, arrivalAt, explanation: route.explanation,
  };
  if (route.status !== 'OPEN' || input.routeId && !route.edgeIds.includes(input.routeId)) {
    return {
      ...base,
      status: route.status === 'OPEN' ? 'CLOSED' : route.status,
      request: { ...request, status: route.status === 'REQUIRES_REVIEW' ? 'REQUIRES_REVIEW' : 'BLOCKED', allocatedQuantity: 0, deficit: request.quantity },
      remainingQuantity: input.availableQuantity ?? input.plan?.reserves[request.resourceId] ?? null,
      issues: route.status === 'OPEN' ? ['Выбранный маршрут не входит в доступный путь доставки'] : [...route.explanation],
    };
  }

  const availableQuantity = input.availableQuantity ?? input.plan?.reserves[request.resourceId] ?? null;
  const allocation = allocateSupplyRequests([request], {
    availableQuantity,
    transports: input.transports ?? input.plan?.transports ?? [],
    orderId: `delivery-preview:${request.id}`,
    at: request.createdAt,
    actorId: 'supply-planner',
  });
  const allocated = allocation.requests[0]!;
  const allocatedQuantity = allocation.allocations.reduce((sum, item) => sum + item.quantity, 0);
  const remainingQuantity = availableQuantity === null ? null : Math.max(0, availableQuantity - allocatedQuantity);
  const late = arrivalAt !== null && Date.parse(arrivalAt) > Date.parse(request.requiredBy);
  return {
    ...base,
    status: late ? 'LATE' : 'OPEN',
    request: allocated,
    allocations: allocation.allocations,
    transports: allocation.transports,
    remainingQuantity,
    issues: [...allocation.issues.map(issue => issue.message), ...(late ? [`Расчётное прибытие ${arrivalAt} позже требуемого срока ${request.requiredBy}`] : [])],
  };
}
