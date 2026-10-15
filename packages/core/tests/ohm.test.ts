import { describe, it, expect } from 'vitest';
import {
  OHM_OVERPASS, OHM_CELL_DEG, OHM_SEC_PER_CELL, OHM_MB_PER_SQDEG, OHM_MAX_CELLS,
  ohmDate, ohmTooLarge, ohmYear, ohmCells, ohmEstimate, ringClosed, stitchRings, type LngLat, type BBox,
} from '../src/index';

describe('ohmYear — десятичный год даты OHM', () => {
  it('год, год-месяц, полная дата, «~год»', () => {
    expect(ohmYear('1936')).toBe(1936);
    expect(ohmYear('1936-07')).toBeCloseTo(1936.4973, 4); // 1936 високосный: 182/366
    expect(ohmYear('1936-09-27')).toBeCloseTo(1936.7377, 4);
    expect(ohmYear('~1930')).toBe(1930);
  });
  it('не разобрать — null', () => {
    expect(ohmYear('')).toBeNull();
    expect(ohmYear(undefined)).toBeNull();
    expect(ohmYear('неизвестно')).toBeNull();
  });
  it('неполный конец — по 28-е число последнего месяца', () => {
    expect(ohmYear('1945', true)).toBeCloseTo(1945.989, 3); // 28.12: 361/365
    expect(ohmYear('1945-05-08', true)).toBeCloseTo(1945.3479, 4);
  });
  it('ISO с временем и поясом — по дате', () => {
    expect(ohmYear('1945-04-16T05:00:00+03:00')).toBeCloseTo(1945.2877, 4); // 105/365
    expect(ohmYear('1945-04-16')).toBe(ohmYear('1945-04-16T05:00:00+03:00'));
  });
  it('ohmDate и адрес Overpass — прежние', () => {
    expect(ohmDate('1936-09', true)).toBe('1936-09-28');
    expect(OHM_OVERPASS).toBe('https://overpass-api.openhistoricalmap.org/api/interpreter');
  });
});

describe('ohmCells — участки 0,25°', () => {
  const theatre: BBox = [11.0, 50.9, 15.6, 54.45];
  const close = (a: BBox, b: BBox) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i], 6));
  it('театр — 19 × 15 участков, крайние обрезаны рамкой', () => {
    const cells = ohmCells(theatre);
    expect(OHM_CELL_DEG).toBe(0.25);
    expect(cells).toHaveLength(285);
    close(cells[0], [11, 50.9, 11.25, 51.15]);
    close(cells[18], [15.5, 50.9, 15.6, 51.15]);
    close(cells[284], [15.5, 54.4, 15.6, 54.45]);
    const area = cells.reduce((s, [w, so, e, n]) => s + (e - w) * (n - so), 0);
    expect(area).toBeCloseTo(4.6 * 3.55, 6);
  });
  it('без лишней строки из-за плавающей точки', () => {
    expect(ohmCells([13.25, 52.4, 13.75, 52.65])).toHaveLength(2);
  });
  it('рамка меньше участка — один участок, равный рамке', () => {
    expect(ohmCells([13, 52, 13.1, 52.1])).toEqual([[13, 52, 13.1, 52.1]]);
  });
});

describe('предел района', () => {
  it('не больше 400 участков; больше — сообщение с числом', () => {
    expect(OHM_MAX_CELLS).toBe(400);
    expect(ohmTooLarge(400)).toBeNull();
    expect(ohmTooLarge(401)).toBe('район слишком велик: 401 участок, не больше 400 — разделите на части');
    expect(ohmTooLarge(402)).toMatch(/: 402 участка,/);
    expect(ohmTooLarge(411)).toMatch(/: 411 участков,/);
    expect(ohmTooLarge(ohmCells([11.0, 50.9, 15.6, 54.45]).length)).toBeNull();
  });
});

describe('ohmEstimate', () => {
  it('участки, минуты, мегабайты — от констант', () => {
    expect(ohmEstimate([11.0, 50.9, 15.6, 54.45])).toEqual({
      cells: 285,
      minutes: Math.ceil((285 * OHM_SEC_PER_CELL) / 60),
      mb: Math.round(4.6 * 3.55 * OHM_MB_PER_SQDEG),
    });
  });
});

describe('stitchRings / ringClosed', () => {
  const isRing = (r: LngLat[]) => {
    expect(r[0]).toEqual(r[r.length - 1]);
  };
  it('две половины квадрата (вторая — обратным ходом) → одно кольцо из 5 точек', () => {
    const rings = stitchRings([[[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1], [1, 1]]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    isRing(rings[0]);
  });
  it('три куска вперемешку → одно кольцо', () => {
    const rings = stitchRings([[[1, 1], [0, 1]], [[0, 0], [1, 0], [1, 1]], [[0, 0], [0, 1]]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
    isRing(rings[0]);
  });
  it('уже замкнутое — как есть', () => {
    const r: LngLat[] = [[0, 0], [1, 0], [1, 1], [0, 0]];
    expect(stitchRings([r])).toEqual([r]);
  });
  it('незамыкающиеся куски — пусто; кусок из одной точки — пропуск', () => {
    expect(stitchRings([[[0, 0], [1, 0]], [[5, 5], [6, 6]]])).toEqual([]);
    const rings = stitchRings([[[9, 9]], [[0, 0], [1, 0], [1, 1]], [[1, 1], [0, 1], [0, 0]]]);
    expect(rings).toHaveLength(1);
    expect(rings[0]).toHaveLength(5);
  });
  it('ringClosed: ≥ 4 точек, первая = последней', () => {
    expect(ringClosed([[0, 0], [1, 0], [1, 1], [0, 0]])).toBe(true);
    expect(ringClosed([[0, 0], [1, 0], [0, 0]])).toBe(false);
    expect(ringClosed([[0, 0], [1, 0], [1, 1], [0, 1e-12]])).toBe(true);
  });
});
