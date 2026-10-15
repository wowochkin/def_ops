import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { OverlayAccumulator, TERRAIN_CLASSES, WetlandLearner, colorBin, decodeMask, encodeGrid, inWetland, modernMarsh, osmNetworkQuery, osmToRivers, osmToRoads, osmToWetlands, overlayGrid, tileXY, tilesFor, type OsmJson, type TheatreData } from '../src';

const box: [number, number, number, number] = [13.6, 52.3, 14.4, 52.7];
const ll = (lon: number, lat: number) => ({ lon, lat });
const square = (x0: number, y0: number, x1: number, y1: number) => [ll(x0, y0), ll(x1, y0), ll(x1, y1), ll(x0, y1), ll(x0, y0)];

describe('болота OpenStreetMap: пути и мультиполигоны', () => {
  const json: OsmJson = { elements: [
    { type: 'way', id: 1, tags: { natural: 'wetland', wetland: 'marsh' }, geometry: square(13.6, 52.4, 13.62, 52.42) },
    { type: 'way', id: 2, tags: { natural: 'wetland' }, geometry: [ll(13.9, 52.5), ll(13.95, 52.5), ll(13.95, 52.55)] }, // не замкнут
    { type: 'relation', id: 10, tags: { type: 'multipolygon', natural: 'wetland' }, members: [
      { type: 'way', ref: 101, role: 'outer', geometry: [ll(13.7, 52.4), ll(13.76, 52.4), ll(13.76, 52.46)] },
      { type: 'way', ref: 102, role: 'outer', geometry: [ll(13.7, 52.4), ll(13.7, 52.46), ll(13.76, 52.46)] }, // обратный ход
      { type: 'way', ref: 103, role: 'inner', geometry: square(13.72, 52.42, 13.74, 52.44) },
      { type: 'node', ref: 5, role: '' },
    ] },
    { type: 'relation', id: 11, tags: { type: 'multipolygon', natural: 'wetland' }, members: [{ type: 'way', ref: 201, role: 'outer' }] }, // без геометрии
    { type: 'relation', id: 12, tags: { type: 'multipolygon', natural: 'wetland' }, members: [
      { type: 'way', ref: 301, role: 'outer', geometry: [ll(14.0, 52.6), ll(14.1, 52.6), ll(14.1, 52.65)] },
      { type: 'way', ref: 302, role: 'outer', geometry: [ll(14.0, 52.61), ll(14.0, 52.65)] }, // не замыкается
    ] },
    { type: 'relation', id: 13, tags: { type: 'multipolygon', natural: 'wetland' }, members: [
      { type: 'way', ref: 401, role: 'outer', geometry: square(14.2, 52.6, 14.22, 52.62) },
      { type: 'way', ref: 402, role: 'outer', geometry: square(14.3, 52.6, 14.32, 52.62) },
    ] },
    { type: 'way', id: 3, tags: { highway: 'primary' }, geometry: [ll(14.0, 52.6), ll(14.1, 52.6)] },
  ] };

  it('кольца склеиваются, плохие пропускаются без исключения', () => {
    const ws = osmToWetlands(json, box);
    expect(ws.length).toBe(4);
    const w1 = ws.find((w) => w.outer.some((p) => p[0] === 13.6))!;
    const w10 = ws.find((w) => w.outer.some((p) => p[0] === 13.76))!;
    expect(w10.outer.length).toBe(5);
    expect(w10.outer[0]).toEqual(w10.outer[4]);
    expect(w10.holes.length).toBe(1);
    expect(inWetland([13.73, 52.43], w10)).toBe(false);
    expect(inWetland([13.705, 52.45], w10)).toBe(true);
    expect(inWetland([13.61, 52.41], w1)).toBe(true);
    expect(w1.holes).toEqual([]);
  });
  it('рамка: кольцо вне рамки пропускается', () => {
    expect(osmToWetlands(json, [10, 50, 11, 51])).toEqual([]);
    expect(osmToWetlands({}, box)).toEqual([]);
  });
  it('дороги и реки отношения пропускают; запрос берёт болота', () => {
    expect(osmToRoads(json, box).length).toBe(1);
    expect(osmToRivers(json, box)).toEqual([]);
    const q = osmNetworkQuery(box);
    expect(q).toContain('way["natural"="wetland"]');
    expect(q).toContain('relation["natural"="wetland"]');
    expect(q).toContain('"waterway"~"^(river|canal)$"');
  });
});

