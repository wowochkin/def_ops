// Разбор хода на карте и зоны влияния сторон: бои за ход с местом (из журнала расчёта) и поле влияния сторон
// (свои — все соединения, противник — только обнаруженный разведкой; территория — по свою сторону фронта).
import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import type { LngLat } from '@def-ops/core';
import { influenceZones, intelReport, onMap, playTurn, sideZones, snapshotZones, startGame, turnBattles, zoneAt } from '../src';

const ctx = loadContext('berlin-1945-tasks');
const T = ctx.theatre;
/** Точка в d км на восток от p (на плоскости театра). */
const east = (p: LngLat, d: number): LngLat => { const q = T.proj.toXY(p); return T.proj.toLL([q[0] + d, q[1]]); };
const A: LngLat = [14.2, 52.5];

describe('бои за ход с местом', () => {
  it('каждый бой хода — место, свои и противник по названиям, исход словами, наши потери; только бои этого хода', () => {
    const g0 = startGame(ctx, 1, '1945-04-17T05:00', 'su');
    const g = playTurn(ctx, g0, []);
    const all = g.state.journal.slice(g.prev!.journal.length).filter((j) => j.kind === 'combat');
    const b = turnBattles(ctx, g.state, 'su', g.prev!);
    expect(all.length).toBeGreaterThan(0);
    expect(b).toHaveLength(all.length);
    const [w, s, e, n] = T.data.bbox;
    for (const x of b) {
      expect(x.at[0]).toBeGreaterThanOrEqual(w); expect(x.at[0]).toBeLessThanOrEqual(e);
      expect(x.at[1]).toBeGreaterThanOrEqual(s); expect(x.at[1]).toBeLessThanOrEqual(n);
      expect(x.own.length).toBeGreaterThan(0);
      expect(x.enemy.length).toBeGreaterThan(0);
      expect(x.own.every((u) => g.state.formations.find((f) => f.id === u.id)?.side === 'su')).toBe(true);
      expect(x.enemy.every((u) => g.state.formations.find((f) => f.id === u.id)?.side === 'de')).toBe(true);
      expect(['прорыв', 'продвижение', 'оборона удержана', 'атака отбита']).toContain(x.outcomeText);
      expect(x.ownLossPct).toBeGreaterThanOrEqual(0);
      expect(x.place).toMatch(/\S/);
      expect(x.time >= g.prev!.time && x.time < g.state.time).toBe(true);
    }
    // наступление противника — свои обороняются
    expect(b.filter((x) => x.role === 'defend').length + b.filter((x) => x.role === 'attack').length).toBe(b.length);
  }, 120000);
});

