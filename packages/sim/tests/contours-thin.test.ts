import { describe, expect, it } from 'vitest';
import { thinMask } from '../src/overlay';
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
});
