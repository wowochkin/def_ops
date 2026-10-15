/**
 * «Основа правил» набора — чистые функции для блока в «Моделях» и тестов: итог (доли входов на нормативах A/B/C и на
 * допущениях; отдельно — подбираемые калибровкой), входы по группам перечня (значение, надёжность, коридор входа; у
 * откалиброванного — исходное значение и множитель), множители калибровки с коридором и «упирается в границу»,
 * нормативы-итоги по операциям. Входы агентной модели (agents-v0.json) общие для всех наборов — своей группой, в итог
 * набора не входят.
 */
import type { CompiledRules, FactRef } from '@def-ops/knowledge';
import { CALIB_INFO, CALIB_KEYS, CALIB_SPACE, edgeOf, RULE_INPUTS, ruleInput, type CalibKey, type RuleGroup } from '@def-ops/sim';
import { MEASURE_RU, opTitle, type Rel } from './basis';

export interface RelTally { A: number; B: number; C: number; assumption: number; total: number }
const tally = (): RelTally => ({ A: 0, B: 0, C: 0, assumption: 0, total: 0 });

/** Доля входов на нормативах с источником, %; входов нет — null. */
export const relShare = (t: RelTally): number | null => (t.total ? Math.round(((t.A + t.B + t.C) / t.total) * 100) : null);

/**
 * Как множитель калибровки меняет вход: set — подбирается само значение (подготовленная оборона, укрепления, темп в
 * городе, темпы по чужой территории), scale — множитель к исходному (таблицы, прогрызание), power — степень к
 * поправке местности, movement — подбирается масштаб марша набора (movementScale): значение профиля × множитель.
 */
export type CalibMode = 'set' | 'scale' | 'power' | 'movement';
const SET_KEYS: CalibKey[] = ['prepared', 'fortPerLevel', 'urbanAdvance', 'terrFoot', 'terrMobile'];
export const calibMode = (k: CalibKey): CalibMode => (k === 'terrainExp' ? 'power' : k === 'movement' ? 'movement' : SET_KEYS.includes(k) ? 'set' : 'scale');

/**
 * Множитель против коридора: edge — «упирается» (внутри коридора, в пределах 2 % ширины от края, edgeOf), outside — вне
 * коридора (ниже или выше; у старых наборов коридор — нынешний из базы, по нему набор не подбирался).
 */
export function edgeState(v: number, range: [number, number]): { edge: 'low' | 'high' | null; outside?: 'low' | 'high' } {
  const lo = Math.min(range[0], range[1]), hi = Math.max(range[0], range[1]), eps = 1e-9 * Math.max(1, Math.abs(hi));
  if (v < lo - eps) return { edge: null, outside: 'low' };
  if (v > hi + eps) return { edge: null, outside: 'high' };
  return { edge: edgeOf(v, range) };
}

export interface RulesBasisRow {
  path: string; title: string; unit?: string; group: RuleGroup; table?: true; calib?: CalibKey; engine: 'army' | 'agents';
  /** Значение в наборе (у откалиброванного — после множителей). */
  value: number | null;
  reliability: Rel; fact: FactRef | null;
  /** Коридор норматива в единицах входа. */
  corridor?: [number, number];
  /** Откалиброванный набор: значение в исходном наборе и множитель калибровки этого входа. */
  base?: number | null; multiplier?: number; mode?: CalibMode;
  /** Множитель калибровки, который меняет вход (у таблицы темпа — «Темп продвижения», хотя коридор — у наибольшего темпа). */
  mult?: CalibKey;
}

export interface CalibKeyRow {
  key: CalibKey; title: string; unit?: string;
  /** Коридор множителя: по которому подбирался набор (fitted) или нынешний из базы; нет норматива — прежние границы. */
  range: [number, number]; fact: FactRef | null; fitted?: true; wider?: true; tableMissing?: true;
  multiplier?: number; edge?: 'low' | 'high' | null; outside?: 'low' | 'high';
}

export interface RulesBasisSummary {
  total: RelTally; calib: RelTally; agents: RelTally;
  groups: { group: RuleGroup; rows: RulesBasisRow[] }[];
  keys: CalibKeyRow[];
  outcomes: { scenario: string; items: CompiledRules['outcomes'] }[];
}

