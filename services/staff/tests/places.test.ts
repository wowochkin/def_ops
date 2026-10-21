import { describe, expect, it } from 'vitest';
import { loadContext } from '@def-ops/sim/data';
import { places } from '@def-ops/sim';
import { decisionToOrders, findArea, findOffset } from '../src/live/apply';
import type { Situation } from '../src/live';

describe('пункты в приказах штаба на модели', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const all = places(ctx.theatre).map((p) => ({ id: p.id, title: p.title, at: p.at }));
  const near = (...ids: string[]) => all.filter((a) => ids.includes(a.id));
  const sit = (areas: Situation['areas']): Situation => ({ messages: [], time: '1945-04-19T05:00', areas, allAreas: all, formations: [{ id: 'de_9a', name: '9-я армия' }],
    enemies: [{ id: 'su_x', name: 'Танковая дивизия «Мюнхеберг»' }] });

  it('точное название среди всех пунктов важнее похожего среди ближних', () => {
    expect(findArea('Альтфридланд', sit(near('Friedland')))?.id).toBe('Altfriedland');
    expect(findArea('Берлин, Александерплац', sit(near('Berlin')))?.id).toBe('B_Alexanderplatz');
    expect(findArea('у Лёкниц', sit(near('Leknica')))?.title).toMatch(/Loecknitz/);
    expect(findArea('Лекниц', sit(near('Loecknitz')))?.title).toMatch(/Leknica/);
    // при равной похожести — ближний
    expect(findArea('Зелов', sit(near('Seelow')))?.id).toBe('Seelow');
  });

  it('допроверка: опечатка и другое написание названия — однозначно ближайший пункт', () => {
    expect(findArea('Мюнхенберг', sit(near('Muencheberg')))?.id).toBe('Muencheberg');
    expect(findArea('город Кюстрн', sit([]))?.title).toMatch(/Кюстрин|Kuestrin|Küstrin/);
    expect(findArea('Хельсинки', sit([]))).toBeNull();
    const o = decisionToOrders({ orders: [{ formation: '9-я армия', task: 'defend', area: 'Зелоов', toArea: null, details: '', deadline: '' } as never] }, sit(near('Seelow')));
    expect(o.applied[0].order?.target).toBe('Seelow');
  });

  it('место словами из доклада — точка в стольких км по румбу от пункта', () => {
    const k = all.find((a) => a.id === 'Krajnik')!;
    const r = findOffset('8,2 км к ЮЗ от Крайник (Krajnik)', sit([]))!;
    expect(r.at[0]).toBeLessThan(k.at[0]);
    expect(r.at[1]).toBeLessThan(k.at[1]);
    const km = Math.hypot((r.at[0] - k.at[0]) * 111 * Math.cos((k.at[1] * Math.PI) / 180), (r.at[1] - k.at[1]) * 111);
    expect(km).toBeCloseTo(8.2, 1);
    expect(findOffset('Крайник', sit([]))).toBeNull();
    const d = decisionToOrders({ orders: [{ formation: '9-я армия', task: 'withdraw', area: '', toArea: '12 км к З от Зелов (Seelow)', deadline: '', details: '' }] }, sit([]));
    expect(Array.isArray(d.orders[0].target)).toBe(true);
  });

  it('полное название соединения противника — цель «против него», а не одноимённый пункт', () => {
    const d = decisionToOrders({ orders: [
      { formation: '9-я армия', task: 'counterattack', area: 'Танковая дивизия «Мюнхеберг»', toArea: null, deadline: '', details: '' },
    ] }, sit(near('Muencheberg')));
    expect(d.orders[0].target).toEqual({ formation: 'su_x' });
  });
});