// синтетический театр: растр 80×40 клеток по 0,01°, карта уровня 12
const Z = 12;
const cols = 80, rows = 40, d = 0.01;
const M = TERRAIN_CLASSES.indexOf('marsh');
const P = (p: LngLat): [number, number] => [tileXY.lon2x(p[0], Z) * 256, tileXY.lat2y(p[1], Z) * 256];
/** Прямоугольник клеток c0…c1 × r0…r1 в пикселях уровня Z. */
const cellRect = (c0: number, r0: number, c1: number, r1: number) => {
  const [x0, y0] = P([box[0] + c0 * d, box[3] - r0 * d]), [x1, y1] = P([box[0] + (c1 + 1) * d, box[3] - (r1 + 1) * d]);
  return [x0, y0, x1, y1];
};
const inR = (x: number, y: number, r: number[]) => x >= r[0] && x < r[2] && y >= r[1] && y < r[3];
// штриховка: чёрточки 6×1 px, строки через 5 px, соседние строки сдвинуты на полшага
const hatch = (x: number, y: number) => y % 5 === 0 && (x + ((y / 5) % 2) * 5) % 10 < 6;
const BLUE = [40, 90, 170];
function makeTheatre(marshCells: [number, number, number, number][]): TheatreData {
  const k = new Uint8Array(cols * rows).fill(TERRAIN_CLASSES.indexOf('open'));
  for (const [c0, r0, c1, r1] of marshCells) for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) k[r * cols + c] = M;
  return { id: 't', name: 't', bbox: box, cellKm: 1, roads: [], rivers: [], terrainGrid: { bbox: box, cols, rows, rle: encodeGrid(k) } } as unknown as TheatreData;
}
function painter(hatched: number[][], filled: number[][]) {
  const tiles = new Map<string, Uint8ClampedArray>();
  const make = (tx: number, ty: number) => {
    const img = new Uint8ClampedArray(256 * 256 * 4);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const gx = tx * 256 + px, gy = ty * 256 + py, cx = gx + 0.5, cy = gy + 0.5;
      let c = [242, 234, 210];
      if ((Math.floor(cx / 40) + Math.floor(cy / 40)) % 5 === 0) c = [150, 190, 120]; // лес
      if (cx % 17 < 2 && cy % 23 < 3) c = [30, 30, 30]; // буквы
      if (filled.some((r) => inR(cx, cy, r))) c = BLUE; // вода карты — заливка
      if (hatch(gx, gy) && hatched.some((r) => inR(cx, cy, r))) c = BLUE; // болото карты — штриховка
      img.set([...c, 255], (py * 256 + px) * 4);
    }
    return img;
  };
  return (x: number, y: number) => tiles.get(`${x},${y}`) ?? tiles.set(`${x},${y}`, make(x, y)).get(`${x},${y}`)!;
}

