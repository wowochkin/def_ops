/**
 * Прогон сценария и сравнение с историей: где и насколько расчёт разошёлся с
 * историческими положениями (с учётом их неопределённости).
 */
import type { LngLat } from '@def-ops/core';
import { dist } from './geo';
import { createState, onMap, step, addHours, type SimContext } from './step';
import type { SimState, UmpireMod } from './types';

export interface History {
  scenario: string;
  positions: { formation: string; time: string; at: LngLat; approxKm: number; place: string; reliability: string; source: string }[];
  frontline: { time: string; sector: string; line: LngLat[] }[];
  /** Ключевые события с историческими датами — проверка «случилось ли и когда». */
  events?: HistoryEvent[];
  /** Документальные контрольные точки численности и потерь (из базы знаний) — сверка с расчётом (compareStrength). */
  checkpoints?: StrengthCheckpoint[];
}

/** Контрольная точка по документу: численность на момент at или накопленные потери за [from, at]. */
export type StrengthCheckpoint =
  | { at: string; formation: string; kind: 'strength'; personnel?: number; tanks?: number; guns?: number }
  /** накопленные потери за [from, at]: personnel — люди */
  | { at: string; formation: string; kind: 'losses'; from: string; personnel: number; tanks?: number };

/**
 * Сверка численности и потерь (допущения без опоры, norms.json: assume-strength-tolerance, assume-strength-weight):
 * точка в допуске — ошибка не больше STRENGTH_TOL от документа; в мерило калибровки и итог агентной модели сверка
 * входит с весом STRENGTH_WEIGHT, если точек не меньше STRENGTH_MIN_POINTS.
 */
export const STRENGTH_TOL = 0.25;
export const STRENGTH_WEIGHT = 0.25;
export const STRENGTH_MIN_POINTS = 10;

export interface StrengthComparison {
  /** Сверено точек; доля в допуске; медиана относительной ошибки. */
  n: number;
  within: number;
  medianRel: number;
  /** По формированиям: точек, доля в допуске, медиана относительной ошибки. */
  byFormation: { key: string; n: number; within: number; medianRel: number }[];
}

/**
 * Сверка численности и потерь с документами по снимкам прогона (снимок — первый не раньше момента точки).
 * strength — |расч − док| / док по людям; losses — накопленные потери расчёта за [from, at] (люди на from +
 * пополнения и полученное при выделении − выделенное из него − люди на at; дата без времени: at — конец дня, from — начало; from раньше начала — начало сценария) против документа. Точки вне
 * сценария, без людей в документе или без формирования на карте — не сверяются. В допуске — ошибка ≤ tol.
 */
export function compareStrength(ctx: SimContext, run: RunResult, history: History, tol = STRENGTH_TOL): StrengthComparison {
  const rows: { key: string; rel: number }[] = [];
  const last = addHours(ctx.scenario.end, 12);
  const unitAt = (time: string, id: string) => {
    for (const s of run.snapshots) if (s.time >= time) { const u = s.units.find((x) => x.id === id); if (u) return { time: s.time, u }; }
    return null;
  };
  // дата без времени (из базы знаний): at — конец дня (00:00 следующего), from — начало дня
  const dateOnly = (t: string) => t.length <= 10;
  for (const c of history.checkpoints ?? []) {
    const cAt = dateOnly(c.at) ? addHours(`${c.at}T00:00`, 24) : c.at;
    if (!c.personnel || c.personnel <= 0 || cAt < ctx.scenario.start || cAt > last) continue;
    const b = unitAt(cAt, c.formation);
    if (!b) continue;
    let sim: number;
    if (c.kind === 'strength') sim = b.u.personnel;
    else {
      // потери от начала сценария, если документ считает раньше; резерв — с его ввода
      const from = dateOnly(c.from) ? `${c.from}T00:00` : c.from;
      const a = unitAt(from > ctx.scenario.start ? from : ctx.scenario.start, c.formation);
      if (!a || a.time >= b.time) continue;
      // журнал хода t отражён в снимках после t: учитываем записи a.time ≤ t < b.time
      let inflow = 0;
      for (const j of run.final.journal) {
        if (j.time < a.time || j.time >= b.time) continue;
        if (j.kind === 'reinforced' && j.formation === c.formation) inflow += j.personnel;
        else if (j.kind === 'detached' && j.from === c.formation) inflow -= j.personnel;
        else if (j.kind === 'detached' && j.formation === c.formation) inflow += j.personnel; // выделено при вводе — приход
      }
      sim = a.u.personnel + inflow - b.u.personnel;
    }
    rows.push({ key: c.formation, rel: Math.abs(sim - c.personnel) / c.personnel });
  }
  const med = (a: number[]) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const share = (l: { rel: number }[]) => l.filter((r) => r.rel <= tol).length / Math.max(1, l.length);
  const by = new Map<string, number[]>();
  for (const r of rows) by.set(r.key, [...(by.get(r.key) ?? []), r.rel]);
  return {
    n: rows.length,
    within: +share(rows).toFixed(3),
    medianRel: +med(rows.map((r) => r.rel)).toFixed(3),
    byFormation: [...by.entries()].map(([key, l]) => ({ key, n: l.length, within: +share(l.map((rel) => ({ rel }))).toFixed(3), medianRel: +med(l).toFixed(3) })),
  };
}

