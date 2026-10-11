import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { runScenario } from '../src/history';
import { dist } from '../src/geo';

describe('выполнив задачу, корпус действует дальше в полосе своей армии (rules.followParentKm)', () => {
  const ctx = loadContext('vistula-oder-1945');
  const P = ctx.theatre.proj;
  // 11 тк: единственный приказ — на Радом (с 69 А); дальше задач нет
  const at = (rules: typeof ctx.rules, time: string) => runScenario({ ...ctx, rules }, 1, 10).snapshots.find((s) => s.time >= time)!.units.find((u) => u.id === 'su_11tk_vo')!.at;
  const radom = ctx.theatre.area('Radom')!.center;

  it('без правила корпус остаётся у цели своего приказа', () => {
    const a = at({ ...ctx.rules, followParentKm: 0 }, '1945-01-21T05:00');
    expect(dist(P.toXY(a), P.toXY(radom))).toBeLessThan(25);
  });

  it('с правилом корпус идёт за армией к её цели и уходит от Радома на запад', () => {
    const a = at({ ...ctx.rules, followParentKm: 6 }, '1945-01-21T05:00');
    expect(a[0]).toBeLessThan(radom[0] - 0.5);
  });
}, 120000);
