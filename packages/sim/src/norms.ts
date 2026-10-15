/**
 * Нормативы опыта войны против модели: как измерить норматив в прогоне (темп формирования между двумя
 * моментами, потери подчинённых соединений) или в правилах (число). Таблица — data/rules/norms.json
 * (loadNorms в data.ts); отчёт — tools/run/norms.ts; сравнение «с посредником и без» — services/staff.
 */
import { agentNumber } from './agents-params';
import { dist } from './geo';
import { interp } from './rules';
import { ENGINEERING } from './staff';
import { profileOf, type SimContext } from './step';
import { STRENGTH_TOL, STRENGTH_WEIGHT, type RunResult } from './history';

export interface Norm {
  id: string; title: string; kb: string; source: string; reliability: string; historical: string;
  measure: { kind: 'pace'; scenario: string; formation: string; from: string; to: string }
    | { kind: 'loss'; scenario: string; parent: string; from: string; to: string }
    | { kind: 'param'; expr: string }
    | { kind: 'frontage'; scenario: string; side: string; echelon: string }
    | { kind: 'unmodelled'; why: string }
    /** Допущение модели: правило есть, опоры в опыте войны нет — показывается значение и чего не хватает. */
    | { kind: 'assumption'; expr: string; why: string };
  expect?: [number, number]; unit?: string; rules: string[]; note?: string;
  /** Операции, к которым относится норматив (для покрытия), если в замере нет сценария. */
  operations?: string[];
}
/** Допущения калибровки в коридорах (строки assume-corridor-* и assume-outcome-* в norms.json). */
export const CORRIDOR_TOL = { A: 0.10, B: 0.20, C: 0.35 } as const;
export const OUTCOME_WEIGHT = 1 / 8;
export const OUTCOME_MIN = 3;
export const CORRIDOR_EDGE = 0.02;

export interface NormTable { norms: Norm[]; findings?: string[] }

export type NormVerdict = 'ok' | 'low' | 'high' | 'none' | 'assumed' | 'error';
export interface NormResult { norm: Norm; values: number[]; mean: number | null; verdict: NormVerdict; text: string }

/** Сценарии, которые нужно прогнать для таблицы. */
export const normScenarios = (t: NormTable) => [...new Set(t.norms.map((n) => ('scenario' in n.measure ? n.measure.scenario : null)).filter((x): x is string => !!x))];

const snapAt = (r: RunResult, t: string) => r.snapshots.find((s) => s.time >= t) ?? r.snapshots[r.snapshots.length - 1];
const days = (a: string, b: string) => (Date.parse(b + 'Z') - Date.parse(a + 'Z')) / 86_400_000;

/** Темп: смещение формирования между двумя моментами по прямой (как в источниках), км/сут. */
export function measurePace(ctx: SimContext, r: RunResult, m: Extract<Norm['measure'], { kind: 'pace' }>): number {
  const a = snapAt(r, m.from).units.find((u) => u.id === m.formation);
  const b = snapAt(r, m.to).units.find((u) => u.id === m.formation);
  if (!a || !b) return NaN;
  return dist(ctx.theatre.proj.toXY(a.at), ctx.theatre.proj.toXY(b.at)) / days(m.from, m.to);
}

/** Потери подчинённых (по цепочке подчинённости) за период, % численности (прибывшие позже — с момента прибытия). */
export function measureLoss(ctx: SimContext, r: RunResult, m: Extract<Norm['measure'], { kind: 'loss' }>): number {
  const parent = new Map(ctx.scenario.formations.map((f) => [f.id, f.parent ?? null]));
  const under = (id: string): boolean => { for (let p = parent.get(id); p; p = parent.get(p)) if (p === m.parent) return true; return false; };
  const inWin = r.snapshots.filter((s) => s.time >= m.from && s.time <= m.to);
  let start = 0, end = 0;
  for (const id of new Set(inWin.flatMap((s) => s.units.map((u) => u.id)))) {
    if (!under(id)) continue;
    const seen = inWin.filter((s) => s.units.some((u) => u.id === id));
    const p0 = seen[0].units.find((u) => u.id === id)!.personnel;
    // сдавшиеся и уничтоженные — потеряны целиком (численность на знаке остаётся последней)
    const u1 = seen[seen.length - 1].units.find((u) => u.id === id)!;
    const p1 = u1.destroyed ? 0 : u1.personnel;
    start += p0; end += Math.min(p0, p1);
  }
  return start ? ((start - end) / start) * 100 : NaN;
}

/**
 * Число из правил и профиля советской стороны (немецкой — где сказано); путь с приставкой «agents.» — параметр
 * агентной модели (agents — содержимое agents-v0.json, таблица — значение при 3:1).
 */
