import { describe, expect, it } from 'vitest';
import { loadContext, loadNorms, loadRules } from '../src/data';
import { evaluateNorms } from '../src/norms';
import { CALIB_SPACE } from '../src/calibrate';
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
    const run = (t: typeof json) => evaluateNorms(t, () => ctx, () => []).map((r) => ({ id: r.norm.id, verdict: r.verdict, text: r.text, values: r.values }));
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
});
