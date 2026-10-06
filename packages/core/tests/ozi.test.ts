import { describe, it, expect } from 'vitest';
import { parseOziMap, sk42ToWgs84, fitGeoref, pixelToLngLat } from '@def-ops/core';

const MAP = `OziExplorer Map Data File Version 2.2
Берлин 1945
C:\\maps\\berlin_1945.jpg
1 ,Map Code,
WGS 84,WGS 84,   0.0000,   0.0000,WGS 84
Reserved 1
Reserved 2
Magnetic Variation,,,E
Map Projection,Latitude/Longitude,PolyCal,No,AutoCalOnly,No,BSBUseWPX,No
Point01,xy,    0,    0,in, deg,  52, 36.0000,N,  13, 12.0000,E, grid,   ,           ,           ,N
Point02,xy, 4000,    0,in, deg,  52, 36.0000,N,  13, 36.0000,E, grid,   ,           ,           ,N
Point03,xy, 4000, 3000,in, deg,  52, 24.0000,N,  13, 36.0000,E, grid,   ,           ,           ,N
Point04,xy,    0, 3000,in, deg,  52, 24.0000,N,  13, 12.0000,E, grid,   ,           ,           ,N
Point05,xy,     ,     ,in, deg,    ,        ,N,    ,        ,E, grid,   ,           ,           ,N
Projection Setup,,,,,,,,,,
Map Feature = MF ; Map Comment = MC     These follow if they exist
Track File = TF      These follow if they exist
Moving Map Parameters = MM?    These follow if they exist
MM0,Yes
MMPNUM,4
MMPXY,1,0,0
MMPXY,2,4000,0
MMPXY,3,4000,3000
MMPXY,4,0,3000
MMPLL,1,  13.200000,  52.600000
MMPLL,2,  13.600000,  52.600000
MMPLL,3,  13.600000,  52.400000
MMPLL,4,  13.200000,  52.400000
IWH,Map Image Width/Height,4000,3000
`;

describe('OziExplorer .map', () => {
  it('опорные точки, файл изображения, размер', () => {
    const m = parseOziMap(MAP);
    expect(m.title).toBe('Берлин 1945');
    expect(m.imageFile).toBe('berlin_1945.jpg');
    expect(m.points).toHaveLength(4);
    expect(m.points[1]).toEqual({ px: 4000, py: 0, lngLat: [13.6, 52.6] });
    expect([m.width, m.height]).toEqual([4000, 3000]);
    expect(m.warnings).toEqual([]);
    const g = fitGeoref(m.points);
    const c = pixelToLngLat(g, 2000, 1500);
    expect(c[0]).toBeCloseTo(13.4, 3);
  });
  it('без точек в градусах — по углам MMPXY/MMPLL', () => {
    const m = parseOziMap(MAP.replace(/^Point0[1-4].*$/gm, 'Point09,xy,     ,     ,in, deg,    ,        ,N,    ,        ,E, grid,   ,           ,           ,N'));
    expect(m.points).toHaveLength(4);
    expect(m.points[2].lngLat).toEqual([13.6, 52.4]);
  });
  it('СК-42 пересчитывается в WGS 84 (сдвиг около 100–150 м)', () => {
    const w = sk42ToWgs84([13.4, 52.5]);
    const dLon = (w[0] - 13.4) * 111320 * Math.cos((52.5 * Math.PI) / 180), dLat = (w[1] - 52.5) * 110540;
    const shift = Math.hypot(dLon, dLat);
    expect(shift).toBeGreaterThan(60);
    expect(shift).toBeLessThan(200);
    const m = parseOziMap(MAP.replace('WGS 84,WGS 84', 'Pulkovo 1942 (1),WGS 84'));
    expect(m.points[0].lngLat[0]).not.toBe(13.2);
    expect(m.warnings).toEqual([]);
  });
  it('неизвестный датум — предупреждение; не .map — ошибка', () => {
    expect(parseOziMap(MAP.replace('WGS 84,WGS 84', 'Tokyo,WGS 84')).warnings[0]).toMatch(/не поддерживается/);
    expect(() => parseOziMap('hello')).toThrow(/OziExplorer/);
  });
});
