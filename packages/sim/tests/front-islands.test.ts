import { describe, expect, it } from 'vitest';
import { mergeIslands } from '../src/front';

// 8×6: слева сторона 0, справа сторона 1; остров стороны 1 внутри стороны 0 (клетки 2–3 ряда 2) и остров стороны 0
// у края карты справа (не трогается)
const grid = (rows: string[]) => rows.join('').split('').map((x) => (x === '.' ? -1 : Number(x)));
const G = grid([
  '00001111',
  '00001111',
  '00110111',
  '00000110',
  '00001111',
  '00001111',
]);

describe('острова территории для линии фронта', () => {
  it('остров без котла отдаётся окружающей стороне; кусок у края карты остаётся', () => {
    const out = mergeIslands(8, 6, G, () => false);
    expect(out[2 * 8 + 2]).toBe(0);
    expect(out[2 * 8 + 3]).toBe(0);
    expect(out[3 * 8 + 7]).toBe(0);
  });
  it('котёл (keep) остаётся', () => {
    const out = mergeIslands(8, 6, G, (side, cells) => side === 1 && cells.includes(2 * 8 + 2));
    expect(out[2 * 8 + 2]).toBe(1);
    expect(out[2 * 8 + 3]).toBe(1);
  });
  it('остров стороны 0 внутри стороны 1 — тоже', () => {
    const H = grid(['11111111', '11111111', '11100111', '11111111', '00000000', '00000000']);
    const out = mergeIslands(8, 6, H, () => false);
    expect(out[2 * 8 + 3]).toBe(1);
    expect(out[5 * 8]).toBe(0);
  });
});