describe('зоны влияния сторон', () => {
  const B = east(A, 40);
  it('вокруг своих — свои (плюс), вокруг обнаруженного противника — его (минус); между ними — спорно, без цвета', () => {
    const z = influenceZones(T, { own: [{ at: A, w: 1 }], enemy: [{ at: B, w: 1 }] });
    expect(zoneAt(z, A)).toBeGreaterThan(0.5);
    expect(zoneAt(z, B)).toBeLessThan(-0.5);
    expect(Math.abs(zoneAt(z, east(A, 20)))).toBeLessThan(0.15);
  });
  it('мягкое затухание: дальше от войск — бледнее, далеко — без цвета', () => {
    const z = influenceZones(T, { own: [{ at: A, w: 1 }], enemy: [] });
    const v = [0, 10, 20, 35].map((d) => zoneAt(z, east(A, -d)));
    for (let i = 1; i < v.length; i++) expect(v[i]).toBeLessThan(v[i - 1]);
    expect(v[3]).toBeGreaterThan(0);
    expect(zoneAt(z, east(A, -90))).toBe(0);
  });
  it('противник не обнаружен — его зоны нет (туман войны)', () => {
    const z = influenceZones(T, { own: [{ at: A, w: 1 }], enemy: [] });
    expect(z.v.some((x) => x < 0)).toBe(false);
  });
  it('место боя — спорно: без цвета, хотя рядом свои', () => {
    const quiet = influenceZones(T, { own: [{ at: A, w: 1 }], enemy: [] });
    const fight = influenceZones(T, { own: [{ at: A, w: 1 }], enemy: [], contested: [east(A, 3)] });
    expect(zoneAt(quiet, east(A, 3))).toBeGreaterThan(0.4);
    expect(Math.abs(zoneAt(fight, east(A, 3)))).toBeLessThan(0.1);
  });
  it('по свою сторону фронта (территория) — бледный цвет и без войск рядом; за фронтом без обнаруженного противника — без цвета', () => {
    // территория: запад театра — свои (0), восток — противник (1); войск нет
    const mid = T.proj.toXY(A)[0];
    const owner = new Int8Array(T.cols * T.rows);
    for (let r = 0; r < T.rows; r++) for (let c = 0; c < T.cols; c++) owner[r * T.cols + c] = T.cellCenter(c, r)[0] < mid ? 0 : 1;
    const z = influenceZones(T, { own: [], enemy: [], territory: { owner, own: 0, enemy: 1 } });
    expect(zoneAt(z, east(A, -15))).toBeGreaterThan(0.1);
    expect(zoneAt(z, east(A, 15))).toBe(0);
    // у самой линии фронта — узкий шов без цвета
    expect(Math.abs(zoneAt(z, east(A, -1)))).toBeLessThan(0.15);
    // в глубину своей земли — бледнее
    expect(zoneAt(z, east(A, -60))).toBeLessThan(zoneAt(z, east(A, -15)));
    // земля противника в поле зрения своей разведки — его цвет и без обнаруженных войск; дальше — без цвета
    const recon = influenceZones(T, { own: [{ at: east(A, -10), w: 1 }], enemy: [], recon: 30, territory: { owner, own: 0, enemy: 1 } });
    expect(zoneAt(recon, east(A, 12))).toBeLessThan(-0.3);
    expect(zoneAt(recon, east(A, 45))).toBe(0);
    // противник обнаружен за фронтом — его сторона окрашена
    const seen = influenceZones(T, { own: [], enemy: [{ at: east(A, 15), w: 1 }], territory: { owner, own: 0, enemy: 1 } });
    expect(zoneAt(seen, east(A, 15))).toBeLessThan(-0.3);
  });
  it('сетка — весь театр; строки равномерны по меркатору (картинка ложится на карту без искажения); значения — в пределах −100..100', () => {
    const z = influenceZones(T, { own: [{ at: A, w: 1 }], enemy: [] });
    expect(z.bbox).toEqual(T.data.bbox);
    expect(z.v).toHaveLength(z.cols * z.rows);
    expect(z.cols).toBeGreaterThan(20);
    expect(z.v.every((x) => Number.isInteger(x) && x >= -100 && x <= 100)).toBe(true);
  });
});

describe('зоны стороны по состоянию игры', () => {
  it('свои — все соединения на карте, противник — только обнаруженный; «снять туман» — все; бои хода — спорные места', () => {
    const g0 = startGame(ctx, 1, '1945-04-17T05:00', 'su');
    const g = playTurn(ctx, g0, []);
    const fog = sideZones(ctx, g.state, 'su');
    const all = sideZones(ctx, g.state, 'su', { reveal: true });
    expect(fog.v.some((x) => x > 0)).toBe(true);
    expect(fog.v.some((x) => x < 0)).toBe(true);
    // далёкий противник (не обнаружен) окрашен только без тумана
    const seen = new Set(intelReport(ctx, g.state, 'su').map((x) => x.id));
    const far = g.state.formations.find((f) => f.side === 'de' && onMap(f, g.state.time) && !seen.has(f.id)
      && g.state.formations.every((o) => o.side !== 'de' || o.id === f.id || !onMap(o, g.state.time) || !seen.has(o.id) || Math.hypot(o.position[0] - f.position[0], o.position[1] - f.position[1]) > 0.8))!;
    expect(far).toBeTruthy();
    expect(zoneAt(fog, far.position)).toBeGreaterThanOrEqual(0);
    expect(zoneAt(all, far.position)).toBeLessThan(0);
    // место боя хода — без цвета
    const b = turnBattles(ctx, g.state, 'su', g.prev!)[0];
    expect(Math.abs(zoneAt(sideZones(ctx, g.state, 'su', { contested: [b.at] }), b.at))).toBeLessThan(0.1);
  }, 120000);

  it('зоны по снимку переигровки: свои и противник без тумана войны', () => {
    const g = startGame(ctx, 1, '1945-04-17T05:00', 'su');
    const live = g.state.formations.filter((f) => onMap(f, g.state.time));
    const own = live.find((f) => f.side === 'su')!, foe = live.find((f) => f.side === 'de')!;
    const sn = { time: ctx.scenario.start, turn: 0, units: [
      { id: own.id, at: own.position, personnel: 8000, tanks: 0, posture: 'attack', destroyed: false },
      { id: foe.id, at: foe.position, personnel: 8000, tanks: 0, posture: 'defend', destroyed: false },
    ] };
    const z = snapshotZones(ctx, sn, 'su');
    expect(zoneAt(z, own.position)).toBeGreaterThan(0);
    expect(zoneAt(z, foe.position)).toBeLessThan(0); // противник виден без разведки
  });
});
