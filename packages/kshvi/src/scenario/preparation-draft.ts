import { EVENT_CATEGORIES } from '../../../kshvi-events/src/model/event-template';
import type { AutonomyProfile } from '../../../kshvi-events/src/profile/autonomy-profile';
import { AUTONOMY_LEVELS } from '../../../kshvi-events/src/profile/intensity-levels';
import { EQUIPMENT_CONDITIONS, type EquipmentHolding } from '../forces/equipment';
import type { ForceDetails } from '../forces/force';
import type { FormationPlan } from '../forces/formation';
import type { ReadinessState } from '../forces/readiness';
import type { ReadinessStage } from '../forces/readiness-stage';
import type { SupplyPlan } from '../logistics/supply-request';
import { initialMapHash, type InitialSituationMap } from './initial-map';
import { INITIAL_MAP_LAYER_IDS } from './initial-map-layers';
import { validateInitialMap } from './initial-map-validation';

export type ScenarioForce = ForceDetails & Readonly<{ id: string }>;
export type PreparationDraft = Readonly<{
  schemaVersion: 1;
  environmentSnapshotId: string | null;
  initialMap: InitialSituationMap | null;
  initialMapStatus: 'DRAFT' | 'MAPPED' | 'APPROVED';
  forces: readonly ScenarioForce[];
  equipment: readonly EquipmentHolding[];
  formation: FormationPlan | null;
  logistics: SupplyPlan | null;
  autonomy: AutonomyProfile | null;
  readinessStage: ReadinessStage | null;
  readinessStates: readonly ReadinessState[];
  updatedAt: string;
}>;

export function emptyPreparationDraft(at: string): PreparationDraft {
  return {
    schemaVersion: 1, environmentSnapshotId: null, initialMap: null, initialMapStatus: 'DRAFT',
    forces: [], equipment: [], formation: null, logistics: null, autonomy: null, readinessStage: null,
    readinessStates: [], updatedAt: at,
  };
}

type Check = ((value: unknown, path: string) => void) & { optional?: true };

function invalid(path: string): never {
  throw new Error(`Некорректное значение поля ${path}`);
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(path);
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) invalid(path);
  return value as Record<string, unknown>;
}

function object(fields: Record<string, Check>): Check {
  return (value, path) => {
    const data = record(value, path);
    for (const key of Object.keys(data)) {
      if (!Object.hasOwn(fields, key)) throw new Error(`Неизвестное поле ${path}.${key}`);
    }
    for (const [key, check] of Object.entries(fields)) {
      if (!Object.hasOwn(data, key) && !check.optional) invalid(`${path}.${key}`);
      check(data[key], `${path}.${key}`);
    }
  };
}

function optional(check: Check): Check {
  const verify = (value: unknown, path: string) => { if (value !== undefined) check(value, path); };
  return Object.assign(verify, { optional: true as const });
}

function nullable(check: Check): Check {
  return (value, path) => { if (value !== null) check(value, path); };
}

function array(check: Check, min = 0): Check {
  return (value, path) => {
    if (!Array.isArray(value) || value.length < min) invalid(path);
    for (let index = 0; index < value.length; index += 1) check(value[index], `${path}[${index}]`);
  };
}

function dictionary(check: Check): Check {
  return (value, path) => {
    for (const [key, item] of Object.entries(record(value, path))) check(item, `${path}.${key}`);
  };
}

function oneOf<T>(...values: readonly T[]): Check {
  return (value, path) => { if (!values.some(item => Object.is(item, value))) invalid(path); };
}

function tagged(key: string, variants: Record<string, Check>): Check {
  return (value, path) => {
    const tag = record(value, path)[key];
    if (typeof tag !== 'string' || !Object.hasOwn(variants, tag)) invalid(`${path}.${key}`);
    variants[tag](value, path);
  };
}

function checkJson(value: unknown, path: string): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') number(value, path);
  else if (Array.isArray(value)) array(checkJson)(value, path);
  else dictionary(checkJson)(value, path);
}

