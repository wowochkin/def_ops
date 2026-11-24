import type { FormationColumn, FormationPlan } from './formation';

export type FormationIssueCode =
  | 'FORCE_ASSIGNMENT_CONFLICT'
  | 'COLUMN_FORCE_MISMATCH'
  | 'AREA_NOT_FOUND'
  | 'AREA_CAPACITY_EXCEEDED'
  | 'AREA_CAPACITY_UNKNOWN'
  | 'ROUTE_NOT_FOUND'
  | 'ROUTE_CLOSED'
  | 'ROUTE_CAPACITY_EXCEEDED'
  | 'ROUTE_CAPACITY_UNKNOWN'
  | 'ROUTE_INTERSECTION'
  | 'CROSSING_OVERLOAD'
  | 'CROSSING_CAPACITY_UNKNOWN'
  | 'TRANSPORT_SHORTAGE'
  | 'TRANSPORT_UNKNOWN'
  | 'SUPPLY_DEFICIT'
  | 'SUPPLY_UNKNOWN'
  | 'COMMUNICATIONS_UNAVAILABLE'
  | 'COMMUNICATIONS_UNKNOWN'
  | 'ORDER_NOT_RECEIVED'
  | 'ORDER_NOT_DELIVERED_IN_TIME'
  | 'INVALID_TIMING'
  | 'DEPENDENCY_TIMING'
  | 'CONTROL_POST_MISSING'
  | 'CONTROL_POST_UNAVAILABLE';

export type FormationIssue = Readonly<{
  code: FormationIssueCode;
  severity: 'ERROR' | 'WARNING' | 'REVIEW';
  message: string;
  refs: readonly string[];
}>;

export type FormationValidation = Readonly<{
  valid: boolean;
  requiresReview: boolean;
  issues: readonly FormationIssue[];
  maxConcurrentColumns: number;
  maxConcurrentTransport: number;
}>;

function concurrent(columns: readonly FormationColumn[], weight: (column: FormationColumn) => number): number {
  let maximum = 0;
  for (const column of columns) {
    const active = columns.filter(other => Date.parse(other.startAt) <= Date.parse(column.startAt) && Date.parse(other.endAt) > Date.parse(column.startAt));
    maximum = Math.max(maximum, active.reduce((sum, item) => sum + weight(item), 0));
  }
  return maximum;
}

