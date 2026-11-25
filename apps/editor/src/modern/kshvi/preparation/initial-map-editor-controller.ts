import {
  addInitialMapMarker, shiftInitialMapMarkers, updateInitialMapMarker,
  type InitialSituationMap, type MapGeometry, type MapMarker, type Position,
} from '../../../../../../packages/kshvi/src/scenario/initial-map';

export type DrawingKind = 'POINT' | 'LINE' | 'AREA';
export type PendingDrawing = Readonly<{ marker: MapMarker; geometryKind: DrawingKind; points: readonly Position[] }>;
export type EditorHistory = Readonly<{
  past: readonly InitialSituationMap[];
  present: InitialSituationMap;
  future: readonly InitialSituationMap[];
  pending: PendingDrawing | null;
}>;
export type InitialMapEditorAction =
  | Readonly<{ type: 'BEGIN_DRAW'; marker: MapMarker; geometryKind: DrawingKind }>
  | Readonly<{ type: 'APPEND_VERTEX'; point: Position }>
  | Readonly<{ type: 'FINISH_DRAW' }>
  | Readonly<{ type: 'CANCEL_DRAW' }>
  | Readonly<{ type: 'CREATE_POINT'; marker: MapMarker }>
  | Readonly<{ type: 'MOVE_OBJECT'; markerIds: readonly string[]; delta: { lon: number; lat: number } }>
  | Readonly<{ type: 'MOVE_VERTEX'; markerId: string; vertex: number; ring?: number; point: Position }>
  | Readonly<{ type: 'UPDATE_ATTRIBUTES'; markerId: string; patch: Partial<Omit<MapMarker, 'id' | 'revision'>> }>
  | Readonly<{ type: 'DELETE_MARKERS'; markerIds: readonly string[] }>
  | Readonly<{ type: 'DUPLICATE_MARKERS'; copies: readonly Readonly<{ id: string; newId: string }>[] }>
  | Readonly<{ type: 'REPLACE_MAP'; map: InitialSituationMap }>;

export function createEditorHistory(map: InitialSituationMap): EditorHistory {
  return { past: [], present: map, future: [], pending: null };
}

function checkPoint(point: Position, map: InitialSituationMap): void {
  const [w, s, e, n] = map.bounds;
  if (point.length !== 2 || !point.every(Number.isFinite) || point[0] < w || point[0] > e || point[1] < s || point[1] > n) {
    throw new Error('Координаты находятся вне области карты');
  }
}

