import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { createState, step, type SimContext } from '../src/step';
import type { ScenarioChange, SimState } from '../src/types';

/** Прогнать ходы, пока время состояния меньше until. */
const runUntil = (ctx: SimContext, until: string, seed = 1) => {
  let s = createState(ctx, seed);
  while (s.time < until) s = step(s, ctx);
  return s;
};
const withChanges = (ctx: SimContext, changes: ScenarioChange[]): SimContext => ({ ...ctx, scenario: { ...ctx.scenario, changes } });
const unit = (s: SimState, id: string) => s.formations.find((f) => f.id === id)!;

describe('изменения по датам: пополнения и переподчинение (Scenario.changes)', () => {
  const base = loadContext('berlin-1945');

  it('пополнение 18.04 прибавляется к текущей и начальной численности в начале хода', () => {
    const ctx = withChanges(base, [{ at: '1945-04-18T05:00', formation: 'su_8gva', kind: 'reinforce', personnel: 5000 }]);
    const before0 = runUntil(base, '1945-04-18T05:00'), before1 = runUntil(ctx, '1945-04-18T05:00');
    // до хода 18.04 прогоны совпадают
    expect(unit(before1, 'su_8gva').personnel).toBe(unit(before0, 'su_8gva').personnel);
    const after0 = step(before0, base), after1 = step(before1, ctx);
    const j = after1.journal.find((x) => x.kind === 'reinforced');
    expect(j && j.kind === 'reinforced' && [j.formation, j.personnel, j.time]).toEqual(['su_8gva', 5000, '1945-04-18T05:00']);
    expect(unit(after1, 'su_8gva').initial.personnel - unit(after0, 'su_8gva').initial.personnel).toBe(5000);
    // разница после хода — 5000 за вычетом потерь того же хода
    const diff = unit(after1, 'su_8gva').personnel - unit(after0, 'su_8gva').personnel;
    expect(diff).toBeGreaterThan(4000);
    expect(diff).toBeLessThanOrEqual(5500);
    expect(after1.changesDone).toEqual([0]);
    // исполняется один раз
    const next = step(after1, ctx);
    expect(next.journal.filter((x) => x.kind === 'reinforced')).toHaveLength(1);
  }, 120000);

  it('переподчинение 20.04: parent меняется; на несуществующий штаб — пропуск с причиной', () => {
    const ctx = withChanges(base, [
      { at: '1945-04-20T05:00', formation: 'su_8gva', kind: 'resubordinate', parent: 'su_1uf' },
      { at: '1945-04-20T05:00', formation: 'su_5ua', kind: 'resubordinate', parent: 'su_нет_такого' },
      { at: '1945-04-20T05:00', formation: 'su_1bf', kind: 'resubordinate', parent: 'su_8gva' },
    ]);
    const before = runUntil(ctx, '1945-04-20T05:00');
    expect(unit(before, 'su_8gva').parent).toBe('su_1bf');
    const after = step(before, ctx);
    expect(unit(after, 'su_8gva').parent).toBe('su_1uf');
    expect(unit(after, 'su_5ua').parent).toBe('su_1bf');
    const r = after.journal.find((x) => x.kind === 'resubordinated');
    expect(r && r.kind === 'resubordinated' && [r.formation, r.from, r.to]).toEqual(['su_8gva', 'su_1bf', 'su_1uf']);
    const skipped = after.journal.filter((x) => x.kind === 'change-skipped');
    expect(skipped.map((x) => x.kind === 'change-skipped' && x.formation)).toEqual(['su_5ua', 'su_1bf']);
    for (const x of skipped) expect(x.kind === 'change-skipped' && x.reason.length).toBeGreaterThan(5);
  }, 120000);

  it('переподчинение на собственного потомка не исполняется', () => {
    const ctx = withChanges(base, [{ at: '1945-04-16T05:00', formation: 'su_1bf', kind: 'resubordinate', parent: 'su_8gva' }]);
    const s = step(createState(ctx, 1), ctx);
    const j = s.journal.find((x) => x.kind === 'change-skipped');
    expect(j && j.kind === 'change-skipped' && j.reason).toMatch(/подчин/);
    expect(s.changesDone).toEqual([0]);
  }, 120000);

  it('пополнение резерва до ввода прибавляется при вводе', () => {
    // 28-я армия вводится 21.04; пополнение назначено на 17.04
    const ctx = withChanges(base, [{ at: '1945-04-17T05:00', formation: 'su_28a', kind: 'reinforce', personnel: 3000, tanks: 20 }]);
    const s0 = runUntil(base, '1945-04-20T05:00'), s1 = runUntil(ctx, '1945-04-20T05:00');
    expect(unit(s1, 'su_28a').personnel).toBe(unit(s0, 'su_28a').personnel);
    expect(s1.journal.some((x) => x.kind === 'reinforced')).toBe(false);
    expect(s1.changesDone ?? []).toEqual([]);
    const e0 = runUntil(base, '1945-04-22T05:00'), e1 = runUntil(ctx, '1945-04-22T05:00');
    const j = e1.journal.find((x) => x.kind === 'reinforced');
    expect(j && j.time).toBe('1945-04-21T05:00');
    expect(unit(e1, 'su_28a').initial.personnel - unit(e0, 'su_28a').initial.personnel).toBe(3000);
    expect(unit(e1, 'su_28a').initial.tanks - unit(e0, 'su_28a').initial.tanks).toBe(20);
  }, 120000);
});