const string: Check = (value, path) => { if (typeof value !== 'string') invalid(path); };
const id: Check = (value, path) => { if (typeof value !== 'string' || !value.trim()) invalid(path); };
const date: Check = (value, path) => {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) invalid(path);
};
const hash: Check = (value, path) => { if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalid(path); };
const boolean = oneOf(true, false);
const number: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value)) invalid(path); };
const nonnegative: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) invalid(path); };
const count: Check = (value, path) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid(path); };
const positiveInt: Check = (value, path) => { if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) invalid(path); };
const fraction: Check = (value, path) => { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) invalid(path); };
const ids = array(id);
const unknownJson = tagged('status', {
  KNOWN: object({ status: oneOf('KNOWN'), value: checkJson }),
  UNKNOWN: object({ status: oneOf('UNKNOWN'), reason: id }),
});

const force = object({
  id,
  identity: object({ sideId: id, nodeId: id, type: id, organizationalLevel: id, service: id, parentId: nullable(id) }),
  composition: object({ personnel: array(checkJson), units: ids, equipment: array(checkJson) }),
  state: object({
    deployed: boolean, readiness: checkJson, serviceability: checkJson, initialCapability: checkJson,
    fatigue: checkJson, training: checkJson, moralePsych: checkJson,
  }),
  position: object({ geometry: unknownJson, area: unknownJson, formation: unknownJson, route: unknownJson, movement: unknownJson, task: unknownJson }),
  supply: object({ stocks: array(checkJson), capacities: array(checkJson), consumptionNorms: array(checkJson), nodeIds: ids, routeIds: ids }),
  capabilities: object({ actions: ids, environmentLimits: array(string), reconnaissance: checkJson, communications: checkJson, interaction: checkJson }),
  uncertainty: object({ knownByNodeId: id, reportedAt: date, accuracy: nullable(fraction), completeness: nullable(fraction) }),
  source: object({ sourceId: id, reportedAt: date, accuracy: optional(fraction), completeness: optional(fraction) }),
});

function coordinates(length: number): Check {
  return (value, path) => {
    if (!Array.isArray(value) || value.length !== length || value.some((point, index) =>
      typeof point !== 'number' || !Number.isFinite(point) || Math.abs(point) > (index % 2 ? 90 : 180))) invalid(path);
    array(number)(value, path);
  };
}

const bounds: Check = (value, path) => {
  coordinates(4)(value, path);
  const [west, south, east, north] = value as number[];
  if (west >= east || south >= north) invalid(path);
};
const position = coordinates(2);
const ring: Check = (value, path) => {
  array(position, 4)(value, path);
  const points = value as [number, number][];
  const [first, last] = [points[0], points[points.length - 1]];
  if (first[0] !== last[0] || first[1] !== last[1]) invalid(path);
};
const markerKind = oneOf(
  'FORCE', 'COMMAND_POST', 'COMMUNICATION', 'LOGISTICS', 'MEDICAL', 'REPAIR',
  'AREA', 'BOUNDARY', 'COLUMN', 'ROUTE', 'OBSTACLE', 'CROSSING', 'TASK',
);
const marker = object({
  id, revision: positiveInt, kind: markerKind, layerId: oneOf(...INITIAL_MAP_LAYER_IDS), truth: oneOf('TRUTH', 'PRIVATE'),
  geometry: nullable(tagged('type', {
    Point: object({ type: oneOf('Point'), coordinates: position }),
    LineString: object({ type: oneOf('LineString'), coordinates: array(position, 2) }),
    Polygon: object({ type: oneOf('Polygon'), coordinates: array(ring, 1) }),
  })),
  sourceId: string, authorId: string, eventId: string, validFrom: date, validUntil: date, state: oneOf('OBSERVED', 'ASSUMED', 'PLANNED', 'UNKNOWN'),
  confidence: nullable(fraction), uncertainty: object({ radiusM: nullable(nonnegative), note: string }),
  visibility: object({ sideIds: optional(ids), instanceIds: optional(ids), roles: optional(ids), staffOnly: optional(boolean) }),
  links: object({ forceId: optional(id), taskId: optional(id), documentId: optional(id), linkedMarkerIds: optional(ids) }),
  sideId: id,
  symbol: object({
    id, version: id, sideId: id, status: oneOf('IMPORTED', 'MAPPED', 'VERIFIED', 'APPROVED', 'DEPRECATED'),
    sourceDocument: string, sourcePage: positiveInt,
  }),
  loadTonnes: optional(nonnegative), crossingCapacityTonnes: optional(nonnegative), passable: optional(boolean),
  routeId: optional(nullable(id)), offRoadJustification: optional(string), geometryRequired: optional(boolean),
});
const initialMap = object({
  schemaVersion: oneOf(1), id, revision: positiveInt, state: oneOf('DRAFT', 'APPROVED'), sha256: optional(hash),
  environment: object({ snapshotId: id, manifestSha256: hash, bounds }), bounds,
  initialOperationalAt: date, timeZone: id, weatherFrameRef: id, terrainStateRef: id,
  symbolSet: object({ id, revision: positiveInt, sha256: hash }), attribution: array(string),
  layers: array(object({ id: oneOf(...INITIAL_MAP_LAYER_IDS), independent: oneOf(true) })), markers: array(marker), history: array(marker),
});

