/**
 * Итоги операции по ходу агентной модели: потери сторон по суткам, фронтам и армиям (поля потерь кадра ядра —
 * выбывшие нарастающим итогом, пленные, пополнения) и исторические потери из истории сценария (числа — из базы
 * знаний, с источником и надёжностью). У старого хода (записан до учёта потерь) — оценка по убыли численности.
 * Чистые функции: их зовут фоновые потоки переигровки и игры.
 */
import type { LngLat } from '@def-ops/core';
import { postureOf, type AgentHistory, type AgentTrace } from './agents';
import { agentsEvents } from './agents-score';
import { establishmentOf } from './establishment';
import type { EventResult, History } from './history';
import { addHours, type SimContext } from './step';

/** Поля потерь кадра хода (trace::FIELDS ядра). */
export const LOSS_FIELDS = ['lost', 'lostTanks', 'lostGuns', 'captured', 'reinforced'] as const;

export interface Loss { personnel: number; tanks: number; guns: number }
type DivLoss = Loss & { captured: number; reinforced: number };

/** В ходе есть поля потерь (ход ядра с учётом потерь). */
export function hasLosses(t: AgentTrace): boolean {
  return LOSS_FIELDS.every((f) => t.fields.includes(f));
}

const ZERO = (): DivLoss => ({ personnel: 0, tanks: 0, guns: 0, captured: 0, reinforced: 0 });

/**
 * Нарастающие потери дивизии k по часам 0…upTo. Часы, когда дивизия «не введена в операцию» (ещё не введена или
 * снята с операции), не считаются: потери держатся на последнем часе в строю. Без полей потерь — оценка: сумма
 * часовых убылей людей, танков, орудий (пополнения и передачи не различаются), пленных и пополнений нет.
 */
function divisionSeries(t: AgentTrace, k: number, upTo: number): DivLoss[] {
  const F = (n: string) => t.fields.indexOf(n);
  const iState = F('state');
  const exact = hasLosses(t);
  const [iP, iT, iG] = ['personnel', 'tanks', 'guns'].map(F);
  const [iL, iLT, iLG, iC, iR] = LOSS_FIELDS.map(F);
  const out: DivLoss[] = [];
  let cur = ZERO();
  let prev: unknown[] | null = null;
  for (let h = 0; h <= upTo; h++) {
    const r = t.frames[h][k];
    const live = !String(r[iState]).startsWith('не введена');
    if (live) {
      if (exact) cur = { personnel: r[iL] as number, tanks: r[iLT] as number, guns: r[iLG] as number, captured: r[iC] as number, reinforced: r[iR] as number };
      else if (prev) {
        const drop = (i: number) => Math.max(0, (prev![i] as number) - (r[i] as number));
        cur = { personnel: cur.personnel + drop(iP), tanks: cur.tanks + drop(iT), guns: cur.guns + drop(iG), captured: 0, reinforced: 0 };
      }
      prev = r;
    } else prev = null;
    out.push(cur);
  }
  return out;
}

/** Потери дивизии k нарастающим итогом к часу h (см. divisionSeries). */
export function divisionLoss(t: AgentTrace, k: number, h: number): Loss & { captured: number; reinforced: number } {
  const hh = Math.max(0, Math.min(t.frames.length - 1, Math.round(h)));
  return divisionSeries(t, k, hh)[hh];
}

export interface LossRow {
  id: string; name: string; side: 'su' | 'de'; echelon: 'side' | 'front' | 'army'; parent: string | null;
  total: Loss; captured: number; reinforced: number;
  /** По суткам от начала хода: сутки i — часы (24 i, min(24 (i + 1), upTo)]. */
  byDay: Loss[];
}
export interface LossSeries { exact: boolean; upTo: number; days: string[]; rows: LossRow[] }

const SIDE_NAME: Record<'su' | 'de', string> = { su: 'Советская сторона', de: 'Немецкая сторона' };

/**
 * Потери по суткам: строки сторон (id 'su' / 'de'), фронтов (групп армий) и армий. Дивизия идёт в армию-предка по
 * подчинению (корпус → армия), без армии — во фронт, без фронта — только в сторону.
 */
