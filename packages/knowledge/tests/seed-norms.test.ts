import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { normRowOf, subjectOf, type Entry, type Fact } from '../src';

const root = new URL('../../../', import.meta.url);
const json = <T,>(p: string) => JSON.parse(readFileSync(new URL(p, root), 'utf8')) as T;
const seed = json<{ entries: Entry[] }>('packages/knowledge/data/seed.json');
const norms = json<{ norms: { id: string; kb: string; measure: { kind: string }; reliability: string }[] }>('packages/sim/data/rules/norms.json').norms;
const normFacts = seed.entries.flatMap((e) => (e.facts ?? []).filter((f) => f.norm).map((f) => ({ entry: e.id, fact: f })));
const factOf = (id: string) => normFacts.filter((x) => x.fact.norm!.id === id);

describe('нормативы модели в сиде', () => {
  it('каждая строка norms.json (кроме «не моделируется») — ровно один факт param или outcome, в записи kb', () => {
    for (const n of norms) {
      const fs = factOf(n.id);
      expect(fs.length, n.id).toBe(1);
      if (n.measure.kind === 'unmodelled') { expect(fs[0].fact.claim, n.id).toBeUndefined(); continue; }
      const k = fs[0].fact.claim?.kind;
      expect(k === 'param' || k === 'outcome', n.id).toBe(true);
      expect(k, n.id).toBe(['pace', 'loss', 'frontage'].includes(n.measure.kind) ? 'outcome' : 'param');
      expect(fs[0].entry, n.id).toBe(n.kb);
    }
  });

  it('допущения — без надёжности, с пояснением', () => {
    const as = norms.filter((n) => n.measure.kind === 'assumption');
    expect(as.length).toBeGreaterThanOrEqual(19);
    for (const n of as) {
      const f = factOf(n.id)[0].fact;
      expect(f.reliability, n.id).toBeUndefined();
      expect(f.claim?.kind === 'param' && !!f.claim.why, n.id).toBe(true);
    }
  });

  it('четыре допущения коридоров есть', () => {
    for (const id of ['assume-corridor-tolerance', 'assume-outcome-weight', 'assume-outcome-min', 'assume-corridor-edge']) expect(factOf(id).length, id).toBe(1);
  });

  it('темп 1 гв. ТА у Зелова — итог 1–5 км/сут', () => {
    const c = factOf('pace-1gta-seelow')[0].fact.claim!;
    expect(c).toMatchObject({ kind: 'outcome', measure: 'pace', subject: 'su_1gta', range: [1, 5], unit: 'км/сут' });
  });

  it('путь param чистый: без «%» и «/», масштаб — в scale', () => {
    for (const { fact } of normFacts) if (fact.claim?.kind === 'param') expect(fact.claim.param, fact.norm!.id).not.toMatch(/[%/]/);
    expect(factOf('cross-small')[0].fact.claim).toMatchObject({ param: 'riverCrossHours', scale: 3 });
    expect(factOf('assume-strength-tolerance')[0].fact.claim).toMatchObject({ param: 'strength.tolerance', unit: '%' });
  });

  it('итоги одного соединения за разные периоды — разные подлежащие', () => {
    const k = (id: string) => subjectOf(factOf(id)[0].fact.claim!);
    expect(k('pace-1pa-day1')).not.toBe(k('pace-1pa-avg'));
    expect(subjectOf(factOf('defence-frontage')[0].fact.claim!)).toContain('de/division/');
  });

  it('из фактов собирается прежняя таблица: строки совпадают с norms.json по всем полям', () => {
    const rows = json<{ norms: Record<string, unknown>[] }>('packages/sim/data/rules/norms.json').norms;
    for (const r of rows) {
      const f: Fact = factOf(r.id as string)[0].fact;
      const back = JSON.parse(JSON.stringify(normRowOf(f)));
      const want = JSON.parse(JSON.stringify(r));
      // пустые необязательные поля в исходнике могут отсутствовать: сравниваем без undefined
      expect(back, r.id as string).toEqual(want);
    }
  });
});