export function measureParam(ctx: SimContext, expr: string, agents?: unknown): number {
  if (expr.startsWith('agents.')) {
    if (agents === undefined) throw new Error('параметр агентной модели: не переданы параметры agents-v0.json');
    return agentNumber(agents, expr.slice('agents.'.length)) ?? NaN;
  }
  const R = ctx.rules, su = profileOf(ctx, 'su');
  const eng = su.engineering ?? ENGINEERING;
  const EN = R.engineers === false ? undefined : R.engineers;
  switch (expr) {
    case 'stockDays.fortress': return profileOf(ctx, 'de').unitTypes.fortress?.stockDays ?? NaN;
    case 'pocket.breakoutKeep%': return (R.pocket?.breakoutKeep ?? 0.3) * 100;
    case 'pocket.capitulateHours': return R.pocket?.capitulateHours ?? 96;
    case 'territory.consolidateKm': return R.territory?.consolidateKm ?? R.contactKm * 1.5;
    case 'engineers.hours': return R.engineers === false ? NaN : EN?.hours ?? 24;
    case 'foot.road': return su.road.foot * (R.movementScale ?? 1);
    case 'foot.open': return su.offRoad.foot.open * (R.movementScale ?? 1);
    case 'supplyFlow.fullHours': return R.supplyFlow ? R.supplyFlow.fullHours ?? 12 : NaN;
    case 'beltBreachKm': return R.beltBreachKm ? R.beltBreachKm : NaN;
    case 'followParentKm': return R.followParentKm ? R.followParentKm : NaN;
    case 'strength.tolerance%': return STRENGTH_TOL * 100;
    case 'strength.weight%': return STRENGTH_WEIGHT * 100;
    case 'supplyFlow.fuelPer100km': return R.supplyFlow ? R.supplyFlow.fuelPer100km ?? 1 : NaN;
    // пороги правдоподобия проверок базы знаний (packages/knowledge/src/checks.ts, PLAUSIBLE) — допущения без опоры
    case 'corridor.tolerance%': return CORRIDOR_TOL.B * 100;
    case 'outcome.weight%': return OUTCOME_WEIGHT * 100;
    case 'outcome.min': return OUTCOME_MIN;
    case 'corridor.edge%': return CORRIDOR_EDGE * 100;
    case 'plausible.division': return 20000;
    case 'plausible.lossesShare%': return 100;
    case 'plausible.dailyLossShare%': return 100 / 3;
    case 'plausible.parentSteps': return 1;
    case 'plausible.reinforceShare%': return 50;
    case 'advanceMax': return interp(R.advance, 10);
    case 'riverCrossHours': return R.riverCrossHours;
    case 'riverCrossHours/3': return R.riverCrossHours / 3;
    case 'bridgeHoursMajor': return eng.bridgeHoursMajor;
    case 'bridgeHoursMinor': return eng.bridgeHoursMinor;
    default: {
      const d = /^orderDelay\.(\w+)$/.exec(expr);
      if (d) return (su.orderDelayHours as Record<string, number>)[d[1]] ?? NaN;
      // множитель режима: нет блока regimes — режимы не включены
      const rg = /^regimes\.(\w+)\.(\w+)$/.exec(expr);
      if (rg) return R.regimes ? (R.regimes as Record<string, Record<string, number>>)[rg[1]]?.[rg[2]] ?? 1 : NaN;
      throw new Error(`неизвестное выражение ${expr}`);
    }
  }
}

export function measureFrontage(ctx: SimContext, m: Extract<Norm['measure'], { kind: 'frontage' }>): number[] {
  const P = profileOf(ctx, m.side);
  return ctx.scenario.formations.filter((f) => f.side === m.side && f.echelon === m.echelon).map((f) => (f.type ? P.unitTypes[f.type]?.frontageKm : undefined) ?? NaN).filter(Number.isFinite);
}

const fmt = (x: number) => (Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(1)).replace('.', ',');

/**
 * Оценить нормативы. ctxOf — контекст сценария (для правил — любой, по умолчанию Берлинской операции);
 * runsOf — прогоны сценария (несколько seed — среднее и разброс); agents — параметры агентной модели
 * (agents-v0.json) для нормативов на пути «agents.…».
 */
