/**
 * Прогон сценария и сравнение с историей: где и насколько расчёт разошёлся с
 * историческими положениями (с учётом их неопределённости).
 */
import type { LngLat } from '@def-ops/core';
import { dist } from './geo';
import { createState, onMap, step, addHours, type SimContext } from './step';
import type { SimState } from './types';

export interface History {
  scenario: string;
  positions: { formation: string; time: string; at: LngLat; approxKm: number; place: string; reliability: string; source: string }[];
  frontline: { time: string; sector: string; line: LngLat[] }[];
}

/** Снимок после хода: время и положения формирований на карте. */
export interface Snapshot {
  time: string;
  turn: number;
  units: { id: string; at: LngLat; personnel: number; tanks: number; posture: string; destroyed: boolean }[];
}

export interface RunResult {
  final: SimState;
  snapshots: Snapshot[];
}

const snap = (s: SimState): Snapshot => ({
  time: s.time, turn: s.turn,
  units: s.formations.filter((f) => onMap(f, s.time) || f.destroyed).map((f) => ({ id: f.id, at: f.position, personnel: f.personnel, tanks: f.tanks, posture: f.posture, destroyed: f.destroyed })),
});

/** Прогнать сценарий от начала до конца (или maxTurns ходов). */
export function runScenario(ctx: SimContext, seed = 1, maxTurns = Infinity): RunResult {
  let s = createState(ctx, seed);
  const snapshots = [snap(s)];
  while (s.time < ctx.scenario.end && s.turn < maxTurns) {
    s = step(s, ctx);
    snapshots.push(snap(s));
  }
  return { final: s, snapshots };
}

export interface Deviation {
  formation: string;
  time: string;
  place: string;
  reliability: string;
  approxKm: number;
  /** Расстояние от расчётного положения до исторического, км. */
  km: number;
  /** Сверх неопределённости исторического положения, км (0 — в пределах). */
  excessKm: number;
}

/**
 * Сравнить снимки с историческими положениями. Историческое положение «за день»
 * (вечер) сравнивается с первым снимком не раньше его времени.
 */
export function compareWithHistory(ctx: SimContext, run: RunResult, history: History): Deviation[] {
  const T = ctx.theatre;
  const out: Deviation[] = [];
  for (const h of history.positions) {
    if (h.time <= ctx.scenario.start || h.time > addHours(ctx.scenario.end, 12)) continue;
    const s = run.snapshots.find((x) => x.time >= h.time);
    const u = s?.units.find((x) => x.id === h.formation);
    if (!s || !u || u.destroyed) continue;
    const km = dist(T.proj.toXY(u.at), T.proj.toXY(h.at));
    out.push({ formation: h.formation, time: h.time, place: h.place, reliability: h.reliability, approxKm: h.approxKm, km: +km.toFixed(1), excessKm: +Math.max(0, km - h.approxKm).toFixed(1) });
  }
  return out;
}

/** Сводка: средние и медианные отклонения, доля в пределах допуска. */
export function summarize(devs: Deviation[], toleranceKm = 10) {
  const med = (a: number[]) => { const b = [...a].sort((x, y) => x - y); return b.length ? b[Math.floor(b.length / 2)] : 0; };
  const by = <K extends string>(key: (d: Deviation) => K) => {
    const m = new Map<K, Deviation[]>();
    for (const d of devs) m.set(key(d), [...(m.get(key(d)) ?? []), d]);
    return [...m.entries()].map(([k, l]) => ({ key: k, n: l.length, meanKm: +(l.reduce((s, d) => s + d.km, 0) / l.length).toFixed(1), medianExcessKm: med(l.map((d) => d.excessKm)), within: +(l.filter((d) => d.excessKm <= toleranceKm).length / l.length).toFixed(2) }));
  };
  return {
    n: devs.length,
    within: +(devs.filter((d) => d.excessKm <= toleranceKm).length / Math.max(1, devs.length)).toFixed(2),
    medianExcessKm: med(devs.map((d) => d.excessKm)),
    byFormation: by((d) => d.formation),
    byDay: by((d) => d.time.slice(0, 10)),
  };
}
