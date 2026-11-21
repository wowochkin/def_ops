import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  INITIAL_MAP_COMMAND_SCHEMAS,
  INITIAL_MAP_JSON_SCHEMA,
  INITIAL_MAP_LAYER_IDS,
  addInitialMapMarker,
  approveInitialMap,
  copyInitialSituationMap,
  createInitialSituationMap,
  importInitialMap,
  initialMapHash,
  initialMapCanonicalJson,
  projectInitialMap,
  projectInitialMapScale,
  shiftInitialMapMarkers,
  updateInitialMapMarker,
  validateInitialMap,
  type InitialSituationMap,
  type MapMarker,
} from '../src/scenario/initial-map';

const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const start = '2030-01-01T06:00:00+03:00';
const end = '2030-01-01T08:00:00+03:00';

function marker(id = 'blue-force'): MapMarker {
  return {
    id,
    revision: 1,
    kind: 'FORCE',
    layerId: 'TRUE_FORCES',
    truth: 'TRUTH',
    geometry: { type: 'Point', coordinates: [0.2, 0.2] },
    sourceId: 'source-1',
    authorId: 'author-1',
    eventId: 'event-1',
    validFrom: start,
    validUntil: end,
    state: 'OBSERVED',
    confidence: 0.9,
    uncertainty: { radiusM: 25, note: 'последнее наблюдение' },
    visibility: { sideIds: ['blue'], instanceIds: ['blue-hq'] },
    links: { forceId: 'force-1', taskId: 'task-1', documentId: 'order-1' },
    sideId: 'blue',
    symbol: {
      id: 'infantry', version: 'v1', sideId: 'blue', status: 'APPROVED',
      sourceDocument: 'signs.doc', sourcePage: 12,
    },
  };
}

function mapFixture(): InitialSituationMap {
  return createInitialSituationMap({
    id: 'map-1',
    revision: 1,
    environment: { snapshotId: 'env-1', manifestSha256: hashA, bounds: [0, 0, 1, 1] },
    initialOperationalAt: start,
    timeZone: 'Europe/Moscow',
    weatherFrameRef: 'weather/frame-1',
    terrainStateRef: 'terrain/state-1',
    symbolSet: { id: 'symbols', revision: 1, sha256: hashB },
    attribution: ['OSM'],
  });
}

function readyMap(): InitialSituationMap {
  return addInitialMapMarker(mapFixture(), marker());
}

describe('PREP-15 и AC-22: ошибки исходной карты', () => {
  it('не подставляет координаты и проверяет грузоподъёмность моста', () => {
    const issues = validateInitialMap({
      forces: [{ id: 'f1', position: null }],
      routes: [{ id: 'r1', loadTonnes: 42, crossingCapacityTonnes: 40 }],
      bounds: [0, 0, 1, 1],
    });
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['POSITION_UNKNOWN', 'CROSSING_OVERLOAD']));
    expect(JSON.stringify(issues)).not.toContain('coordinates');
    expect(issues.find(issue => issue.code === 'POSITION_UNKNOWN')?.severity).toBe('ERROR');
  });

  it('находит объект вне области, несовпадение стороны и противоречивое время', () => {
    const outside = { ...marker('outside'), geometry: { type: 'Point', coordinates: [2, 2] } as const };
    const wrongSide = { ...marker('wrong-side'), symbol: { ...marker().symbol, sideId: 'red' } };
    const wrongTime = { ...marker('wrong-time'), validFrom: end, validUntil: start };
    const codes = validateInitialMap({ bounds: [0, 0, 1, 1], markers: [outside, wrongSide, wrongTime] }).map(issue => issue.code);
    expect(codes).toEqual(expect.arrayContaining(['OUTSIDE_BOUNDS', 'SYMBOL_SIDE_MISMATCH', 'TIME_CONTRADICTORY']));
  });

  it('проверяет несовместимые районы, непроходимый маршрут, колонну и задачу', () => {
    const polygon = { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } as const;
    const issues = validateInitialMap({
      bounds: [0, 0, 2, 2],
      areas: [
        { id: 'a1', geometry: polygon, incompatibleWith: ['a2'] },
        { id: 'a2', geometry: polygon, incompatibleWith: ['a1'] },
      ],
      routes: [{ id: 'closed', passable: false }],
      columns: [{ id: 'column', routeId: null, offRoadJustification: '' }],
      tasks: [{ id: 'task', geometryRequired: true, geometry: null }],
    });
    expect(issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'INCOMPATIBLE_AREAS_OVERLAP', 'ROUTE_NOT_PASSABLE', 'COLUMN_ROUTE_REQUIRED', 'TASK_GEOMETRY_REQUIRED',
    ]));
  });

  it('разрешает явный район неопределённости вместо точного положения', () => {
    const issues = validateInitialMap({
      bounds: [0, 0, 2, 2],
      forces: [{
        id: 'unknown-force', position: null,
        uncertaintyArea: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
      }],
    });
    expect(issues).toEqual([expect.objectContaining({ code: 'POSITION_UNCERTAIN', severity: 'INFO' })]);
  });
});

