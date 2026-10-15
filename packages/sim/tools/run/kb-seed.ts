/**
 * Нормативы и основа правил из встроенной базы знаний (packages/knowledge/data/seed.json) для консольных средств
 * (npm run sim:norms, npm run sim:calibrate). Пакеты sim и knowledge друг от друга не зависят — связываются здесь,
 * в средствах, как в редакторе (apps/editor/src/sim/kb-rules.ts): перечень входов и пересчёт коридоров — модели,
 * выбор нормативов и сборка — базы.
 */
import { readFileSync } from 'node:fs';
import { compileRules, normRowOf, normTableOf, type CompiledRules, type Entry } from '@def-ops/knowledge';
import { CALIB_SPACE, type CalibKey } from '../../src/calibrate';
import { loadNorms, loadProfile } from '../../src/data';
import { outcomeNorm, type Norm, type NormTable } from '../../src/norms';
import { corridorOf, ruleInputRefs, toMultiplier } from '../../src/rule-inputs';
import type { Rules, SideProfile } from '../../src/types';

const ROOT = new URL('../../../../', import.meta.url);
const json = <T,>(p: string) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8')) as T;

let entries: Entry[] | null = null;
/** Записи встроенной базы (сид). */
export function seedEntries(): Entry[] {
  if (!entries) { const s = json<{ entries: Entry[] } | Entry[]>('packages/knowledge/data/seed.json'); entries = Array.isArray(s) ? s : s.entries; }
  return entries;
}

/** Таблица нормативов, собранная из базы; порядок строк — как в norms.json (исходник встроенных нормативов). */
export function seedNormTable(): NormTable {
  const t = normTableOf(seedEntries(), loadNorms().norms.map((n) => n.id));
  return t as unknown as NormTable;
}

/** Основа правил по сиду: base — набор, к которому применяются множители калибровки (знаменатели пересчёта). */
export function seedBasis(base: Rules, profiles: Record<string, SideProfile> = { 'rkka-1945': loadProfile('rkka-1945'), 'wehrmacht-1945': loadProfile('wehrmacht-1945') }): CompiledRules {
  const agents = json<unknown>('packages/sim/data/rules/agents-v0.json');
  return compileRules(seedEntries(), ruleInputRefs(base, profiles, agents), {}, {
    corridorOf,
    toMultiplier: (key, c, path) => toMultiplier(key as CalibKey, c, base, profiles, path),
    space: CALIB_SPACE,
  });
}

/** Нормативы-итоги операции из основы правил — строками нормативов (у факта сида — строка norms.json целиком). */
export function seedOutcomeNorms(b: CompiledRules, scenario: string): Norm[] {
  return b.outcomes.filter((o) => o.claim.scenario === scenario).map((o) => {
    const row = normRowOf(o.fact.fact);
    return row ? (row as unknown as Norm) : outcomeNorm(o.claim, { id: `${o.fact.entry}#${o.fact.index}`, kb: o.fact.entry, source: o.fact.fact.source, reliability: o.fact.fact.reliability });
  });
}
