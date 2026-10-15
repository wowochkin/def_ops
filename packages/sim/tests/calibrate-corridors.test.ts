import { describe, expect, it } from 'vitest';
import { loadContext, loadHistory, loadRules } from '../src/data';
import { baseParams, calibCorridors, calibratedRules, calibVerdict, Calibrator, CALIB_KEYS, CALIB_SPACE, corridorReport, evaluateRules, mergeEvaluations, spaceOf, withOutcomes, type CalibScore } from '../src/calibrate';
import { edgeOf, measureFrontage, outcomeNorm, outcomesScore, OUTCOME_WEIGHT, type Norm, type NormResult } from '../src/norms';

const sc = (total: number): CalibScore => ({ total, train: 0, test: 0, within: 0, events: 0, detail: [] });
const res = (verdict: NormResult['verdict']): NormResult => ({ norm: { id: verdict } as Norm, values: [], mean: null, verdict, text: '' });

describe('калибровка в коридорах', () => {
  it('калибратор с коридором не выходит за него ни в широком поиске, ни в уточнении', () => {
    const r = loadRules('ww2-draft');
    const space = { prepared: [1.2, 1.4] as [number, number], advance: [0.9, 1.1] as [number, number] };
    const c = new Calibrator(baseParams(r), 50, 3, CALIB_KEYS, space);
    c.report(c.start, sc(10));
    while (!c.done) for (const p of c.next(4)) {
      expect(p.prepared).toBeGreaterThanOrEqual(1.2); expect(p.prepared).toBeLessThanOrEqual(1.4);
      expect(p.advance).toBeGreaterThanOrEqual(0.9); expect(p.advance).toBeLessThanOrEqual(1.1);
      c.report(p, sc(Math.abs(p.prepared - 1.39)));
    }
    expect(c.best!.p.prepared).toBeGreaterThan(1.3);
  });

  it('старт вне коридора переносится внутрь; точка вне коридора лучшей не становится; подбор завершается', () => {
    const r = loadRules('ww2-draft');
    const p0 = { ...baseParams(r), prepared: 3, fortPerLevel: -1 };
    const c = new Calibrator(p0, 12, 5, ['prepared', 'fortPerLevel', 'advance'], { prepared: [1.2, 1.5], fortPerLevel: [0.1, 0.3] });
    expect(c.start.prepared).toBe(1.5);
    expect(c.start.fortPerLevel).toBe(0.1);
    // не подбираемые множители не трогаются
    expect(c.start.movement).toBe(p0.movement);
    // прежний старт (вне коридора) с хорошим мерилом — не лучший
    expect(c.report(p0, sc(0))).toBe(false);
    expect(c.best).toBeNull();
    expect(c.report(c.start, sc(5))).toBe(true);
    let n = 0;
    while (!c.done) { for (const p of c.next(3)) { n++; expect(p.prepared).toBeLessThanOrEqual(1.5); c.report(p, sc(5 + n)); } expect(n).toBeLessThanOrEqual(12); }
    expect(n).toBe(12);
    expect(c.best!.p.prepared).toBe(1.5);
  });

  it('коридоры сборщика → границы калибратора; у множителей без коридора — прежние', () => {
    const s = spaceOf({ prepared: { range: [1.1, 1.3] }, advance: { range: [0.2, 3] } });
    expect(s).toEqual({ prepared: [1.1, 1.3], advance: [0.2, 3] });
    const c = new Calibrator(baseParams(loadRules('ww2-draft')), 4, 1, CALIB_KEYS, s);
    expect(c.space.prepared).toEqual([1.1, 1.3]);
    expect(c.space.movement).toEqual(CALIB_SPACE.movement);
  });

  it('edgeOf: в пределах 2 % ширины коридора от края', () => {
    expect(edgeOf(1.0, [1, 2])).toBe('low');
    expect(edgeOf(1.019, [1, 2])).toBe('low');
    expect(edgeOf(1.03, [1, 2])).toBeNull();
    expect(edgeOf(1.5, [1, 2])).toBeNull();
    expect(edgeOf(1.985, [1, 2])).toBe('high');
    expect(edgeOf(2, [1, 2])).toBe('high');
    expect(edgeOf(5, [5, 5])).toBeNull();
  });

  it('outcomesScore: доля итогов в допуске от 3 измеримых; меньше — null', () => {
    expect(outcomesScore([res('ok'), res('ok'), res('low')])).toBeCloseTo(2 / 3, 9);
    expect(outcomesScore([res('ok'), res('high')])).toBeNull();
    // не моделируется, допущение, нет данных — не итоги
    expect(outcomesScore([res('ok'), res('high'), res('none'), res('error'), res('assumed')])).toBeNull();
  });

  it('мерило с итогами: 7/8 × нынешнее + 1/8 × (1 − доля) × 50; без итогов — прежнее', () => {
    expect(OUTCOME_WEIGHT).toBe(1 / 8);
    expect(withOutcomes(20, 2 / 3)).toBeCloseTo((7 / 8) * 20 + (1 / 8) * (1 / 3) * 50, 9);
    expect(withOutcomes(20, null)).toBe(20);
  });

  it('evaluateRules: 3 итога операции входят в мерило по формуле, 2 — мерило прежнее; чужая операция не считается', () => {
    const ctx = loadContext('berlin-city-1945');
    const history = loadHistory('berlin-city-1945');
    const fr = measureFrontage(ctx, { kind: 'frontage', scenario: 'berlin-city-1945', side: 'de', echelon: 'division' });
    expect(fr.length).toBeGreaterThan(0);
    const m = fr.reduce((a, b) => a + b, 0) / fr.length;
    const norm = (id: string, expect: [number, number], scenario = 'berlin-city-1945'): Norm =>
      ({ id, title: id, kb: '', source: '', reliability: 'B', historical: '', measure: { kind: 'frontage', scenario, side: 'de', echelon: 'division' }, expect, unit: 'км', rules: [] });
    const ok1 = norm('a', [m - 1, m + 1]), ok2 = norm('b', [m - 2, m + 2]), bad = norm('c', [m + 5, m + 9]);
    const o = { seeds: 1 };
    const plain = evaluateRules(ctx, ctx.rules, history, o);
    const two = evaluateRules(ctx, ctx.rules, history, { ...o, outcomes: [ok1, bad, norm('x', [0, 1], 'berlin-1945-tasks')] });
    expect(two.score.total).toBe(plain.score.total);
    const three = evaluateRules(ctx, ctx.rules, history, { ...o, outcomes: [ok1, ok2, bad] });
    const base = plain.score.total;
    expect(three.score.total).toBeCloseTo((7 / 8) * base + (1 / 8) * (1 / 3) * 50, 2);
    expect(three.score.outcomes).toMatchObject({ n: 3 });
    expect(three.score.outcomes!.within).toBeCloseTo(2 / 3, 3);
    expect(three.score.outcomes!.items.map((x) => [x.id, x.ok])).toEqual([['a', true], ['b', true], ['c', false]]);
    // слияние оценок по потокам сохраняет итоги
    const merged = mergeEvaluations([three, three]);
    expect(merged.score.outcomes!.within).toBeCloseTo(2 / 3, 3);
    expect(merged.score.outcomes!.items.length).toBe(3);
  }, 60_000);

  it('норматив-итог базы → строка нормативов для замера', () => {
    const n = outcomeNorm({ measure: 'pace', scenario: 's', subject: 'su_1gta', from: '1945-04-16T00:00', to: '1945-04-19T00:00', range: [1, 5], unit: 'км/сут' }, { id: 'f1', title: 'темп' });
    expect(n.measure).toEqual({ kind: 'pace', scenario: 's', formation: 'su_1gta', from: '1945-04-16T00:00', to: '1945-04-19T00:00' });
    expect(n.expect).toEqual([1, 5]);
    const l = outcomeNorm({ measure: 'loss', scenario: 's', subject: 'su_8ga', from: 'a', to: 'b', range: [5, 9], unit: '%' }, { id: 'f2' });
    expect(l.measure).toMatchObject({ kind: 'loss', parent: 'su_8ga' });
    const f = outcomeNorm({ measure: 'frontage', scenario: 's', from: '', to: '', range: [5, 9], unit: 'км', side: 'de', echelon: 'division' }, { id: 'f3' });
    expect(f.measure).toMatchObject({ kind: 'frontage', side: 'de', echelon: 'division' });
  });

  it('откалиброванный набор записывает коридоры; отчёт по множителям — коридор, источник, «упирается»', () => {
    const r = loadRules('ww2-draft');
    const p = { ...baseParams(r), prepared: 1.4, advance: 1 };
    const corridors = { prepared: { range: [1.2, 1.4] as [number, number], source: 'kb:x#1', reliability: 'B' as const, tolerance: 0.2 } };
    const out = calibratedRules(r, p, { id: 't', scenario: 's', evals: 1, seeds: 1, trainUntil: 'x', before: sc(2), after: sc(1), corridors });
    expect((out.calibration as Record<string, unknown>).corridors).toEqual(corridors);
    const rows = corridorReport(p, corridors, ['prepared', 'advance']);
    expect(rows[0]).toMatchObject({ key: 'prepared', value: 1.4, range: [1.2, 1.4], source: 'kb:x#1', reliability: 'B', edge: 'high' });
    expect(rows[1]).toMatchObject({ key: 'advance', range: [...CALIB_SPACE.advance], edge: null });
    expect(rows[1].source).toBeUndefined();
  });

  it('итог не лучше исходных — набор не пишется (средство калибровки предупреждает)', () => {
    expect(calibVerdict(sc(10), sc(8)).write).toBe(true);
    const worse = calibVerdict(sc(10), sc(12));
    expect(worse.write).toBe(false);
    expect(worse.text).toMatch(/не лучше исходных/);
    expect(calibVerdict(sc(10), sc(10)).write).toBe(false);
    expect(calibVerdict(sc(10), null).write).toBe(false);
  });

  it('коридор в наборе: источник норматива сида — из norm.src', () => {
    const c = calibCorridors({ movement: { range: [0.75, 1.28], fact: { entry: 'org:su-advance', index: 22, fact: { reliability: 'A', norm: { id: 'march-foot-normal', src: 'БУП-42, ч. 2, §817' } } } } });
    expect(c.movement?.source).toBe('БУП-42, ч. 2, §817');
    expect(c.movement?.norm).toBe('march-foot-normal');
  });
});
