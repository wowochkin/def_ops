import { describe, expect, it } from 'vitest';
import { between, cardArrows, historyAt, MAP, projection, shortArmy, simplify, traceArmies, type ExpoMapData } from '../src/expo/map';

describe('карта стенда', () => {
  it('подписи армий кратко', () => {
    expect(shortArmy('8-я гвардейская армия')).toBe('8 гв. А');
    expect(shortArmy('1-я гвардейская танковая армия')).toBe('1 гв. ТА');
    expect(shortArmy('3-я ударная армия')).toBe('3 уд. А');
    expect(shortArmy('1-я армия Войска Польского')).toBe('1 А ВП');
  });

  it('упрощение сохраняет концы и изгиб', () => {
    expect(simplify([[0, 0], [1, 0.001], [2, 0]], 0.01)).toEqual([[0, 0], [2, 0]]);
    expect(simplify([[0, 0], [1, 1], [2, 0]], 0.01)).toHaveLength(3);
  });

  it('проекция: углы рамки — углы рисунка', () => {
    const p = projection([10, 50, 12, 52]);
    expect(p.xy([10, 52])).toEqual([0, 0]);
    expect(p.xy([12, 50])).toEqual([1000, p.height]);
  });

  it('армии по истории — между сутками по прямой, без положения — ближайшее', () => {
    const d: ExpoMapData = { ...MAP, days: ['1945-04-16T00:00', '1945-04-17T00:00'], armies: [
      { id: 'a', label: 'A', side: 'su', front: 'su_1bf', track: [[0, 0], [2, 2]] },
      { id: 'b', label: 'B', side: 'de', front: null, track: [null, [5, 5]] },
    ] };
    const at = historyAt('1945-04-16T12:00', d);
    expect(at.find((x) => x.id === 'a')!.at).toEqual([1, 1]);
    expect(at.find((x) => x.id === 'b')!.at).toEqual([5, 5]);
  });

  it('подложка: Берлин, реки и армии обоих фронтов', () => {
    expect(MAP.cities.find((c) => c.capital)?.name).toBe('Берлин');
    expect(MAP.rivers.length).toBeGreaterThan(50);
    expect(MAP.armies.filter((a) => a.front === 'su_1bf').length).toBeGreaterThan(5);
    expect(MAP.armies.filter((a) => a.front === 'su_1uf').length).toBeGreaterThan(5);
  });

  it('армии по ходу ядра — среднее дивизий по цепочке подчинения', () => {
    const t = {
      hqs: [{ id: 'su_8gva', parent: 'su_1bf', echelon: 'army' }, { id: 'k', parent: 'su_8gva', echelon: 'corps' }],
      divisions: [{ hq: 'k' }, { hq: 'su_8gva' }, { hq: 'x' }],
      frames: [[[14, 52], [15, 53], [1, 1]]],
    };
    const a = traceArmies(t);
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ id: 'su_8gva', label: '8 гв. А', at: [14.5, 52.5] });
  });

  it('стрелки карточки и промежуточные положения', () => {
    const armies = [{ id: 'a', label: 'A', side: 'su' as const, front: null, at: [0, 0] as [number, number] }];
    expect(cardArrows([{ army: 'a', kind: 'attack', place: 'X' }, { army: 'a', kind: 'hold', place: null }], armies, () => [1, 1])).toEqual([
      { army: 'a', from: [0, 0], to: [1, 1], kind: 'attack' },
    ]);
    expect(between(armies, [{ ...armies[0], at: [2, 2] }], 0.5)[0].at).toEqual([1, 1]);
  });
});

it('главные пути — самые длинные', async () => {
  const { mainPaths } = await import('../src/expo/map');
  const p = mainPaths({ a: [[0, 0], [1, 0]], b: [[0, 0], [3, 0]], c: [[0, 0]], d: [[0, 0], [2, 0]] }, 2);
  expect(Object.keys(p)).toEqual(['b', 'd']);
});
