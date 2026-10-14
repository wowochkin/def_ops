/**
 * «Основа правил»: сборщик «база → правила» (packages/knowledge, compileRules) с перечнем входов и пересчётом коридоров
 * модели (packages/sim, rule-inputs) — пакеты друг от друга не зависят, связываются здесь. Набор правил, профили
 * сторон, параметры агентной модели (agents-v0.json), записи базы и закрепления → коридоры множителей, происхождение
 * каждого входа, нормативы-итоги, расхождения. Наборы правил не меняются.
 *
 * Коридор множителя считается от исходного набора (у откалиброванного — calibration.from): множители калибровки
 * применяются к исходным правилам, и коридор норматива пересчитывается в множитель относительно них же.
 */
import { compileRules, type CompiledRules, type Entry, type Pins, type RuleInputRef } from '@def-ops/knowledge';
import { CALIB_SPACE, corridorOf, RULE_INPUTS, rulesFrom, toMultiplier, type CalibKey, type DataKind, type Rules, type SideProfile } from '@def-ops/sim';
import * as kbStore from '../kb/store';
import { BUILTIN, getData } from './userdata';

/** Сторона входа: профиль советской стороны (марш, переправы, задержка приказа) — su, крепость и профиль вермахта — de. */
export function inputSide(path: string): 'su' | 'de' | undefined {
  if (path.startsWith('profiles.su.') || path.startsWith('orderDelay.') || ['foot.road', 'foot.open', 'bridgeHoursMajor', 'bridgeHoursMinor'].includes(path)) return 'su';
  if (path.startsWith('profiles.de.') || path === 'stockDays.fortress') return 'de';
  return undefined;
}

/** Исходный набор откалиброванного (calibration.from); у неоткалиброванного — null. */
export const baseRulesId = (r: Rules): string | null => (r as Rules & { calibration?: { from?: string } }).calibration?.from ?? null;

/**
 * Основа правил по загруженным данным: rules — набор (значения входов), base — исходный набор (знаменатели пересчёта
 * коридора в множитель), profiles — профили сторон по id или по стороне.
 */
export function basisFrom(entries: Entry[], pins: Pins, rules: Rules, base: Rules, profiles: Record<string, SideProfile>, agents: unknown): CompiledRules {
  const inputs: RuleInputRef[] = RULE_INPUTS.map((i) => {
    const side = inputSide(i.path);
    return { path: i.path, engine: i.engine, value: i.read(rules, profiles, agents), ...(i.calib ? { calib: i.calib } : {}), ...(side ? { side } : {}) };
  });
  return compileRules(entries, inputs, pins, {
    corridorOf,
    toMultiplier: (key, c, path) => toMultiplier(key as CalibKey, c, base, profiles, path),
    space: CALIB_SPACE,
  });
}

const get = (kind: DataKind, file: string) => getData(kind, file);

/** Основа правил набора rulesId по нынешней базе; entries и pins — если уже прочитаны. */
export async function rulesBasis(rulesId: string, have?: { entries: Entry[]; pins: Pins }): Promise<CompiledRules> {
  const rules = await rulesFrom(get, rulesId);
  const from = baseRulesId(rules);
  const base = from ? await rulesFrom(get, from).catch(() => rules) : rules;
  const profiles: Record<string, SideProfile> = {};
  for (const id of BUILTIN.profiles) profiles[id] = (await getData('profiles', `${id}.json`)) as SideProfile;
  const [agents, entries, pins] = await Promise.all([getData('rules', 'agents-v0.json'), have?.entries ?? kbStore.entries(), have?.pins ?? kbStore.pins()]);
  return basisFrom(entries, pins, rules, base, profiles, agents);
}

/** Отпечаток основы правил для операции: коридоры множителей и нормативы-итоги операции — для «изменилось». */
export interface RulesDigest { corridors: Record<string, [number, number]>; outcomes: string[] }
export function rulesDigest(b: CompiledRules, opId: string): RulesDigest {
  const corridors = Object.fromEntries(Object.entries(b.corridors).map(([k, c]) => [k, c.range])) as Record<string, [number, number]>;
  const outcomes = b.outcomes.filter((o) => o.claim.scenario === opId)
    .map((o) => `${o.claim.measure} ${o.claim.subject ?? ''} ${o.claim.from.slice(0, 10)}–${o.claim.to.slice(0, 10)}: ${o.claim.range[0]}–${o.claim.range[1]} ${o.claim.unit}`.replace(/\s+/g, ' ').trim()).sort();
  return { corridors, outcomes };
}

const fmt = (r: [number, number]) => `${+r[0].toPrecision(3)}–${+r[1].toPrecision(3)}`;
/** Что изменилось в основе правил операции (для журнала): коридоры множителей и итоги. */
export function diffDigest(a: RulesDigest | undefined, b: RulesDigest): string[] {
  if (!a) return [];
  const out: string[] = [];
  for (const k of Object.keys(b.corridors)) {
    const x = a.corridors[k], y = b.corridors[k];
    if (!x || x[0] !== y[0] || x[1] !== y[1]) out.push(`коридор ${k}: ${x ? fmt(x) : '—'} → ${fmt(y)}`);
  }
  const was = new Set(a.outcomes), now = new Set(b.outcomes);
  for (const o of b.outcomes) if (!was.has(o)) out.push(`итог + ${o}`);
  for (const o of a.outcomes) if (!now.has(o)) out.push(`итог − ${o}`);
  return out;
}
