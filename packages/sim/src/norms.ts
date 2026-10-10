/**
 * Нормативы опыта войны против модели: как измерить норматив в прогоне (темп формирования между двумя
 * моментами, потери подчинённых соединений) или в правилах (число). Таблица — data/rules/norms.json
 * (loadNorms в data.ts); отчёт — tools/run/norms.ts; сравнение «с посредником и без» — services/staff.
 */
import { dist } from './geo';
import { interp } from './rules';
import { ENGINEERING } from './staff';
import { profileOf, type SimContext } from './step';
import type { RunResult } from './history';

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

/** Число из правил и профиля советской стороны (немецкой — где сказано). */
export function measureParam(ctx: SimContext, expr: string): number {
  const R = ctx.rules, su = profileOf(ctx, 'su');
  const eng = su.engineering ?? ENGINEERING;
  const EN = R.engineers === false ? undefined : R.engineers;
  switch (expr) {
    case 'stockDays.fortress': return profileOf(ctx, 'de').unitTypes.fortress?.stockDays ?? NaN;
    case 'pocket.breakoutKeep%': return (R.pocket?.breakoutKeep ?? 0.3) * 100;
    case 'pocket.capitulateHours': return R.pocket?.capitulateHours ?? 96;
    case 'territory.consolidateKm': return R.territory?.consolidateKm ?? R.contactKm * 1.5;
    case 'engineers.hours': return R.engineers === false ? NaN : EN?.hours ?? 24;
    case 'advanceMax': return interp(R.advance, 10);
    case 'riverCrossHours': return R.riverCrossHours;
    case 'riverCrossHours/3': return R.riverCrossHours / 3;
    case 'bridgeHoursMajor': return eng.bridgeHoursMajor;
    case 'bridgeHoursMinor': return eng.bridgeHoursMinor;
    default: {
      const d = /^orderDelay\.(\w+)$/.exec(expr);
      if (d) return (su.orderDelayHours as Record<string, number>)[d[1]] ?? NaN;
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
 * runsOf — прогоны сценария (несколько seed — среднее и разброс).
 */
export function evaluateNorms(t: NormTable, ctxOf: (scenario: string) => SimContext, runsOf: (scenario: string) => RunResult[], paramScenario = 'berlin-1945-tasks'): NormResult[] {
  const out: NormResult[] = [];
  for (const n of t.norms) {
    const m = n.measure;
    let values: number[] = [];
    try {
      if (m.kind === 'unmodelled') { out.push({ norm: n, values, mean: null, verdict: 'none', text: `не моделируется: ${m.why}` }); continue; }
      if (m.kind === 'assumption') { const v = measureParam(ctxOf(paramScenario), m.expr); out.push({ norm: n, values: [v], mean: v, verdict: 'assumed', text: `${fmt(v)} ${n.unit ?? ''} — ${m.why}` }); continue; }
      values = m.kind === 'pace' ? runsOf(m.scenario).map((r) => measurePace(ctxOf(m.scenario), r, m))
        : m.kind === 'loss' ? runsOf(m.scenario).map((r) => measureLoss(ctxOf(m.scenario), r, m))
        : m.kind === 'frontage' ? measureFrontage(ctxOf(m.scenario), m)
        : [measureParam(ctxOf(paramScenario), m.expr)];
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

export const NORM_MARK: Record<NormVerdict, string> = { ok: '✓ в пределах', low: '↓ ниже опыта', high: '↑ выше опыта', none: '— не моделируется', assumed: '◇ допущение, опоры нет', error: '? нет данных' };
export const fmtNorm = fmt;