/** Физические невозможности — ERROR, пробелы — REVIEW, сложная регулировка — WARNING. */
export function validateFormation(plan: FormationPlan): FormationValidation {
  const issues: FormationIssue[] = [];
  const add = (code: FormationIssueCode, severity: FormationIssue['severity'], message: string, refs: readonly string[] = []): void => {
    if (!issues.some(item => item.code === code && JSON.stringify(item.refs) === JSON.stringify(refs))) issues.push({ code, severity, message, refs });
  };
  const assignments = new Map<string, string>();
  const roots = [...plan.echelons, ...plan.reserves, ...plan.supportGroups];
  for (const root of roots) {
    for (const forceId of root.forceIds) {
      const previous = assignments.get(forceId);
      if (previous && previous !== root.id) add('FORCE_ASSIGNMENT_CONFLICT', 'ERROR', `Сила ${forceId} имеет несовместимые назначения ${previous} и ${root.id}`, [forceId, previous, root.id]);
      assignments.set(forceId, root.id);
    }
  }
  for (const column of plan.columns) {
    const echelon = plan.echelons.find(item => item.id === column.echelonId);
    if (!echelon) add('COLUMN_FORCE_MISMATCH', 'ERROR', `Колонна ${column.id} ссылается на отсутствующий эшелон`, [column.id, column.echelonId]);
    for (const forceId of column.forceIds) {
      if (!echelon?.forceIds.includes(forceId)) add('COLUMN_FORCE_MISMATCH', 'ERROR', `Сила ${forceId} не принадлежит эшелону ${column.echelonId}`, [column.id, forceId]);
    }
  }

  for (const root of roots) {
    const area = plan.areas.find(item => item.id === root.areaId);
    if (!area) {
      add('AREA_NOT_FOUND', 'ERROR', `Район или рубеж ${root.areaId} не найден`, [root.id, root.areaId]);
      continue;
    }
    if (area.capacityForces === null) add('AREA_CAPACITY_UNKNOWN', 'REVIEW', `Ёмкость района ${area.id} неизвестна`, [area.id]);
    else {
      const occupants = roots.filter(item => item.areaId === area.id).flatMap(item => item.forceIds);
      if (occupants.length > area.capacityForces) add('AREA_CAPACITY_EXCEEDED', 'ERROR', `Район ${area.id} не вмещает назначенные силы`, [area.id, root.id]);
    }
    if (!Number.isFinite(Date.parse(root.readyAt))) add('INVALID_TIMING', 'ERROR', `Некорректный срок готовности ${root.id}`, [root.id]);
    for (const dependencyId of root.dependsOn) {
      const dependency = roots.find(item => item.id === dependencyId);
      if (!dependency || Date.parse(root.readyAt) < Date.parse(dependency.readyAt)) add('DEPENDENCY_TIMING', 'ERROR', `Срок ${root.id} не учитывает зависимость ${dependencyId}`, [root.id, dependencyId]);
    }
  }

  if (plan.orderReceivedAt === null) add('ORDER_NOT_RECEIVED', 'REVIEW', 'Приказ ещё не получен исполнителем', [plan.id]);
  for (const column of plan.columns) {
    const start = Date.parse(column.startAt);
    const end = Date.parse(column.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) add('INVALID_TIMING', 'ERROR', `Некорректный интервал колонны ${column.id}`, [column.id]);
    if (plan.orderReceivedAt && Number.isFinite(start) && start < Date.parse(plan.orderReceivedAt)) {
      add('ORDER_NOT_DELIVERED_IN_TIME', 'ERROR', `Колонна ${column.id} начинает движение до получения приказа`, [column.id]);
    }
    const route = plan.routes.find(item => item.id === column.routeId);
    if (!route) {
      add('ROUTE_NOT_FOUND', 'ERROR', `Маршрут ${column.routeId} не найден`, [column.id, column.routeId]);
      continue;
    }
    if (route.status === 'CLOSED') add('ROUTE_CLOSED', 'ERROR', `Маршрут ${route.id} закрыт`, [route.id, column.id]);
    if (route.status === 'UNKNOWN') add('ROUTE_CAPACITY_UNKNOWN', 'REVIEW', `Состояние маршрута ${route.id} неизвестно`, [route.id]);
    if (route.crossingCapacityTonnes === null || column.loadTonnes === null) add('CROSSING_CAPACITY_UNKNOWN', 'REVIEW', `Нагрузка или ёмкость переправы ${route.id} неизвестна`, [route.id, column.id]);
    else if (column.loadTonnes > route.crossingCapacityTonnes) add('CROSSING_OVERLOAD', 'ERROR', `Колонна ${column.id} превышает ёмкость переправы`, [route.id, column.id]);
  }

  let maxConcurrentColumns = 0;
  for (const route of plan.routes) {
    const columns = plan.columns.filter(column => column.routeId === route.id);
    if (!columns.length) continue;
    const concurrentColumns = concurrent(columns, () => 1);
    maxConcurrentColumns = Math.max(maxConcurrentColumns, concurrentColumns);
    if (route.capacityColumns === null) add('ROUTE_CAPACITY_UNKNOWN', 'REVIEW', `Пропускная способность дороги ${route.id} неизвестна`, [route.id]);
    else if (concurrentColumns > route.capacityColumns) add('ROUTE_CAPACITY_EXCEEDED', 'ERROR', `Дорога ${route.id} занята в назначенный интервал`, [route.id]);
    for (const intersectingId of route.intersectsRouteIds) {
      if (plan.columns.some(column => column.routeId === intersectingId) && route.id < intersectingId) {
        add('ROUTE_INTERSECTION', 'WARNING', `Пересечение маршрутов ${route.id} и ${intersectingId} требует регулирования интервалов`, [route.id, intersectingId]);
      }
    }
  }

  const maxConcurrentTransport = concurrent(plan.columns, column => column.transportRequired);
  if (plan.logistics.transportAvailable === null) add('TRANSPORT_UNKNOWN', 'REVIEW', 'Доступный транспорт неизвестен');
  else if (maxConcurrentTransport > plan.logistics.transportAvailable) add('TRANSPORT_SHORTAGE', 'ERROR', `Одновременно требуется ${maxConcurrentTransport} единиц транспорта, доступно ${plan.logistics.transportAvailable}`);

  const stockIds = [...new Set([...Object.keys(plan.logistics.requiredStocks), ...Object.keys(plan.logistics.availableStocks)])].sort();
  for (const resourceId of stockIds) {
    const required = plan.logistics.requiredStocks[resourceId];
    const available = plan.logistics.availableStocks[resourceId];
    if (required === null || required === undefined || available === null || available === undefined || !Number.isFinite(required) || !Number.isFinite(available)) {
      add('SUPPLY_UNKNOWN', 'REVIEW', `Запас или потребность ${resourceId} неизвестны`, [resourceId]);
    } else if (available < required) add('SUPPLY_DEFICIT', 'ERROR', `Дефицит ${resourceId}: требуется ${required}, доступно ${available}`, [resourceId]);
  }
  if (plan.logistics.communicationsAvailable === null) add('COMMUNICATIONS_UNKNOWN', 'REVIEW', 'Состояние связи неизвестно');
  else if (!plan.logistics.communicationsAvailable) add('COMMUNICATIONS_UNAVAILABLE', 'ERROR', 'Построение не обеспечено связью');

  for (const role of ['MAIN', 'ALTERNATE'] as const) {
    const posts = plan.controlPosts.filter(post => post.role === role);
    if (!posts.length) add('CONTROL_POST_MISSING', 'ERROR', `Не назначен ${role === 'MAIN' ? 'основной' : 'запасной'} пункт управления`);
    else if (posts.every(post => !post.available)) add('CONTROL_POST_UNAVAILABLE', 'ERROR', `Пункт управления ${role} недоступен`);
  }

  const requiresReview = issues.some(issue => issue.severity === 'REVIEW');
  const valid = !issues.some(issue => issue.severity === 'ERROR' || issue.severity === 'REVIEW');
  return { valid, requiresReview, issues, maxConcurrentColumns, maxConcurrentTransport };
}