const source = object({ sourceId: id, revision: positiveInt, sha256: hash, note: optional(string) });
const measure = tagged('status', {
  KNOWN: object({ status: oneOf('KNOWN'), value: nonnegative, unit: id, source }),
  UNKNOWN: object({ status: oneOf('UNKNOWN'), value: oneOf(null), unit: id, reason: id }),
});
const equipmentType = object({
  id, revision: positiveInt, sha256: hash, title: id, movementClass: id, massTonnes: measure,
  dimensions: object({ lengthM: measure, widthM: measure, heightM: measure }),
  transportCapacity: object({ payloadTonnes: measure, personnel: measure }),
  operatingResources: array(object({ resourceId: id, amountPerUnit: nonnegative, unit: id, source })),
  allowedTasks: ids, environmentLimits: array(string),
});
const equipmentCondition = oneOf(...EQUIPMENT_CONDITIONS);
const resource = object({ resourceId: id, amount: nonnegative, unit: id });
const distribution = object({ targetId: id, quantity: count, unitIds: optional(ids) });
const equipmentEvent = object({
  eventId: id, kind: oneOf('STATE_CHANGE', 'DAMAGE', 'LOSS', 'REPAIR', 'RETURN_TO_SERVICE', 'TRANSFER'), at: date,
  from: nullable(equipmentCondition), to: nullable(equipmentCondition), causeId: id, reason: string, resources: array(resource),
  availableResources: optional(array(resource)), unitId: optional(id), quantity: optional(count), allocations: optional(array(distribution)),
});
const equipmentUnit = object({
  unitId: id, serialNumber: id, state: equipmentCondition, causeId: nullable(id), assignedTo: nullable(id),
  appliedEventIds: ids, resourceBalances: dictionary(resource), history: array(equipmentEvent),
});
const equipmentSnapshot = {
  authorized: nullable(count), actual: nullable(count),
  stateCounts: object(Object.fromEntries(EQUIPMENT_CONDITIONS.map(condition => [condition, count]))),
  crew: object({ requiredPerUnit: measure, assigned: measure }), items: array(equipmentUnit), distribution: array(distribution),
};
const equipment = object({
  ...equipmentSnapshot, schemaVersion: oneOf(1), id, forceId: id, accounting: oneOf('AGGREGATE', 'INDIVIDUAL'), equipmentType,
  unallocated: nullable(count), assignments: array(object({
    assignmentId: id, kind: id, quantity: count, unitIds: optional(ids), at: date, causeId: id,
  })),
  source, initial: object(equipmentSnapshot), appliedEventIds: ids, resourceBalances: dictionary(resource), history: array(equipmentEvent),
});

