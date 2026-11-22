import { crossingDecision } from './crossing-queue';
import type { MovementClass, TerrainObject, TerrainState } from './types';

export type RoutePosition = Readonly<{ remainingMeters: number; travelledMeters: number }>;
export type RouteEdgeCost = Readonly<{
  speedKph: number | null;
  closed: boolean;
  queueDelayMinutes?: number;
  reason?: string;
}>;

export function routeCost(position: RoutePosition, edge: RouteEdgeCost): Readonly<{
  status: 'OPEN' | 'CLOSED' | 'REQUIRES_REVIEW';
  remainingMeters: number;
  travelledMeters: number;
  durationMinutes: number | null;
  explanation: string;
}> {
  const base = { remainingMeters: position.remainingMeters, travelledMeters: position.travelledMeters };
  if (edge.closed) return { ...base, status: 'CLOSED', durationMinutes: null, explanation: edge.reason ?? 'Участок маршрута закрыт' };
  if (edge.speedKph === null || !Number.isFinite(edge.speedKph) || edge.speedKph <= 0 || !Number.isFinite(position.remainingMeters) || position.remainingMeters < 0) {
    return { ...base, status: 'REQUIRES_REVIEW', durationMinutes: null, explanation: 'Скорость или остаток пути неизвестны' };
  }
  const queue = edge.queueDelayMinutes ?? 0;
  if (!Number.isFinite(queue) || queue < 0) return { ...base, status: 'REQUIRES_REVIEW', durationMinutes: null, explanation: 'Неизвестна задержка очереди' };
  const durationMinutes = Number((position.remainingMeters / 1000 / edge.speedKph * 60 + queue).toFixed(12));
  return { ...base, status: 'OPEN', durationMinutes, explanation: queue ? `Включена задержка очереди ${queue} мин` : 'Маршрут открыт' };
}

export type RouteGraphEdge = Readonly<{
  id: string;
  from: string;
  to: string;
  distanceMeters: number;
  terrainObjectId: string;
  baseSpeedKph: number | null;
}>;

export type RouteGraph = Readonly<{
  nodes: readonly string[];
  edges: readonly RouteGraphEdge[];
}>;

export type RouteProcessEffect = Readonly<{
  purpose: RouteRequest['purpose'];
  status: 'OPEN' | 'CLOSED' | 'REQUIRES_REVIEW';
  edgeIds: readonly string[];
  delayMinutes: number | null;
  operationalAt: string;
}>;
export type RouteDomainProcesses = Readonly<{
  supply?: (effect: RouteProcessEffect) => unknown;
  evacuation?: (effect: RouteProcessEffect) => unknown;
  reconnaissance?: (effect: RouteProcessEffect) => unknown;
  agentOption?: (effect: RouteProcessEffect) => unknown;
}>;
export type RouteRequest = Readonly<{
  state: TerrainState;
  graph: RouteGraph;
  from: string;
  to: string;
  movement: Readonly<{ movementClass: MovementClass; loadTonnes: number | null; widthM?: number | null; heightM?: number | null }>;
  travelledMeters: number;
  elapsedMinutes: number;
  purpose: 'MOVEMENT' | 'SUPPLY' | 'EVACUATION' | 'RECONNAISSANCE' | 'AGENT_OPTION';
  processes?: RouteDomainProcesses;
}>;

type EvaluatedEdge = Readonly<{ costMinutes: number | null; distanceMeters: number; status: 'OPEN' | 'CLOSED' | 'REQUIRES_REVIEW' }>;
type Path = Readonly<{ edges: readonly RouteGraphEdge[]; costMinutes: number | null; requiresReview: boolean }>;

const crossingKinds = new Set(['BRIDGE', 'FORD', 'FERRY', 'PONTOON', 'ICE_CROSSING']);

function queueDelay(state: TerrainState, object: TerrainObject, durationMinutes: number): number {
  const queue = state.queues[object.id];
  if (!queue?.reservations.length || object.simultaneousCapacity === undefined && !queue.reservations.length) return 0;
  const capacity = object.simultaneousCapacity ?? 1;
  const arrival = Date.parse(state.operationalAt);
  const duration = durationMinutes * 60000;
  let start = arrival;
  for (;;) {
    const overlapping = queue.reservations.filter(value => Date.parse(value.startAt) < start + duration && Date.parse(value.endAt) > start);
    if (overlapping.length < capacity) return (start - arrival) / 60000;
    start = Math.min(...overlapping.map(value => Date.parse(value.endAt)));
  }
}

