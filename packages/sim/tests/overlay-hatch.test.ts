import { describe, expect, it } from 'vitest';
import { HATCH, OverlayAccumulator, combineLegends, decodeMask, hatchMask, hatchPx, hatchWindow, isHatch, legendFromSamples, tileXY, type OverlayLegend } from '../src';

// синтетика: класс 0 — чернила, −1 — бумага, −2 — прозрачно
const S = 48;
const grid = (size: number, inkAt: (x: number, y: number) => boolean) => {
  const cls = new Int8Array(size * size).fill(-1);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (inkAt(x, y)) cls[y * size + x] = 0;
  return cls;
};
// штриховка: чёрточки 6×1 px, строки через 5 px, соседние строки сдвинуты на полшага
const hatch = (x: number, y: number) => y % 5 === 0 && (x + ((y / 5) % 2) * 5) % 10 < 6;
// полые буквы 7×9 с шагом 10 в строках 8–16
const letters = (x: number, y: number, y0 = 8) => {
  const gx = x % 10, gy = y - y0;
  return gy >= 0 && gy <= 8 && gx <= 6 && (gy === 0 || gy === 8 || gx === 0 || gx === 6);
};

describe('признаки окна штриховки', () => {
  it('штриховка 6×1 с шагом 5 — болото', () => {
    const s = hatchWindow(grid(S, hatch), S, 0, 0, 24, 0);
    expect(s.ink).toBeCloseTo(0.128, 3);
    expect(s.hRun).toBeCloseTo(4.933, 2);
    expect(s.vRun).toBe(1);
    expect(s.rows).toBe(5);
    expect(s.px).toBe(576);
    expect(s.w).toBe(24);
    expect(isHatch(s)).toBe(true);
  });
  it('заливка того же цвета — не болото', () => {
    const s = hatchWindow(grid(S, () => true), S, 0, 0, 24, 0);
    expect(s.ink).toBe(1);
    expect(isHatch(s)).toBe(false);
  });
  it('надпись тем же цветом — не болото', () => {
    const s = hatchWindow(grid(S, (x, y) => letters(x, y)), S, 0, 0, 24, 0);
    expect(s.hRun).toBeCloseTo(1.73, 2);
    expect(s.vRun).toBeCloseTo(2.29, 2);
    expect(isHatch(s)).toBe(false);
  });
  it('длинная горизонтальная линия (дорога) — не болото', () => {
    const s = hatchWindow(grid(S, (_, y) => y === 12), S, 0, 0, 24, 0);
    expect(s.ink).toBeCloseTo(0.042, 3);
    expect(s.hRun).toBe(24);
    expect(s.rows).toBe(1);
    expect(isHatch(s)).toBe(false);
  });
  it('вертикальная штриховка — не болото', () => {
    const s = hatchWindow(grid(S, (x, y) => hatch(y, x)), S, 0, 0, 24, 0);
    expect(s.hRun).toBe(1);
    expect(s.vRun).toBeCloseTo(4.933, 2);
    expect(isHatch(s)).toBe(false);
  });
  it('пороги — параметры: при minInk = 0,2 разреженная штриховка не проходит', () => {
    const s = hatchWindow(grid(S, (x, y) => hatch(x, y)), S, 0, 0, 24, 0);
    expect(isHatch(s, { minInk: 0.2 })).toBe(false);
    expect(HATCH.rowsShare).toBeCloseTo(1 / 6, 9);
  });
  it('сторона окна ≈ 120 м, зажата в 12…48 px', () => {
    expect(hatchPx(52.5, 12)).toBe(12);
    expect(hatchPx(52.5, 14)).toBe(21);
    expect(hatchPx(52.5, 17)).toBe(48);
  });
});

describe('край карты и край тайла', () => {
  it('окно целиком прозрачно — без NaN, не болото', () => {
    const cls = new Int8Array(S * S).fill(-2);
    const s = hatchWindow(cls, S, 0, 0, 24, 0);
    expect(s).toMatchObject({ ink: 0, px: 0, hRun: 0, vRun: 0, rows: 0 });
    for (const v of Object.values(s)) expect(Number.isNaN(v)).toBe(false);
    expect(isHatch(s)).toBe(false);
  });
  it('тайл 256 сплошь штриховкой, w = 24 (не кратно) — каждый пиксель в окне-болоте', () => {
    const m = hatchMask(grid(256, hatch), 256, 24, 0);
    expect(m.reduce((a, x) => a + x, 0)).toBe(65536);
  });
  it('левая половина тайла прозрачна — болото только там, где карта есть', () => {
    const cls = grid(256, hatch);
    for (let y = 0; y < 256; y++) for (let x = 0; x < 128; x++) cls[y * 256 + x] = -2;
    const m = hatchMask(cls, 256, 24, 0);
    let left = 0, right = 0;
    for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if (m[y * 256 + x]) { if (x < 128) left++; else right++; }
    expect(left).toBe(0);
    expect(right).toBe(128 * 256);
  });
});

