import { describe, expect, it } from 'vitest';
import { loadContext, loadHistory } from '../src/data';
import { compareStrength, runScenario, type History, type StrengthCheckpoint } from '../src/history';
import { evaluateRules } from '../src/calibrate';
import { analyze, reportMarkdown } from '../src/report';
import { establishmentOf } from '../src/establishment';
import { groupManning, hqReports, unitReports } from '../src/reports';
import type { Formation, FormationDef, SimState } from '../src/types';
import type { SimContext } from '../src/step';
import rows from '../data/rules/establishment.json';

describe('сверка численности и потерь с документами (History.checkpoints)', () => {
  const ctx = loadContext('berlin-1945');
  const history = loadHistory('berlin-1945');
  const run = runScenario(ctx, 101);
  const at = (time: string, id: string) => run.snapshots.find((s) => s.time >= time)!.units.find((u) => u.id === id)!;
  const ids = ['su_8gva', 'su_5ua', 'su_1gta', 'de_lvi', 'de_xi_ss', 'de_ci'];
  // точки «ровно по расчёту»: численность на 18.04 и 22.04, потери за 16–22.04
  const exact: StrengthCheckpoint[] = [
    ...ids.flatMap((id) => ['1945-04-18T05:00', '1945-04-22T05:00'].map((t): StrengthCheckpoint => ({ at: t, formation: id, kind: 'strength', personnel: at(t, id).personnel }))),
  ];
  const lossIds = ids.filter((id) => at('1945-04-16T05:00', id).personnel - at('1945-04-22T05:00', id).personnel > 100);
  for (const id of lossIds) exact.push({ at: '1945-04-22T05:00', formation: id, kind: 'losses', from: '1945-04-01', personnel: at('1945-04-16T05:00', id).personnel - at('1945-04-22T05:00', id).personnel });
  const doubled = exact.map((c) => ({ ...c, personnel: c.personnel! * 2 })) as StrengthCheckpoint[];
  const hist = (cps: StrengthCheckpoint[]): History => ({ ...history, checkpoints: cps });

  it('расчёт ровно на документе — все точки в допуске', () => {
    expect(exact.length).toBeGreaterThanOrEqual(14);
    const r = compareStrength(ctx, run, hist(exact));
    expect(r.n).toBe(exact.length);
    expect(r.within).toBe(1);
    expect(r.medianRel).toBeLessThan(0.001);
    expect(r.byFormation.map((b) => b.key).sort()).toEqual([...ids].sort());
  });

  it('документ вдвое больше расчёта — ни одной точки в допуске', () => {
    const r = compareStrength(ctx, run, hist(doubled));
    expect(r.n).toBe(exact.length);
    expect(r.within).toBe(0);
    expect(r.medianRel).toBeCloseTo(0.5, 2);
  });

  it('даты без времени: at — конец дня, from — начало дня', () => {
    const lost = (a: string, b: string, id: string) => at(a, id).personnel - at(b, id).personnel;
    const id = lossIds[0];
    // потери за один день 16.04: от начала сценария до снимка 17.04
    const day = compareStrength(ctx, run, hist([{ at: '1945-04-16', formation: id, kind: 'losses', from: '1945-04-16', personnel: lost('1945-04-16T05:00', '1945-04-17T00:00', id) }]));
    expect(day.n).toBe(1);
    expect(day.medianRel).toBeLessThan(0.001);
    // 16–19.04 — четверо суток: снимок не раньше 20.04 00:00
    const four = compareStrength(ctx, run, hist([{ at: '1945-04-19', formation: id, kind: 'losses', from: '1945-04-16', personnel: lost('1945-04-16T05:00', '1945-04-20T00:00', id) }]));
    expect(four.n).toBe(1);
    expect(four.medianRel).toBeLessThan(0.001);
    // численность на 18.04 — на конец дня
    const st = compareStrength(ctx, run, hist([{ at: '1945-04-18', formation: id, kind: 'strength', personnel: at('1945-04-19T00:00', id).personnel }]));
    expect(st.medianRel).toBeLessThan(0.001);
  });

  it('без точек — пусто', () => {
    expect(compareStrength(ctx, run, history)).toMatchObject({ n: 0, within: 0, byFormation: [] });
  });

  it('калибровка: при ≥ 10 точках обучения сверка входит в мерило', () => {
    const plain = evaluateRules(ctx, ctx.rules, history, { seeds: 1 });
    const withCp = evaluateRules(ctx, ctx.rules, hist(doubled), { seeds: 1 });
    expect(plain.score.strength).toBeUndefined();
    expect(withCp.score.strength!.n).toBeGreaterThanOrEqual(10);
    expect(withCp.score.strength!.within).toBe(0);
    expect(withCp.score.total).toBeCloseTo(plain.score.total * 0.75 + 50 * 0.25, 2);
  }, 240000);

  it('отчёт: раздел о численности и потерях только при наличии точек', () => {
    const a = analyze(ctx, hist(doubled), { seed: 101 });
    const md = reportMarkdown(ctx, a);
    expect(md).toContain('## Численность и потери против документов');
    expect(md).toMatch(/в пределах ±25 %: 0 %/);
    const b = analyze(ctx, history, { seed: 101 });
    expect(reportMarkdown(ctx, b)).not.toContain('Численность и потери против документов');
  }, 240000);
}, 240000);

