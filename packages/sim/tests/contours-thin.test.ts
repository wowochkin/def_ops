import { describe, expect, it } from 'vitest';
import { dropBlobs, thinMask } from '../src/overlay';
import { gridContours } from '../src/theatre-io';
import type { TerrainGrid } from '../src/types';

describe('растр → контуры местности и осевые дорог', () => {
  it('контуры по растру: площадь — как у клеток класса, озеро в лесу — дыра', () => {
    // 6×5: лес кольцом вокруг воды, отдельная клетка застройки
    const rows = ['ffffou', 'fwwfoo', 'fwwfoo', 'ffffoo', 'oooooo'];
    const g: TerrainGrid = { bbox: [0, 0, 6, 5], cols: 6, rows: 5, rle: rows.join('') };
    const sh = gridContours(g);
    const forest = sh.filter((x) => x.class === 'forest');
    expect(forest).toHaveLength(1);
    expect(forest[0].holes).toHaveLength(1);
    const area = (r: [number, number][]) => Math.abs(r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
    expect(area(forest[0].ring) - area(forest[0].holes[0])).toBe(12);
    expect(sh.filter((x) => x.class === 'water').map((x) => area(x.ring))).toEqual([4]);
    expect(sh.filter((x) => x.class === 'urban').map((x) => area(x.ring))).toEqual([1]);
    // углы контура — только в изломах: квадрат воды — 4 вершины
    expect(sh.find((x) => x.class === 'water')!.ring).toHaveLength(4);
  });

  it('дорога полосой в 3 клетки утончается до линии в одну клетку без разрывов', () => {
    const cols = 20, rows = 7, m = new Uint8Array(cols * rows);
    for (let r = 2; r <= 4; r++) for (let c = 1; c < 19; c++) m[r * cols + c] = 1;
    thinMask(m, cols, rows);
    const per = Array.from({ length: cols }, (_, c) => [0, 1, 2, 3, 4, 5, 6].filter((r) => m[r * cols + c]).length);
    expect(Math.max(...per)).toBe(1);
    // связность: в каждом столбце середины линии есть клетка
    for (let c = 3; c < 17; c++) expect(per[c]).toBe(1);
  });

  it('в линейных классах остаются линии: буквы и заливка того же цвета отбрасываются', () => {
    const S = 128, cls = new Int8Array(S * S).fill(-1);
    const at = (x: number, y: number) => cls[y * S + x];
    for (let x = 10; x < 120; x++) for (let y = 60; y < 63; y++) cls[y * S + x] = 0; // дорога: 110×3
    for (const [bx, by] of [[20, 20], [32, 20], [44, 20]]) for (let x = bx; x < bx + 8; x++) for (let y = by; y < by + 10; y++) cls[y * S + x] = 0; // «буквы»
    for (let x = 80; x < 120; x++) for (let y = 90; y < 125; y++) cls[y * S + x] = 0; // заливка 40×35
    // сеть дорог: решётка тонких линий через весь тайл — длина веток много больше размера, но заливки нет
    for (let x = 0; x < S; x++) for (const y of [5, 45]) cls[y * S + x] = 0;
    for (let y = 0; y < 50; y++) for (const x of [5, 70, 100, 125]) cls[y * S + x] = 0;
    dropBlobs(cls, S, 0, 24, 6);
    expect(at(64, 45)).toBe(0);
    expect(at(70, 15)).toBe(0);
    expect(at(60, 61)).toBe(0);
    expect(at(24, 24)).toBe(-1);
    expect(at(100, 100)).toBe(-1);
  });
});

describe('образцы цвета', () => {
  it('бледная серо-голубая вода — по оттенку: бумага карты водой не считается', async () => {
    const { legendFromSamples, pixelClass } = await import('../src/overlay');
    const lg = legendFromSamples({ water: [[160, 180, 190], [150, 165, 185]] }, 0.6);
    expect(pixelClass(lg, ['water'], 158, 178, 190)).toBe(0);
    expect(pixelClass(lg, ['water'], 236, 222, 196)).toBe(-1); // бумага
    expect(pixelClass(lg, ['water'], 205, 200, 185)).toBe(-1); // серая бумага, штриховка
  });
});
