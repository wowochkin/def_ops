import { expect, it } from 'vitest';
import {
  getSymbol,
  renderSymbol,
  symbolFeatures,
  symbolImages,
  symbolLayers,
} from '../src/index';
import { coverageReport, sourceRegistry } from '../src/source/registry';

it('пустой allowedModifierIds запрещает любой неперечисленный модификатор', () => {
  expect(() => renderSymbol({
    id: 'restricted', frame: 'NONE', anchor: [0.5, 0.5], labels: {}, allowedModifierIds: [],
    modifiers: [{ id: 'unlisted', kind: 'TASK', value: 'недопустимо' }],
  }, { width: 64, height: 64 })).toThrow('Недопустимый модификатор');
});

it('MapLibre использует исходные шаблоны, модификаторы и подписи линий и районов', () => {
  const movement = getSymbol('source-68');
  const area = getSymbol('source-118');
  const features = symbolFeatures([
    {
      id: 'movement-1', setVersion: 'test-set', geometry: { type: 'LineString', coordinates: [[30, 50], [31, 51]] },
      symbol: { ...movement, allowedModifierIds: ['main'], labels: { top: 'Маршрут А' }, modifiers: [{ id: 'main', kind: 'TASK', value: 'основной' }] },
    },
    {
      id: 'area-1', setVersion: 'test-set', geometry: { type: 'Polygon', coordinates: [[[30, 50], [31, 50], [31, 51], [30, 50]]] },
      symbol: { ...area, labels: { top: 'Район Б' } },
    },
  ]);
  expect(features.features[0].properties).toMatchObject({ geometryTemplate: 'SOURCE_VECTOR', label: 'Маршрут А' });
  expect(features.features[0].properties.modifiers).toEqual([{ id: 'main', kind: 'TASK', value: 'основной' }]);
  expect(features.features[0].properties.geometryParameters).toBeDefined();
  expect(features.features[1].properties.label).toBe('Район Б');
  const layers = symbolLayers();
  const template = layers.find(layer => layer.id === 'tactical-symbols-lines-template');
  expect(template).toMatchObject({ type: 'symbol', layout: { 'symbol-placement': 'line', 'icon-image': ['get', 'icon'] } });
  expect(layers.find(layer => layer.id === 'tactical-symbols-areas-pattern')).toMatchObject({ type: 'fill', paint: { 'fill-pattern': ['get', 'icon'] } });
  expect(layers.find(layer => layer.id === 'tactical-symbols-lines')?.paint).toMatchObject({ 'line-dasharray': ['get', 'lineDasharray'] });

  const pontoon = { ...getSymbol('source-1'), id: 'pontoon-test', geometry: { version: 1, template: 'PONTOON' as const, parameters: { spans: 3 } } };
  const changed = { ...pontoon, geometry: { ...pontoon.geometry, parameters: { ...pontoon.geometry.parameters, spans: 5 } } };
  const [ordinaryImage, changedImage] = symbolImages([pontoon, changed]);
  expect(changedImage.svg).not.toBe(ordinaryImage.svg);
  expect(symbolFeatures([{ id: 'pontoon-1', setVersion: 'test', symbol: changed, geometry: { type: 'LineString', coordinates: [[30, 50], [31, 50]] } }]).features[0].properties.geometryParameters).toMatchObject({ spans: 5 });
});

it('missingDocuments выявляет удалённый и неполностью перенесённый документ', () => {
  const removed = sourceRegistry.documents[0];
  const withoutDocument = { ...sourceRegistry, documents: sourceRegistry.documents.slice(1) };
  expect(coverageReport(withoutDocument).missingDocuments).toContain(removed.originalName);
  const incomplete = {
    ...sourceRegistry,
    documents: [{ ...removed, coverage: 'REGISTERED' as const, fragmentIds: [] }, ...sourceRegistry.documents.slice(1)],
    fragments: sourceRegistry.fragments.filter(fragment => fragment.documentId !== removed.id),
  };
  expect(coverageReport(incomplete).missingDocuments).toContain(removed.originalName);
});
