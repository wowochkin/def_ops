import { describe, it, expect } from 'vitest';
import {
  emptyDocument, makeProjection, createFeature, migrateDocument, orderedFeatures, renderDocument, exportSVG,
  addLayer, updateLayer, removeLayer, moveLayer, setFeatureLayer, soloLayer, roleForPreset, pickLayer, toGeoJSON, fromGeoJSON,
  isFeatureEditable,
} from '@def-ops/core';

function doc() {
  const d = emptyDocument([14, 52.5], 8);
  const p = makeProjection(d.origin, d.refZoom);
  const ll = (x: number, y: number) => p.toLngLat([x, y]);
  const front = createFeature('line', 'atlas.front15', { points: [ll(0, -100), ll(0, 100)], layerId: pickLayer(d, 'line', 'atlas.front15') });
  const arrow = createFeature('arrow', 'atlas.p1', { points: [ll(0, 0), ll(-200, 0)], layerId: pickLayer(d, 'arrow', 'atlas.p1') });
  if (arrow.kind === 'arrow') arrow.anchor = { featureId: front.id, t: 0.5 };
  const town = createFeature('label', 'atlas.city', { at: ll(50, 50), text: 'Кюстрин', layerId: pickLayer(d, 'label', 'atlas.city') });
  d.features.push(arrow, front, town);
  return { d, front, arrow, town };
}

describe('слои', () => {
  it('раскладка по смыслу знака', () => {
    expect(roleForPreset('line', 'atlas.front15')).toBe('front');
    expect(roleForPreset('arrow', 'atlas.german')).toBe('enemy');
    expect(roleForPreset('line', 'inf.river')).toBe('base');
    expect(roleForPreset('label', 'atlas.unit')).toBe('labels');
    expect(roleForPreset('symbol', 'inf.settlement')).toBe('labels');
    expect(roleForPreset('label', 'atlas.enemyUnit')).toBe('enemy');
    expect(roleForPreset('arrow', 'atlas.p1')).toBe('friendly');
    // уставные знаки — по категории библиотеки и принадлежности
    expect(roleForPreset('symbol', 'sa.tank', 'enemy')).toBe('enemy');
    expect(roleForPreset('symbol', 'sa.tank', 'own')).toBe('friendly');
    expect(roleForPreset('line', 'rkka.wire1', 'neutral')).toBe('front');
    expect(roleForPreset('line', 'sa.frontLine', 'enemy')).toBe('front');
    expect(roleForPreset('area', 'std.forest')).toBe('base');
  });

  it('порядок отрисовки — по слоям, а не по порядку в массиве', () => {
    const { d, front, arrow } = doc();
    const order = orderedFeatures(d).flatMap((g) => g.features.map((f) => f.id));
    expect(order.indexOf(arrow.id)).toBeLessThan(order.indexOf(front.id)); // «свои» ниже «фронта»
    const up = moveLayer(d, 'friendly', 1);
    const order2 = orderedFeatures(up).flatMap((g) => g.features.map((f) => f.id));
    expect(order2.indexOf(arrow.id)).toBeGreaterThan(order2.indexOf(front.id));
  });

  it('скрытый слой не рендерится, но привязка к его линии сохраняется', () => {
    const { d, arrow } = doc();
    const hidden = updateLayer(d, 'front', { visible: false });
    const r = renderDocument(hidden);
    expect(r.layers.map((l) => l.id)).not.toContain('front');
    const a = r.features.find((f) => f.id === arrow.id)!;
    expect(a.svg).toContain('<path');
    expect(soloLayer(d, 'front').layers.filter((l) => l.visible).map((l) => l.id)).toEqual(['front']);
  });

  it('заблокированный слой не редактируется; удаление слоя переносит объекты', () => {
    const { d, town } = doc();
    expect(isFeatureEditable(updateLayer(d, 'labels', { locked: true }), town)).toBe(false);
    const moved = removeLayer(d, 'labels', 'base');
    expect(moved.features.find((f) => f.id === town.id)!.layerId).toBe('base');
    const dropped = removeLayer(d, 'front');
    const arrow = dropped.features.find((f) => f.kind === 'arrow');
    expect(arrow && arrow.kind === 'arrow' && arrow.anchor).toBeNull();
  });

  it('новый слой, перенос объекта, SVG со слоями-группами', () => {
    const { d, town } = doc();
    const { doc: d2, layer } = addLayer(d, { name: 'Разведка' }, 'front');
    expect(d2.layers.findIndex((l) => l.id === layer.id)).toBe(d2.layers.findIndex((l) => l.id === 'front') + 1);
    const d3 = setFeatureLayer(d2, town.id, layer.id);
    const svg = exportSVG(d3);
    expect(svg).toContain(`inkscape:label="Разведка"`);
    expect(exportSVG(d3, { layers: ['front'] })).not.toContain('Разведка');
  });

  it('миграция v1 → v2', () => {
    const { d } = doc();
    const v1 = { ...d, version: 1, layers: undefined, features: d.features.map(({ layerId: _l, ...f }) => f) };
    const m = migrateDocument(v1);
    expect(m.version).toBe(2);
    expect(m.layers.length).toBeGreaterThan(3);
    expect(m.features.every((f) => m.layers.some((l) => l.id === f.layerId))).toBe(true);
    expect(() => migrateDocument({ version: 9, features: [] })).toThrow();
  });
});

describe('GeoJSON', () => {
  it('экспорт и импорт без потерь', () => {
    const { d, arrow } = doc();
    const fc = toGeoJSON(d);
    expect(fc.features).toHaveLength(3);
    const a = fc.features.find((f) => f.id === arrow.id)!;
    expect(a.geometry!.type).toBe('LineString');
    const empty = { ...emptyDocument(), layers: [] };
    const back = fromGeoJSON(empty, JSON.parse(JSON.stringify(fc))).doc;
    expect(back.features).toHaveLength(3);
    const ba = back.features.find((f) => f.id === arrow.id)!;
    expect(ba.kind === 'arrow' && ba.anchor).toBeTruthy();
    expect(JSON.stringify(ba.style)).toBe(JSON.stringify(arrow.style));
  });
  it('чужой GeoJSON — знаки по умолчанию', () => {
    const d = emptyDocument();
    const r = fromGeoJSON(d, {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[14, 52], [14.1, 52], [14.1, 52.1], [14, 52]]] }, properties: {} },
        { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[14, 52], [14.2, 52.1]], [[14, 52.3], [14.2, 52.3]]] }, properties: { name: 'Рубеж' } },
      ],
    }, { layerId: 'enemy' });
    expect(r.added).toHaveLength(3);
    expect(r.doc.features.every((f) => f.layerId === 'enemy')).toBe(true);
    const poly = r.doc.features.find((f) => f.kind === 'area')!;
    expect(poly.kind === 'area' && poly.points.length).toBe(3);
  });
});
