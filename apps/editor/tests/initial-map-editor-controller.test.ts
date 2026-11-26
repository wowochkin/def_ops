import { describe, expect, it } from 'vitest';
import { approveInitialMap, createInitialSituationMap, type MapMarker } from '../../../packages/kshvi/src/scenario/initial-map';
import { applyInitialMapAction, createEditorHistory, redo, undo } from '../src/modern/kshvi/preparation/initial-map-editor-controller';

const emptyMap = () => createInitialSituationMap({
  id: 'drawing-test', revision: 1,
  environment: { snapshotId: 'snapshot', manifestSha256: 'a'.repeat(64), bounds: [0, 0, 1, 1] },
  initialOperationalAt: '2030-01-01T00:00:00Z', timeZone: 'UTC', weatherFrameRef: 'weather', terrainStateRef: 'terrain',
  symbolSet: { id: 'symbols', revision: 1, sha256: 'b'.repeat(64) }, attribution: ['test'],
});
const marker = (id: string): MapMarker => ({
  id, revision: 1, kind: 'ROUTE', layerId: 'REFERENCE', truth: 'PRIVATE', geometry: null,
  sourceId: 'user-document', authorId: 'author', eventId: 'user-input',
  validFrom: '2030-01-01T00:00:00Z', validUntil: '2030-01-02T00:00:00Z', state: 'PLANNED',
  confidence: 1, uncertainty: { radiusM: 0, note: '' }, visibility: { sideIds: ['blue'] }, links: { documentId: 'user-document' }, sideId: 'blue',
  symbol: { id: 'route', version: 'v1', sideId: 'blue', status: 'APPROVED', sourceDocument: 'test', sourcePage: 1 },
});

describe('история графического редактора', () => {
  it('дублирует группу одним действием и перепривязывает только внутренние ссылки', () => {
    let history = createEditorHistory(emptyMap());
    const point = { ...marker('first'), kind: 'TASK' as const, geometry: { type: 'Point' as const, coordinates: [0.2, 0.2] as const } };
    history = applyInitialMapAction(history, { type: 'CREATE_POINT', marker: point });
    history = applyInitialMapAction(history, { type: 'CREATE_POINT', marker: { ...point, id: 'second', links: { documentId: 'user-document', linkedMarkerIds: ['first'] } } });
    const before = history.present;
    history = applyInitialMapAction(history, { type: 'DUPLICATE_MARKERS', copies: [{ id: 'first', newId: 'first-copy' }, { id: 'second', newId: 'second-copy' }] });
    expect(history.present.markers).toHaveLength(4);
    expect(history.present.markers[3].links).toEqual({ documentId: 'user-document', linkedMarkerIds: ['first-copy'] });
    expect(history.present.markers[3].geometry).toEqual(point.geometry);
    expect(undo(history).present).toEqual(before);
  });
  it('черновое нанесение не превращает несверенный знак в утверждённый', () => {
    const item = { ...marker('unverified'), symbol: { ...marker('unverified').symbol, status: 'MAPPED' as const },
      geometry: { type: 'Point' as const, coordinates: [0.2, 0.2] as const } };
    const history = applyInitialMapAction(createEditorHistory(emptyMap()), { type: 'CREATE_POINT', marker: item });
    expect(history.present.markers[0].symbol.status).toBe('MAPPED');
    expect(history.present.state).toBe('DRAFT');
    expect(() => approveInitialMap(history.present)).toThrow(/SYMBOL_NOT_APPROVED/);
    const moved = applyInitialMapAction(history, { type: 'MOVE_OBJECT', markerIds: ['unverified'], delta: { lon: 0.1, lat: 0.1 } });
    expect(moved.present.markers[0].geometry).toEqual({ type: 'Point', coordinates: [0.30000000000000004, 0.30000000000000004] });
    expect(moved.present.markers[0].symbol.status).toBe('MAPPED');
  });
  it('завершает линию атомарно, редактирует вершину и восстанавливает undo/redo', () => {
    let history = createEditorHistory(emptyMap());
    history = applyInitialMapAction(history, { type: 'BEGIN_DRAW', marker: marker('line'), geometryKind: 'LINE' });
    history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point: [0.1, 0.1] });
    history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point: [0.2, 0.2] });
    expect(history.present.markers).toHaveLength(0);
    history = applyInitialMapAction(history, { type: 'FINISH_DRAW' });
    expect(history.present.markers[0].geometry).toEqual({ type: 'LineString', coordinates: [[0.1, 0.1], [0.2, 0.2]] });
    const drawn = history.present;
    history = applyInitialMapAction(history, { type: 'MOVE_VERTEX', markerId: 'line', vertex: 1, point: [0.3, 0.3] });
    expect(history.present.markers[0].geometry).toEqual({ type: 'LineString', coordinates: [[0.1, 0.1], [0.3, 0.3]] });
    expect(undo(history).present).toEqual(drawn);
    expect(redo(undo(history)).present).toEqual(history.present);
    expect(emptyMap().markers).toEqual([]);
  });

  it('отмена незавершённой геометрии не меняет документ и историю', () => {
    const initial = createEditorHistory(emptyMap());
    let drawing = applyInitialMapAction(initial, { type: 'BEGIN_DRAW', marker: marker('area'), geometryKind: 'AREA' });
    drawing = applyInitialMapAction(drawing, { type: 'APPEND_VERTEX', point: [0.2, 0.2] });
    const cancelled = applyInitialMapAction(drawing, { type: 'CANCEL_DRAW' });
    expect(cancelled.present).toBe(initial.present);
    expect(cancelled.past).toEqual([]);
    expect(cancelled.pending).toBeNull();
  });

  it('не сохраняет самопересекающуюся область и координаты за рамкой', () => {
    let history = applyInitialMapAction(createEditorHistory(emptyMap()), { type: 'BEGIN_DRAW', marker: { ...marker('area'), kind: 'AREA' }, geometryKind: 'AREA' });
    for (const point of [[0.1, 0.1], [0.8, 0.8], [0.1, 0.8], [0.8, 0.1]] as const) {
      history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point });
    }
    expect(() => applyInitialMapAction(history, { type: 'FINISH_DRAW' })).toThrow();
    expect(history.present.markers).toHaveLength(0);
    expect(() => applyInitialMapAction(history, { type: 'APPEND_VERTEX', point: [2, 0.5] })).toThrow();
  });

  it('замыкает область и синхронно двигает обе копии замыкающей вершины', () => {
    let history = applyInitialMapAction(createEditorHistory(emptyMap()), { type: 'BEGIN_DRAW', marker: { ...marker('area'), kind: 'AREA' }, geometryKind: 'AREA' });
    for (const point of [[0.1, 0.1], [0.7, 0.1], [0.7, 0.7]] as const) history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point });
    history = applyInitialMapAction(history, { type: 'FINISH_DRAW' });
    history = applyInitialMapAction(history, { type: 'MOVE_VERTEX', markerId: 'area', vertex: 0, point: [0.2, 0.2] });
    expect(history.present.markers[0].geometry).toEqual({ type: 'Polygon', coordinates: [[[0.2, 0.2], [0.7, 0.1], [0.7, 0.7], [0.2, 0.2]]] });
  });

  it('после undo новая правка снимает redo, отказ удаления не обрывает связи', () => {
    let history = createEditorHistory(emptyMap());
    const point = { ...marker('first'), kind: 'TASK' as const, geometry: { type: 'Point' as const, coordinates: [0.2, 0.2] as const } };
    history = applyInitialMapAction(history, { type: 'CREATE_POINT', marker: point });
    history = applyInitialMapAction(history, { type: 'CREATE_POINT', marker: { ...point, id: 'second', links: { linkedMarkerIds: ['first'] } } });
    expect(() => applyInitialMapAction(history, { type: 'DELETE_MARKERS', markerIds: ['first'] })).toThrow(/связ/);
    history = undo(history);
    history = applyInitialMapAction(history, { type: 'UPDATE_ATTRIBUTES', markerId: 'first', patch: { sourceId: 'another-document' } });
    expect(history.future).toHaveLength(0);
    expect(history.present.markers[0].sourceId).toBe('another-document');
  });
});

