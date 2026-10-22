import { describe, expect, it } from 'vitest';
import { divergence } from '../tools/agents/divergence';

const start = '1945-04-16T05:00';
const time = (h: number) => new Date(Date.parse(`${start}:00Z`) + h * 3600e3).toISOString().slice(0, 16);
const row = (lng: number) => [lng, 52, 'оборона: поспешная', 9000, 0, 100, 2, 1, 0, 1, 0];
const trace = {
  scenario: 't', name: 't', start, hours: 48, seed: 1,
  fields: ['lng', 'lat', 'state', 'personnel', 'tanks', 'guns', 'ammo', 'fuel', 'fatigue', 'cohesion', 'encircled'],
  divisions: [
    { id: 'd1', name: 'дивизия 1', side: 'su', hq: 'a', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
    { id: 'd2', name: 'дивизия 2', side: 'su', hq: 'b', kind: 'sd', mobility: 'foot', size: 'rifle', quality: 1 },
  ],
  hqs: [
    { id: 'f', name: 'фронт', side: 'su', echelon: 'front', parent: null },
    { id: 'a', name: 'армия А', side: 'su', echelon: 'army', parent: 'f' },
    { id: 'b', name: 'армия Б', side: 'su', echelon: 'army', parent: 'f' },
    { id: 'k', name: 'корпус армии А', side: 'su', echelon: 'corps', parent: 'a' },
  ],
  frames: Array.from({ length: 49 }, () => [row(14), row(15)]),
  journal: [],
  documents: [
    { tick: 20, time: time(20), hq: 'a', kind: 'order', to: ['d1'], text: 'наступать', rule: null },
    { tick: 30, time: time(30), hq: 'f', kind: 'directive', to: ['a'], text: 'наступать', rule: 'ПУ-39' },
    { tick: 47, time: time(47), hq: 'a', kind: 'order', to: ['d1'], text: 'поздно', rule: null },
    { tick: 25, time: time(25), hq: 'k', kind: 'order', to: ['d1'], text: 'корпус', rule: null },
  ],
};
const history = { divisions: [
  { formation: 'd1', time: time(12), at: [14, 52] as [number, number], approxKm: 2, reliability: 'B' },
  { formation: 'd1', time: time(24), at: [14.45, 52] as [number, number], approxKm: 2, reliability: 'B' },
  { formation: 'd2', time: time(24), at: [15, 52] as [number, number], approxKm: 2, reliability: 'B' },
] };

describe('отчёт о расхождениях', () => {
  it('армия вне допуска — первый час и документы её штабов за ±12 ч; армия в допуске — без строки', () => {
    const rows = divergence(trace, history, 10, [{ id: 'stavka-1', date: time(24).slice(0, 10), goal: 'наступать на Берлин', from: 'su_stavka' },
      { id: 'okh-1', date: time(24).slice(0, 10), goal: 'держать Одер', from: 'de_hc' }]);
    expect(rows.map((r) => r.army)).toEqual(['a']);
    expect(rows[0].firstOutAt).toBe(time(24));
    expect(rows[0].deviationKm).toBeGreaterThan(10);
    // документы штаба армии, её старших и её корпусов; директивы — только своей стороны
    expect(rows[0].documents.map((d) => d.tick)).toEqual([20, 30, 25]);
    expect(rows[0].historical).toEqual(['stavka-1: наступать на Берлин']);
  });
});
