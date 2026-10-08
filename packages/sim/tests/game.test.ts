import { describe, expect, it } from 'vitest';
import { loadContext } from '../src/data';
import { dayEvents, describePlace, intelReport, playTurn, replayGame, runScenario, runToDocument, startGame, unitReports, type GameRecord, type Order } from '../src';

describe('игра: передача командования, доклады, туман войны', () => {
  const ctx = loadContext('berlin-1945-tasks');
  const takeover = '1945-04-19T05:00';

  it('до передачи — как переигровка по истории; после — исторические приказы сняты', () => {
    const g = startGame(ctx, 1, takeover);
    const r = runScenario(ctx, 1, 3);
    expect(g.state.time).toBe(takeover);
    expect(g.snapshots.length).toBe(4);
    expect(g.snapshots[3].units).toEqual(r.snapshots[3].units);
    expect(g.state.pending.every((o) => o.issuedAt < takeover)).toBe(true);
  }, 60000);

  it('доклады, разведсводка с туманом войны, сводка за сутки; запись восстанавливает игру', () => {
    let g = startGame(ctx, 1, takeover, 'su');
    const own = unitReports(ctx, g.state, 'su', g.prev);
    expect(own.find((u) => u.id === 'su_8gva')?.place).toMatch(/\S/);
    const intel = intelReport(ctx, g.state, 'su', g.prev);
    const all = g.state.formations.filter((f) => f.side === 'de' && !f.destroyed).length;
    expect(intel.length).toBeGreaterThan(3);
    expect(intel.length).toBeLessThan(all); // туман войны: далёкий противник не виден
    expect(intel[0].estimate).toMatch(/тыс\. чел\./);
    expect(describePlace(ctx.theatre, [14.40, 52.40])).toMatch(/км к (С|СВ|В|ЮВ|Ю|ЮЗ|З|СЗ) от /);

    const target = ctx.theatre.data.areas.find((a) => a.id === 'Bernau')!.id;
    const unit = g.state.formations.find((f) => f.side === 'su' && f.echelon === 'army' && !f.destroyed)!;
    const orders: Order[] = [{ id: 'h1', formation: unit.id, task: 'attack', target, issuedAt: g.state.time, source: 'human' }];
    const rec: GameRecord = { version: 1, scenario: ctx.scenario.id, rules: ctx.rules.id, seed: 1, takeover, human: 'su', ai: 'de', turns: [] };
    for (let k = 0; k < 2; k++) {
      rec.turns.push({ time: g.state.time, orders: k === 0 ? orders : [] });
      g = playTurn(ctx, g, k === 0 ? orders : []);
    }
    expect(g.state.formations.find((f) => f.id === unit.id)!.order?.source).toBe('human');
    expect(dayEvents(ctx, g.state, 'su', g.prev!).length).toBeGreaterThan(0);
    const again = replayGame(loadContext('berlin-1945-tasks'), rec);
    expect(again.state.formations).toEqual(g.state.formations);

    // туман войны на карте: знаков противника меньше, чем без него, или они короче по времени
    const visible = (id: string, sn: (typeof g.snapshots)[number]) => sn.units.some((u) => u.id !== id && !u.destroyed && g.state.formations.find((f) => f.id === u.id)?.side === 'su' && Math.hypot(u.at[0] - sn.units.find((x) => x.id === id)!.at[0], u.at[1] - sn.units.find((x) => x.id === id)!.at[1]) < 0.2);
    const run = { final: g.state, snapshots: g.snapshots };
    const fog = runToDocument(ctx, run, null, { visible });
    const clear = runToDocument(ctx, run, null);
    const enemy = (d: typeof fog) => d.features.filter((f) => f.layerId === 'sim-enemy');
    expect(enemy(fog).length).not.toBe(enemy(clear).length);
  }, 120000);
});

describe('распоряжения штаба человека: тыл, переправы, резервы', () => {
  it('при передаче командования будущие наводки и прибытия сняты, тыл — под управлением; распоряжения исполняются и повторяются по записи', async () => {
    const { checkAction, NOT_COMMITTED, supplyHoursOf } = await import('../src');
    const ctx = loadContext('berlin-1945-tasks');
    let g = startGame(ctx, 1, '1945-04-19T05:00', 'su');
    expect(ctx.theatre.data.bridges.some((b) => b.id === 'x_gryfino')).toBe(false);
    expect(ctx.theatre.data.bridges.some((b) => b.id === 'x_kuestrin')).toBe(true);
    const a28 = g.state.formations.find((f) => f.id === 'su_28a')!;
    expect(a28.reserveFrom).toBe('1945-04-21T05:00');
    expect(a28.enterAt).toBe(NOT_COMMITTED);
    expect(unitReports(ctx, g.state, 'su').find((u) => u.id === 'su_28a')!.status).toBe('reserve');
    const bases = g.state.logistics!.su.bases;
    expect(bases.length).toBe(12);
    expect(bases[0].name).toBe('Kostrzyn');

    const t = g.state.time;
    // переправа через Одер у Шведта (река есть, наши рядом — 61 А / 1 А ВП), резерв и база — в полосу 8 гв. А (своя территория)
    const seelow = g.state.formations.find((f) => f.id === 'su_8gva')!.position;
    const bridge = { kind: 'bridge' as const, side: 'su', at: [14.28, 52.98] as [number, number], issuedAt: t };
    const nope = checkAction(ctx, g.state, { kind: 'bridge', side: 'su', at: [13.4, 52.2], issuedAt: t });
    expect(nope.ok).toBe(false);
    const actions = [
      bridge,
      { kind: 'commit' as const, side: 'su', formation: 'su_28a', at: seelow, issuedAt: t },
      { kind: 'base' as const, side: 'su', base: 'base1', to: seelow, issuedAt: t },
      { kind: 'priority' as const, side: 'su', formations: ['su_8gva', 'su_1gta'], issuedAt: t },
    ];
    const checks = actions.map((a) => checkAction(ctx, g.state, a));
    expect(checks.map((c) => c.ok)).toEqual([checkAction(ctx, g.state, bridge).ok, true, true, true]);
    const rec: GameRecord = { version: 1, scenario: ctx.scenario.id, rules: ctx.rules.id, seed: 1, takeover: t, human: 'su', ai: 'de', turns: [] };
    for (let k = 0; k < 3; k++) {
      const acts = k === 0 ? actions : [];
      rec.turns.push({ time: g.state.time, orders: [], actions: acts });
      const r = playTurn(ctx, g, [], acts);
      if (k === 0) expect(r.results.filter((x) => x.ok).length).toBe(checks.filter((c) => c.ok).length);
      g = r;
    }
    const f28 = g.state.formations.find((f) => f.id === 'su_28a')!;
    expect(f28.enterAt).toBe('1945-04-21T05:00');
    expect(f28.position).toEqual(seelow);
    expect(g.state.logistics!.su.bases[0].moved).toBe(true);
    expect(g.state.logistics!.su.priority).toEqual(['su_8gva', 'su_1gta']);
    const sh = supplyHoursOf(ctx, g.state, 'su');
    expect(sh.rangeHours).toBe(48);
    expect(sh.hours.size).toBeGreaterThan(10);
    const again = replayGame(loadContext('berlin-1945-tasks'), rec);
    expect(again.state.formations).toEqual(g.state.formations);
  }, 120000);
});