const routeStatus = oneOf('OPEN', 'CLOSED', 'UNKNOWN');
const formationElement = { id, forceIds: ids, areaId: id, readyAt: date, dependsOn: ids };
const formation = object({
  id, orderVersion: positiveInt, orderIssuedAt: date, orderReceivedAt: nullable(date),
  echelons: array(object({ ...formationElement, order: count })), reserves: array(object(formationElement)),
  supportGroups: array(object(formationElement)), columns: array(object({
    id, echelonId: id, forceIds: ids, routeId: id, startAt: date, endAt: date,
    loadTonnes: nullable(nonnegative), transportRequired: count,
  })),
  areas: array(object({ id, kind: oneOf('AREA', 'ZONE', 'POSITION', 'LINE', 'DIRECTION'), capacityForces: nullable(count) })),
  routes: array(object({ id, status: routeStatus, capacityColumns: nullable(count), crossingCapacityTonnes: nullable(nonnegative), intersectsRouteIds: ids })),
  controlPosts: array(object({ id, role: oneOf('MAIN', 'ALTERNATE'), nodeId: id, available: boolean })),
  logistics: object({
    transportAvailable: nullable(count), communicationsAvailable: nullable(boolean),
    requiredStocks: dictionary(nullable(nonnegative)), availableStocks: dictionary(nullable(nonnegative)),
  }),
});

const logistics = object({
  id, actionPlanVersion: positiveInt, linkedActionPlanVersion: positiveInt, approved: boolean,
  requests: array(object({
    id, resourceId: id, unit: id, requesterNodeId: id, sourceNodeId: id, quantity: nonnegative,
    totalWeightTonnes: nullable(nonnegative), totalVolumeM3: nullable(nonnegative), priority: number,
    requiredBy: date, createdAt: date, taskIds: ids,
    status: oneOf('REQUESTED', 'ALLOCATED', 'PARTIALLY_ALLOCATED', 'BLOCKED', 'REQUIRES_REVIEW', 'CANCELLED'),
    allocatedQuantity: nonnegative, deficit: nonnegative, orderId: optional(id), allocationIds: optional(ids),
    history: array(object({ at: date, actorId: id, basis: id, previousPriority: number, priority: number })),
  })),
  actionTasks: array(object({ taskId: id, resourceId: id, requiredQuantity: nonnegative, requiredBy: date })),
  routes: array(object({ routeId: id, requestIds: ids, status: routeStatus })),
  reserves: dictionary(nullable(nonnegative)), reportingSchedule: array(object({ taskId: id, reportAt: date })),
});

const autonomy = object({
  schemaVersion: oneOf(1), profileId: id, level: oneOf(...AUTONOMY_LEVELS),
  methodicalProfile: object({ profileId: id, version: positiveInt }),
  settings: object({
    attemptsPerOperationalHour: nonnegative, intervalMinutes: positiveInt,
    maxEventsPerInterval: count, maxEventsPerStage: count, maxSeverityCost: nonnegative,
    severityBudgetPerStage: nonnegative, maxCascadeDepth: count, maxCascadeEvents: count, manualApprovalShare: fraction,
  }),
  distribution: oneOf('POISSON'),
  intensity: object({
    categories: object(Object.fromEntries(EVENT_CATEGORIES.map(category => [category, optional(nonnegative)]))),
    stages: dictionary(nonnegative), sides: dictionary(nonnegative), areas: dictionary(nonnegative),
  }),
});

