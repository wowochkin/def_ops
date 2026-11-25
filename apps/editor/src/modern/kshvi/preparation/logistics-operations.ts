import type { PreparationDraft } from '@def-ops/kshvi/preparation-draft';
import type { SupplyDeliveryPreview } from '../../../../../../packages/kshvi/src/logistics/delivery-plan';
import type { SupplyPlan, SupplyRequest } from '../../../../../../packages/kshvi/src/logistics/supply-request';

export function emptySupplyPlan(): SupplyPlan {
  return {
    id: crypto.randomUUID(), actionPlanVersion: 1, linkedActionPlanVersion: 1,
    requests: [], actionTasks: [], routes: [], reserves: {}, reportingSchedule: [], approved: false,
    transports: [{
      id: 'transport-1', status: 'SERVICEABLE', remainingCapacityQuantity: 1000,
      remainingWeightTonnes: 100, remainingVolumeM3: 100,
    }],
    nodes: [],
  };
}

export function applySupplyPreview(draft: PreparationDraft, input: {
  request: SupplyRequest;
  preview: SupplyDeliveryPreview;
  routeId: string;
  availableQuantity: number;
}): PreparationDraft {
  const current = draft.logistics ?? emptySupplyPlan();
  const requests = [...current.requests.filter(item => item.id !== input.request.id), input.preview.request];
  const routes = [...current.routes.filter(route => !route.requestIds.includes(input.request.id))];
  routes.push({ routeId: input.routeId, requestIds: [input.request.id], status: input.preview.routeStatus });
  const plan: SupplyPlan = {
    ...current, requests, routes,
    reserves: { ...current.reserves, [input.request.resourceId]: input.preview.remainingQuantity },
    transports: input.preview.transports,
  };
  return { ...draft, logistics: plan };
}
