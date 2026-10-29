// Зоны влияния сторон на карте «Командования»: картинка из сетки (свои — красноватые, противник — голубоватые, цвета
// знаков сторон; прозрачно), смена зон за ход — плавно по времени карты.
import { describe, expect, it } from 'vitest';
import type { ZoneGrid } from '@def-ops/sim';
import { ZONE_ALPHA, ZONE_ALPHA_ENEMY, ZONE_ENEMY, ZONE_OWN, zoneOverlays, zoneRgba, zonesAt, zonesKey } from '../src/zones-overlay';

const grid = (v: number[]): ZoneGrid => ({ bbox: [14, 52, 15, 53], cols: v.length, rows: 1, v });

describe('картинка зон влияния', () => {
  it('свои — цветом своих знаков, противник — цветом его знаков; прозрачность по силе, не больше ZONE_ALPHA; спорное — прозрачно', () => {
    const px = zoneRgba(grid([100, 50, 0, -100]));
    expect([...px.slice(0, 3)]).toEqual(ZONE_OWN);
    expect(px[3]).toBe(Math.round(255 * ZONE_ALPHA));
    expect(px[7]).toBeGreaterThan(Math.round(255 * ZONE_ALPHA * 0.5)); // средние — заметнее
    expect(px[7]).toBeLessThan(px[3]);
    expect(px[11]).toBe(0);
    expect([...px.slice(12, 15)]).toEqual(ZONE_ENEMY);
    expect(px[15]).toBe(Math.round(255 * ZONE_ALPHA_ENEMY)); // голубой на пергаменте бледнее красного — противник заметнее
    expect(ZONE_ALPHA_ENEMY).toBeGreaterThanOrEqual(0.22);
    expect(ZONE_ALPHA_ENEMY).toBeLessThanOrEqual(0.25);
    expect(ZONE_ALPHA).toBeGreaterThanOrEqual(0.12);
    expect(ZONE_ALPHA).toBeLessThanOrEqual(0.18);
  });
});

describe('цвет зоны противника', () => {
  it('явно голубой: синий преобладает над красным и зелёным с запасом (не серо-голубой)', () => {
    const [r, g, b] = ZONE_ENEMY;
    expect(b).toBeGreaterThanOrEqual(200);
    expect(b - r).toBeGreaterThanOrEqual(120);
    expect(b - g).toBeGreaterThanOrEqual(70);
  });
});

describe('зоны на карте по времени', () => {
  const cur = grid([100]), prev = grid([-100]);
  const urls = { cur: 'data:cur', prev: 'data:prev' };
  const at = (time: string, on = true) => zoneOverlays({ cur, prev, urls, from: '1945-04-16T05:00', to: '1945-04-17T05:00', time, on });
  it('конец хода — зоны на конец хода; начало — на начало; посередине — переход', () => {
    expect(at('1945-04-17T05:00')).toEqual([expect.objectContaining({ id: 'zones', url: 'data:cur', opacity: 1, visible: true, corners: [[14, 53], [15, 53], [15, 52], [14, 52]] })]);
    expect(at('1945-04-16T05:00')).toEqual([expect.objectContaining({ id: 'zones-prev', url: 'data:prev', opacity: 1 })]);
    const mid = at('1945-04-16T17:00');
    expect(mid.map((o) => o.id)).toEqual(['zones-prev', 'zones']);
    expect(mid[0].opacity).toBeCloseTo(0.5, 1);
    expect(mid[1].opacity).toBeCloseTo(0.5, 1);
  });
  it('раньше начала хода (шкала времени назад) — зон нет: их считали только на этот ход; слой выключен — нет', () => {
    expect(at('1945-04-15T05:00')).toEqual([]);
    expect(at('1945-04-17T05:00', false)).toEqual([]);
  });
  it('первый ход (начала нет) — зоны на конец хода, пока время карты не раньше него', () => {
    expect(zoneOverlays({ cur, prev: null, urls: { cur: 'data:cur', prev: null }, from: '1945-04-16T05:00', to: '1945-04-17T05:00', time: '1945-04-17T05:00', on: true })).toHaveLength(1);
    expect(zoneOverlays({ cur, prev: null, urls: { cur: 'data:cur', prev: null }, from: '1945-04-16T05:00', to: '1945-04-17T05:00', time: '1945-04-16T06:00', on: true })).toEqual([]);
  });
});

describe('зоны переигровки по времени', () => {
  const g = (k: number): ZoneGrid => ({ bbox: [14, 52, 15, 53], cols: 1, rows: 1, v: [k] });
  const frames = [{ time: '1945-04-16T05:00', grid: g(1) }, { time: '1945-04-17T05:00', grid: g(2) }];
  it('между кадрами — переход от прежнего к следующему; после последнего — последний; кадров нет — ничего', () => {
    expect(zonesAt(frames, '1945-04-16T17:00')).toEqual({ prev: g(1), cur: g(2), from: '1945-04-16T05:00', to: '1945-04-17T05:00' });
    expect(zonesAt(frames, '1945-04-18T05:00')).toEqual({ prev: null, cur: g(2), from: '1945-04-17T05:00', to: '1945-04-17T05:00' });
    expect(zonesAt([], '1945-04-16T05:00').cur).toBeNull();
  });
});

describe('ключ наложений зон переигровки', () => {
  const g = (k: number): ZoneGrid => ({ bbox: [14, 52, 15, 53], cols: 1, rows: 1, v: [k] });
  const frames = ['1945-04-16T05:00', '1945-04-17T05:00', '1945-04-18T05:00'].map((time, k) => ({ time, grid: g(k + 1) }));
  const sides = { own: true, enemy: true };
  const at = (t: string) => {
    const z = zonesAt(frames, t);
    const url = (x: ZoneGrid | null) => (x ? `data:image/png;base64,${x.v[0]}` : null);
    const ov = zoneOverlays({ cur: z.cur, prev: z.prev, urls: { cur: url(z.cur), prev: url(z.prev) }, from: z.from, to: z.to, time: t, on: true });
    return { ov, key: zonesKey(z, sides, ov) };
  };
  it('шаг на сутки меняет картинку и ключ', () => {
    const a = at('1945-04-17T05:00'), b = at('1945-04-18T05:00');
    expect(a.ov[0].url).not.toBe(b.ov[0].url);
    expect(a.key).not.toBe(b.key);
    expect(zonesKey(zonesAt(frames, '1945-04-17T05:00'), { own: true, enemy: false }, a.ov)).not.toBe(a.key);
  });
});