describe('накопитель: классы по штриховке', () => {
  const Z = 14;
  const tx = Math.floor(tileXY.lon2x(13.6, Z)), ty = Math.floor(tileXY.lat2y(52.5, Z));
  const g = { bbox: [tileXY.x2lon(tx, Z), tileXY.y2lat(ty + 1, Z), tileXY.x2lon(tx + 1, Z), tileXY.y2lat(ty, Z)] as [number, number, number, number], cols: 2, rows: 2 };
  const INK = [40, 90, 170], PAPER = [242, 234, 210];
  // четверти: штриховка | заливка / надписи | горизонтальные линии через 40 px
  const img = new Uint8ClampedArray(256 * 256 * 4);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const top = y < 128, left = x < 128;
    const ink = top ? (left ? hatch(x, y) : true) : left ? letters(x, y % 20, 5) : y % 40 === 0;
    img.set([...(ink ? INK : PAPER), 255], (y * 256 + x) * 4);
  }
  const run = (legend: OverlayLegend, preview?: Uint8ClampedArray) => {
    const acc = new OverlayAccumulator(legend, g);
    acc.addTile(img, 256, tx, ty, Z, preview);
    return acc.result({ source: 'синтетика', zoom: Z });
  };
  it('штриховка — болото; заливка, надписи и линии — нет', () => {
    const legend = legendFromSamples({ marsh: [[40, 90, 170]] }, 1, {}, ['marsh']);
    expect(legend.hatch).toEqual(['marsh']);
    const preview = new Uint8ClampedArray(256 * 256 * 4);
    const ov = run(legend, preview);
    expect([...decodeMask(ov.masks.marsh, 4)]).toEqual([1, 0, 0, 0]);
    // предпросмотр: окно-болото целиком (и бумага в нём) — цветом болота; заливка не отмечена
    const at = (x: number, y: number) => [...preview.slice((y * 256 + x) * 4, (y * 256 + x) * 4 + 3)];
    expect(at(1, 1)).toEqual([120, 180, 170]);
    expect(at(200, 50)).toEqual([0, 0, 0]);
  });
  it('без hatch — прежнее поведение: заливка — болото, штриховка — нет', () => {
    const ov = run(legendFromSamples({ marsh: [[40, 90, 170]] }));
    expect([...decodeMask(ov.masks.marsh, 4)]).toEqual([0, 1, 0, 0]);
  });
  it('болото того же цвета, что вода: штриховка — болото, заливка — вода', () => {
    const ov = run(legendFromSamples({ water: [[40, 90, 170]], marsh: [[40, 90, 170]] }, 1, {}, ['marsh']));
    expect([...decodeMask(ov.masks.marsh, 4)]).toEqual([1, 0, 0, 0]);
    expect([...decodeMask(ov.masks.water, 4)]).toEqual([0, 1, 0, 0]);
  });
  it('hatch в легенду — только классы с образцами', () => {
    expect(legendFromSamples({ marsh: [] }, 1, {}, ['marsh']).hatch ?? []).toEqual([]);
  });
});

describe('combineLegends', () => {
  const net = legendFromSamples({ road: [[235, 130, 40]], water: [[60, 120, 220]] });
  const marsh = legendFromSamples({ marsh: [[40, 90, 170]] }, 1, {}, ['marsh']);
  it('сеть + болота', () => {
    const L = combineLegends(net, marsh);
    expect(Object.keys(L.pixels)).toEqual(['road', 'water', 'marsh']);
    expect(L.hatch).toEqual(['marsh']);
    expect(L.cells.map((c) => c.cls)).toEqual(['road', 'water', 'marsh']);
    expect(L.id).toBe(net.id);
    expect(L.name).toBe(net.name);
  });
  it('повторный класс — у первой легенды', () => {
    const other = legendFromSamples({ water: [[0, 0, 255]] }, 1, { water: 0.5 });
    const L = combineLegends(net, other);
    expect(L.pixels.water).toBe(net.pixels.water);
    expect(L.cells.filter((c) => c.cls === 'water')).toEqual([net.cells.find((c) => c.cls === 'water')]);
  });
  it('без болот — hatch пуст, marsh нет', () => {
    const L = combineLegends(net);
    expect(L.hatch ?? []).toEqual([]);
    expect(L.pixels.marsh).toBeUndefined();
  });
});