export interface SummaryOptions {
  /** Значения входов в исходном наборе (calibration.from) — у откалиброванного. */
  baseValues?: Record<string, number | null>;
  /** calibration.multipliers откалиброванного набора. */
  multipliers?: Partial<Record<CalibKey, number>>;
  /** calibration.corridors: коридоры, по которым подбирался набор. */
  fitted?: Partial<Record<CalibKey, { range: [number, number] }>>;
  /** movementScale исходного набора: значения марша исходного набора делятся на него (множитель movement его заменяет). */
  baseMovementScale?: number;
}

export function rulesBasisSummary(b: CompiledRules, o: SummaryOptions = {}): RulesBasisSummary {
  const total = tally(), calib = tally(), agents = tally();
  const byPath = new Map(b.provenance.map((p) => [p.path, p]));
  const groups: RulesBasisSummary['groups'] = [];
  for (const inp of RULE_INPUTS) {
    const p = byPath.get(inp.path);
    if (!p) continue;
    const rel = p.reliability as Rel;
    const bump = (t: RelTally) => { t[rel]++; t.total++; };
    if (inp.engine === 'agents') bump(agents);
    else { bump(total); if (inp.calib) bump(calib); }
    const row: RulesBasisRow = {
      path: inp.path, title: inp.title, group: inp.group, engine: inp.engine, value: p.value, reliability: rel, fact: p.fact,
      ...(inp.unit ? { unit: inp.unit } : {}), ...(inp.table ? { table: true as const } : {}), ...(inp.calib ? { calib: inp.calib } : {}),
      ...(p.corridor ? { corridor: p.corridor } : {}),
    };
    const mk = inp.calib ?? (inp.table && inp.path in CALIB_INFO ? inp.path as CalibKey : undefined);
    if (mk) row.mult = mk;
    if (o.multipliers && mk && o.multipliers[mk] != null) {
      row.multiplier = o.multipliers[mk];
      row.mode = calibMode(mk);
      if (o.baseValues && inp.path in o.baseValues) {
        const bv = o.baseValues[inp.path];
        // марш: значение профиля без масштаба исходного набора — множитель калибровки заменяет масштаб, а не умножает его
        row.base = row.mode === 'movement' && bv != null ? +(bv / (o.baseMovementScale || 1)).toPrecision(12) : bv;
      }
    }
    let g = groups.find((x) => x.group === inp.group);
    if (!g) groups.push(g = { group: inp.group, rows: [] });
    g.rows.push(row);
  }
  const keys: CalibKeyRow[] = CALIB_KEYS.map((key) => {
    const c = b.corridors[key], f = o.fitted?.[key];
    const range: [number, number] = f ? [f.range[0], f.range[1]] : c ? [c.range[0], c.range[1]] : [CALIB_SPACE[key][0], CALIB_SPACE[key][1]];
    const m = o.multipliers?.[key];
    return {
      key, title: CALIB_INFO[key].title, ...(CALIB_INFO[key].unit ? { unit: CALIB_INFO[key].unit } : {}), range, fact: c?.fact ?? null,
      ...(f ? { fitted: true as const } : {}), ...(c?.wider ? { wider: true as const } : {}), ...(c?.tableMissing ? { tableMissing: true as const } : {}),
      ...(m != null ? { multiplier: m, ...edgeState(m, range) } : {}),
    };
  });
  const scen = [...new Set(b.outcomes.map((x) => x.claim.scenario))];
  const outcomes = scen.map((scenario) => ({ scenario, items: b.outcomes.filter((x) => x.claim.scenario === scenario) }));
  return { total, calib, agents, groups, keys, outcomes };
}

/**
 * Расхождение по-русски: путь входа → название входа, ключ множителя → название множителя, ключ итога → «итог …» с
 * названием операции (op — своя операция; встроенные — из каталога).
 */
export function conflictTitle(path: string, op?: (id: string) => string | undefined): string {
  if (path.startsWith('outcome:')) {
    const [, scenario, measure, subject] = path.split(':');
    return `итог: ${MEASURE_RU[measure] ?? measure}${subject ? ` ${subject}` : ''} (${op?.(scenario) ?? opTitle(scenario)})`;
  }
  const i = ruleInput(path);
  if (i) return i.title;
  if (path in CALIB_INFO) return `${CALIB_INFO[path as CalibKey].title} (множитель калибровки)`;
  return path;
}
