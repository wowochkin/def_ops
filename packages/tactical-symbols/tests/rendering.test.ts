import { describe, expect, it } from 'vitest';
import {
  anchorOffset,
  anchorPixels,
  approveSymbol,
  assertSymbolsApproved,
  deprecateSymbol,
  formatCrossingLabels,
  formatRoadLabels,
  getSymbol,
  pinSymbolUsage,
  renderSymbol,
  simplifySymbol,
  symbolFeatures,
  symbolImages,
  symbolLayers,
  symbolLegend,
  symbolSet,
  symbolSource,
  transitionSymbol,
} from '../src/index';

const minimalSymbol = {
  id: 'cp',
  frame: 'RECTANGLE',
  anchor: [0.5, 1],
  modifiers: [],
  labels: {},
} as const;

describe('жизненный цикл и версии знаков', () => {
  it('не утверждает непроверенный знак', () => {
    expect(() => approveSymbol({ status: 'MAPPED' })).toThrow('VERIFIED');
    expect(approveSymbol({ status: 'VERIFIED' }).status).toBe('APPROVED');
    expect(() => transitionSymbol({ status: 'IMPORTED' }, 'VERIFIED')).toThrow('MAPPED');
  });

  it('оформляет DEPRECATED с основанием и заменой', () => {
    expect(() => deprecateSymbol({ status: 'APPROVED' }, { reason: '', replacementId: 'cp-v2' })).toThrow('основание');
    expect(deprecateSymbol(
      { status: 'APPROVED', version: '1.0.0' },
      { reason: 'Заменён новой редакцией', replacementId: 'cp-v2' },
    )).toMatchObject({ status: 'DEPRECATED', replacementId: 'cp-v2', version: '1.0.0' });
    expect(() => approveSymbol({ status: 'DEPRECATED' })).toThrow('VERIFIED');
  });

  it('фиксирует точную версию в сценарии и блокирует непроверенный набор', () => {
    const usage = pinSymbolUsage(symbolSet, 'source-1');
    expect(usage).toMatchObject({
      symbolId: 'source-1-1',
      symbolVersion: '3.0.0',
      setVersion: 'ru-modern-v3',
      geometryVersion: 1,
    });
    expect(() => assertSymbolsApproved([usage], [symbolSet])).toThrow('APPROVED');

    const commandPost = getSymbol('source-1');
    const laterSet = {
      ...symbolSet,
      version: 'ru-modern-v4',
      symbols: [{ ...commandPost, version: '3.1.0', status: 'APPROVED' as const }],
    };
    expect(symbolLegend([usage], [symbolSet, laterSet])).toEqual([{
      symbolId: 'source-1-1',
      name: commandPost.name,
      symbolVersion: '3.0.0',
      setVersion: 'ru-modern-v3',
      geometryVersion: 1,
      status: 'MAPPED',
    }]);
  });
});

describe('параметрический SVG', () => {
  it('сохраняет точку привязки и не использует растровые изображения', () => {
    const svg = renderSymbol(minimalSymbol, { width: 64, height: 64 });
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('<image');
    expect(svg).toContain('data-anchor-x="0.5"');
    expect(svg).toContain('data-anchor-y="1"');
    expect(anchorPixels(minimalSymbol, { width: 64, height: 64 })).toEqual([32, 64]);
    expect(anchorOffset(minimalSymbol, { width: 64, height: 64 })).toEqual([0, -32]);
  });

  it('проверяет правила сочетания модификаторов', () => {
    const commandPost = { ...getSymbol('source-1'), allowedModifierIds: ['main', 'auxiliary'] };
    expect(() => renderSymbol({
      ...commandPost,
      modifiers: [
        { id: 'main', kind: 'TASK', value: 'основной', incompatibleWith: ['auxiliary'] },
        { id: 'auxiliary', kind: 'TASK', value: 'вспомогательный' },
      ],
    }, { width: 64, height: 64 })).toThrow('несовместим');
  });

  it('изменяет векторную геометрию от параметров и экранирует русские подписи', () => {
    const crossing = { ...getSymbol('source-1'), id: 'pontoon-test', geometry: { version: 1, template: 'PONTOON' as const, parameters: { spans: 3 } } };
    const ordinary = renderSymbol(crossing, { width: 96, height: 96 });
    const changed = renderSymbol({
      ...crossing,
      geometry: { ...crossing.geometry, parameters: { ...crossing.geometry.parameters, spans: 5 } },
      labels: { top: 'Рота <А> & «Б»' },
    }, { width: 96, height: 96 });
    expect(changed).not.toBe(ordinary);
    expect(changed).toContain('Рота &lt;А&gt; &amp; «Б»');
    expect(changed).not.toContain('<image');
    expect(changed).not.toContain('@font-face');
  });

  it('семантически упрощает без потери принадлежности, типа, якоря и версии', () => {
    const commandPost = getSymbol('source-1');
    const simplified = simplifySymbol({
      ...commandPost,
      labels: { top: 'Штаб армии' },
      modifiers: [{ id: 'main', kind: 'TASK', value: 'основной' }],
    });
    expect(simplified).toMatchObject({
      affiliation: commandPost.affiliation,
      objectType: commandPost.objectType,
      anchor: commandPost.anchor,
      version: commandPost.version,
      modifiers: [],
      labels: {},
    });
    const svg = renderSymbol(commandPost, { width: 64, height: 64, detail: 'SEMANTIC' });
    expect(svg).toContain(`data-object-type="${commandPost.objectType}"`);
    expect(svg).toContain('data-detail="SEMANTIC"');
  });
});

