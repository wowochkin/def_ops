import { describe, expect, it } from 'vitest';
import type { LngLat } from '@def-ops/core';
import { NetworkLearner, OverlayAccumulator, applyOverlay, osmRoadsQuery, osmToRoads, colorBin, cutAbsent, decodeMask, overlayGrid, tilesFor, tileXY, type TheatreData } from '../src';

// синтетическая «историческая карта» уровня 12: бумага, лес пятнами, надписи чёрным, дороги оранжевым
const Z = 12;
const bbox: [number, number, number, number] = [13.6, 52.3, 14.4, 52.7];
const P = (p: LngLat): [number, number] => [tileXY.lon2x(p[0], Z) * 256, tileXY.lat2y(p[1], Z) * 256];
const A: LngLat[] = [[13.62, 52.5], [14.38, 52.5]]; // есть и в театре, и на карте (на карте сдвинута на 3 пикселя)
const B: LngLat[] = [[14.0, 52.32], [14.0, 52.48]]; // только в театре — послевоенная
const C: LngLat[] = [[13.65, 52.65], [14.35, 52.62]]; // только на карте — дорога того времени
const D: LngLat[] = [[13.7, 52.35], [13.9, 52.42], [13.75, 52.58]]; // ещё одна дорога и там и там: учит цвет
const segs = (line: LngLat[], dy = 0) => line.slice(1).map((b, i) => { const a = P(line[i]), c = P(b); return [a[0], a[1] + dy, c[0], c[1] + dy]; });
const mapRoads = [...segs(A, 3), ...segs(C), ...segs(D, -2)];
const dist = (x: number, y: number, [ax, ay, bx, by]: number[]) => {
  const dx = bx - ax, dy = by - ay, u = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - ax - dx * u, y - ay - dy * u);
};
function tile(tx: number, ty: number): Uint8ClampedArray {
  const img = new Uint8ClampedArray(256 * 256 * 4);
  for (let py = 0; py < 256; py++) for (let px = 0; px < 256; px++) {
    const gx = tx * 256 + px + 0.5, gy = ty * 256 + py + 0.5, o = (py * 256 + px) * 4;
    let c = [242, 234, 210];
    if ((Math.floor(gx / 40) + Math.floor(gy / 40)) % 5 === 0) c = [150, 190, 120]; // лес
    if (gx % 17 < 2 && gy % 23 < 3) c = [30, 30, 30]; // буквы
    if (mapRoads.some((s) => dist(gx, gy, s) < 1.6)) c = [235, 130, 40];
    img.set([...c, 255], o);
  }
  return img;
}

describe('дороги исторической карты по современной сети', () => {
  const T = { id: 't', name: 't', bbox, cellKm: 0.5, roads: [
    { kind: 'road', line: A, name: 'A' }, { kind: 'road', line: B, name: 'B' }, { kind: 'road', line: D, name: 'D' }, { kind: 'rail', line: [[13.6, 52.4], [14.4, 52.4]] },
  ] } as unknown as TheatreData;
  const tiles = new Map<string, Uint8ClampedArray>();
  const get = (x: number, y: number) => tiles.get(`${x},${y}`) ?? tiles.set(`${x},${y}`, tile(x, y)).get(`${x},${y}`)!;
  const L = new NetworkLearner(T, bbox, Z);
  for (const t of L.tileList()) L.addTile(get(t.x, t.y), 256, t.x, t.y);
  const { state, result } = L.check();

  it('цвет дороги узнаётся сам: оранжевый — да, бумага, лес и надписи — нет', () => {
    const bins = result.colors.road.map((c) => c.bin);
    expect(bins).toContain(colorBin(235, 130, 40));
    expect(bins).not.toContain(colorBin(242, 234, 210));
    expect(bins).not.toContain(colorBin(150, 190, 120));
    expect(bins).not.toContain(colorBin(30, 30, 30));
  });
  it('дорога, которая есть на карте (со сдвигом привязки), подтверждается; послевоенная — нет', () => {
    const kmB = 0.16 * 110.57;
    expect(result.km.absent).toBeGreaterThan(kmB * 0.8);
    expect(result.km.absent).toBeLessThan(kmB * 1.3);
    expect(result.absent.every((a) => a.line === 1)).toBe(true);
    expect(result.absentNamed[0].name).toBe('B');
    expect(result.km.present).toBeGreaterThan(result.km.checked * 0.6);
  });
  it('второй проход: дорога карты вдали от сети — новая; дороги сети в новые не попадают', () => {
    const grid = overlayGrid(T, bbox);
    const acc = new OverlayAccumulator(L.legend(), grid);
    for (const t of tilesFor(grid.bbox, Z)) acc.addTile(get(t.x, t.y), 256, t.x, t.y, Z);
    const ov = L.merge(acc.result({ source: 'синтетика', zoom: Z }), state, result);
    const N = ov.cols * ov.rows, [w, , , n] = ov.bbox, dl = (ov.bbox[2] - w) / ov.cols, da = (n - ov.bbox[1]) / ov.rows;
    const road = decodeMask(ov.masks.road, N);
    const cell = (p: LngLat) => Math.floor((n - p[1]) / da) * ov.cols + Math.floor((p[0] - w) / dl);
    const near = (p: LngLat) => { const c = cell(p); return [-1, 0, 1].some((dr) => [-1, 0, 1].some((dc) => road[c + dr * ov.cols + dc])); };
    // вдоль C — новая дорога почти везде
    const onC = Array.from({ length: 20 }, (_, i) => near([C[0][0] + ((C[1][0] - C[0][0]) * (i + 0.5)) / 20, C[0][1] + ((C[1][1] - C[0][1]) * (i + 0.5)) / 20] as LngLat));
    expect(onC.filter(Boolean).length).toBeGreaterThanOrEqual(16);
    // вдоль A — не новая (она уже в театре)
    const onA = Array.from({ length: 20 }, (_, i) => road[cell([A[0][0] + ((A[1][0] - A[0][0]) * (i + 0.5)) / 20, 52.5])]);
    expect(onA.filter(Boolean).length).toBeLessThanOrEqual(2);
    expect(ov.stats['net-absent']).toBeGreaterThan(0);
    // применение: отрезок B убирается, A и D остаются линиями, новая дорога — в растр
    const { theatre, changes } = applyOverlay(T, ov, { road: 'road', dropAbsent: true });
    expect(theatre.roads.some((r) => r.name === 'B')).toBe(false);
    expect(theatre.roads.filter((r) => r.name === 'A' || r.name === 'D').length).toBe(2);
    expect(changes['км дорог театра убрано (нет на карте)']).toBeGreaterThan(10);
    expect(theatre.roadGrid).toBeTruthy();
  });
  it('вырезка отрезка из середины линии оставляет два куска', () => {
    const line: LngLat[] = [[13, 52], [14, 52]];
    const r = cutAbsent([{ kind: 'road', line }], [{ line: 0, from: 20, to: 30 }]);
    expect(r.roads.length).toBe(2);
    expect(r.km).toBeCloseTo(10, 0);
    expect(r.roads[0].line[r.roads[0].line.length - 1][0]).toBeLessThan(r.roads[1].line[0][0]);
  });
});