describe('PREP-13/14 и ENV-12–15: версионная карта', () => {
  it('создаёт независимые слои и сохраняет прежнюю версию при ручной правке', () => {
    const initial = readyMap();
    expect(initial.layers.map(layer => layer.id)).toEqual(INITIAL_MAP_LAYER_IDS);
    expect(initial.environment.manifestSha256).toBe(hashA);
    const changed = updateInitialMapMarker(initial, 'blue-force', {
      geometry: { type: 'Point', coordinates: [0.3, 0.3] },
    });
    expect(changed.revision).toBe(2);
    expect(changed.markers[0].geometry).toEqual({ type: 'Point', coordinates: [0.3, 0.3] });
    expect(changed.history).toHaveLength(1);
    expect(changed.history[0].geometry).toEqual({ type: 'Point', coordinates: [0.2, 0.2] });
    expect(initial.markers[0].geometry).toEqual({ type: 'Point', coordinates: [0.2, 0.2] });
    expect(changed.markers[0].sourceId).toBe('source-1');
    expect(changed.markers[0].visibility.instanceIds).toEqual(['blue-hq']);
  });

  it('не даёт сместить часть связанной графики и проверяет область после сдвига', () => {
    const route: MapMarker = {
      ...marker('route-1'), kind: 'ROUTE', layerId: 'RESOURCES',
      geometry: { type: 'LineString', coordinates: [[0.2, 0.2], [0.4, 0.4]] },
      links: { linkedMarkerIds: ['blue-force'] },
    };
    const initial = addInitialMapMarker(readyMap(), route);
    expect(() => shiftInitialMapMarkers(initial, ['blue-force'], { lon: 0.1, lat: 0.1 })).toThrow('GROUP_SHIFT_LINKS');
    const shifted = shiftInitialMapMarkers(initial, ['blue-force', 'route-1'], { lon: 0.1, lat: 0.1 });
    expect(shifted.markers.find(item => item.id === 'blue-force')?.geometry).toEqual({ type: 'Point', coordinates: [0.30000000000000004, 0.30000000000000004] });
    expect(() => shiftInitialMapMarkers(initial, ['blue-force', 'route-1'], { lon: 2, lat: 2 })).toThrow('OUTSIDE_BOUNDS');
  });

  it('копирует обстановку с новыми идентификаторами без изменения оригинала', () => {
    const original = readyMap();
    let next = 0;
    const copy = copyInitialSituationMap(original, { id: 'map-copy', idFactory: () => `copy-${++next}` });
    expect(copy.id).toBe('map-copy');
    expect(copy.markers[0].id).toBe('copy-1');
    expect(copy.revision).toBe(1);
    expect(original.markers[0].id).toBe('blue-force');
    expect(copy.environment).toEqual(original.environment);
  });

  it('импортирует GeoJSON и согласованный внутренний JSON с повторной валидацией', () => {
    const item = marker('geo-force');
    const featureCollection = {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature', geometry: item.geometry,
        properties: {
          id: item.id, kind: item.kind, layerId: item.layerId, truth: item.truth,
          sourceId: item.sourceId, authorId: item.authorId, eventId: item.eventId,
          validFrom: item.validFrom, validUntil: item.validUntil, state: item.state,
          confidence: item.confidence, uncertainty: item.uncertainty, visibility: item.visibility,
          links: item.links, sideId: item.sideId, symbol: item.symbol,
        },
      }],
    };
    const imported = importInitialMap(featureCollection, { bounds: [0, 0, 1, 1] });
    expect(imported.issues).toEqual([]);
    expect(imported.markers[0]).toMatchObject({ id: 'geo-force', geometry: item.geometry, sourceId: 'source-1' });
    const roundTrip = importInitialMap(JSON.stringify(readyMap()), { bounds: [0, 0, 1, 1] });
    expect(roundTrip.issues).toEqual([]);
    expect(roundTrip.map?.markers[0].id).toBe('blue-force');
    expect(initialMapHash(roundTrip.map!)).toBe(initialMapHash(readyMap()));
  });

  it('не принимает импорт без источника, времени, видимости и связи', () => {
    const imported = importInitialMap({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: null, properties: { id: 'broken', kind: 'FORCE' } }],
    }, { bounds: [0, 0, 1, 1] });
    expect(imported.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'POSITION_UNKNOWN', 'SOURCE_REQUIRED', 'AUTHOR_REQUIRED', 'TIME_REQUIRED', 'VISIBILITY_REQUIRED', 'LINK_REQUIRED',
    ]));
    expect(imported.markers[0].geometry).toBeNull();
  });

  it('утверждает только валидную карту и стабильно хеширует содержимое', () => {
    const initial = readyMap();
    const approved = approveInitialMap(initial);
    expect(approved.state).toBe('APPROVED');
    expect(approved.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(initialMapHash(approved)).toBe(approved.sha256);
    expect(initial.state).toBe('DRAFT');
    expect(() => approveInitialMap({ ...initial, markers: [{ ...marker(), geometry: null }] })).toThrow('POSITION_UNKNOWN');
  });
});

