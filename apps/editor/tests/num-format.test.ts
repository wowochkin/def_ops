import { describe, expect, it } from 'vitest';
import { fmtCount, fmtFrac, fmtHours, fmtKm, fmtPct } from '../src/num-format';

describe('общий формат чисел карточек', () => {
  it('часы и километры — целые, доли — две цифры с запятой, тысячи — с неразрывным пробелом', () => {
    expect(fmtHours(13.416)).toBe('13 ч');
    expect(fmtHours(-2)).toBe('0 ч');
    expect(fmtKm(12.6)).toBe('13 км');
    expect(fmtKm(1234.4)).toBe('1\u00a0234 км'); // тысячи — неразрывный пробел
    expect(fmtFrac(0.5)).toBe('0,50');
    expect(fmtFrac(1)).toBe('1,00');
    expect(fmtCount(4920.6)).toBe('4\u00a0921');
    expect(fmtCount(Number.NaN)).toBe('0');
    expect(fmtPct(0.987)).toBe('99 %');
    expect(fmtPct(null)).toBe('—');
  });
});
