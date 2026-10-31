import { expect, it } from 'vitest';
import { emptyDocument, type MapDocument, type SymbolFeature } from '@def-ops/core';
import { dailyPaths, fitView, orderFeatures, ORDERS_LAYER } from '../src/expo/stage-doc';

it('camera fits the box: wider box — smaller zoom, centre in the middle', () => {
  const a = fitView([13, 52, 14, 53], 1000, 600);
  const b = fitView([12, 52, 15, 53], 1000, 600);
  expect(b.zoom).toBeLessThan(a.zoom);
  expect(a.center[0]).toBeCloseTo(13.5, 5);
  expect(a.center[1]).toBeGreaterThan(52.4);
  expect(a.center[1]).toBeLessThan(52.6);
});

it('daily paths follow keyframes of the army symbol day by day; orders become atlas arrows', () => {
  const doc: MapDocument = { ...emptyDocument(), timeline: { start: '1945-04-16T05:00', end: '1945-04-19T05:00', current: '1945-04-16T05:00', motion: 'smooth' } };
  const army = {
    id: 's1', kind: 'symbol', layerId: 'lvl-op-units', preset: 'std.unitOval', at: [14.6, 52.6], rotation: 0, style: {}, ref: 'su_8gva',
    keyframes: [{ t: '1945-04-16T05:00', at: [14.6, 52.6] }, { t: '1945-04-17T20:00', at: [14.3, 52.55] }, { t: '1945-04-18T20:00', at: [14.0, 52.5] }],
  } as unknown as SymbolFeature;
  doc.features = [army];
  const p = dailyPaths(doc, ['su_8gva'], '1945-04-19T05:00');
  expect(p.su_8gva[0]).toEqual([14.6, 52.6]);
  expect(p.su_8gva.at(-1)).toEqual([14.0, 52.5]);
  const f = orderFeatures(doc, [{ army: 'su_2gta', from: [14.6, 52.6], to: [13.4, 52.5], kind: 'attack' }], 8, () => true);
  expect(f).toHaveLength(1);
  expect(f[0]).toMatchObject({ kind: 'arrow', preset: 'atlas.tank', layerId: ORDERS_LAYER });
});