export function evaluateNorms(t: NormTable, ctxOf: (scenario: string) => SimContext, runsOf: (scenario: string) => RunResult[], paramScenario = 'berlin-1945-tasks', agents?: unknown): NormResult[] {
  const out: NormResult[] = [];
  for (const n of t.norms) {
    const m = n.measure;
    let values: number[] = [];
    try {
      if (m.kind === 'unmodelled') { out.push({ norm: n, values, mean: null, verdict: 'none', text: `не моделируется: ${m.why}` }); continue; }
      if (m.kind === 'assumption') { const v = measureParam(ctxOf(paramScenario), m.expr, agents); if (!Number.isFinite(v)) { out.push({ norm: n, values: [], mean: null, verdict: 'none', text: `не включено в правилах: ${m.why}` }); continue; } out.push({ norm: n, values: [v], mean: v, verdict: 'assumed', text: `${fmt(v)} ${n.unit ?? ''} — ${m.why}` }); continue; }
      values = m.kind === 'pace' ? runsOf(m.scenario).map((r) => measurePace(ctxOf(m.scenario), r, m))
        : m.kind === 'loss' ? runsOf(m.scenario).map((r) => measureLoss(ctxOf(m.scenario), r, m))
        : m.kind === 'frontage' ? measureFrontage(ctxOf(m.scenario), m)
        : [measureParam(ctxOf(paramScenario), m.expr, agents)];
    } catch (e) { out.push({ norm: n, values, mean: null, verdict: 'error', text: (e as Error).message }); continue; }
    const ok = values.filter(Number.isFinite);
    if (!ok.length) { out.push({ norm: n, values, mean: null, verdict: 'error', text: 'нет данных (формирования нет на карте в эти дни)' }); continue; }
    const mean = ok.reduce((a, b) => a + b, 0) / ok.length;
    const [lo, hi] = n.expect!;
    const spread = ok.length > 1 ? ` (${fmt(Math.min(...ok))}–${fmt(Math.max(...ok))})` : '';
    out.push({ norm: n, values: ok, mean, verdict: mean < lo ? 'low' : mean > hi ? 'high' : 'ok', text: `${fmt(mean)}${spread} ${n.unit}` });
  }
  return out;
}

/**
 * Множитель упирается в границу коридора: в пределах CORRIDOR_EDGE (2 %) ширины от края — 'low' / 'high'
 * («упирается в границу — проверьте источник»); вырожденный коридор (нулевой ширины) — null.
 */
export function edgeOf(v: number, c: [number, number]): 'low' | 'high' | null {
  const lo = Math.min(c[0], c[1]), hi = Math.max(c[0], c[1]), w = hi - lo;
  if (!(w > 0) || !Number.isFinite(v)) return null;
  const e = CORRIDOR_EDGE * w + 1e-12;
  return v - lo <= e ? 'low' : hi - v <= e ? 'high' : null;
}

/**
 * Доля нормативов-итогов в допуске (0…1) — по измеримым (в пределах, ниже, выше); «не моделируется», допущения и
 * «нет данных» не считаются. Измеримых меньше OUTCOME_MIN (3) — null: итоги в мерило не входят, только проверка.
 */
export function outcomesScore(results: NormResult[]): number | null {
  const m = results.filter((r) => r.verdict === 'ok' || r.verdict === 'low' || r.verdict === 'high');
  return m.length < OUTCOME_MIN ? null : m.filter((r) => r.verdict === 'ok').length / m.length;
}

/** Норматив-итог базы знаний (факт outcome; форма — как в packages/knowledge, без зависимости от неё). */
export interface OutcomeClaim { measure: string; scenario: string; subject?: string; from: string; to: string; range: [number, number]; unit: string; side?: string; echelon?: string; near?: string }

/** Строка нормативов по нормативу-итогу базы (у фактов из документов и ручных нет строки norms.json). */
export function outcomeNorm(c: OutcomeClaim, o: { id: string; title?: string; kb?: string; source?: string; reliability?: string; historical?: string }): Norm {
  const measure: Norm['measure'] = c.measure === 'pace' ? { kind: 'pace', scenario: c.scenario, formation: c.subject ?? '', from: c.from, to: c.to }
    : c.measure === 'loss' ? { kind: 'loss', scenario: c.scenario, parent: c.subject ?? '', from: c.from, to: c.to }
    : c.measure === 'frontage' ? { kind: 'frontage', scenario: c.scenario, side: c.side ?? '', echelon: c.echelon ?? '' }
    : { kind: 'unmodelled', why: `мера «${c.measure}» в прогоне не замеряется` };
  return {
    id: o.id, title: o.title ?? `${c.measure} ${c.subject ?? [c.side, c.echelon].filter(Boolean).join(' ')}`.trim(), kb: o.kb ?? '', source: o.source ?? '',
    reliability: o.reliability ?? '', historical: o.historical ?? '', measure, expect: [Math.min(...c.range), Math.max(...c.range)], unit: c.unit, rules: [],
  };
}

export const NORM_MARK: Record<NormVerdict, string> = { ok: '✓ в пределах', low: '↓ ниже опыта', high: '↑ выше опыта', none: '— не моделируется', assumed: '◇ допущение, опоры нет', error: '? нет данных' };
export const fmtNorm = fmt;