describe('ROLE-03–06: истинная и приватные проекции', () => {
  it('не выдаёт истинное положение закрытой стороны другой инстанции', () => {
    const secret: MapMarker = {
      ...marker('secret-red'), sideId: 'red',
      geometry: { type: 'Point', coordinates: [0.8, 0.8] },
      visibility: { sideIds: ['red'], instanceIds: ['red-hq'] },
      symbol: { ...marker().symbol, sideId: 'red' },
    };
    const reported: MapMarker = {
      ...marker('reported-red'), truth: 'PRIVATE', layerId: 'OBSERVATIONS', state: 'ASSUMED', sideId: 'red',
      geometry: { type: 'Point', coordinates: [0.7, 0.7] },
      visibility: { sideIds: ['blue'], instanceIds: ['blue-hq'] },
      links: { forceId: 'force-red' },
      symbol: { ...marker().symbol, sideId: 'red' },
    };
    const initial = addInitialMapMarker(addInitialMapMarker(readyMap(), secret), reported);
    const blue = projectInitialMap(initial, { mode: 'INSTANCE', sideId: 'blue', instanceId: 'blue-hq', role: 'TRAINEE' });
    const red = projectInitialMap(initial, { mode: 'INSTANCE', sideId: 'red', instanceId: 'red-hq', role: 'TRAINEE' });
    const truth = projectInitialMap(initial, { mode: 'TRUTH', role: 'DIRECTOR' });
    expect(blue.markers.map(item => item.id)).toEqual(['blue-force', 'reported-red']);
    expect(JSON.stringify(blue)).not.toContain('secret-red');
    expect(JSON.stringify(blue)).not.toContain('0.8,0.8');
    expect(red.markers.map(item => item.id)).toEqual(['secret-red']);
    expect(truth.markers.map(item => item.id)).toEqual(['blue-force', 'secret-red', 'reported-red']);
  });

  it('запрещает обучаемому запрашивать истинную карту', () => {
    expect(() => projectInitialMap(readyMap(), { mode: 'TRUTH', role: 'TRAINEE' })).toThrow('TRUTH_PROJECTION_FORBIDDEN');
  });
});

