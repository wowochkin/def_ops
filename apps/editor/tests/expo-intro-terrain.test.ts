import { describe, expect, it } from 'vitest';
import { introTerrain } from '../src/expo/intro-terrain';

const grid = { bbox: [12, 50, 14, 52] as [number, number, number, number], cols: 2, rows: 2, base: 5, stepM: 10, rle: '1,2,3,4' };

describe('рельеф интро из сетки модели', () => {
  it('сохраняет север и реальные высоты ячеек; между ними интерполирует', () => {
    const terrain = introTerrain(grid, grid.bbox);
    expect(terrain.heightAt([12.5, 51.5])).toBe(15);
    expect(terrain.heightAt([13.5, 50.5])).toBe(45);
    expect(terrain.heightAt([13, 51])).toBe(30);
    expect(terrain.point([13, 52])[2]).toBeLessThan(terrain.point([13, 50])[2]);
    expect(terrain.point([14, 51])[0]).toBeGreaterThan(terrain.point([12, 51])[0]);
  });
  it('не превращает равнину в горы: 100 метров дают 0,4 километра визуальной высоты', () => {
    const terrain = introTerrain({ ...grid, base: 0, stepM: 100, rle: '1*4' }, grid.bbox);
    expect(terrain.point([13, 51])[1]).toBeCloseTo(0.4);
  });
  it('ограничивает сетку 256×256 вершинами, сохраняя края театра', () => {
    const terrain = introTerrain({ ...grid, cols: 600, rows: 400, rle: '2*240000' }, grid.bbox);
    expect(terrain.cols).toBeLessThanOrEqual(256);
    expect(terrain.rows).toBeLessThanOrEqual(256);
    expect(terrain.positions.length).toBe(terrain.cols * terrain.rows * 3);
    expect(Array.from(terrain.positions).every(Number.isFinite)).toBe(true);
    expect(terrain.positions[0]).toBeCloseTo(terrain.point([12, 52])[0]);
    expect(terrain.positions.at(-1)).toBeCloseTo(terrain.point([14, 50])[2]);
  });
  it('не подставляет выдуманный рельеф при отсутствующей или испорченной сетке', () => {
    expect(() => introTerrain(undefined, grid.bbox)).toThrow();
    expect(() => introTerrain({ ...grid, rle: '1' }, grid.bbox)).toThrow();
  });
});
