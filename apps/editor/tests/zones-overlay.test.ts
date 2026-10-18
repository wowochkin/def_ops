// Зоны влияния сторон на карте «Командования»: картинка из сетки (свои — красноватые, противник — голубоватые, цвета
// знаков сторон; прозрачно), смена зон за ход — плавно по времени карты.
import { describe, expect, it } from 'vitest';
import type { ZoneGrid } from '@def-ops/sim';
import { ZONE_ALPHA, ZONE_ENEMY, ZONE_OWN, zoneOverlays, zoneRgba } from '../src/zones-overlay';

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
    expect(ZONE_ALPHA).toBeGreaterThanOrEqual(0.12);
    expect(ZONE_ALPHA).toBeLessThanOrEqual(0.18);
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