describe('сложные переправы, дороги и МТО', () => {
  it('выводит только известные параметры переправы в выбранных единицах', () => {
    expect(formatCrossingLabels({
      kind: 'FORD',
      lengthM: 120,
      widthM: 8.5,
      capacityTonnes: 40,
      depthM: 1.2,
      bottom: 'твёрдое',
      currentMps: 0.8,
      state: 'открыт',
      throughputPerHour: 12,
    })).toEqual({
      length: '120 м',
      width: '8,5 м',
      capacity: '40 т',
      depth: '1,2 м',
      bottom: 'твёрдое',
      current: '0,8 м/с',
      state: 'открыт',
      throughput: '12 ед./ч',
    });
    expect(formatCrossingLabels({ kind: 'FERRY', lengthM: null, depthM: null })).toEqual({});
    expect(formatCrossingLabels({ kind: 'FERRY', lengthM: 1200 }, { length: 'km' })).toEqual({ length: '1,2 км' });
    expect(formatRoadLabels(
      { lengthM: 12_500, widthM: 6, state: 'повреждена', throughputPerHour: 80 },
      { length: 'km' },
    )).toEqual({ length: '12,5 км', width: '6 м', state: 'повреждена', throughput: '80 ед./ч' });
  });

  it('рендерит все обязательные семейства без TTF и внешних ресурсов', () => {
    for (const definition of symbolSet.symbols) {
      const svg = renderSymbol(definition, { width: 80, height: 80 });
      expect(svg, definition.id).toContain('<svg');
      expect(svg, definition.id).toMatch(/<(path|rect|circle|polygon|polyline|line|use)\b/);
      expect(svg, definition.id).not.toContain('<image');
      expect(svg, definition.id).not.toMatch(/(?:src|href)=["']https?:|\.ttf|@font-face/);
      expect(definition.status, definition.id).toBe('MAPPED');
      if (definition.id.startsWith('source-')) expect(definition.source.symbolNumber, definition.id).toMatch(/^\d+$/);
      else expect(definition.source.symbolNumber, definition.id).toBeNull();
      expect(definition.source.referenceFragment.sha256, definition.id).toMatch(/^[a-f0-9]{64}$/);
      expect(definition.source.gaps.length, definition.id).toBeGreaterThan(0);
    }
    expect(symbolSet.symbols.some(symbol => symbol.status === 'APPROVED')).toBe(false);
  });
});

describe('MapLibre без внешних ресурсов', () => {
  it('создаёт точки, линии, площади, кластеры и локальные SVG-образы', () => {
    const instances = [
      { id: 'cp-1', setVersion: symbolSet.version, symbol: getSymbol('source-1'), geometry: { type: 'Point', coordinates: [30, 50] } },
      { id: 'cp-2', setVersion: symbolSet.version, symbol: getSymbol('source-429'), geometry: { type: 'Point', coordinates: [31, 51] } },
      { id: 'route-1', setVersion: symbolSet.version, symbol: getSymbol('source-68'), geometry: { type: 'LineString', coordinates: [[30, 50], [31, 51]] } },
      { id: 'area-1', setVersion: symbolSet.version, symbol: getSymbol('source-118'), geometry: { type: 'Polygon', coordinates: [[[30, 50], [31, 50], [31, 51], [30, 50]]] } },
    ] as const;
    const features = symbolFeatures(instances, { width: 64, height: 64 });
    const source = symbolSource(features);
    const layers = symbolLayers();
    const images = symbolImages([getSymbol('source-1'), getSymbol('source-429')], { width: 64, height: 64 });

    expect(features.features).toHaveLength(4);
    expect(features.features[0].properties).toMatchObject({
      symbolId: 'source-1-1', symbolVersion: '3.0.0', setVersion: 'ru-modern-v3', offset: [0, 0],
    });
    expect(source).toMatchObject({ type: 'geojson', cluster: true, clusterMaxZoom: 14 });
    expect(layers.map(layer => layer.id)).toEqual(expect.arrayContaining([
      'tactical-symbols-clusters', 'tactical-symbols-points',
      'tactical-symbols-lines', 'tactical-symbols-areas',
    ]));
    expect(images).toHaveLength(2);
    expect(images.every(image => image.svg.includes('<svg') && !image.svg.includes('<image'))).toBe(true);
    expect(JSON.stringify({ source, layers, images })).not.toMatch(/(?:src|href)=["']https?:|\.ttf/);
  });

  it('раскрывает кластер через API MapLibre с исходным clusterId', async () => {
    const { expandSymbolCluster } = await import('../src/index');
    await expect(expandSymbolCluster(42, async clusterId => {
      if (clusterId !== 42) throw new Error('Неверный clusterId');
      return 8;
    })).resolves.toEqual({ clusterId: 42, zoom: 8 });
  });
});
