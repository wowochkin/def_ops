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
  /** Ключевые события с историческими датами — проверка «случилось ли и когда». */
  events?: HistoryEvent[];
}

export type HistoryEvent = { id: string; title: string; date: string; source?: string } & (
  | { kind: 'reach'; side: string; place: string; radiusKm: number; /** взято: в радиусе нет боеспособных частей противника */ control?: boolean }
  | { kind: 'cut'; formation?: string; formations?: string[] }
  | { kind: 'meet'; formations: string[]; place: string; radiusKm: number }
);

export interface EventResult {
  id: string;
  title: string;
  historical: string;
  /** Дата в расчёте (null — не случилось). */
  simulated: string | null;
  /** Расхождение в сутках (+ — позже истории); null — не случилось. */
  days: number | null;
}

/** Когда в расчёте произошли ключевые события (по снимкам и журналу). */
export function checkEvents(ctx: SimContext, run: RunResult, history: History): EventResult[] {
  const T = ctx.theatre;
  return (history.events ?? []).map((e) => {
    let when: string | null = null;
    if (e.kind === 'reach') {
      const c = T.area(e.place)?.center;
      const side = new Set(run.final.formations.filter((f) => f.side === e.side).map((f) => f.id));
      const near = (u: Snapshot['units'][number]) => !u.destroyed && dist(T.proj.toXY(u.at), T.proj.toXY(c!)) <= e.radiusKm;
      for (const s of run.snapshots) {
        if (c && s.units.some((u) => side.has(u.id) && near(u)) && !(e.control && s.units.some((u) => !side.has(u.id) && near(u)))) { when = s.time; break; }
      }
    } else if (e.kind === 'meet') {
      const c = T.area(e.place)?.center;
      for (const s of run.snapshots) {
        if (c && e.formations.every((id) => s.units.some((u) => u.id === id && !u.destroyed && dist(T.proj.toXY(u.at), T.proj.toXY(c)) <= e.radiusKm))) { when = s.time; break; }
      }
    } else {
      // окружено (или уничтожено) хотя бы одно из перечисленных
      const ids = new Set(e.formations ?? (e.formation ? [e.formation] : []));
      const j = run.final.journal.find((x) => (x.kind === 'encircled' && ids.has(x.formation) && x.cut) || (x.kind === 'destroyed' && ids.has(x.formation)));
      when = j ? j.time : null;
    }
    // снимок — на утро; событие «дня» — день перед ним
    const day = when ? addHours(when, -12).slice(0, 10) : null;
    const days = day ? Math.round((Date.parse(day) - Date.parse(e.date)) / 86400000) : null;
    return { id: e.id, title: e.title, historical: e.date, simulated: day, days };
  });
}

/** Снимок после хода: время и положения формирований на карте. */
export interface Snapshot {
  time: string;
  turn: number;
  units: { id: string; at: LngLat; personnel: number; tanks: number; posture: string; destroyed: boolean; cutOff?: boolean; ammo?: number }[];
}

export interface RunResult {
  final: SimState;
  snapshots: Snapshot[];
}

const snap = (s: SimState): Snapshot => ({
  time: s.time, turn: s.turn,
  units: s.formations.filter((f) => onMap(f, s.time) || f.destroyed).map((f) => ({ id: f.id, at: f.position, personnel: f.personnel, tanks: f.tanks, posture: f.posture, destroyed: f.destroyed, ...(f.cutOff ? { cutOff: true } : {}), ammo: +f.ammo.toFixed(2) })),
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
