/**
 * Нормативы модели как факты базы: обратная сборка строки norms.json из факта `param`/`outcome`/«не моделируется»
 * (с fact.norm). Форма совпадает с Norm из packages/sim (пакеты друг от друга не зависят).
 */
import type { Entry, Fact } from './schema';

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
    const expr = n.expr ?? c.param;
    measure = c.why != null ? { kind: 'assumption', expr, why: c.why } : { kind: 'param', expr };
    expect = c.range ?? (c.value != null ? [c.value, c.value] : undefined);
    unit = c.unit;
  } else if (c.kind === 'outcome') {
    expect = c.range; unit = c.unit;
    measure = c.measure === 'pace' ? { kind: 'pace', scenario: c.scenario, formation: c.subject ?? '', from: c.from, to: c.to }
      : c.measure === 'loss' ? { kind: 'loss', scenario: c.scenario, parent: c.subject ?? '', from: c.from, to: c.to }
      : { kind: c.measure, scenario: c.scenario, ...(c.side ? { side: c.side } : {}), ...(c.echelon ? { echelon: c.echelon } : {}), ...(c.near ? { near: c.near } : {}), ...(n.extra ?? {}) };
  } else return null;
  return {
    id: n.id, title: n.title, kb: n.kb, source: n.src, reliability: f.reliability ?? n.reliability ?? '', historical: n.historical, measure,
    ...(expect ? { expect } : {}), ...(unit ? { unit } : {}), rules: n.rules, ...(n.note ? { note: n.note } : {}), ...(n.operations ? { operations: n.operations } : {}),
  };
}

/** Запись базы с выводами проверки нормативами (раздел «Выводы проверки» — строки «- …»). */
export const NORMS_CHECK_ENTRY = 'org:model-norms-check';

/**
 * Таблица нормативов модели, собранная из базы (для `sim:norms` и мерила калибровки): строки — по фактам с fact.norm,
 * по одной на норматив; order — порядок строк (id), остальные — следом в порядке записей базы; выводы — из записи
 * «Модель: проверка нормативами».
 */
export function normTableOf(entries: Entry[], order: string[] = []): { norms: NormRow[]; findings?: string[] } {
  const rows = new Map<string, NormRow>();
  for (const e of entries) for (const f of e.facts ?? []) {
    const r = normRowOf(f);
    if (r && !rows.has(r.id)) rows.set(r.id, r);
  }
  const pos = new Map(order.map((id, i) => [id, i]));
  const all = [...rows.values()];
  const norms = all.map((r, i) => ({ r, k: pos.get(r.id) ?? order.length + i })).sort((a, b) => a.k - b.k).map((x) => x.r);
  const text = entries.find((e) => e.id === NORMS_CHECK_ENTRY)?.sections?.find((s) => s.title === 'Выводы проверки')?.text;
  const findings = text?.split('\n').filter((l) => l.startsWith('- ')).map((l) => l.slice(2));
  return { norms, ...(findings?.length ? { findings } : {}) };
}
