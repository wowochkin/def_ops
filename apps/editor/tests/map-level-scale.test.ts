import { describe, expect, it } from 'vitest';
import { LEVELS, levelDefaultScale, levelOfScale, levelScaleLabel, migrateLevel, scaleInLevel } from '../src/map-level-scale';

describe('масштабы пяти уровней карты', () => {
  it('интервалы: Ставка, фронт, армия, корпус, дивизия', () => {
    expect(levelScaleLabel('stavka')).toBe('1:700 000 – 1:1 500 000');
    expect(levelScaleLabel('front')).toBe('1:350 000 – 1:700 000');
    expect(levelScaleLabel('army')).toBe('1:150 000 – 1:350 000');
    expect(levelScaleLabel('corps')).toBe('1:75 000 – 1:150 000');
    expect(levelScaleLabel('division')).toBe('1:25 000 – 1:75 000');
  });
  it('при переключении — 1:1 000 000, 1:500 000, 1:200 000, 1:100 000, 1:50 000; каждый внутри своего интервала', () => {
    expect(LEVELS.map(levelDefaultScale)).toEqual([1_000_000, 500_000, 200_000, 100_000, 50_000]);
    for (const l of LEVELS) expect(levelOfScale(levelDefaultScale(l)), l).toBe(l);
  });
  it('граница принадлежит более мелкому уровню; интервалы не пересекаются', () => {
    expect(levelOfScale(150_000)).toBe('army');
    expect(levelOfScale(100_000)).toBe('corps');
    expect(levelOfScale(75_000)).toBe('corps');
    expect(levelOfScale(1_500_000)).toBe('stavka');
    for (let d = 25_000; d <= 1_500_000; d += 1_000) expect(LEVELS.filter((l) => scaleInLevel(l, d)).length, String(d)).toBe(1);
  });
  it('вне интервалов уровня нет', () => {
    expect(levelOfScale(2_000_000)).toBeNull();
    expect(levelOfScale(10_000)).toBeNull();
  });
  it('сохранённый уровень: старые три — по содержанию карты, мусор и пусто — дивизия', () => {
    expect(migrateLevel('tac')).toBe('division');
    expect(migrateLevel('op')).toBe('front');
    expect(migrateLevel('st')).toBe('stavka');
    expect(migrateLevel('army')).toBe('army');
    expect(migrateLevel('мусор')).toBe('division');
    expect(migrateLevel(null)).toBe('division');
  });
});