function same(a: Position, b: Position): boolean { return a[0] === b[0] && a[1] === b[1]; }
function orientation(a: Position, b: Position, c: Position): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function onSegment(a: Position, b: Position, c: Position): boolean {
  return orientation(a, b, c) === 0 && c[0] >= Math.min(a[0], b[0]) && c[0] <= Math.max(a[0], b[0])
    && c[1] >= Math.min(a[1], b[1]) && c[1] <= Math.max(a[1], b[1]);
}
function intersects(a: Position, b: Position, c: Position, d: Position): boolean {
  const abc = orientation(a, b, c), abd = orientation(a, b, d), cda = orientation(c, d, a), cdb = orientation(c, d, b);
  return (Math.sign(abc) !== Math.sign(abd) && Math.sign(cda) !== Math.sign(cdb))
    || onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

/** Проверяется до записи, чтобы незавершённый или пересекающийся контур не стал документом. */
export function checkEditorGeometry(geometry: MapGeometry, map: InitialSituationMap): void {
  const groups = geometry.type === 'Point' ? [[geometry.coordinates]] : geometry.type === 'LineString' ? [geometry.coordinates] : geometry.coordinates;
  for (const points of groups) {
    for (const point of points) checkPoint(point, map);
    if (geometry.type === 'LineString' && (points.length < 2 || points.every(point => same(point, points[0])))) {
      throw new Error('Линии нужны как минимум две различные вершины');
    }
    if (geometry.type !== 'Polygon') continue;
    if (points.length < 4 || !same(points[0], points[points.length - 1])) throw new Error('Области нужен замкнутый контур из трёх вершин');
    let area = 0;
    for (let i = 0; i < points.length - 1; i++) {
      if (same(points[i], points[i + 1])) throw new Error('Соседние вершины контура совпадают');
      area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
      for (let j = i + 2; j < points.length - 1; j++) {
        if (i === 0 && j === points.length - 2) continue;
        if (intersects(points[i], points[i + 1], points[j], points[j + 1])) throw new Error('Контур области пересекает сам себя');
      }
    }
    if (area === 0) throw new Error('Контур области имеет нулевую площадь');
  }
}

function commit(history: EditorHistory, next: InitialSituationMap): EditorHistory {
  if (next === history.present) return history;
  return { past: [...history.past, history.present], present: next, future: [], pending: null };
}

export function applyInitialMapAction(history: EditorHistory, action: InitialMapEditorAction): EditorHistory {
  const map = history.present;
  if (action.type === 'BEGIN_DRAW') {
    if (map.markers.some(marker => marker.id === action.marker.id)) throw new Error('Идентификатор объекта уже занят');
    return { ...history, pending: { marker: structuredClone(action.marker), geometryKind: action.geometryKind, points: [] } };
  }
  if (action.type === 'CANCEL_DRAW') return history.pending ? { ...history, pending: null } : history;
  if (action.type === 'APPEND_VERTEX') {
    if (!history.pending) throw new Error('Сначала выберите инструмент нанесения');
    checkPoint(action.point, map);
    const points = history.pending.points;
    if (points.length && same(points[points.length - 1], action.point)) return history;
    return { ...history, pending: { ...history.pending, points: history.pending.geometryKind === 'POINT' ? [[...action.point] as Position] : [...points, [...action.point] as Position] } };
  }
  if (action.type === 'FINISH_DRAW') {
    const pending = history.pending;
    if (!pending) return history;
    const points = pending.points;
    let geometry: MapGeometry;
    if (pending.geometryKind === 'POINT') {
      if (points.length !== 1) throw new Error('Укажите одну точку');
      geometry = { type: 'Point', coordinates: points[0] };
    } else if (pending.geometryKind === 'LINE') geometry = { type: 'LineString', coordinates: points };
    else geometry = { type: 'Polygon', coordinates: [points.length && same(points[0], points[points.length - 1]) ? points : [...points, points[0]]] };
    checkEditorGeometry(geometry, map);
    return commit(history, addInitialMapMarker(map, { ...pending.marker, geometry }, { draftSymbols: true }));
  }
  if (action.type === 'CREATE_POINT') {
    if (action.marker.geometry?.type !== 'Point') throw new Error('Ожидается точечная геометрия');
    checkEditorGeometry(action.marker.geometry, map);
    return commit(history, addInitialMapMarker(map, action.marker, { draftSymbols: true }));
  }
  if (action.type === 'MOVE_OBJECT') {
    const next = shiftInitialMapMarkers(map, action.markerIds, action.delta, { draftSymbols: true });
    for (const marker of next.markers) if (marker.geometry) checkEditorGeometry(marker.geometry, next);
    return commit(history, next);
  }
  if (action.type === 'UPDATE_ATTRIBUTES') {
    if (action.patch.geometry) checkEditorGeometry(action.patch.geometry, map);
    return commit(history, updateInitialMapMarker(map, action.markerId, action.patch, { draftSymbols: true }));
  }
  if (action.type === 'MOVE_VERTEX') {
    const marker = map.markers.find(item => item.id === action.markerId);
    if (!marker?.geometry) throw new Error('Объект с геометрией не найден');
    const geometry = structuredClone(marker.geometry) as MapGeometry;
    if (geometry.type === 'Point') {
      if (action.vertex !== 0) throw new Error('Вершина не найдена');
      return applyInitialMapAction(history, { type: 'UPDATE_ATTRIBUTES', markerId: marker.id, patch: { geometry: { type: 'Point', coordinates: action.point } } });
    }
    const points = geometry.type === 'LineString' ? [...geometry.coordinates] : [...(geometry.coordinates[action.ring ?? 0] ?? [])];
    if (!Number.isSafeInteger(action.vertex) || action.vertex < 0 || action.vertex >= points.length) throw new Error('Вершина не найдена');
    points[action.vertex] = action.point;
    if (geometry.type === 'Polygon' && (action.vertex === 0 || action.vertex === points.length - 1)) {
      points[0] = action.point; points[points.length - 1] = action.point;
    }
    const nextGeometry: MapGeometry = geometry.type === 'LineString' ? { ...geometry, coordinates: points }
      : { ...geometry, coordinates: geometry.coordinates.map((ring, index) => index === (action.ring ?? 0) ? points : ring) };
    return applyInitialMapAction(history, { type: 'UPDATE_ATTRIBUTES', markerId: marker.id, patch: { geometry: nextGeometry } });
  }
  if (action.type === 'DELETE_MARKERS') {
    const ids = new Set(action.markerIds);
    if (!ids.size) return history;
    if ([...ids].some(id => !map.markers.some(marker => marker.id === id))) throw new Error('Объект не найден');
    if (map.markers.some(marker => !ids.has(marker.id) && marker.links.linkedMarkerIds?.some(id => ids.has(id)))) {
      throw new Error('Удаление оставит неразрешённые связи: выберите связанные объекты вместе');
    }
    return commit(history, { ...map, revision: map.revision + 1, state: 'DRAFT', sha256: undefined,
      markers: map.markers.filter(marker => !ids.has(marker.id)), history: [...map.history, ...map.markers.filter(marker => ids.has(marker.id))] });
  }
  if (action.type === 'DUPLICATE_MARKERS') {
    const ids = new Map(action.copies.map(copy => [copy.id, copy.newId]));
    const newIds = new Set(action.copies.map(copy => copy.newId));
    if (ids.size !== action.copies.length || newIds.size !== action.copies.length
      || action.copies.some(copy => !copy.newId.trim() || map.markers.some(marker => marker.id === copy.newId))) throw new Error('Идентификаторы копий должны быть уникальными');
    let next = map;
    for (const copy of action.copies) {
      const marker = map.markers.find(item => item.id === copy.id);
      if (!marker) throw new Error('Объект для копирования не найден');
      const duplicate = { ...structuredClone(marker), id: copy.newId, revision: 1,
        links: { ...marker.links, ...(marker.links.linkedMarkerIds ? { linkedMarkerIds: marker.links.linkedMarkerIds.map(id => ids.get(id) ?? id) } : {}) } };
      next = addInitialMapMarker(next, duplicate, { draftSymbols: true });
    }
    return commit(history, next);
  }
  if (action.map.environment.snapshotId !== map.environment.snapshotId || action.map.environment.manifestSha256 !== map.environment.manifestSha256) {
    throw new Error('Импорт относится к другому снимку среды');
  }
  for (const marker of action.map.markers) if (marker.geometry) checkEditorGeometry(marker.geometry, map);
  return commit(history, action.map);
}

export function undo(history: EditorHistory): EditorHistory {
  if (history.pending) return { ...history, pending: null };
  const previous = history.past.at(-1);
  return previous ? { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future], pending: null } : history;
}

export function redo(history: EditorHistory): EditorHistory {
  const next = history.future[0];
  return next ? { past: [...history.past, history.present], present: next, future: history.future.slice(1), pending: null } : history;
}
