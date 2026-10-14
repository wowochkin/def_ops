/**
 * Нормативы модели как факты базы: обратная сборка строки norms.json из факта `param`/`outcome`/«не моделируется»
 * (с fact.norm). Форма совпадает с Norm из packages/sim (пакеты друг от друга не зависят).
 */
import type { Fact } from './schema';

export interface NormRow {
  id: string; title: string; kb: string; source: string; reliability: string; historical: string;
  measure: Record<string, string> & { kind: string };
  expect?: [number, number]; unit?: string; rules: string[]; note?: string; operations?: string[];
}

/** Строка норматива по факту; null — факт не из norms.json (нет fact.norm). */
export function normRowOf(f: Fact): NormRow | null {
  const n = f.norm;
  if (!n) return null;
  const c = f.claim;
  let measure: NormRow['measure'];
  let expect: [number, number] | undefined;
  let unit: string | undefined;
  if (!c) measure = { kind: 'unmodelled', why: n.extra?.why ?? '' };
  else if (c.kind === 'param') {
    measure = c.why != null ? { kind: 'assumption', expr: c.param, why: c.why } : { kind: 'param', expr: c.param };
    expect = c.range ?? (c.value != null ? [c.value, c.value] : undefined);
    unit = c.unit;
  } else if (c.kind === 'outcome') {
    expect = c.range; unit = c.unit;
    measure = c.measure === 'pace' ? { kind: 'pace', scenario: c.scenario, formation: c.subject ?? '', from: c.from, to: c.to }
      : c.measure === 'loss' ? { kind: 'loss', scenario: c.scenario, parent: c.subject ?? '', from: c.from, to: c.to }
      : { kind: c.measure, scenario: c.scenario, ...(n.extra ?? {}) };
  } else return null;
  return {
    id: n.id, title: n.title, kb: n.kb, source: n.src, reliability: f.reliability ?? n.reliability ?? '', historical: n.historical, measure,
    ...(expect ? { expect } : {}), ...(unit ? { unit } : {}), rules: n.rules, ...(n.note ? { note: n.note } : {}), ...(n.operations ? { operations: n.operations } : {}),
  };
}
