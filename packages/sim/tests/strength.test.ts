import { describe, expect, it } from 'vitest';
import { loadContext, loadHistory } from '../src/data';
import { compareStrength, runScenario, type History, type StrengthCheckpoint } from '../src/history';
import { evaluateRules } from '../src/calibrate';
import { analyze, reportMarkdown } from '../src/report';

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
