import { describe, expect, it } from 'vitest';
import { HATCH, OverlayAccumulator, combineLegends, decodeMask, hatchMask, hatchPx, hatchScale, hatchWindow, isHatch, legendFromSamples, tileXY, tilesFor, type OverlayLegend } from '../src';

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
    expect(HATCH).toMatchObject({ minStrokes: 2, strokesShare: 1 / 8, maxThick: 2, maxRunShare: 0.75 });
  });
  it('толстая горизонтальная линия 4 px при w = 21 — не болото', () => {
    const s = hatchWindow(grid(S, (_, y) => y >= 8 && y < 12), S, 0, 0, 21, 0);
    expect(s.strokes).toBe(1);
    expect(isHatch(s)).toBe(false);
  });
  it('линия 2–4 px и двойная дорога (y = 4 и 7) при w = 12 — не болото', () => {
    for (const t of [2, 3, 4]) expect(isHatch(hatchWindow(grid(S, (_, y) => y >= 4 && y < 4 + t), S, 0, 0, 12, 0))).toBe(false);
    const road = hatchWindow(grid(S, (_, y) => y === 4 || y === 7), S, 0, 0, 12, 0);
    expect(road.strokes).toBe(2);
    expect(isHatch(road)).toBe(false);
  });
  it('штриховка 6×1 с шагом 5 — болото при w = 12, 21, 24, 48 (и в каждом окне маски)', () => {
    for (const w of [12, 21, 24, 48]) {
      expect(isHatch(hatchWindow(grid(S, hatch), S, 0, 0, w, 0))).toBe(true);
      const m = hatchMask(grid(256, hatch), 256, w, 0);
      expect(m.reduce((a, x) => a + x, 0)).toBe(65536);
    }
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
  const Z = 12; // чёрточки 6×1 с шагом 5 px на уровне 12 (≈ 23 м/px) — шаг ≈ 115 м, как на карте 1:100 000
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
  it('класс-штриховка раньше заливки того же цвета не забирает её: заливка — вода, штриховка — болото', () => {
    const ov = run(legendFromSamples({ marsh: [[40, 90, 170]], water: [[40, 90, 170]] }, 1, {}, ['marsh']));
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

describe('штриховка карты 1:100 000 на уровнях 12–16 (маска чернил ≈ 24 м на пиксель)', () => {
  // чёрточки 150 м, промежуток 100 м (соседние строки сдвинуты на 125 м), шаг строк 100 м, толщина 12 м; широта 52,5°
  const lat0 = 52.5, INK = [40, 90, 170], PAPER = [242, 234, 210];
  const box: [number, number, number, number] = [14.0, 52.494, 14.03, 52.506];
  const g = { bbox: box, cols: 3, rows: 2 }; // клетки 0,01° × 0,006° ≈ 680 × 670 м
  const over = (a0: number, a1: number, b0: number, b1: number) => a0 < b1 && a1 > b0;
  const mppAt = (z: number) => (156543.03 * Math.cos((lat0 * Math.PI) / 180)) / 2 ** z;
  const river = 4 * mppAt(14); // река шириной 4 px на уровне 14 (≈ 23 м), через каждые 400 м
  const draw = (z: number, mode: 'hatch' | 'fill' | 'river', tx: number, ty: number) => {
    const mpp = mppAt(z), img = new Uint8ClampedArray(256 * 256 * 4);
    for (let py = 0; py < 256; py++) {
      const y0 = (ty * 256 + py) * mpp, y1 = y0 + mpp, k0 = Math.floor(y0 / 100);
      for (let px = 0; px < 256; px++) {
        const x0 = (tx * 256 + px) * mpp, x1 = x0 + mpp;
        let ink = mode === 'fill';
        if (mode === 'river') ink = over(y0, y1, Math.floor(y0 / 400) * 400 + 200, Math.floor(y0 / 400) * 400 + 200 + river);
        if (mode === 'hatch') for (const k of [k0 - 1, k0, k0 + 1]) {
          if (!over(y0, y1, k * 100, k * 100 + 12)) continue;
          const off = (k % 2) * 125, j0 = Math.floor((x0 - off) / 250);
          for (const j of [j0 - 1, j0, j0 + 1]) if (over(x0 - off, x1 - off, j * 250, j * 250 + 150)) ink = true;
        }
        img.set([...(ink ? INK : PAPER), 255], (py * 256 + px) * 4);
      }
    }
    return img;
  };
  const share = (z: number, mode: 'hatch' | 'fill' | 'river') => {
    const acc = new OverlayAccumulator(legendFromSamples({ marsh: [[40, 90, 170]] }, 1, {}, ['marsh']), g);
    for (const t of tilesFor(box, z)) acc.addTile(draw(z, mode, t.x, t.y), 256, t.x, t.y, z);
    const m = decodeMask(acc.result({ source: 'синтетика', zoom: z }).masks.marsh, 6);
    return m.reduce((a, x) => a + x, 0) / 6;
  };
  for (const z of [12, 13, 14, 15, 16]) it(`уровень ${z}: штриховка — болото (≥ 80 % клеток); заливка и река 4 px (ур. 14) — нет`, () => {
    expect(share(z, 'hatch')).toBeGreaterThanOrEqual(0.8);
    expect(share(z, 'fill')).toBe(0);
    expect(share(z, 'river')).toBe(0);
  });
  it('масштаб маски: f = max(1, round(24 / mpp)), окно 12–48 px на маске', () => {
    expect(hatchScale(52.5, 12)).toEqual({ f: 1, w: 12 });
    expect(hatchScale(52.5, 13)).toEqual({ f: 2, w: 12 });
    expect(hatchScale(52.5, 14)).toEqual({ f: 4, w: 12 });
    expect(hatchScale(52.5, 15)).toEqual({ f: 8, w: 12 });
    expect(hatchScale(52.5, 16)).toEqual({ f: 17, w: 12 });
  });
});
