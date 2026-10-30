/**
 * Итоги операции по ходу агентной модели: потери сторон по суткам, фронтам и армиям (поля потерь кадра ядра —
 * выбывшие нарастающим итогом, пленные, пополнения) и исторические потери из истории сценария (числа — из базы
 * знаний, с источником и надёжностью). У старого хода (записан до учёта потерь) — оценка по убыли численности.
 * Чистые функции: их зовут фоновые потоки переигровки и игры.
 */
import type { AgentHistory, AgentTrace } from './agents';
import type { History } from './history';
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

/** Итоги операции по ходу: потери сторон (задача событий и удаления от объекта дописывается к этому же типу). */
export interface OperationSummary {
  version: 1; scenario: string; seed: number; start: string;
  /** Последний учтённый час хода; over — операция (игра) закончена. */
  upTo: number; over: boolean;
  losses: LossSeries;
  history: { losses: HistoricalLoss[] };
}

export function operationSummary(base: SimContext, t: AgentTrace, h: AgentHistory, baseHistory: History | null, o: { upTo?: number; over?: boolean } = {}): OperationSummary {
  void base; void baseHistory; // события и удаление от объекта — по контексту и истории сценария
  const last = t.frames.length - 1;
  const upTo = Math.max(0, Math.min(last, Math.round(o.upTo ?? last)));
  return { version: 1, scenario: t.scenario, seed: t.seed, start: t.start, upTo, over: o.over ?? upTo >= last, losses: lossSeries(t, upTo), history: { losses: historicalLosses(h) } };
}