function evaluate(state: TerrainState, edge: RouteGraphEdge, request: RouteRequest, ignoreStatus: boolean): EvaluatedEdge {
  const object = state.objects[edge.terrainObjectId];
  if (!object) return { costMinutes: null, distanceMeters: edge.distanceMeters, status: 'REQUIRES_REVIEW' };
  if (!ignoreStatus) {
    if (crossingKinds.has(object.kind)) {
      const decision = crossingDecision(request.movement, object);
      if (decision !== 'ALLOWED') return { costMinutes: null, distanceMeters: edge.distanceMeters, status: decision === 'BLOCKED' ? 'CLOSED' : 'REQUIRES_REVIEW' };
    } else if (object.status === 'CLOSED') return { costMinutes: null, distanceMeters: edge.distanceMeters, status: 'CLOSED' };
    else if (object.status === 'UNKNOWN') return { costMinutes: null, distanceMeters: edge.distanceMeters, status: 'REQUIRES_REVIEW' };
  }
  const ownSpeed = object.speedKph?.[request.movement.movementClass];
  const speed = ownSpeed === undefined ? edge.baseSpeedKph : ownSpeed;
  if (speed === null || !Number.isFinite(speed) || speed <= 0 || !Number.isFinite(edge.distanceMeters) || edge.distanceMeters < 0) {
    return { costMinutes: null, distanceMeters: edge.distanceMeters, status: 'REQUIRES_REVIEW' };
  }
  const drivingMinutes = edge.distanceMeters / 1000 / speed * 60;
  if (object.crossingMinutes === null) return { costMinutes: null, distanceMeters: edge.distanceMeters, status: 'REQUIRES_REVIEW' };
  const duration = crossingKinds.has(object.kind) ? Math.max(drivingMinutes, object.crossingMinutes ?? 0) : drivingMinutes;
  const wait = ignoreStatus ? 0 : queueDelay(state, object, duration);
  return { costMinutes: duration + wait, distanceMeters: edge.distanceMeters, status: 'OPEN' };
}

function shortest(request: RouteRequest, ignoreStatus: boolean): Path {
  if (request.from === request.to) return { edges: [], costMinutes: 0, requiresReview: false };
  const distances = new Map<string, number>(request.graph.nodes.map(node => [node, node === request.from ? 0 : Number.POSITIVE_INFINITY]));
  const previous = new Map<string, RouteGraphEdge>();
  const unvisited = new Set(request.graph.nodes);
  let requiresReview = false;
  while (unvisited.size) {
    const node = [...unvisited].sort((a, b) => (distances.get(a)! - (distances.get(b) ?? Number.POSITIVE_INFINITY) || a.localeCompare(b)))[0];
    unvisited.delete(node);
    const distance = distances.get(node)!;
    if (!Number.isFinite(distance) || node === request.to) break;
    for (const edge of request.graph.edges.filter(value => value.from === node).sort((a, b) => a.id.localeCompare(b.id))) {
      if (!unvisited.has(edge.to)) continue;
      const evaluated = evaluate(request.state, edge, request, ignoreStatus);
      if (evaluated.status === 'REQUIRES_REVIEW') requiresReview = true;
      if (evaluated.costMinutes === null) continue;
      const candidate = distance + evaluated.costMinutes;
      if (candidate < distances.get(edge.to)!) {
        distances.set(edge.to, candidate);
        previous.set(edge.to, edge);
      }
    }
  }
  const cost = distances.get(request.to) ?? Number.POSITIVE_INFINITY;
  if (!Number.isFinite(cost)) return { edges: [], costMinutes: null, requiresReview };
  const edges: RouteGraphEdge[] = [];
  let node = request.to;
  while (node !== request.from) {
    const edge = previous.get(node);
    if (!edge) return { edges: [], costMinutes: null, requiresReview };
    edges.unshift(edge);
    node = edge.from;
  }
  return { edges, costMinutes: cost, requiresReview };
}