export function lossSeries(t: AgentTrace, upTo = t.frames.length - 1): LossSeries {
  const end = Math.max(0, Math.min(t.frames.length - 1, Math.round(upTo)));
  const nDays = Math.max(1, Math.ceil(end / 24));
  const days = Array.from({ length: nDays }, (_, i) => addHours(t.start, 24 * i).slice(0, 10));
  const hq = new Map(t.hqs.map((h) => [h.id, h]));
  const up = (from: string, echelon: string): string | null => {
    for (let p: string | null = from, n = 0; p && n < 10; p = hq.get(p)?.parent ?? null, n++) if (hq.get(p)?.echelon === echelon) return p;
    return null;
  };
  const rows = new Map<string, LossRow>();
  const row = (id: string, name: string, side: 'su' | 'de', echelon: LossRow['echelon'], parent: string | null): LossRow => {
    let r = rows.get(id);
    if (!r) rows.set(id, r = { id, name, side, echelon, parent, total: { personnel: 0, tanks: 0, guns: 0 }, captured: 0, reinforced: 0, byDay: days.map(() => ({ personnel: 0, tanks: 0, guns: 0 })) });
    return r;
  };
  row('su', SIDE_NAME.su, 'su', 'side', null);
  row('de', SIDE_NAME.de, 'de', 'side', null);
  t.divisions.forEach((d, k) => {
    const side = d.side === 'de' ? 'de' : 'su';
    const front = up(d.hq, 'front'), army = up(d.hq, 'army');
    const targets = [row(side, SIDE_NAME[side], side, 'side', null)];
    if (front) targets.push(row(front, hq.get(front)!.name, side, 'front', side));
    if (army) targets.push(row(army, hq.get(army)!.name, side, 'army', front ?? side));
    const s = divisionSeries(t, k, end);
    const last = s[end];
    for (const r of targets) {
      r.total.personnel += last.personnel; r.total.tanks += last.tanks; r.total.guns += last.guns;
      r.captured += last.captured; r.reinforced += last.reinforced;
      for (let i = 0; i < nDays; i++) {
        const a = s[Math.min(24 * i, end)], b = s[Math.min(24 * (i + 1), end)];
        r.byDay[i].personnel += b.personnel - a.personnel; r.byDay[i].tanks += b.tanks - a.tanks; r.byDay[i].guns += b.guns - a.guns;
      }
    }
  });
  const round = (l: Loss) => { l.personnel = Math.round(l.personnel); l.tanks = Math.round(l.tanks); l.guns = Math.round(l.guns); };
  for (const r of rows.values()) { round(r.total); r.byDay.forEach(round); r.captured = Math.round(r.captured); r.reinforced = Math.round(r.reinforced); }
  return { exact: hasLosses(t), upTo: end, days, rows: [...rows.values()] };
}

/** Исторические потери: сторона ('su' / 'de') или штаб, период, числа, источник и надёжность (запись базы знаний — kb). */
export interface HistoricalLoss {
  scope: string; from?: string; to: string;
  irrecoverable?: number; sanitary?: number; total?: number; killed?: number; captured?: number; tanks?: number; guns?: number; perDay?: number;
  source: string; reliability: 'A' | 'B' | 'C'; kb?: string; note?: string;
}

/** Исторические потери из истории сценария: потери операции (operationLosses) и сверочные потери штабов (losses). */
export function historicalLosses(h: AgentHistory): HistoricalLoss[] {
  return [
    ...(h.operationLosses ?? []),
    ...(h.losses ?? []).map((l): HistoricalLoss => ({ scope: l.formation, to: l.until, total: l.value, source: l.source, reliability: l.reliability })),
  ];
}

/** Объект операции — центр Берлина (как у командования: OBJECTIVE_AT.berlin). */
export const OBJECTIVE: LngLat = [13.3777, 52.5186];

/** Расстояние по дуге большого круга, км. */
function km(a: LngLat, b: LngLat): number {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLng = (b[0] - a[0]) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
}
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Часы суток хода: 0, 24, 48 … и последний час, если ход не кончается ровно сутками. */
function dayHours(t: AgentTrace): number[] {
  const last = t.frames.length - 1;
  const out: number[] = [];
  for (let h = 0; h < last; h += 24) out.push(h);
  out.push(last);
  return out;
}
/** Час суток i с учётом upTo: впереди upTo — первые такие сутки берут час upTo, дальше — null. */
function hourAt(hours: number[], i: number, upTo: number): number | null {
  if (hours[i] <= upTo) return hours[i];
  return i > 0 && hours[i - 1] < upTo ? upTo : null;
}
/** Дивизия в строю: введена в операцию и не выбыла (не «небоеспособна», не сведена в другую). */
const inLine = (state: unknown) => { const p = postureOf(String(state)); return p !== null && p !== 'destroyed'; };

/** Удаление фронта от объекта по суткам: игра (центр дивизий фронта в строю) и история (среднее положений армий). */
export interface DistanceRow { hq: string; name: string; game: (number | null)[]; history: (number | null)[] }

/**
 * Удаление советских фронтов от объекта, км, по суткам: game[i] — от центра дивизий фронта в строю на часе суток i
 * (впереди upTo — null), history[i] — от среднего исторических положений армий фронта той же даты (нет — null).
 */
