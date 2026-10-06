import { describe, it, expect } from 'vitest';
import {
  metersPerPixel, scaleDenominator, zoomForScale, scaleBar, formatScale, nearestStandardScale,
  tileOf, tileBBox, tileRange, tileCount, tileUrl, validBBox,
  fitGeoref, pixelToLngLat, lngLatToPixel, georefFromCorners, georefBBox, pointInRing, type LngLat,
} from '@def-ops/core';

describe('масштаб', () => {
  it('метры на пиксель и численный масштаб', () => {
    expect(metersPerPixel(0, 0, 256)).toBeCloseTo(156543.03, 1);
    const z = zoomForScale(52.5, 25000);
    expect(scaleDenominator(52.5, z)).toBeCloseTo(25000, 3);
    expect(formatScale(24987)).toBe('1:25 000');
    expect(nearestStandardScale(31000)).toBe(25000);
  });
  it('линейка — круглая длина не длиннее заданной', () => {
    const s = scaleBar(52.5, 12, 120);
    expect([1, 2, 5].some((k) => s.meters / Math.pow(10, Math.floor(Math.log10(s.meters))) === k)).toBe(true);
    expect(s.px).toBeLessThanOrEqual(120);
    expect(s.px).toBeGreaterThan(40);
    expect(s.ticks[0]).toBe(0);
    expect(s.ticks[s.ticks.length - 1]).toBeCloseTo(s.px);
  });
});

describe('тайлы', () => {
  it('тайл точки и его границы', () => {
    const [x, y] = tileOf([13.4, 52.52], 12);
    expect([x, y]).toEqual([2200, 1343]);
    const b = tileBBox(x, y, 12);
    expect(b[0]).toBeLessThan(13.4); expect(b[2]).toBeGreaterThan(13.4);
    expect(b[1]).toBeLessThan(52.52); expect(b[3]).toBeGreaterThan(52.52);
  });
  it('диапазон и количество', () => {
    const berlin: [number, number, number, number] = [13.2, 52.4, 13.6, 52.6];
    expect(validBBox(berlin)).toBe(true);
    expect(validBBox([13.6, 52.4, 13.2, 52.6])).toBe(false);
    expect(tileRange(berlin, 10).count).toBeGreaterThan(0);
    expect(tileCount(berlin, 10, 12)).toBe(tileRange(berlin, 10).count + tileRange(berlin, 11).count + tileRange(berlin, 12).count);
  });
  it('шаблон адреса', () => {
    expect(tileUrl('https://{s}.t/{z}/{x}/{y}.png', 3, 1, 2)).toBe('https://a.t/3/1/2.png');
    expect(tileUrl('https://t/{z}/{x}/{-y}.png', 3, 1, 2)).toBe('https://t/3/1/5.png');
    expect(tileUrl('q={quadkey}', 3, 3, 5)).toBe('q=213');
  });
});

describe('привязка растра по опорным точкам', () => {
  // «скан» 1000×800 px, север вверх, повёрнут на 5°
  const truth = (px: number, py: number): LngLat => {
    const a = (5 * Math.PI) / 180, X = px * Math.cos(a) - py * Math.sin(a), Y = px * Math.sin(a) + py * Math.cos(a);
    return [13.3 + X * 0.0002, 52.55 - Y * 0.00012];
  };
  const pts = [[0, 0], [1000, 0], [1000, 800], [0, 800], [500, 400]].map(([px, py]) => ({ px, py, lngLat: truth(px, py) }));

  it('аффинная по 3 точкам: прямое и обратное преобразование', () => {
    const g = fitGeoref(pts.slice(0, 3), 'affine');
    const ll = pixelToLngLat(g, 250, 600);
    const t = truth(250, 600);
    expect(ll[0]).toBeCloseTo(t[0], 3); expect(ll[1]).toBeCloseTo(t[1], 3);
    const [px, py] = lngLatToPixel(g, ll);
    expect(px).toBeCloseTo(250, 3); expect(py).toBeCloseTo(600, 3);
  });
  it('уравнивание по 5 точкам: невязки малы; грубая ошибка видна', () => {
    const g = fitGeoref(pts, 'projective');
    expect(g.rmsMeters).toBeLessThan(25); // нелинейность Меркатора на 10 км
    const bad = pts.map((p, i) => (i === 4 ? { ...p, lngLat: [p.lngLat[0] + 0.01, p.lngLat[1]] as LngLat } : p));
    const gb = fitGeoref(bad, 'affine');
    expect(Math.max(...gb.residuals)).toBeGreaterThan(300);
    expect(gb.residuals.indexOf(Math.max(...gb.residuals))).toBe(4);
  });
  it('вырожденные точки и нехватка точек — ошибка', () => {
    expect(() => fitGeoref(pts.slice(0, 2), 'affine')).toThrow(/не меньше 3/);
    expect(() => fitGeoref([{ px: 0, py: 0, lngLat: [13, 52] }, { px: 1, py: 1, lngLat: [13.1, 52.1] }, { px: 2, py: 2, lngLat: [13.2, 52.2] }], 'affine')).toThrow(/вырождены/);
  });
  it('по углам и охват; точка в многоугольнике', () => {
    const corners: [LngLat, LngLat, LngLat, LngLat] = [[13.3, 52.6], [13.5, 52.6], [13.5, 52.5], [13.3, 52.5]];
    const g = georefFromCorners(2000, 1000, corners);
    const c = pixelToLngLat(g, 1000, 500);
    expect(c[0]).toBeCloseTo(13.4, 6);
    const b = georefBBox(g, 2000, 1000);
    expect(b[0]).toBeCloseTo(13.3, 6); expect(b[3]).toBeCloseTo(52.6, 6);
    expect(pointInRing([13.4, 52.55], corners)).toBe(true);
    expect(pointInRing([13.6, 52.55], corners)).toBe(false);
  });
});