describe('болота исторической карты по современным болотам', () => {
  // растр: болото 10–17 × 5–10 (на карте заштриховано) и 50–56 × 25–30 (на карте нет); OSM: 60–66 × 5–9 (заштриховано);
  // только на карте: штриховка 30–36 × 28–33; заливка того же цвета 20–25 × 15–19 — вода карты
  const T = makeTheatre([[10, 5, 17, 10], [50, 25, 56, 30]]);
  const osm = [{ outer: [[14.2, 52.6], [14.27, 52.6], [14.27, 52.65], [14.2, 52.65], [14.2, 52.6]] as LngLat[], holes: [] }];
  const get = painter([cellRect(10, 5, 17, 10), cellRect(60, 5, 66, 9), cellRect(30, 28, 36, 33)], [cellRect(20, 15, 25, 19)]);
  const grid = overlayGrid(T, box);
  const W = new WetlandLearner(T, osm, grid, Z);
  for (const t of W.tileList()) W.addTile(get(t.x, t.y), 256, t.x, t.y);
  const acc = new OverlayAccumulator(W.legend(), grid);
  for (const t of tilesFor(grid.bbox, Z)) acc.addTile(get(t.x, t.y), 256, t.x, t.y, Z);
  const ov = W.mergeMarsh(acc.result({ source: 'синтетика', zoom: Z }));
  const N = cols * rows, mask = (k: string) => decodeMask(ov.masks[k], N), at = (m: Uint8Array, c: number, r: number) => m[r * cols + c];

  it('современные болота: растр ∪ полигоны OSM', () => {
    const m = modernMarsh(T, osm, grid);
    expect(at(m.marsh, 13, 7)).toBe(1);
    expect(at(m.marsh, 63, 7)).toBe(1);
    expect(at(m.marsh, 67, 7)).toBe(0);
    expect(m.osmCells).toBe(7 * 5);
  });
  it('цвет штриховки узнаётся; бумага, лес и буквы — нет', () => {
    const bins = W.colors().map((c) => c.bin);
    expect(bins).toContain(colorBin(40, 90, 170));
    for (const c of [[242, 234, 210], [150, 190, 120], [30, 30, 30]]) expect(bins).not.toContain(colorBin(c[0], c[1], c[2]));
    expect(W.inside).toBeGreaterThanOrEqual(20);
    expect(W.outside).toBeGreaterThanOrEqual(20);
    expect(W.legend().hatch).toEqual(['marsh']);
  });
  it('сверка: на карте и сейчас, только на карте, только сейчас; заливка — не болото', () => {
    expect(ov.marsh!.areas).toEqual({ total: 3, present: 2, gone: 1 });
    expect(ov.marsh!.source).toBe('network');
    expect(at(mask('marsh-gone'), 53, 27)).toBe(1);
    expect(at(mask('marsh-new'), 33, 30)).toBe(1);
    expect(at(mask('marsh-present'), 13, 7)).toBe(1);
    expect(at(mask('marsh-present'), 63, 7)).toBe(1);
    expect(at(mask('marsh'), 22, 17)).toBe(0);
    expect(at(mask('marsh'), 33, 30)).toBe(1);
    expect(ov.marsh!.osm).toBe(35);
    expect(ov.marsh!.cells.present).toBeGreaterThan(0);
    expect(ov.marsh!.cells.gone).toBeGreaterThan(0);
  });
});

describe('болот нет или мало — цвет не узнан', () => {
  it('без болот и полигонов: тайлов нет, легенда без болота', () => {
    const T = makeTheatre([]);
    const W = new WetlandLearner(T, [], overlayGrid(T, box), Z);
    expect(W.tileList()).toEqual([]);
    expect(W.colors()).toEqual([]);
    expect(W.legend().pixels.marsh).toBeUndefined();
    expect(W.legend().hatch).toBeUndefined();
  });
  it('одна клетка болота (≈ 9 окон) — мало', () => {
    const T = makeTheatre([[40, 20, 40, 20]]);
    const get = painter([cellRect(40, 20, 40, 20)], []);
    const W = new WetlandLearner(T, [], overlayGrid(T, box), Z);
    expect(W.tileList().length).toBeGreaterThan(0);
    for (const t of W.tileList()) W.addTile(get(t.x, t.y), 256, t.x, t.y);
    expect(W.inside).toBeLessThan(20);
    expect(W.colors()).toEqual([]);
    expect(W.legend().pixels.marsh).toBeUndefined();
  });
});