const activity = object({
  id, kind: oneOf('SIGNAL', 'MANNING', 'ORGANIZATION', 'EQUIPMENT', 'AREA', 'COMMAND_POST', 'COMMUNICATIONS',
    'SUPPLIES', 'DEPLOYMENT', 'ENGINEERING', 'INTERACTION', 'REPORT'),
  title: id, responsibleNodeId: id, startAt: date, dueAt: date, durationMinutes: nonnegative, dependsOn: ids, requiresSignal: boolean,
  preconditions: array(object({ id, met: nullable(boolean), details: string })),
  resources: array(object({ resourceId: id, unit: id, required: nonnegative, available: nullable(nonnegative) })),
  reportRequired: boolean, criterion: object({ id, description: string }),
});
const readinessStage = object({
  id, title: id, startsAt: date, dueAt: date, signal: object({ id, sentAt: date, senderNodeId: id }),
  activities: array(activity), completionCriterionIds: ids, adverseOutcomes: array(oneOf('PARTIAL', 'FAILED')),
});
const limitationCode = oneOf(
  'SIGNAL_NOT_RECEIVED', 'PERSONNEL_SHORTAGE', 'EQUIPMENT_UNSERVICEABLE', 'SUPPLIES_NOT_REPLENISHED', 'AREA_NOT_OCCUPIED',
  'COMMUNICATIONS_UNAVAILABLE', 'DEPENDENCY_NOT_COMPLETED', 'RESOURCE_SHORTAGE', 'RESOURCE_UNKNOWN', 'REPORT_NOT_RECEIVED',
  'CRITERION_NOT_MET', 'PRECONDITION_NOT_MET', 'PRECONDITION_UNKNOWN', 'ACTIVITY_NOT_DUE', 'DEADLINE_MISSED', 'LEVEL_UNKNOWN',
  'ACTIVITY_FAILED', 'UNKNOWN_ACTIVITY',
);
const readinessState = object({
  subjectId: id, subjectKind: oneOf('FORCE', 'COMMAND_POST'), initialLevel: nullable(number), requiredLevel: nullable(number),
  status: oneOf('NOT_STARTED', 'IN_PROGRESS', 'READY', 'PARTIAL', 'FAILED'),
  actualStartedAt: optional(date), actualCompletedAt: optional(date), signalReceipt: optional(object({ signalId: id, receivedAt: date })),
  completedActivityIds: ids, activityRecords: array(object({
    activityId: id, status: oneOf('COMPLETED', 'FAILED'), startedAt: date, completedAt: date, reportId: nullable(id),
  })),
  reports: array(object({ id, activityId: optional(id), authorId: id, submittedAt: date, text: string })),
  criterionResults: dictionary(nullable(boolean)),
  limitations: array(object({ code: limitationCode, activityId: optional(id), since: date, details: string })),
  authorizations: array(object({
    decisionId: id, actorId: id, actorRole: id, authorities: ids, orderId: id, limitations: array(limitationCode),
    consumedByOrderId: optional(id), authorized: boolean, basis: string, rationale: string, at: date,
  })),
  history: array(object({
    id, at: date, kind: oneOf('SIGNAL_RECEIVED', 'ACTIVITY_COMPLETED', 'ACTIVITY_FAILED', 'PARTIAL_AUTHORIZED'),
    causeId: id, details: string,
  })),
});

const shape = object({
  schemaVersion: oneOf(1), environmentSnapshotId: nullable(id), initialMap: nullable(initialMap),
  initialMapStatus: oneOf('DRAFT', 'MAPPED', 'APPROVED'), forces: array(force), equipment: array(equipment),
  formation: nullable(formation), logistics: nullable(logistics), autonomy: nullable(autonomy),
  readinessStage: nullable(readinessStage), readinessStates: array(readinessState), updatedAt: date,
} satisfies Record<keyof PreparationDraft, Check>);

function uniqueIds(items: readonly { id: string }[], label: string): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error(`Повторяющийся идентификатор ${label}: ${item.id}`);
    ids.add(item.id);
  }
  return ids;
}

function requireReference(id: string, existing: ReadonlySet<string>, label: string): void {
  if (!existing.has(id)) throw new Error(`Не найдена ссылка ${label}: ${id}`);
}

function checkInitialMap(draft: PreparationDraft, forceIds: ReadonlySet<string>): void {
  const map = draft.initialMap;
  if (!map) {
    if (draft.initialMapStatus !== 'DRAFT') throw new Error('Статус нанесённой обстановки требует исходную карту');
    return;
  }
  if (map.environment.snapshotId !== draft.environmentSnapshotId) throw new Error('Исходная карта ссылается на другой снимок среды');
  if (!map.bounds.every((coordinate, index) => coordinate === map.environment.bounds[index])) {
    throw new Error('Границы исходной карты должны совпадать с границами снимка');
  }
  const markerIds = uniqueIds(map.markers, 'объекта исходной карты');
  const routeIds = new Set(map.markers.filter(item => item.kind === 'ROUTE').map(item => item.id));
  const layerIds = uniqueIds(map.layers, 'слоя исходной карты');
  for (const item of map.markers) {
    requireReference(item.layerId, layerIds, 'на слой');
    if (item.links.forceId) requireReference(item.links.forceId, forceIds, 'на силу');
    if (item.routeId) requireReference(item.routeId, routeIds, 'на маршрут');
    for (const linked of item.links.linkedMarkerIds ?? []) requireReference(linked, markerIds, 'на объект карты');
  }
  if (draft.initialMapStatus === 'APPROVED') {
    if (map.state !== 'APPROVED' || map.sha256 !== initialMapHash(map)) throw new Error('Статус утверждённой карты требует верный SHA-256');
  } else if (map.state !== 'DRAFT' || map.sha256 !== undefined) {
    throw new Error('Состояние или SHA-256 исходной карты не соответствует статусу черновика');
  }
  if (draft.initialMapStatus !== 'DRAFT') {
    if (!map.markers.some(item => item.geometry !== null)) throw new Error('Статус нанесённой карты требует геометрию на карте');
    const issues = validateInitialMap(map).filter(issue => issue.severity === 'ERROR'
      && (draft.initialMapStatus === 'APPROVED' || ['INVALID_GEOMETRY', 'OUTSIDE_BOUNDS', 'MAP_LAYER_REQUIRED'].includes(issue.code)));
    if (issues.length) throw new Error(issues.map(issue => issue.message).join(', '));
  }
}