it('повторный щелчок перемещает черновую точку, затем добавление остаётся одним действием', () => {
  let history = applyInitialMapAction(createEditorHistory(emptyMap()), { type: 'BEGIN_DRAW', marker: marker('point'), geometryKind: 'POINT' });
  history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point: [0.2, 0.2] });
  history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point: [0.6, 0.6] });
  expect(history.present.markers).toHaveLength(0);
  expect(history.pending?.points).toEqual([[0.6, 0.6]]);
  history = applyInitialMapAction(history, { type: 'FINISH_DRAW' });
  expect(history.present.markers[0].geometry).toEqual({ type: 'Point', coordinates: [0.6, 0.6] });
  expect(undo(history).present.markers).toHaveLength(0);
});

it('удаляет и перемещает вершины незавершённого маршрута', () => {
  let history = applyInitialMapAction(createEditorHistory(emptyMap()), { type: 'BEGIN_DRAW', marker: marker('pending-line'), geometryKind: 'LINE' });
  for (const point of [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] as const) history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point });
  history = applyInitialMapAction(history, { type: 'DELETE_PENDING_VERTEX', index: 1 });
  expect(history.pending?.points).toEqual([[0.1, 0.1], [0.3, 0.3]]);
  history = applyInitialMapAction(history, { type: 'MOVE_PENDING_VERTEX', index: 1, point: [0.4, 0.4] });
  expect(history.pending?.points).toEqual([[0.1, 0.1], [0.4, 0.4]]);
  history = applyInitialMapAction(history, { type: 'DELETE_PENDING_VERTEX' });
  expect(history.pending?.points).toEqual([[0.1, 0.1]]);
});

it('удаляет вершину сохранённой линии и не оставляет неправильную геометрию', () => {
  let history = applyInitialMapAction(createEditorHistory(emptyMap()), { type: 'BEGIN_DRAW', marker: marker('saved-line'), geometryKind: 'LINE' });
  for (const point of [[0.1, 0.1], [0.2, 0.2], [0.3, 0.3]] as const) history = applyInitialMapAction(history, { type: 'APPEND_VERTEX', point });
  history = applyInitialMapAction(history, { type: 'FINISH_DRAW' });
  history = applyInitialMapAction(history, { type: 'DELETE_VERTEX', markerId: 'saved-line', vertex: 1 });
  expect(history.present.markers[0].geometry).toEqual({ type: 'LineString', coordinates: [[0.1, 0.1], [0.3, 0.3]] });
  expect(() => applyInitialMapAction(history, { type: 'DELETE_VERTEX', markerId: 'saved-line', vertex: 1 })).toThrow();
});
