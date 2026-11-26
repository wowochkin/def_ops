import { INITIAL_MAP_LAYER_IDS } from './initial-map-layers';
import type {
  Bounds,
  InitialSituationMap,
  MapGeometry,
  MapMarker,
  Position,
} from './initial-map';

export type InitialMapIssue = Readonly<{
  code: string;
  severity: 'ERROR' | 'WARNING' | 'INFO';
  message: string;
  objectId?: string;
  path?: string;
}>;

export type InitialMapValidationInput = Readonly<{
  schemaVersion?: number;
  bounds: Bounds;
  initialOperationalAt?: string;
  environment?: InitialSituationMap['environment'];
  symbolSet?: InitialSituationMap['symbolSet'];
  layers?: InitialSituationMap['layers'];
  markers?: readonly MapMarker[];
  history?: readonly MapMarker[];
  forces?: readonly Readonly<{
    id: string;
    position: Position | null;
    uncertaintyArea?: MapGeometry;
    sideId?: string;
    symbolSideId?: string;
  }>[];
  routes?: readonly Readonly<{
    id: string;
    geometry?: MapGeometry | null;
    loadTonnes?: number;
    crossingCapacityTonnes?: number;
    passable?: boolean;
    validFrom?: string;
    validUntil?: string;
  }>[];
  areas?: readonly Readonly<{
    id: string;
    geometry: MapGeometry | null;
    incompatibleWith?: readonly string[];
  }>[];
  columns?: readonly Readonly<{
    id: string;
    routeId: string | null;
    offRoadJustification?: string;
  }>[];
  tasks?: readonly Readonly<{
    id: string;
    geometryRequired: boolean;
    geometry: MapGeometry | null;
  }>[];
}>;

const POSITIONAL_KINDS = new Set(['FORCE', 'COMMAND_POST', 'COMMUNICATION', 'LOGISTICS', 'MEDICAL', 'REPAIR', 'CROSSING']);
const SHA256 = /^[0-9a-f]{64}$/;

function issue(code: string, message: string, objectId?: string, severity: InitialMapIssue['severity'] = 'ERROR'): InitialMapIssue {
  return { code, severity, message, ...(objectId ? { objectId } : {}) };
}

function positions(geometry: MapGeometry): readonly Position[] {
  if (geometry.type === 'Point') return [geometry.coordinates];
  if (geometry.type === 'LineString') return geometry.coordinates;
  return geometry.coordinates.flat();
}

function validPosition(position: Position): boolean {
  return Array.isArray(position) && position.length === 2 && position.every(value => Number.isFinite(value))
    && position[0] >= -180 && position[0] <= 180 && position[1] >= -90 && position[1] <= 90;
}

function outside(position: Position, bounds: Bounds): boolean {
  return position[0] < bounds[0] || position[1] < bounds[1] || position[0] > bounds[2] || position[1] > bounds[3];
}

function validateGeometry(geometry: MapGeometry | null | undefined, bounds: Bounds, objectId: string, output: InitialMapIssue[]): void {
  if (!geometry) return;
  let points: readonly Position[];
  try {
    points = positions(geometry);
  } catch {
    output.push(issue('INVALID_GEOMETRY', 'Геометрия имеет неподдерживаемую структуру', objectId));
    return;
  }
  if (!points.length || points.some(point => !validPosition(point))) {
    output.push(issue('INVALID_GEOMETRY', 'Геометрия содержит некорректные координаты', objectId));
    return;
  }
  if (points.some(point => outside(point, bounds))) output.push(issue('OUTSIDE_BOUNDS', 'Объект находится вне области учения', objectId));
}

function timeIssues(validFrom: string, validUntil: string, objectId: string): InitialMapIssue[] {
  if (!validFrom) return [issue('TIME_REQUIRED', 'Укажите начало действия объекта или открытый период', objectId)];
  if (!validUntil) return [];
  const from = Date.parse(validFrom);
  const until = Date.parse(validUntil);
  if (!Number.isFinite(from) || !Number.isFinite(until)) return [issue('TIME_INVALID', 'Оперативное время должно быть датой с часовым поясом', objectId)];
  if (from >= until) return [issue('TIME_CONTRADICTORY', 'Начало периода должно предшествовать его окончанию', objectId)];
  return [];
}

function hasVisibility(marker: MapMarker): boolean {
  const visibility = marker.visibility;
  return Boolean(visibility?.staffOnly || visibility?.sideIds?.length || visibility?.instanceIds?.length || visibility?.roles?.length);
}

