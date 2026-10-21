import { describe, expect, it } from 'vitest';
import { levelDefaultScale, levelOfScale, levelScaleLabel, scaleInLevel } from '../src/map-level-scale';

describe('рекомендуемые масштабы по уровням', () => {
  it('интервалы заказчика', () => {
    expect(levelScaleLabel('tac')).toBe('1:25 000 – 1:50 000');
    expect(levelScaleLabel('op')).toBe('1:100 000 – 1:200 000');
    expect(levelScaleLabel('st')).toBe('1:200 000 – 1:500 000');
  });
  it('1:200 000 — стратегический, не оперативный', () => {
    expect(levelOfScale(200_000)).toBe('st');
    expect(scaleInLevel('op', 200_000)).toBe(false);
    expect(scaleInLevel('st', 200_000)).toBe(true);
    expect(levelOfScale(150_000)).toBe('op');
    expect(levelOfScale(30_000)).toBe('tac');
    expect(levelOfScale(500_000)).toBe('st');
  });
  it('между интервалами и вне них уровня нет', () => {
    expect(levelOfScale(75_000)).toBeNull();
    expect(levelOfScale(2_000_000)).toBeNull();
    expect(levelOfScale(10_000)).toBeNull();
  });
  it('при переключении уровня — 1:50 000, 1:150 000, 1:300 000; каждый внутри своего интервала', () => {
    expect([levelDefaultScale('tac'), levelDefaultScale('op'), levelDefaultScale('st')]).toEqual([50_000, 150_000, 300_000]);
    for (const l of ['tac', 'op', 'st'] as const) expect(levelOfScale(levelDefaultScale(l)), l).toBe(l);
  });
  it('граница оперативного и стратегического не пересекается', () => {
    for (let d = 100_000; d <= 500_000; d += 1_000) expect([scaleInLevel('op', d), scaleInLevel('st', d)].filter(Boolean).length, String(d)).toBeLessThanOrEqual(1);
  });
});
