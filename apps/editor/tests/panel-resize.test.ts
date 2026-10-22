import { describe, expect, it } from 'vitest';
import { clampWidth } from '../src/panel-resize';

describe('ширина панели', () => {
  it('в пределах и не шире 70 % окна', () => {
    expect(clampWidth(200, 320, 900, 1440)).toBe(320);
    expect(clampWidth(500, 320, 900, 1440)).toBe(500);
    expect(clampWidth(1200, 320, 900, 1440)).toBe(900);
    expect(clampWidth(900, 320, 900, 1000)).toBe(700);
  });
});
