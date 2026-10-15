import { describe, expect, it } from 'vitest';
import { encodeGrid, overlayGrid, TERRAIN_CLASSES, tilesFor, WetlandLearner, type MarshCheck, type TheatreData } from '@def-ops/sim';
import { marshHeader, marshToTerrainDefault, marshWindowsText, netMarshApply, networkTiles } from '../src/hist-marsh';

const check = (o: Partial<MarshCheck> = {}): MarshCheck => ({
  source: 'network', colors: [{ bin: 1, rgb: [40, 90, 170], road: 0.5, side: 0.02 }], windows: { inside: 814, outside: 7484, hatched: 600 },
  osm: 0, cells: { present: 15, added: 64, gone: 0 }, areas: { total: 2, present: 2, gone: 0 }, ...o,
});

describe('болота карты — в местность: согласие на запись (сеть)', () => {
  it('по умолчанию отмечено только при явной проверке болот', () => {
    expect(marshToTerrainDefault('marsh')).toBe(true);
    expect(marshToTerrainDefault('all')).toBe(true);
    expect(marshToTerrainDefault('roads')).toBe(false);
    expect(marshToTerrainDefault('water')).toBe(false);
  });
  it('болото пишется только при отмеченном флажке и при маске', () => {
    expect(netMarshApply(true, true)).toBe('marsh');
    expect(netMarshApply(true, false)).toBeUndefined();
    expect(netMarshApply(false, true)).toBeUndefined();
  });
});

describe('сводка болот: заголовок и окна', () => {
  it('«и OSM» — только когда болота OSM были', () => {
    expect(marshHeader(check())).toBe('цвет штриховки узнан по болотам театра');
    expect(marshHeader(check({ osm: 35 }))).toBe('цвет штриховки узнан по болотам театра и OSM');
    expect(marshHeader(check({ source: 'samples', colors: [] }))).toBe('цвет штриховки узнан по образцу');
    expect(marshHeader(check({ unknown: true, colors: [] }))).toBe('цвет штриховки не узнан');
  });
  it('строка окон говорит, что считает: в болотах (из них штриховкой) и вне их', () => {
    expect(marshWindowsText(check())).toBe('окон в современных болотах 814, из них со штриховкой 600; вне болот 7484');
  });
});

describe('тайлы прогона по сети: с тайлами у болот', () => {
  const box: [number, number, number, number] = [13.6, 52.3, 14.4, 52.7];
  const cols = 80, rows = 40, k = new Uint8Array(cols * rows).fill(TERRAIN_CLASSES.indexOf('open'));
  for (let r = 5; r <= 10; r++) for (let c = 10; c <= 17; c++) k[r * cols + c] = TERRAIN_CLASSES.indexOf('marsh');
  const T = { id: 't', name: 't', bbox: box, cellKm: 1, roads: [], rivers: [], terrainGrid: { bbox: box, cols, rows, rle: encodeGrid(k) } } as unknown as TheatreData;
  const grid = overlayGrid(T, box), z = 12;
  it('болота сверяются — к тайлам области добавляются тайлы у болот; не сверяются — нет', () => {
    const all = tilesFor(grid.bbox, z).length, wet = new WetlandLearner(T, [], grid, z).tileList().length;
    expect(wet).toBeGreaterThan(0);
    expect(networkTiles(T, [], grid, z, 'all')).toBe(all + wet);
    expect(networkTiles(T, [], grid, z, 'marsh')).toBe(all + wet);
    expect(networkTiles(T, [], grid, z, 'roads')).toBe(all);
    expect(networkTiles(T, [], grid, z, 'water')).toBe(all);
  });
});