function checkReferences(draft: PreparationDraft): void {
  const forceIds = uniqueIds(draft.forces, 'силы');
  uniqueIds(draft.equipment, 'учёта техники');
  for (const holding of draft.equipment) requireReference(holding.forceId, forceIds, 'техники на силу');
  checkInitialMap(draft, forceIds);
  const { formation, logistics, readinessStage } = draft;
  if (formation) {
    const elements = [...formation.echelons, ...formation.reserves, ...formation.supportGroups];
    const elementIds = uniqueIds(elements, 'элемента построения');
    const echelonIds = new Set(formation.echelons.map(item => item.id));
    const areaIds = uniqueIds(formation.areas, 'района построения');
    const routeIds = uniqueIds(formation.routes, 'маршрута построения');
    uniqueIds(formation.columns, 'колонны');
    for (const item of [...elements, ...formation.columns]) {
      for (const id of item.forceIds) requireReference(id, forceIds, 'построения на силу');
    }
    for (const item of elements) {
      requireReference(item.areaId, areaIds, 'на район построения');
      for (const id of item.dependsOn) requireReference(id, elementIds, 'на элемент построения');
    }
    for (const item of formation.columns) {
      requireReference(item.echelonId, echelonIds, 'на эшелон колонны');
      requireReference(item.routeId, routeIds, 'на маршрут колонны');
    }
    for (const item of formation.routes) {
      for (const id of item.intersectsRouteIds) requireReference(id, routeIds, 'на пересекаемый маршрут');
    }
  }
  if (logistics) {
    const requestIds = uniqueIds(logistics.requests, 'заявки МТО');
    for (const route of logistics.routes) {
      for (const id of route.requestIds) requireReference(id, requestIds, 'маршрута на заявку МТО');
    }
  }
  if (readinessStage) {
    const activityIds = uniqueIds(readinessStage.activities, 'мероприятия готовности');
    for (const item of readinessStage.activities) {
      for (const id of item.dependsOn) requireReference(id, activityIds, 'на мероприятие готовности');
    }
  }
  const postIds = new Set([
    ...formation?.controlPosts.map(item => item.id) ?? [],
    ...draft.initialMap?.markers.filter(item => item.kind === 'COMMAND_POST').map(item => item.id) ?? [],
  ]);
  for (const item of draft.readinessStates) {
    requireReference(item.subjectId, item.subjectKind === 'FORCE' ? forceIds : postIds, 'состояния готовности');
  }
}

/** Структура JSON и ссылки внутри черновика. Сервер дополнительно проверяет снимок и полномочия. */
export function validatePreparationDraft(value: unknown): PreparationDraft {
  const draft = record(value, 'preparation');
  if (draft.schemaVersion !== 1) throw new Error('Неизвестная версия черновика подготовки');
  if (draft.initialMapStatus !== 'DRAFT' && draft.initialMapStatus !== 'MAPPED' && draft.initialMapStatus !== 'APPROVED') {
    throw new Error('Неизвестный статус исходной карты');
  }
  shape(draft, 'preparation');
  const result = value as PreparationDraft;
  checkReferences(result);
  return result;
}