describe('дороги OpenStreetMap для охвата карты', () => {
  const box: [number, number, number, number] = [13.6, 52.3, 14.4, 52.7];
  const json: Parameters<typeof osmToRoads>[0] = { elements: [
    { type: 'way', tags: { highway: 'primary', ref: 'B 1' }, geometry: [{ lon: 13.5, lat: 52.5 }, { lon: 13.7, lat: 52.5 }, { lon: 13.9, lat: 52.5 }, { lon: 14.5, lat: 52.5 }] },
    { type: 'way', tags: { highway: 'tertiary', name: 'Dorfstraße' }, geometry: [{ lon: 14.0, lat: 52.32 }, { lon: 14.0, lat: 52.4 }, { lon: 14.0, lat: 52.48 }] },
    { type: 'way', tags: { highway: 'residential' }, geometry: [{ lon: 14.0, lat: 52.6 }, { lon: 14.1, lat: 52.6 }] },
  ] };
  it('разбор Overpass: классы, обрезка рамкой, упрощение, названия', () => {
    const r = osmToRoads(json, box);
    expect(r.map((x) => [x.kind, x.name])).toEqual([['highway', 'B 1'], ['road', 'Dorfstraße']]);
    expect(r[0].line).toEqual([[13.7, 52.5], [13.9, 52.5]]); // вне рамки — отрезано
    expect(r[1].line.length).toBe(2); // прямая — без средней точки
    expect(osmRoadsQuery(box)).toContain('(52.3,13.6,52.7,14.4)');
  });
  it('сохранение: дороги театра в охвате заменяются подтверждёнными кусками OSM', () => {
    const osm = osmToRoads(json, box);
    const T = { id: 't', name: 't', bbox: box, cellKm: 1, roads: [
      { kind: 'road', line: [[13.8, 52.45], [13.9, 52.45]], name: 'старая в охвате' },
      { kind: 'road', line: [[15.0, 52.0], [15.1, 52.0]], name: 'вне охвата' },
      { kind: 'rail', line: [[13.8, 52.4], [13.9, 52.4]] },
    ] } as unknown as TheatreData;
    const ov = { legend: 'network', name: 'n', source: 's', zoom: 12, bbox: box, cols: 8, rows: 4, covered: '321', masks: {}, stats: {},
      network: { colors: { road: [], highway: [] }, points: 0, covered: 0, km: { checked: 0, present: 0, absent: 0, unclear: 0 }, absent: [{ line: 1, from: 0, to: 100 }], absentNamed: [], roads: osm } };
    const { theatre } = applyOverlay(T, ov, { dropAbsent: true });
    expect(theatre.roads.map((r) => r.name ?? r.kind).sort()).toEqual(['B 1', 'rail', 'вне охвата']);
  });
});
