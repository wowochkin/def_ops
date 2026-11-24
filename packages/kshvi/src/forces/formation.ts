export type FormationEchelon = Readonly<{
  id: string;
  order: number;
  forceIds: readonly string[];
  areaId: string;
  readyAt: string;
  dependsOn: readonly string[];
}>;

export type FormationReserve = Readonly<{
  id: string;
  forceIds: readonly string[];
  areaId: string;
  readyAt: string;
  dependsOn: readonly string[];
}>;

export type FormationSupportGroup = Readonly<{
  id: string;
  forceIds: readonly string[];
  areaId: string;
  readyAt: string;
  dependsOn: readonly string[];
}>;

export type FormationColumn = Readonly<{
  id: string;
  echelonId: string;
  forceIds: readonly string[];
  routeId: string;
  startAt: string;
  endAt: string;
  loadTonnes: number | null;
  transportRequired: number;
}>;

export type FormationArea = Readonly<{
  id: string;
  kind: 'AREA' | 'ZONE' | 'POSITION' | 'LINE' | 'DIRECTION';
  capacityForces: number | null;
}>;

export type FormationRoute = Readonly<{
  id: string;
  status: 'OPEN' | 'CLOSED' | 'UNKNOWN';
  capacityColumns: number | null;
  crossingCapacityTonnes: number | null;
  intersectsRouteIds: readonly string[];
}>;

export type FormationControlPost = Readonly<{
  id: string;
  role: 'MAIN' | 'ALTERNATE';
  nodeId: string;
  available: boolean;
}>;

export type FormationPlan = Readonly<{
  id: string;
  orderVersion: number;
  orderIssuedAt: string;
  orderReceivedAt: string | null;
  echelons: readonly FormationEchelon[];
  reserves: readonly FormationReserve[];
  supportGroups: readonly FormationSupportGroup[];
  columns: readonly FormationColumn[];
  areas: readonly FormationArea[];
  routes: readonly FormationRoute[];
  controlPosts: readonly FormationControlPost[];
  logistics: Readonly<{
    transportAvailable: number | null;
    communicationsAvailable: boolean | null;
    requiredStocks: Readonly<Record<string, number | null>>;
    availableStocks: Readonly<Record<string, number | null>>;
  }>;
}>;

export type FormationRoutePosition = Readonly<{
  routeLengthMeters: number;
  remainingMeters: number;
  travelledMeters: number;
  delayMinutes: number;
}>;

export type FormationExecutionElement = Readonly<{
  elementId: string;
  stage: 'AWAITING_ORDER' | 'PREPARATION' | 'EXECUTION' | 'PARTIAL' | 'COMPLETED' | 'FAILED' | 'SUSPENDED';
  route: FormationRoutePosition | null;
  reportIds: readonly string[];
}>;

export type FormationExecutionStatus = Readonly<{
  planId: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'PARTIAL' | 'COMPLETED' | 'FAILED';
  completedElementIds: readonly string[];
  pendingElementIds: readonly string[];
  positions: Readonly<Record<string, FormationRoutePosition>>;
  reportIds: readonly string[];
}>;

/** Сводка не перемещает силы в район назначения до фактического прибытия и доклада. */
export function formationExecutionStatus(plan: FormationPlan, elements: readonly FormationExecutionElement[]): FormationExecutionStatus {
  const expected = [...plan.echelons, ...plan.reserves, ...plan.supportGroups].map(item => item.id);
  const byId = new Map(elements.map(item => [item.elementId, item]));
  const completedElementIds = expected.filter(id => byId.get(id)?.stage === 'COMPLETED' && (byId.get(id)?.reportIds.length ?? 0) > 0);
  const pendingElementIds = expected.filter(id => !completedElementIds.includes(id));
  const positions: Record<string, FormationRoutePosition> = {};
  const reportIds: string[] = [];
  for (const item of elements) {
    if (item.route) positions[item.elementId] = { ...item.route };
    for (const reportId of item.reportIds) if (!reportIds.includes(reportId)) reportIds.push(reportId);
  }
  const hasProgress = elements.some(item => item.stage === 'COMPLETED' || item.stage === 'PARTIAL' || item.stage === 'FAILED' || (item.route?.travelledMeters ?? 0) > 0);
  const allFailed = expected.length > 0 && expected.every(id => byId.get(id)?.stage === 'FAILED');
  const status = pendingElementIds.length === 0
    ? 'COMPLETED'
    : allFailed
      ? 'FAILED'
      : hasProgress
        ? 'PARTIAL'
        : elements.some(item => item.stage === 'EXECUTION' || item.stage === 'PREPARATION' || item.stage === 'SUSPENDED') ? 'IN_PROGRESS' : 'NOT_STARTED';
  return { planId: plan.id, status, completedElementIds, pendingElementIds, positions, reportIds };
}
