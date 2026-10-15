import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { OverlayAccumulator, TERRAIN_CLASSES, TERRAIN_CODES, Theatre, WetlandLearner, applyOverlay, colorBin, decodeGrid, decodeMask, encodeGrid, inWetland, maskRle, mergeMarsh, modernMarsh, osmNetworkQuery, osmToRivers, osmToRoads, osmToWetlands, overlayGrid, tileXY, tilesFor, type OsmJson, type OverlayResult, type TheatreData } from '../src';
import { loadTheatre } from '../src/data';

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
  it('окна штриховки: внутри, снаружи и сколько окон внутри прошли проверку штриховки', () => {
    const win = ov.marsh!.windows;
    expect(win).toEqual({ inside: W.inside, outside: W.outside, hatched: W.insideHatch });
    expect(win.hatched).toBeGreaterThan(0);
    expect(win.hatched).toBeLessThan(win.inside); // болото 50–56 × 25–30 на карте не заштриховано
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

describe('правка 1: ответ Overpass, растеризация, цвет не узнан', () => {
  // ответ `out body geom`: у отношения — bounds и members с type, ref, role, geometry; член-узел — с lat/lon
  const real: OsmJson = { elements: [
    { type: 'relation', id: 5551, bounds: { minlat: 52.4, minlon: 13.8, maxlat: 52.46, maxlon: 13.88 }, members: [
      { type: 'way', ref: 9001, role: 'outer', geometry: [ll(13.8, 52.4), ll(13.88, 52.4), ll(13.88, 52.46)] },
      { type: 'way', ref: 9002, role: '', geometry: [ll(13.88, 52.46), ll(13.8, 52.46), ll(13.8, 52.4)] }, // старая схема: роль пустая — внешнее
      { type: 'way', ref: 9003, role: 'inner', geometry: square(13.82, 52.42, 13.86, 52.44) },
      { type: 'node', ref: 77, role: 'label', lat: 52.43, lon: 13.84 },
    ], tags: { type: 'multipolygon', natural: 'wetland', wetland: 'bog' } },
  ] };
  it('отношение из ответа `out body geom` → болото с дырой; пустая роль — внешнее кольцо', () => {
    const ws = osmToWetlands(real, box);
    expect(ws.length).toBe(1);
    expect(ws[0].outer.length).toBe(5);
    expect(ws[0].holes.length).toBe(1);
  });
  it('запрос: отношения выводятся с членами (out body geom), без ограничения размера, с тайм-аутом', () => {
    const q = osmNetworkQuery(box);
    expect(q).toMatch(/relation\["natural"="wetland"\]\([^)]*\);\s*out body geom;/);
    expect(q).not.toContain('maxsize'); // по умолчанию у Overpass предел больше
    expect(q).toContain('[timeout:180]');
    expect(q).toContain('way["natural"="wetland"]');
  });
  it('упрощение с допуском: кольцо мельче допуска (< 4 точек) — пропуск', () => {
    const tiny: OsmJson = { elements: [
      { type: 'way', id: 1, tags: { natural: 'wetland' }, geometry: [ll(13.7, 52.4), ll(13.7005, 52.4), ll(13.7005, 52.4005), ll(13.7, 52.4005), ll(13.7, 52.4)] },
      { type: 'way', id: 2, tags: { natural: 'wetland' }, geometry: square(13.8, 52.4, 13.82, 52.42) },
    ] };
    expect(osmToWetlands(tiny, box, 0.0025).length).toBe(1);
    expect(osmToWetlands(tiny, box).length).toBe(2);
  });
  it('растеризация совпадает с проверкой точки в полигоне (кольца, дыры, вогнутость)', () => {
    const concave: LngLat[] = [[13.9, 52.35], [14.05, 52.35], [14.05, 52.5], [13.98, 52.5], [13.98, 52.4], [13.95, 52.4], [13.95, 52.5], [13.9, 52.5], [13.9, 52.35]];
    const holed = { outer: [[14.1, 52.32], [14.3, 52.33], [14.28, 52.55], [14.12, 52.5], [14.1, 52.32]] as LngLat[], holes: [[[14.15, 52.38], [14.24, 52.38], [14.24, 52.46], [14.15, 52.46], [14.15, 52.38]] as LngLat[]] };
    const ws = [...osmToWetlands(real, box), { outer: concave, holes: [] }, holed, { outer: concave, holes: [] }]; // повтор — объединение, не чёт-нечет между болотами
    const grid = { bbox: box, cols: 80, rows: 40 };
    const m = modernMarsh({}, ws, grid);
    let n = 0;
    for (let r = 0; r < 40; r++) for (let c = 0; c < 80; c++) {
      const p: LngLat = [box[0] + (c + 0.5) * d, box[3] - (r + 0.5) * d];
      const want = ws.some((w) => inWetland(p, w)) ? 1 : 0;
      expect(m.marsh[r * 80 + c], `${c},${r}`).toBe(want);
      n += want;
    }
    expect(n).toBeGreaterThan(100);
    expect(m.osmCells).toBe(n);
  });
  it('цвет по сети не узнан: «нет на карте» не отмечается', () => {
    const T = makeTheatre([[10, 5, 17, 10]]);
    const N = cols * rows;
    const ov = { legend: 'network', name: 'n', source: 's', zoom: Z, bbox: box, cols, rows, covered: maskRle(new Uint8Array(N).fill(1)), masks: {}, stats: {} };
    const r = mergeMarsh(ov, T, [], { source: 'network', colors: [], windows: { inside: 5, outside: 100, hatched: 0 } });
    expect(r.marsh!.unknown).toBe(true);
    expect(r.marsh!.areas.gone).toBe(0);
    expect(r.marsh!.cells.gone).toBe(0);
    expect(r.masks['marsh-gone']).toBeUndefined();
    // по образцам — отмечается, как раньше
    const s = mergeMarsh(ov, T, [], { source: 'samples', colors: [], windows: { inside: 0, outside: 0, hatched: 0 } });
    expect(s.marsh!.areas.gone).toBe(1);
    expect(s.marsh!.unknown).toBeUndefined();
  });
});

describe('запись болот в местность театра', () => {
  const O = (code: string) => TERRAIN_CLASSES.indexOf(TERRAIN_CODES[code]);
  const codes = (s: string) => [...s].map(O);
  /** Театр-растр и поправка на той же сетке; маски — списки номеров клеток. */
  function setup(cs: number, rs: number, cells: string, ms: Record<string, number[]>) {
    const bb: [number, number, number, number] = [13, 52, 13 + cs * 0.01, 52 + rs * 0.01];
    const T = { id: 't', name: 't', bbox: bb, cellKm: 1, roads: [], rivers: [], terrainGrid: { bbox: bb, cols: cs, rows: rs, rle: encodeGrid(codes(cells)) } } as unknown as TheatreData;
    const m = (ix: number[]) => { const a = new Uint8Array(cs * rs); for (const i of ix) a[i] = 1; return maskRle(a); };
    const ov: OverlayResult = { legend: 'l', name: 'n', source: 's', zoom: 12, bbox: bb, cols: cs, rows: rs, covered: maskRle(new Uint8Array(cs * rs).fill(1)), masks: Object.fromEntries(Object.entries(ms).map(([k, v]) => [k, m(v)])), stats: {} };
    return { T, ov, bb };
  }
  const cls = (t: TheatreData) => [...decodeGrid(t.terrainGrid!)].map((v) => Object.entries(TERRAIN_CODES).find(([, c]) => c === TERRAIN_CLASSES[v])![0]).join('');
  const { T, ov } = setup(6, 3, 'ofuwmm' + 'oooomm' + 'ooofmm', { marsh: [0, 1, 2, 3], forest: [1], 'marsh-gone': [4, 5, 10, 11, 16, 17] });

  it('запись с приоритетом: вода и застройка не перезаписываются, лес — да; без флажка болота не снимаются', () => {
    const { theatre, changes } = applyOverlay(T, ov, { marsh: 'marsh', forest: 'forest' });
    expect(cls(theatre).slice(0, 6)).toBe('mmuwmm');
    expect(changes).toEqual({ 'open→marsh': 1, 'forest→marsh': 1 });
    expect(Object.keys(changes).some((k) => k.startsWith('marsh→'))).toBe(false);
  });
  it('флажок «убрать»: болота, которых нет на карте, — открытая или лес по соседям', () => {
    const { theatre, changes } = applyOverlay(T, ov, { marsh: 'marsh', forest: 'forest', marshGone: true });
    const s = cls(theatre);
    for (const r of [0, 1, 2]) for (const c of [4, 5]) expect('of').toContain(s[r * 6 + c]);
    expect(s[4]).toBe('o');
    expect(changes['marsh→open'] + (changes['marsh→forest'] ?? 0)).toBe(6);
  });
  it('сплошной массив болот: соседи — тоже болото → открытая; за рамкой не меняется', () => {
    const all = Array.from({ length: 81 }, (_, i) => i);
    const { T, ov, bb } = setup(9, 9, 'm'.repeat(81), { 'marsh-gone': all });
    const r1 = applyOverlay(T, ov, { marshGone: true });
    expect(cls(r1.theatre)).toBe('o'.repeat(81));
    expect(r1.changes).toEqual({ 'marsh→open': 81 });
    const r2 = applyOverlay(T, ov, { marshGone: true, clip: [bb[0] + 0.01, bb[1], bb[2], bb[3]] });
    const s = cls(r2.theatre);
    for (let r = 0; r < 9; r++) {
      expect(s[r * 9]).toBe('m');
      expect(s.slice(r * 9 + 1, r * 9 + 9)).toBe('o'.repeat(8));
    }
    expect(r2.changes).toEqual({ 'marsh→open': 72 });
    expect(applyOverlay(T, ov, {}).changes).toEqual({});
  });
});

describe('сквозной прогон: болота карты у Кюстрина → местность театра', () => {
  const data = loadTheatre('oder-berlin-1945');
  const area: [number, number, number, number] = [14.60, 52.50, 14.85, 52.62];
  const z = 13;
  const A: [number, number, number, number] = [14.655, 52.535, 14.805, 52.59]; // болота растра у Кюстрина
  const B: [number, number, number, number] = [14.60, 52.50, 14.64, 52.52]; // болот растра нет
  const C: [number, number, number, number] = [14.82, 52.50, 14.85, 52.52]; // заливка тем же цветом
  const osm = [{ outer: [[14.61, 52.60], [14.64, 52.60], [14.64, 52.615], [14.61, 52.615], [14.61, 52.60]] as LngLat[], holes: [] }];
  const inB = (lon: number, lat: number, b: number[]) => lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3];
  // штриховка карты 1:100 000 на уровне 13 (≈ 11,6 м/px): чёрточки 12×1 px (≈ 140 м), строки через 10 px (≈ 115 м)
  const hatch100k = (x: number, y: number) => y % 10 === 0 && (x + ((y / 10) % 2) * 10) % 20 < 12;
  const tiles = new Map<string, Uint8ClampedArray>();
  const get = (tx: number, ty: number) => {
    const key = `${tx},${ty}`;
    if (tiles.has(key)) return tiles.get(key)!;
    const img = new Uint8ClampedArray(256 * 256 * 4);
    for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
      const gx = tx * 256 + px, gy = ty * 256 + py;
      const lon = tileXY.x2lon((gx + 0.5) / 256, z), lat = tileXY.y2lat((gy + 0.5) / 256, z);
      let c = [242, 234, 210];
      if (inB(lon, lat, C)) c = BLUE;
      if (hatch100k(gx, gy) && (inB(lon, lat, A) || inB(lon, lat, B))) c = BLUE;
      img.set([...c, 255], (py * 256 + px) * 4);
    }
    tiles.set(key, img);
    return img;
  };
  const grid = overlayGrid(data, area);
  const W = new WetlandLearner(data, osm, grid, z);
  for (const t of W.tileList()) W.addTile(get(t.x, t.y), 256, t.x, t.y);
  const acc = new OverlayAccumulator(W.legend(), grid);
  for (const t of tilesFor(grid.bbox, z)) acc.addTile(get(t.x, t.y), 256, t.x, t.y, z);
  const ov = W.mergeMarsh(acc.result({ source: 'синтетика', zoom: z }));
  const N = grid.cols * grid.rows, mask = (k: string) => decodeMask(ov.masks[k], N);
  const [gw, , ge, gn] = grid.bbox, gs = grid.bbox[1];
  const cellsIn = (b: number[]) => {
    const out: number[] = [];
    for (let r = 0; r < grid.rows; r++) for (let c = 0; c < grid.cols; c++) {
      const lon = gw + ((c + 0.5) / grid.cols) * (ge - gw), lat = gn - ((r + 0.5) / grid.rows) * (gn - gs);
      if (inB(lon, lat, b)) out.push(r * grid.cols + c);
    }
    return out;
  };
  const modern = modernMarsh(data, [], grid).marsh;

  it('цвет узнан; на карте и сейчас, только на карте, только сейчас', () => {
    expect(W.colors().map((c) => c.bin)).toContain(colorBin(40, 90, 170));
    const inA = cellsIn(A).filter((i) => modern[i]);
    expect(inA.length).toBeGreaterThan(10);
    const present = mask('marsh-present');
    expect(inA.filter((i) => present[i]).length).toBeGreaterThanOrEqual(0.7 * inA.length);
    const fresh = mask('marsh-new');
    expect(cellsIn(B).filter((i) => fresh[i]).length).toBeGreaterThan(0);
    const gone = mask('marsh-gone'), poly = cellsIn([14.61, 52.60, 14.64, 52.615]);
    expect(poly.length).toBeGreaterThan(0);
    for (const i of poly) expect(gone[i]).toBe(1);
  });
  it('запись: болото поверх открытой, не поверх воды и застройки; «убрать» не трогает болото только из OSM', () => {
    const r1 = applyOverlay(data, ov, { marsh: 'marsh' });
    expect(r1.changes['open→marsh']).toBeGreaterThan(0);
    expect(r1.changes['water→marsh']).toBeUndefined();
    expect(r1.changes['urban→marsh']).toBeUndefined();
    expect(() => new Theatre(r1.theatre)).not.toThrow();
    const r2 = applyOverlay(data, ov, { marsh: 'marsh', marshGone: true });
    expect(Object.keys(r2.changes).filter((k) => k.startsWith('marsh→'))).toEqual([]);
    expect(() => new Theatre(r2.theatre)).not.toThrow();
  });
});