function geometryBounds(geometry: MapGeometry): Bounds {
  const points = positions(geometry);
  const xs = points.map(point => point[0]);
  const ys = points.map(point => point[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function overlaps(left: MapGeometry, right: MapGeometry): boolean {
  const a = geometryBounds(left);
  const b = geometryBounds(right);
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function validateRoute(route: Readonly<{
  id: string;
  geometry?: MapGeometry | null;
  loadTonnes?: number;
  crossingCapacityTonnes?: number;
  passable?: boolean;
  validFrom?: string;
  validUntil?: string;
}>, bounds: Bounds, output: InitialMapIssue[]): void {
  validateGeometry(route.geometry, bounds, route.id, output);
  if (route.passable === false) output.push(issue('ROUTE_NOT_PASSABLE', 'Маршрут проходит через непроходимый участок', route.id));
  if (route.loadTonnes !== undefined && route.crossingCapacityTonnes !== undefined && route.loadTonnes > route.crossingCapacityTonnes) {
    output.push(issue('CROSSING_OVERLOAD', 'Грузоподъёмность переправы меньше нагрузки маршрута', route.id));
  }
  if (route.validFrom !== undefined || route.validUntil !== undefined) output.push(...timeIssues(route.validFrom ?? '', route.validUntil ?? '', route.id));
}

export function validateInitialMap(input: InitialMapValidationInput): InitialMapIssue[] {
  const output: InitialMapIssue[] = [];
  if (input.bounds.length !== 4 || input.bounds.some(value => !Number.isFinite(value))
    || input.bounds[0] >= input.bounds[2] || input.bounds[1] >= input.bounds[3]) {
    output.push(issue('BOUNDS_INVALID', 'Область карты задана некорректно'));
  }
  if (input.environment && (!input.environment.snapshotId || !SHA256.test(input.environment.manifestSha256))) {
    output.push(issue('ENVIRONMENT_HASH_INVALID', 'Снимок среды должен иметь идентификатор и SHA-256'));
  }
  if (input.symbolSet && (!input.symbolSet.id || !SHA256.test(input.symbolSet.sha256))) {
    output.push(issue('SYMBOL_SET_HASH_INVALID', 'Набор знаков должен иметь неизменяемый SHA-256'));
  }
  if (input.schemaVersion === 1) {
    const layers = new Set(input.layers?.filter(layer => layer.independent).map(layer => layer.id));
    for (const layerId of INITIAL_MAP_LAYER_IDS) {
      if (!layers.has(layerId)) output.push(issue('MAP_LAYER_REQUIRED', `Отсутствует независимый слой ${layerId}`, layerId));
    }
  }
  const seen = new Set<string>();
  for (const marker of input.markers ?? []) {
    if (!marker.id?.trim()) output.push(issue('OBJECT_ID_REQUIRED', 'Укажите идентификатор отметки'));
    if (seen.has(marker.id)) output.push(issue('DUPLICATE_OBJECT_ID', 'Идентификатор отметки должен быть уникальным', marker.id));
    seen.add(marker.id);
    if (!marker.geometry) {
      output.push(issue(POSITIONAL_KINDS.has(marker.kind) ? 'POSITION_UNKNOWN' : 'GEOMETRY_REQUIRED', 'Положение неизвестно; координаты не подставляются автоматически', marker.id));
    }
    validateGeometry(marker.geometry, input.bounds, marker.id, output);
    if (!marker.sourceId) output.push(issue('SOURCE_REQUIRED', 'Укажите источник отметки', marker.id));
    if (!marker.authorId) output.push(issue('AUTHOR_REQUIRED', 'Укажите автора отметки', marker.id));
    if (!marker.eventId) output.push(issue('EVENT_REFERENCE_REQUIRED', 'Укажите событие или основание отметки', marker.id));
    output.push(...timeIssues(marker.validFrom, marker.validUntil, marker.id));
    if (!hasVisibility(marker)) output.push(issue('VISIBILITY_REQUIRED', 'Задайте явную область видимости', marker.id));
    if (!marker.layerId) output.push(issue('LAYER_REQUIRED', 'Выберите независимый слой отметки', marker.id));
    if (!['OBSERVED', 'ASSUMED', 'PLANNED', 'UNKNOWN'].includes(marker.state)) output.push(issue('MARKER_STATE_INVALID', 'Укажите состояние достоверности отметки', marker.id));
    if ((marker.confidence === null || marker.confidence === undefined) && marker.state !== 'UNKNOWN') output.push(issue('CONFIDENCE_REQUIRED', 'Укажите достоверность либо состояние UNKNOWN', marker.id));
    if (marker.confidence !== null && marker.confidence !== undefined && (marker.confidence < 0 || marker.confidence > 1)) output.push(issue('CONFIDENCE_INVALID', 'Достоверность должна быть от 0 до 1', marker.id));
    if (!marker.symbol) {
      output.push(issue('SYMBOL_REQUIRED', 'Назначьте отметке утверждённый знак', marker.id));
    } else {
      if (marker.symbol.sideId !== marker.sideId) output.push(issue('SYMBOL_SIDE_MISMATCH', 'Сторона знака не совпадает со стороной объекта', marker.id));
      if (marker.symbol.status !== 'APPROVED') output.push(issue('SYMBOL_NOT_APPROVED', 'В исходной обстановке допустимы только утверждённые знаки', marker.id));
      if (!marker.symbol.sourceDocument || marker.symbol.sourcePage < 1) output.push(issue('SYMBOL_SOURCE_REQUIRED', 'У знака должны быть документ и страница источника', marker.id));
    }
    if (marker.kind === 'ROUTE') validateRoute(marker, input.bounds, output);
    if (marker.kind === 'COLUMN' && !marker.routeId && !marker.offRoadJustification?.trim()) {
      output.push(issue('COLUMN_ROUTE_REQUIRED', 'Колонне нужна дорога или обоснованное движение вне дорог', marker.id));
    }
    if (marker.kind === 'TASK' && marker.geometryRequired && !marker.geometry) output.push(issue('TASK_GEOMETRY_REQUIRED', 'Для задачи требуется геометрия', marker.id));
  }
  for (const force of input.forces ?? []) {
    if (!force.position) {
      if (force.uncertaintyArea) {
        validateGeometry(force.uncertaintyArea, input.bounds, force.id, output);
        output.push(issue('POSITION_UNCERTAIN', 'Точное положение неизвестно; использован явный район неопределённости', force.id, 'INFO'));
      } else {
        output.push(issue('POSITION_UNKNOWN', 'Сила не имеет положения или района неопределённости', force.id));
      }
    } else if (!validPosition(force.position)) {
      output.push(issue('INVALID_GEOMETRY', 'Положение силы содержит некорректные координаты', force.id));
    } else if (outside(force.position, input.bounds)) {
      output.push(issue('OUTSIDE_BOUNDS', 'Сила находится вне области учения', force.id));
    }
    if (force.sideId && force.symbolSideId && force.sideId !== force.symbolSideId) {
      output.push(issue('SYMBOL_SIDE_MISMATCH', 'Сторона знака не совпадает со стороной силы', force.id));
    }
  }
  for (const route of input.routes ?? []) validateRoute(route, input.bounds, output);
  const areas = input.areas ?? [];
  for (const area of areas) validateGeometry(area.geometry, input.bounds, area.id, output);
  for (let left = 0; left < areas.length; left += 1) {
    for (let right = left + 1; right < areas.length; right += 1) {
      const a = areas[left];
      const b = areas[right];
      if (a.geometry && b.geometry && (a.incompatibleWith?.includes(b.id) || b.incompatibleWith?.includes(a.id)) && overlaps(a.geometry, b.geometry)) {
        output.push(issue('INCOMPATIBLE_AREAS_OVERLAP', 'Несовместимые районы пересекаются', `${a.id}/${b.id}`));
      }
    }
  }
  const routeIds = new Set((input.routes ?? []).map(route => route.id));
  for (const column of input.columns ?? []) {
    if (!column.routeId && !column.offRoadJustification?.trim()) output.push(issue('COLUMN_ROUTE_REQUIRED', 'Колонне нужна дорога или обоснованное движение вне дорог', column.id));
    if (column.routeId && !routeIds.has(column.routeId)) output.push(issue('COLUMN_ROUTE_UNKNOWN', 'Дорога колонны не найдена в исходной обстановке', column.id));
  }
  for (const task of input.tasks ?? []) {
    if (task.geometryRequired && !task.geometry) output.push(issue('TASK_GEOMETRY_REQUIRED', 'Для задачи требуется геометрия', task.id));
    validateGeometry(task.geometry, input.bounds, task.id, output);
  }
  return output;
}