/** Знак события на карте переигровки: появляется в момент, когда событие случилось в расчёте (и бледный — в исторический). */
export interface EventMarker { preset: string; name: string; note?: string; historicalAt?: string }

export type HistoryEvent = { id: string; title: string; date: string; source?: string; marker?: EventMarker } & (
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
  /** Момент в расчёте (снимок после хода, когда событие уже случилось); null — не случилось. */
  at: string | null;
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
      for (const s of run.snapshots.slice(1)) { // до начала сценария событие произойти не может
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
      const j = run.final.journal.find((x) => (x.kind === 'encircled' && ids.has(x.formation) && x.cut) || ((x.kind === 'destroyed' || x.kind === 'capitulated') && ids.has(x.formation)));
      when = j ? j.time : null;
    }
    // снимок — на утро; событие «дня» — день перед ним
    const day = when ? addHours(when, -12).slice(0, 10) : null;
    const days = day ? Math.round((Date.parse(day) - Date.parse(e.date)) / 86400000) : null;
    return { id: e.id, title: e.title, historical: e.date, simulated: day, days, at: when };
  });
}

/** Снимок после хода: время и положения формирований на карте. */
export interface Snapshot {
  time: string;
  turn: number;
  /** path — путь за ход (по дорогам и улицам), если формирование шло не напрямик. */
  units: { id: string; at: LngLat; personnel: number; tanks: number; posture: string; destroyed: boolean; cutOff?: boolean; ammo?: number; path?: LngLat[] }[];
  /** Территория после хода (если правила её ведут). */
  territory?: number[];
  /** Соединения, поставленные на место, а не пришедшие с прежнего снимка (состояние при передаче командования):
   *  пути между их прежним и новым местом нет — ось танковой армии после такого снимка начинается заново. */
  jumped?: string[];
}

export interface RunResult {
  final: SimState;
  snapshots: Snapshot[];
}

/** Снимок состояния после хода. */
export const snapshotOf = (s: SimState): Snapshot => {
  // пути за ход — из записей журнала о движении (бой, затем марш — склеиваются)
  const paths = new Map<string, LngLat[]>();
  for (const j of s.journal) if (j.kind === 'move') {
    const seg = j.path ?? [j.from, j.to];
    const cur = paths.get(j.formation);
    paths.set(j.formation, cur ? [...cur, ...seg.slice(1)] : seg);
  }
  return {
  time: s.time, turn: s.turn,
  units: s.formations.filter((f) => onMap(f, s.time) || f.destroyed).map((f) => { const p = paths.get(f.id); return { id: f.id, at: f.position, personnel: f.personnel, tanks: f.tanks, posture: f.posture, destroyed: f.destroyed, ...(f.cutOff ? { cutOff: true } : {}), ammo: +f.ammo.toFixed(2), ...(p && p.length > 2 ? { path: p } : {}) }; }),
  ...(s.territory ? { territory: s.territory } : {}),
  };
};

/** Прогнать сценарий от начала до конца (или maxTurns ходов). */
export function runScenario(ctx: SimContext, seed = 1, maxTurns = Infinity): RunResult {
  let s = createState(ctx, seed);
  const snapshots = [snapshotOf(s)];
  while (s.time < ctx.scenario.end && s.turn < maxTurns) {
    s = step(s, ctx);
    snapshots.push(snapshotOf(s));
  }
  return { final: s, snapshots };
}

/**
 * Прогон с поправками посредника: перед каждым ходом before(state) возвращает поправки на этот ход
 * (модель-посредник — асинхронно). Без поправок совпадает с runScenario.
 */
export async function runScenarioWith(ctx: SimContext, seed: number, before: (s: SimState) => Promise<UmpireMod[]>, maxTurns = Infinity): Promise<RunResult & { umpire: { time: string; mods: UmpireMod[] }[] }> {
  let s = createState(ctx, seed);
  const snapshots = [snapshotOf(s)];
  const umpire: { time: string; mods: UmpireMod[] }[] = [];
  while (s.time < ctx.scenario.end && s.turn < maxTurns) {
    const mods = await before(s);
    if (mods.length) umpire.push({ time: s.time, mods });
    s = step(mods.length ? { ...s, umpire: mods } : s, ctx);
    snapshots.push(snapshotOf(s));
  }
  return { final: s, snapshots, umpire };
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