describe('NF-19 и печатная воспроизводимость', () => {
  it('публикует схемы домена и команд без серверных зависимостей', () => {
    expect(INITIAL_MAP_JSON_SCHEMA.required).toEqual(expect.arrayContaining(['environment', 'layers', 'markers', 'symbolSet']));
    expect(INITIAL_MAP_COMMAND_SCHEMAS.geoJsonImport.required).toContain('document');
    const source = readFileSync(new URL('../src/scenario/initial-map.ts', import.meta.url), 'utf8');
    const hashSource = readFileSync(new URL('../src/scenario/initial-map-hash.ts', import.meta.url), 'utf8');
    expect(source + hashSource).not.toMatch(/node:|React|indexedDB|\bfetch\s*\(/);
  });

  it('сохраняет слои, версии знаков и атрибуцию в каноническом содержимом', () => {
    const approved = approveInitialMap(readyMap());
    const content = JSON.parse(initialMapCanonicalJson(approved)) as InitialSituationMap;
    expect(content.layers.map(layer => layer.id)).toEqual(INITIAL_MAP_LAYER_IDS);
    expect(content.markers[0].symbol).toMatchObject({ version: 'v1', sourceDocument: 'signs.doc', sourcePage: 12 });
    expect(content.attribution).toEqual(['OSM']);
    expect(content.symbolSet.sha256).toBe(hashB);
  });
});


describe('NF-19: устойчивость согласованного импорта', () => {
  it('диагностирует повреждённую геометрию, реквизиты и неполный набор слоёв без исключения', () => {
    const malformed = JSON.parse(JSON.stringify(readyMap())) as { layers: unknown[]; markers: unknown[] };
    malformed.layers = malformed.layers.slice(1);
    malformed.markers = [{ id: '', kind: 'FORCE', geometry: { type: 'Point', coordinates: null } }];
    const result = importInitialMap(JSON.stringify(malformed), { bounds: [0, 0, 1, 1] });
    expect(result.issues.map(issue => issue.code)).toEqual(expect.arrayContaining([
      'OBJECT_ID_REQUIRED', 'INVALID_GEOMETRY', 'UNCERTAINTY_REQUIRED', 'SYMBOL_REQUIRED', 'MAP_LAYER_REQUIRED',
    ]));
  });
});


describe('ENV-14: независимый масштабный профиль', () => {
  const profile = {
    id: 'hq-map', revision: 1, minZoom: 5, maxZoom: 12,
    requiredLayerIds: ['TRUE_FORCES'], availableLayerIds: ['TRUE_FORCES'],
    minimumAttributes: ['sourceId', 'validFrom', 'visibility'], aggregation: 'NONE',
  } as const;

  it('формирует предпросмотр слоёв без изменения масштаба учения и карты', () => {
    const initial = readyMap();
    const preview = projectInitialMapScale(initial, profile, 8);
    expect(preview.issues).toEqual([]);
    expect(preview.map.layers.map(layer => layer.id)).toEqual(['TRUE_FORCES']);
    expect(preview.map.markers.map(item => item.id)).toEqual(['blue-force']);
    expect(preview.map.revision).toBe(initial.revision);
    expect(initial.layers).toHaveLength(INITIAL_MAP_LAYER_IDS.length);
  });

  it('блокирует неподдерживаемый масштаб, слой и недостающую атрибуцию', () => {
    expect(() => projectInitialMapScale(readyMap(), profile, 13)).toThrow('SCALE_ZOOM_UNSUPPORTED');
    expect(() => projectInitialMapScale(readyMap(), { ...profile, availableLayerIds: ['WEATHER'] }, 8)).toThrow('SCALE_LAYER_UNAVAILABLE');
    const initial = { ...readyMap(), markers: [{ ...marker(), sourceId: '' }] };
    expect(projectInitialMapScale(initial, profile, 8).issues).toContainEqual(expect.objectContaining({ code: 'SCALE_ATTRIBUTE_REQUIRED', objectId: 'blue-force' }));
  });
});
