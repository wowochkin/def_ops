import { expect, it } from 'vitest';
import { emptyDocument, featureAt, type MapDocument, type SymbolFeature } from '@def-ops/core';
import { dailyPaths, followHistory, unitAt } from '../src/expo/stage-doc';

// Координаты реального изолированного сеанса hist/hist/uf3-elbe.
// Армия разбита на символы по смене состояния, последнее движение короче 0,08°.
const early = {
  id: 'five-march', kind: 'symbol', layerId: 'lvl-op-units', preset: 'std.unitOval', ref: 'su_5gva', name: '5-я гвардейская армия',
  at: [14.784, 51.555], rotation: 0, style: {}, time: { from: '1945-04-16T05:00', to: '1945-04-25T17:00' },
  keyframes: [{ t: '1945-04-16T05:00', at: [14.784, 51.555] }, { t: '1945-04-25T14:00', at: [13.0932608688, 51.5379384513] }],
} as unknown as SymbolFeature;
const arrived = {
  ...early, id: 'five-arrived', time: { from: '1945-04-25T17:00' }, at: [13.0671942156, 51.5382874565],
  keyframes: [{ t: '1945-04-25T17:00', at: [13.0671942156, 51.5382874565] }, { t: '1945-04-27T05:00', at: [12.9934, 51.5383] }, { t: '1945-05-02T05:00', at: [12.9934, 51.5383] }],
} as SymbolFeature;
const doc = (features: SymbolFeature[] = [early, arrived]): MapDocument => ({ ...emptyDocument(), features, timeline: { start: '1945-04-16T05:00', end: '1945-05-02T05:00', current: '1945-04-16T05:00', motion: 'smooth' } });

it('5-я гв. армия остаётся у Торгау после прибытия: короткий последний сегмент не заменяется историческим уходом на юг', () => {
  const result = followHistory(doc(), 'su_1uf');
  expect(result.features[1]).toBe(arrived);
  expect(featureAt(result.features[1] as SymbolFeature, '1945-05-02T05:00')?.at).toEqual([12.9934, 51.5383]);
  expect(featureAt(result.features[1] as SymbolFeature, '1945-04-25T17:00')?.at).toEqual(arrived.at);
});
it('положение армии выбирается из действующего сегмента, включая точную границу и интерполяцию', () => {
  expect(unitAt(doc(), 'su_5gva', '1945-04-25T17:00')).toEqual(arrived.at);
  expect(unitAt(doc(), 'su_5gva', '1945-04-26T11:00')).toEqual(featureAt(arrived, '1945-04-26T11:00')?.at);
  expect(unitAt(doc(), 'su_5gva', '1945-05-02T05:00')).toEqual([12.9934, 51.5383]);
  expect(unitAt(doc(), 'su_5gva', '1945-04-15T05:00')).toBeNull();
});
it('путь составляется по времени, а не склейкой полных путей отдельных символов', () => {
  const path = dailyPaths(doc([arrived, early]), ['su_5gva'], '1945-05-02T05:00').su_5gva;
  expect(path[0]).toEqual(early.at);
  expect(path.at(-1)).toEqual([12.9934, 51.5383]);
  expect(path.every((p, i) => !i || p[0] <= path[i - 1][0])).toBe(true);
});