describe('сверка потерь выделенного формирования (detachFrom)', () => {
  it('выделенное при вводе — приход, а не отрицательные потери', () => {
    const ctx = loadContext('vistula-oder-1945');
    const run = runScenario(ctx, 1);
    const j = run.final.journal.find((x) => x.kind === 'detached' && x.formation === 'su_29gsk_vo')!;
    expect(j).toBeDefined();
    const end = run.snapshots[run.snapshots.length - 1];
    const u = end.units.find((x) => x.id === 'su_29gsk_vo')!;
    const got = j.kind === 'detached' ? j.personnel : 0;
    const doc = got - u.personnel;
    expect(doc).toBeGreaterThan(0);
    const h: History = { scenario: ctx.scenario.id, positions: [], frontline: [], checkpoints: [{ at: end.time, formation: 'su_29gsk_vo', kind: 'losses', from: ctx.scenario.start.slice(0, 10), personnel: doc }] };
    const r = compareStrength(ctx, run, h);
    expect(r.n).toBe(1);
    expect(r.medianRel).toBeLessThan(0.001);
  }, 120000);
});

describe('укомплектованность: от штата и от начала операции', () => {
  const base = loadContext('berlin-1945');
  // контекст с одной советской дивизией (и армией над ней) и состояние на час 0
  const ctxWith = (d: { staffKind?: string; personnel: number; initial: number }[]) => {
    const defs: FormationDef[] = [{ id: 'a', name: 'армия', side: 'su', echelon: 'army', parent: null },
      ...d.map((x, i): FormationDef => ({ id: `d${i}`, name: `дивизия ${i}`, side: 'su', echelon: 'division', parent: 'a', type: 'rifle', staffKind: x.staffKind }))];
    const ctx: SimContext = { ...base, scenario: { ...base.scenario, formations: defs } };
    const formations = d.map((x, i): Formation => ({ id: `d${i}`, name: `дивизия ${i}`, side: 'su', echelon: 'division', parent: 'a', type: 'rifle', position: [14.3, 52.6], personnel: x.personnel, tanks: 0, guns: 0,
      initial: { personnel: x.initial, tanks: 0, guns: 0 }, ammo: 1, fuel: 1, fatigue: 0, posture: 'defend', dugInHours: 0, order: null, route: null, destroyed: false, enterAt: null }));
    const state: SimState = { scenario: ctx.scenario.id, time: base.scenario.start, turn: 0, formations, pending: [], rngState: 0, seed: 1, journal: [] };
    return { ctx, state };
  };

  it('штат по виду соединения: у каждой строки — источник; неизвестный вид — null', () => {
    for (const r of rows.rows) { expect(r.source).not.toBe(''); expect(r.personnel).toBeGreaterThan(0); }
    const sd = establishmentOf('su', 'sd');
    expect(sd!.personnel).toBe(11706);
    expect(sd!.personnel).toBeGreaterThanOrEqual(11000);
    expect(sd!.personnel).toBeLessThanOrEqual(12500);
    expect(establishmentOf('su', 'нет такого')).toBeNull();
    expect(establishmentOf('su', undefined)).toBeNull();
    expect(establishmentOf('de', 'sd')).toBeNull();
  });

  it('укомплектованность: от штата и от начала операции — разные мерила', () => {
    // дивизия sd: 4 920 при 5 000 на начало операции
    const { ctx, state } = ctxWith([{ staffKind: 'sd', personnel: 4920, initial: 5000 }]);
    const [u] = unitReports(ctx, state, 'su', null);
    expect(u.strength).toBeCloseTo(0.984, 3);
    expect(u.manning).toBeCloseTo(4920 / establishmentOf('su', 'sd')!.personnel, 3);
  });

  it('без штата — manning null; у штаба — люди со штатом / сумма штатов', () => {
    const { ctx, state } = ctxWith([{ staffKind: 'sd', personnel: 4000, initial: 5000 }, { staffKind: 'sd', personnel: 6000, initial: 6000 }, { staffKind: 'tk', personnel: 9000, initial: 9000 }]);
    const own = unitReports(ctx, state, 'su', null);
    expect(own[2].manning).toBeNull();
    const [h] = hqReports(ctx, own, 'su');
    const sd = establishmentOf('su', 'sd')!.personnel;
    expect(h.manning).toBeCloseTo(10000 / (2 * sd), 4);
    // армия из стрелковой дивизии и танкового корпуса: от штата — только дивизия со штатом
    const { ctx: c1, state: s1 } = ctxWith([{ staffKind: 'sd', personnel: 4920, initial: 5000 }, { staffKind: 'tk', personnel: 9000, initial: 10000 }]);
    const o1 = unitReports(c1, s1, 'su', null);
    const [h1] = hqReports(c1, o1, 'su');
    expect(h1.manning).toBeCloseTo(4920 / sd, 4);
    expect(h1.strength).toBeCloseTo(13920 / 15000, 4);
    // смешанный список (доклад штаба и его дивизии, с повтором) — как одни дивизии
    const alone = groupManning(o1);
    expect(groupManning([h1, ...o1, o1[0]])).toEqual(alone);
    // список одних докладов штабов — по их штатам: люди со штатом = manning × establishment
    expect(groupManning([h1]).manning).toBeCloseTo(4920 / sd, 4);
    // без единого штата — null
    const { ctx: c2, state: s2 } = ctxWith([{ staffKind: 'tk', personnel: 9000, initial: 9000 }]);
    expect(hqReports(c2, unitReports(c2, s2, 'su', null), 'su')[0].manning).toBeNull();
  });
});
