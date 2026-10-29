import { describe, expect, it } from 'vitest';
import { loadAgents, loadContext, loadNorms, loadRules } from '../src/data';
import { evaluateNorms, measureParam } from '../src/norms';
import { CALIB_SPACE } from '../src/calibrate';
import { RULE_INPUTS, ruleInput } from '../src/rule-inputs';
import { seedBasis, seedNormTable, seedOutcomeNorms } from '../tools/run/kb-seed';

describe('нормативы из базы знаний (сид) для sim:norms и калибровки', () => {
  const table = seedNormTable();
  const json = loadNorms();

  it('таблица, собранная из сида, равна norms.json: строки, порядок, выводы', () => {
    expect(JSON.parse(JSON.stringify(table.norms))).toEqual(JSON.parse(JSON.stringify(json.norms)));
    expect(table.findings).toEqual(json.findings);
  });

  it('отчёт по собранной таблице равен отчёту по norms.json (замеры по правилам; прогоны подставлены пустыми)', () => {
    const ctx = loadContext('berlin-1945-tasks');
    const run = (t: typeof json) => evaluateNorms(t, () => ctx, () => [], undefined, loadAgents()).map((r) => ({ id: r.norm.id, verdict: r.verdict, text: r.text, values: r.values }));
    expect(run(table)).toEqual(run(json));
  });

  it('основа правил из сида: коридоры всех множителей, итоги операции — строками нормативов', () => {
    const base = loadRules('ww2-draft');
    const b = seedBasis(base);
    expect(Object.keys(b.corridors).sort()).toEqual(Object.keys(CALIB_SPACE).sort());
    expect(b.corridors.advance.fact).not.toBeNull();
    const outs = seedOutcomeNorms(b, 'berlin-1945-tasks');
    expect(outs.length).toBeGreaterThanOrEqual(3);
    for (const n of outs) expect(['pace', 'loss', 'frontage']).toContain(n.measure.kind);
    // у факта сида — строка norms.json целиком
    const pace = outs.find((n) => n.id === 'pace-1gta-seelow');
    expect(pace).toEqual(json.norms.find((n) => n.id === 'pace-1gta-seelow'));
    expect(seedOutcomeNorms(b, 'нет-такой')).toEqual([]);
  });

  it('нормативы агентной модели: каждая строка agents-… — вход перечня, в основе правил — норматив A/B/C, значение в отчёте', () => {
    const rows = json.norms.filter((n) => n.measure.kind === 'param' && n.measure.expr.startsWith('agents.'));
    const inputs = RULE_INPUTS.filter((i) => i.engine === 'agents');
    // у каждого из входов агентной модели — строка норматива
    expect(new Set(rows.map((n) => (n.measure as { expr: string }).expr))).toEqual(new Set(inputs.map((i) => i.path)));
    const b = seedBasis(loadRules('ww2-draft'));
    const agents = loadAgents();
    const ctx = loadContext('berlin-1945-tasks');
    const res = evaluateNorms({ norms: rows }, () => ctx, () => [], undefined, agents);
    for (const n of rows) {
      const path = (n.measure as { expr: string }).expr;
      const inp = ruleInput(path);
      expect(inp?.engine, n.id).toBe('agents');
      expect(inp!.unit, n.id).toBe(n.unit);
      const p = b.provenance.find((x) => x.path === path)!;
      expect(['A', 'B', 'C'], n.id).toContain(p.reliability);
      expect(p.fact?.fact.norm?.id, n.id).toBe(n.id);
      expect(p.corridor, n.id).toBeDefined();
      const r = res.find((x) => x.norm.id === n.id)!;
      expect(r.mean, n.id).toBe(inp!.read(ctx.rules, ctx.profiles, agents));
    }
  });

  it('выражения нормативов-допущений читаются: нет неизвестных; пороги режима «История как замысел» — числа', () => {
    const ctx = loadContext('berlin-1945-tasks', 'ww2-berlin-cal');
    const agents = loadAgents();
    for (const n of loadNorms().norms) {
      const m = n.measure;
      if (m.kind !== 'param' && m.kind !== 'assumption') continue;
      if (/^(strength|corridor|outcome|plausible)\./.test(m.expr)) continue;
      expect(() => measureParam(ctx, m.expr, agents), n.id).not.toThrow();
    }
    const want: Record<string, number> = { 'intent-leave': 30, 'intent-return': 15, 'intent-reach': 2, 'intent-unfit': 0.25 };
    for (const [id, v] of Object.entries(want)) {
      const n = loadNorms().norms.find((x) => x.id === id)!;
      expect(measureParam(ctx, (n.measure as { expr: string }).expr, agents), id).toBe(v);
    }
  });
});