export function recalculateRoute(request: RouteRequest): Readonly<{
  status: 'OPEN' | 'CLOSED' | 'REQUIRES_REVIEW';
  graphVersion: number;
  edgeIds: readonly string[];
  remainingMeters: number | null;
  travelledMeters: number;
  elapsedMinutes: number;
  costMinutes: number | null;
  arrivalDelayMinutes: number | null;
  effects: Readonly<{
    route: 'UNCHANGED' | 'REROUTED' | 'BLOCKED' | 'REQUIRES_REVIEW';
    movement: 'OPEN' | 'DELAYED' | 'BLOCKED' | 'REQUIRES_REVIEW';
    supply: 'PLANNED' | 'DELAYED' | 'BLOCKED' | 'REQUIRES_REVIEW';
    evacuation: 'PLANNED' | 'DELAYED' | 'BLOCKED' | 'REQUIRES_REVIEW';
    reconnaissance: 'PLANNED' | 'DELAYED' | 'BLOCKED' | 'REQUIRES_REVIEW';
    agentOption: 'AVAILABLE' | 'DELAYED' | 'BLOCKED' | 'REQUIRES_REVIEW';
  }>;
  processResults: Readonly<Partial<Record<keyof RouteDomainProcesses, unknown>>>;
  explanation: readonly string[];
}> {
  const actual = shortest(request, false);
  const baseline = shortest(request, true);
  const actualIds = actual.edges.map(edge => edge.id);
  const baselineIds = baseline.edges.map(edge => edge.id);
  const blocked = actual.costMinutes === null;
  const status = !blocked ? 'OPEN' : actual.requiresReview ? 'REQUIRES_REVIEW' : 'CLOSED';
  const review = status === 'REQUIRES_REVIEW';
  const rerouted = !blocked && canonicalIds(actualIds) !== canonicalIds(baselineIds);
  const delay = blocked || baseline.costMinutes === null ? null : Math.max(0, actual.costMinutes! - baseline.costMinutes);
  const delayed = delay !== null && delay > 1e-9;
  const affectedObjectIds = new Set(baseline.edges.filter(edge => !actualIds.includes(edge.id)).map(edge => edge.terrainObjectId));
  const reasons = request.state.history.filter(event => affectedObjectIds.has(event.objectId)).map(event => event.reason);
  const explanation = review
    ? ['Проходимость возможного маршрута неизвестна; требуется разведка или проверка', ...reasons]
    : blocked
      ? ['Нет открытого маршрута от фактической точки', ...reasons]
      : [`Пересчёт от фактической точки: пройдено ${request.travelledMeters} м, затрачено ${request.elapsedMinutes} мин`, ...reasons];
  const effect = <T extends string>(open: T, slowed: T, closed: T): T | 'REQUIRES_REVIEW' => review ? 'REQUIRES_REVIEW' : blocked ? closed : delayed ? slowed : open;
  const processResults: Partial<Record<keyof RouteDomainProcesses, unknown>> = {};
  const processEffect: RouteProcessEffect = { purpose: request.purpose, status, edgeIds: actualIds, delayMinutes: delay, operationalAt: request.state.operationalAt };
  for (const key of ['supply', 'evacuation', 'reconnaissance', 'agentOption'] as const) {
    const process = request.processes?.[key];
    if (process) processResults[key] = process(processEffect);
  }
  return {
    status,
    graphVersion: request.state.algorithmVersions.G_v,
    edgeIds: actualIds,
    remainingMeters: blocked ? null : actual.edges.reduce((sum, edge) => sum + edge.distanceMeters, 0),
    travelledMeters: request.travelledMeters,
    elapsedMinutes: request.elapsedMinutes,
    costMinutes: actual.costMinutes,
    arrivalDelayMinutes: delay,
    effects: {
      route: review ? 'REQUIRES_REVIEW' : blocked ? 'BLOCKED' : rerouted ? 'REROUTED' : 'UNCHANGED',
      movement: effect('OPEN', 'DELAYED', 'BLOCKED'),
      supply: effect('PLANNED', 'DELAYED', 'BLOCKED'),
      evacuation: effect('PLANNED', 'DELAYED', 'BLOCKED'),
      reconnaissance: request.processes?.reconnaissance ? effect('PLANNED', 'DELAYED', 'BLOCKED') : 'REQUIRES_REVIEW',
      agentOption: effect('AVAILABLE', 'DELAYED', 'BLOCKED'),
    },
    processResults,
    explanation: [...new Set(explanation)],
  };
}

function canonicalIds(ids: readonly string[]): string {
  return JSON.stringify(ids);
}
