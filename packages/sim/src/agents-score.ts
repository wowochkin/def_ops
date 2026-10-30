/**
 * Сверка прогона агентной модели с историей — числа для сравнения вариантов и калибровки (раздел «Моделирование»):
 * доля положений дивизий в допуске, медиана превышения, события операции в пределах ±2 суток. Та же мерка, что в
 * «Переигровке» (agentsToRun → compareWithHistory, checkEvents), без карты.
 */
import { agentsHistory, agentsToRun, type AgentHistory, type AgentTrace } from './agents';
import { checkEvents, compareStrength, type EventResult, compareWithHistory, STRENGTH_MIN_POINTS, STRENGTH_WEIGHT, summarize, type History } from './history';
import { evaluateNorms, outcomesScore, OUTCOME_WEIGHT, type Norm } from './norms';
import type { SimContext } from './step';

export interface AgentsScore {
  within: number; n: number; medianExcessKm: number;
  /** Средняя ошибка положений дивизий, км (непрерывная мера, без допуска). */
  meanKm: number;
  /** Средняя ошибка срока событий, сутки (по наступившим в прогоне событиям); сколько из них наступило. */
  meanEventDays: number | null; eventsOccurred: number;
  eventsHit: number; eventsTotal: number;
  events: { id: string; title: string; days: number | null }[];
  /** По объединениям (армиям и корпусам по подчинению дивизий): доля в допуске и число положений. */
  byGroup: { id: string; within: number; n: number }[];
  /** Сверка численности и потерь с документами (есть, когда в истории есть контрольные точки). */
  strength?: { n: number; within: number };
  /** Нормативы-итоги операции, измеримые в прогоне: сколько, доля в допуске, каждый (id, значение, в допуске ли). */
  outcomes?: { n: number; within: number; items: { id: string; mean: number | null; ok: boolean }[] };
  /**
   * Итог для калибровки: положения и события поровну (0…1); при ≥ 10 контрольных точках — на 25% сверка численности;
   * при ≥ 3 измеримых нормативах-итогах операции — на 1/8 доля итогов в допуске (тот же вес и порог, что у нынешней модели).
   */
  score: number;
}

/** Шаг снимков сверки, ч: на нём мерило и итоги операции видят события одинаково. */
export const SCORE_STEP_HOURS = 6;

/** Прогон ядра как RunResult и история для сверки — общий путь мерила и итогов операции. */
function scoreRun(base: SimContext, trace: AgentTrace, history: AgentHistory, baseHistory: History | null, stepHours: number) {
  return { ...agentsToRun(base, trace, stepHours), h: agentsHistory(history, baseHistory) };
}

/**
 * События операции по ходу ядра: когда они случились в расчёте и на сколько суток от истории. Одно определение на
 * мерило сходства (agentsScore) и сравнение итогов (operationSummary).
 */
export function agentsEvents(base: SimContext, trace: AgentTrace, history: AgentHistory, baseHistory: History | null, stepHours = SCORE_STEP_HOURS): EventResult[] {
  const { ctx, run, h } = scoreRun(base, trace, history, baseHistory, stepHours);
  return checkEvents(ctx, run, h);
}

export function agentsScore(base: SimContext, trace: AgentTrace, history: AgentHistory, baseHistory: History | null, toleranceKm = 10, stepHours = SCORE_STEP_HOURS, outcomes: Norm[] = []): AgentsScore {
  const { ctx, run, h } = scoreRun(base, trace, history, baseHistory, stepHours);
  const devs = compareWithHistory(ctx, run, h);
  const s = summarize(devs, toleranceKm);
  // события — тем же путём, что agentsEvents (scoreRun → checkEvents)
  const ev = checkEvents(ctx, run, h);
  const hit = ev.filter((e) => e.days != null && Math.abs(e.days) <= 2).length;
  const occurred = ev.filter((e) => e.days != null);
  // объединение дивизии — армия над её штабом (корпус → армия), без армии — сам штаб
  const hqs = new Map(trace.hqs.map((x) => [x.id, x]));
  const armyOf = (id: string) => { for (let x = hqs.get(id), n = 0; x && n < 6; x = x.parent ? hqs.get(x.parent) : undefined, n++) if (x.echelon === 'army') return x.id; return id; };
  const hq = new Map(trace.divisions.map((d) => [d.id, armyOf(d.hq)]));
  const name = new Map(trace.hqs.map((x) => [x.id, x.name]));
  const groups = new Map<string, { ok: number; n: number }>();
  for (const d of devs) {
    const g = hq.get(d.formation);
    if (!g) continue;
    const x = groups.get(g) ?? { ok: 0, n: 0 };
    x.n++; if (d.excessKm <= toleranceKm) x.ok++;
    groups.set(g, x);
  }
  const st = compareStrength(ctx, run, h);
  const posEv = (s.within + (ev.length ? hit / ev.length : s.within)) / 2;
  const withStrength = st.n >= STRENGTH_MIN_POINTS ? posEv * (1 - STRENGTH_WEIGHT) + st.within * STRENGTH_WEIGHT : posEv;
  // нормативы-итоги этой операции: темп и потери — по прогону ядра, ширина полос — по профилям
  const outs = outcomes.filter((n) => 'scenario' in n.measure && n.measure.scenario === base.scenario.id);
  const res = outs.length ? evaluateNorms({ norms: outs }, () => ctx, () => [run]) : [];
  const share = outcomesScore(res);
  const items = res.filter((r) => r.verdict === 'ok' || r.verdict === 'low' || r.verdict === 'high').map((r) => ({ id: r.norm.id, mean: r.mean == null ? null : +r.mean.toFixed(2), ok: r.verdict === 'ok' }));
  return {
    within: s.within, n: s.n, medianExcessKm: s.medianExcessKm,
    meanKm: devs.length ? +(devs.reduce((a, d) => a + d.km, 0) / devs.length).toFixed(1) : 0,
    meanEventDays: occurred.length ? +(occurred.reduce((a, e) => a + Math.abs(e.days!), 0) / occurred.length).toFixed(2) : null, eventsOccurred: occurred.length,
    eventsHit: hit, eventsTotal: ev.length,
    events: ev.map((e) => ({ id: e.id, title: e.title, days: e.days })),
    byGroup: [...groups].map(([id, x]) => ({ id: name.get(id) ?? id, within: +(x.ok / x.n).toFixed(2), n: x.n })).sort((a, b) => b.n - a.n),
    ...(st.n > 0 ? { strength: { n: st.n, within: st.within } } : {}),
    ...(outs.length ? { outcomes: { n: items.length, within: +(items.length ? items.filter((x) => x.ok).length / items.length : 0).toFixed(3), items } } : {}),
    score: +(share == null ? withStrength : withStrength * (1 - OUTCOME_WEIGHT) + share * OUTCOME_WEIGHT).toFixed(3),
  };
}
