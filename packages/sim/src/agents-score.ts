/**
 * Сверка прогона агентной модели с историей — числа для сравнения вариантов и калибровки (раздел «Моделирование»):
 * доля положений дивизий в допуске, медиана превышения, события операции в пределах ±2 суток. Та же мерка, что в
 * «Переигровке» (agentsToRun → compareWithHistory, checkEvents), без карты.
 */
import { agentsHistory, agentsToRun, type AgentHistory, type AgentTrace } from './agents';
import { checkEvents, compareStrength, compareWithHistory, summarize, type History } from './history';
import type { SimContext } from './step';

export interface AgentsScore {
  within: number; n: number; medianExcessKm: number;
  eventsHit: number; eventsTotal: number;
  events: { id: string; title: string; days: number | null }[];
  /** По объединениям (армиям и корпусам по подчинению дивизий): доля в допуске и число положений. */
  byGroup: { id: string; within: number; n: number }[];
  /** Сверка численности и потерь с документами (есть, когда в истории есть контрольные точки). */
  strength?: { n: number; within: number };
  /** Итог для калибровки: положения и события поровну (0…1); при ≥ 10 контрольных точках — на 25% сверка численности. */
  score: number;
}

export function agentsScore(base: SimContext, trace: AgentTrace, history: AgentHistory, baseHistory: History | null, toleranceKm = 10, stepHours = 6): AgentsScore {
  const { ctx, run } = agentsToRun(base, trace, stepHours);
  const h = agentsHistory(history, baseHistory);
  const devs = compareWithHistory(ctx, run, h);
  const s = summarize(devs, toleranceKm);
  const ev = checkEvents(ctx, run, h);
  const hit = ev.filter((e) => e.days != null && Math.abs(e.days) <= 2).length;
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
  return {
    within: s.within, n: s.n, medianExcessKm: s.medianExcessKm, eventsHit: hit, eventsTotal: ev.length,
    events: ev.map((e) => ({ id: e.id, title: e.title, days: e.days })),
    byGroup: [...groups].map(([id, x]) => ({ id: name.get(id) ?? id, within: +(x.ok / x.n).toFixed(2), n: x.n })).sort((a, b) => b.n - a.n),
    ...(st.n > 0 ? { strength: { n: st.n, within: st.within } } : {}),
    score: +(st.n >= 10 ? posEv * 0.75 + st.within * 0.25 : posEv).toFixed(3),
  };
}
