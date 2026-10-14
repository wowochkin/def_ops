import { describe, expect, it } from 'vitest';
import { createFeature, emptyDocument, type Feature, type LngLat, type SymbolFeature } from '@def-ops/core';
import { nearestFeature, shownFeatures, unitAt, unitPlace } from '../src/map-pick';

// проекция «как есть»: долгота, широта — пиксели
const project = (p: LngLat) => [p[0], p[1]] as [number, number];
const sym = (at: LngLat, name: string, layerId = 'sim-own', ref?: string): Feature => {
  const f = createFeature('symbol', 'std.unitOval', { at, layerId }, 1, 'own') as SymbolFeature;
  f.name = name;
  if (ref) f.ref = ref;
  return f;
};
const line = (points: LngLat[], name: string): Feature => {
  const f = createFeature('line', 'std.frontLine', { points, layerId: 'sim-front' }, 1, 'own');
  f.name = name;
  return f;
};

describe('nearestFeature: знак под курсором', () => {
  it('ближайший знак в радиусе (от края знака), дальше — ничего', () => {
    const fs = [sym([0, 0], 'А'), sym([30, 0], 'Б')];
    expect(nearestFeature(fs, project, [4, 0])?.name).toBe('А');
    expect(nearestFeature(fs, project, [24, 0])?.name).toBe('Б');
    // 20 px от центра − 6 px края = 14: на границе радиуса уже не берётся
    expect(nearestFeature(fs, project, [0, 20])).toBeNull();
  });
  it('знаки важнее линий при почти равном расстоянии; lines: false — линии не берутся', () => {
    const fs = [line([[-50, 5], [50, 5]], 'фронт'), sym([0, 12], 'знак')];
    // до линии 3 − 2 = 1, до знака 4 − 6 = −2: знак ближе
    expect(nearestFeature(fs, project, [0, 8])?.name).toBe('знак');
    // у самой линии и далеко от знака — линия, а без линий — ничего
    expect(nearestFeature(fs, project, [40, 5])?.name).toBe('фронт');
    expect(nearestFeature(fs, project, [40, 5], { lines: false })).toBeNull();
  });
  it('unitAt — только знаки с формированием и не исторические', () => {
    const fs = [sym([0, 0], 'призрак', 'hist-units', 'a'), sym([10, 0], 'без ref'), sym([16, 0], '8 гв. А', 'lvl-op-units', 'su_8ga')];
    expect(unitAt(fs, project, [2, 0])?.ref).toBe('su_8ga');
    expect(unitPlace(fs, 'su_8ga')).toEqual([16, 0]);
    expect(unitPlace(fs, 'a')).toBeNull();
  });
  it('shownFeatures: видимые слои в момент времени', () => {
    const doc = emptyDocument([0, 0], 8);
    doc.layers = [{ id: 'sim-own', name: 'свои', role: 'friendly', visible: true, locked: true, opacity: 1 }, { id: 'off', name: 'скрыт', role: 'custom', visible: false, locked: true, opacity: 1 }];
    const a = sym([0, 0], 'А'), b = sym([1, 1], 'Б', 'off'), c = sym([2, 2], 'В');
    c.time = { from: '1945-04-20', to: null };
    doc.features = [a, b, c];
    expect(shownFeatures(doc, '1945-04-17').map((f) => f.name)).toEqual(['А']);
    expect(shownFeatures(doc, '1945-04-21').map((f) => f.name)).toEqual(['А', 'В']);
  });
});