export function distanceSeries(t: AgentTrace, h: AgentHistory, upTo = t.frames.length - 1, objective: LngLat = OBJECTIVE): { days: string[]; rows: DistanceRow[] } {
  const hours = dayHours(t);
  const days = hours.map((x) => addHours(t.start, x).slice(0, 10));
  const hq = new Map(t.hqs.map((x) => [x.id, x]));
  const frontOf = (from: string): string | null => {
    for (let p: string | null = from, n = 0; p && n < 10; p = hq.get(p)?.parent ?? null, n++) if (hq.get(p)?.echelon === 'front') return p;
    return null;
  };
  const [iLng, iLat, iState] = ['lng', 'lat', 'state'].map((n) => t.fields.indexOf(n));
  const fronts = t.hqs.filter((x) => x.side === 'su' && x.echelon === 'front');
  const rows: DistanceRow[] = [];
  for (const f of fronts) {
    const ks = t.divisions.map((d, k) => (d.side === 'su' && frontOf(d.hq) === f.id ? k : -1)).filter((k) => k >= 0);
    if (!ks.length) continue;
    const game = hours.map((_, i) => {
      const hh = hourAt(hours, i, upTo);
      if (hh == null) return null;
      const live = ks.map((k) => t.frames[hh][k]).filter((r) => inLine(r[iState]));
      if (!live.length) return null;
      const c: LngLat = [live.reduce((a, r) => a + (r[iLng] as number), 0) / live.length, live.reduce((a, r) => a + (r[iLat] as number), 0) / live.length];
      return r1(km(c, objective));
    });
    const armies = (h.armies ?? []).filter((a) => (hq.has(a.formation) ? frontOf(a.formation) === f.id : false));
    const history = days.map((d) => {
      const p = armies.filter((a) => a.time.slice(0, 10) === d);
      if (!p.length) return null;
      return r1(km([p.reduce((a, x) => a + x.at[0], 0) / p.length, p.reduce((a, x) => a + x.at[1], 0) / p.length], objective));
    });
    rows.push({ hq: f.id, name: f.name, game, history });
  }
  return { days, rows };
}

/** Силы стороны по суткам: людей и дивизий в строю, укомплектованность «от штата» (по дивизиям, у которых штат есть). */
export interface SideTotals { strength0: number; strength: number[]; divisions: number[]; manningFromTable: number[] | null }

/** Силы сторон по суткам хода до upTo (сутки впереди upTo не считаются). */
export function sideTotals(t: AgentTrace, upTo = t.frames.length - 1): Record<'su' | 'de', SideTotals> {
  const hours = dayHours(t);
  const [iState, iP] = ['state', 'personnel'].map((n) => t.fields.indexOf(n));
  const sideOf = (s: string): 'su' | 'de' => (s === 'de' ? 'de' : 'su');
  const staff = t.divisions.map((d) => establishmentOf(sideOf(d.side), d.kind)?.personnel ?? null);
  const at = hours.map((_, i) => hourAt(hours, i, upTo)).filter((x): x is number => x != null);
  const out = {} as Record<'su' | 'de', SideTotals>;
  for (const side of ['su', 'de'] as const) {
    const ks = t.divisions.map((d, k) => (sideOf(d.side) === side ? k : -1)).filter((k) => k >= 0);
    const live = (hh: number) => ks.filter((k) => inLine(t.frames[hh][k][iState]));
    const pers = (hh: number, l: number[]) => Math.round(l.reduce((a, k) => a + (t.frames[hh][k][iP] as number), 0));
    const withStaff = ks.some((k) => staff[k] != null);
    out[side] = {
      strength0: pers(0, live(0)),
      strength: at.map((hh) => pers(hh, live(hh))),
      divisions: at.map((hh) => live(hh).length),
      manningFromTable: withStaff ? at.map((hh) => {
        const l = live(hh).filter((k) => staff[k] != null);
        const st = l.reduce((a, k) => a + staff[k]!, 0);
        return st ? +(pers(hh, l) / st).toFixed(3) : 0;
      }) : null,
    };
  }
  return out;
}

/** Итоги операции по ходу: потери сторон, события, удаление фронтов от объекта, силы сторон по суткам. */
export interface OperationSummary {
  version: 1; scenario: string; seed: number; start: string;
  /** Последний учтённый час хода; over — операция (игра) закончена. */
  upTo: number; over: boolean;
  losses: LossSeries;
  history: { losses: HistoricalLoss[] };
  /** События операции — та же функция, что у мерила сходства (agentsEvents), по ходу до upTo. */
  events: EventResult[];
  distance: { days: string[]; rows: DistanceRow[] };
  sides: Record<'su' | 'de', SideTotals>;
}

export function operationSummary(base: SimContext, t: AgentTrace, h: AgentHistory, baseHistory: History | null, o: { upTo?: number; over?: boolean } = {}): OperationSummary {
  const last = t.frames.length - 1;
  const upTo = Math.max(0, Math.min(last, Math.round(o.upTo ?? last)));
  // события — по ходу до upTo: впереди сыгранного ничего не «случилось»
  const cut = upTo < last ? { ...t, hours: upTo, frames: t.frames.slice(0, upTo + 1) } : t;
  return {
    version: 1, scenario: t.scenario, seed: t.seed, start: t.start, upTo, over: o.over ?? true,
    losses: lossSeries(t, upTo), history: { losses: historicalLosses(h) },
    events: agentsEvents(base, cut, h, baseHistory), distance: distanceSeries(t, h, upTo), sides: sideTotals(t, upTo),
  };
}
