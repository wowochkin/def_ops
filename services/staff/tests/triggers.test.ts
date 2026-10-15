import { describe, expect, it } from 'vitest';
import { loadContext } from '@def-ops/sim/data';
import { startGame, type GameState, type JournalEntry } from '@def-ops/sim';
import { situationTriggers, staffQueries } from '../src/live';

describe('триггеры обстановки для доктрины', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const fresh = (): GameState => {
    const g = startGame(ctx, 1, '1945-04-16T05:00');
    return { ...g, state: structuredClone(g.state) };
  };
  const de = (g: GameState) => g.state.formations.find((f) => f.side === 'de' && !f.destroyed && (!f.enterAt || f.enterAt <= g.state.time))!;
  const su = (g: GameState) => g.state.formations.find((f) => f.side === 'su' && !f.destroyed)!;
  const combat = (g: GameState, time: string): JournalEntry => ({
    kind: 'combat', time, attackers: [su(g).id], defenders: [de(g).id], at: de(g).position, ratio: 3.4, factors: [], noise: 1,
    advanceKm: 1, attackerLoss: 0.02, defenderLoss: 0.05, outcome: 'breakthrough',
  });
  const back = (t: string, h: number) => new Date(Date.parse(`${t}:00Z`) - h * 3600_000).toISOString().slice(0, 16);

  it('16.04 05:00: советская сторона наступает', () => {
    expect(situationTriggers(ctx, fresh(), 'su')).toContain('attack');
  });

  it('своё формирование отрезано — первым идёт окружение', () => {
    const g = fresh();
    de(g).cutOff = true;
    expect(situationTriggers(ctx, g, 'de')[0]).toBe('encircled');
  });

  it('бой за последний ход: свои обороняются, прорыв при 3,4 : 1 — вклинение и давление; бой старше хода не учитывается', () => {
    const g = fresh();
    const before = situationTriggers(ctx, g, 'de');
    g.state.journal.push(combat(g, back(g.state.time, 1)));
    const t = situationTriggers(ctx, g, 'de');
    expect(t).toContain('penetration');
    expect(t).toContain('pressure');
    expect(t.indexOf('penetration')).toBeLessThan(t.indexOf('pressure'));

    const old = fresh();
    old.state.journal = old.state.journal.filter((j) => j.kind !== 'combat');
    old.state.journal.push(combat(old, back(old.state.time, ctx.scenario.turnHours + 1)));
    const t2 = situationTriggers(ctx, old, 'de');
    expect(t2).not.toContain('penetration');
    expect(t2).not.toContain('pressure');
    expect(before).toEqual(situationTriggers(ctx, fresh(), 'de'));
  });

  it('продвижение от 3 км без прорыва — тоже вклинение; соотношение ниже 3 — без давления', () => {
    const g = fresh();
    g.state.journal = g.state.journal.filter((j) => j.kind !== 'combat');
    g.state.journal.push({ ...combat(g, back(g.state.time, 1)), outcome: 'advance', advanceKm: 3, ratio: 2.5 } as JournalEntry);
    const t = situationTriggers(ctx, g, 'de');
    expect(t).toContain('penetration');
    expect(t).not.toContain('pressure');
  });

  it('запросы штаба: по триггерам и последним — местность у ориентира', () => {
    expect(staffQueries(['penetration'], 'Берлин')).toEqual(['вклинение противника контратака резервы', 'оборона и местность у Берлин']);
    expect(staffQueries(['encircled', 'pressure', 'attack', 'reserves'], 'X')).toEqual([
      'окружение прорыв к своим', 'оборона при превосходстве противника отход', 'наступление эшелоны ввод подвижной группы темп', 'резервы ввод в бой', 'оборона и местность у X',
    ]);
  });
});
