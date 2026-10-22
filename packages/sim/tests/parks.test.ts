import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { checkAction, playTurn, startGame } from '../src';
import { parksOf, PARKS_TOP } from '../src/staff';

describe('понтонные парки по ступеням: Ставка придаёт фронтам, фронт — армиям, армия — корпусам', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const g0 = startGame(ctx, 1, '1945-04-19T05:00', 'su');
  const t = g0.state.time;
  const pk0 = parksOf(ctx, g0.state, 'su');
  const fronts = pk0.children(PARKS_TOP).filter((id) => ctx.scenario.formations.find((f) => f.id === id)?.echelon === 'front');
  const front = 'su_1bf', army = 'su_8gva';

  it('по умолчанию — фронтам поровну, армиям ничего; у Ставки своих не остаётся', () => {
    expect(fronts.length).toBeGreaterThan(1);
    expect(fronts.reduce((m, f) => m + pk0.allot(f), 0)).toBe(pk0.total);
    expect(pk0.own(PARKS_TOP)).toBe(0);
    expect(pk0.allot(army)).toBe(0);
    expect(pk0.parent(army)).toBe(front);
  });

  it('армия без приданных парков переправу не наводит; фронт придал — наводит, сверх — нет', () => {
    const at: [number, number] = [14.28, 52.98];
    const no = checkAction(ctx, g0.state, { kind: 'bridge', side: 'su', at, issuedAt: t, by: army });
    expect(no.ok).toBe(false);
    expect(no.text).toContain('придаёт старший');
    const give = { kind: 'parks' as const, side: 'su', hq: army, n: 1, issuedAt: t };
    expect(checkAction(ctx, g0.state, give).ok).toBe(true);
    expect(checkAction(ctx, g0.state, { ...give, n: pk0.allot(front) + 1 }).ok).toBe(false);
    const g1 = playTurn(ctx, g0, [], [give]);
    const pk1 = parksOf(ctx, g1.state, 'su');
    expect(pk1.allot(army)).toBe(1);
    expect(pk1.own(front)).toBe(pk0.allot(front) - 1);
    const b = { kind: 'bridge' as const, side: 'su', at, issuedAt: g1.state.time, by: army };
    const ok = checkAction(ctx, g1.state, b);
    if (ok.ok) {
      // единственный парк армии занят наводкой — второй переправы той же армией нет
      expect(checkAction(ctx, g1.state, b, 1).text).toContain('заняты');
    } else expect(ok.text).not.toContain('придаёт старший');
  });

  it('придать больше, чем свободно у старшего, нельзя', () => {
    const other = fronts.find((f) => f !== front)!;
    expect(checkAction(ctx, g0.state, { kind: 'parks', side: 'su', hq: other, n: pk0.total + 1, issuedAt: t }).ok).toBe(false);
  });
});
