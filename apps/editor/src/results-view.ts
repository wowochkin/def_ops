/**
 * Вкладка «Итоги» без React: части вкладки, состояние «переигровки без вмешательства», пояснения части «Потери» и
 * сравнение потерь среднесуточно (периоды расчёта и истории разные).
 */
import type { HistoricalLoss, OperationSummary } from '@def-ops/sim';

/** Части вкладки: разбор хода (в игре), потери сторон, сравнение с историей. */
export type ResultsPart = 'turn' | 'losses' | 'compare';
export const PART_TITLE: Record<ResultsPart, string> = { turn: 'Разбор хода', losses: 'Потери', compare: 'Сравнение' };

/** Переигровка без вмешательства того же сценария и seed — для сравнения. */
export type BaselineState = { state: 'off' } | { state: 'wait' } | { state: 'ready'; summary: OperationSummary } | { state: 'error'; text: string };

export const ESTIMATE_NOTE = 'оценка по убыли численности: ход записан до учёта потерь — пополнения и передачи не различаются';
export const NO_HISTORY_NOTE = 'Исторических потерь этой операции в базе знаний нет';

/** Пояснения части «Потери»: оценка для старого хода; исторических потерь нет. */
export function lossesNote(s: OperationSummary): string[] {
  const out: string[] = [];
  if (!s.losses.exact) out.push(ESTIMATE_NOTE);
  if (!s.history.losses.length) out.push(NO_HISTORY_NOTE);
  return out;
}

/** Суток в периоде истории (оба конца включительно). */
export function histDays(h: HistoricalLoss): number | null {
  if (!h.from) return null;
  const d = (x: string) => Date.parse(`${x.slice(0, 10)}T00:00Z`);
  return Math.round((d(h.to) - d(h.from)) / 86400000) + 1;
}
/** Люди в исторической строке: всего, иначе безвозвратные + санитарные, иначе убитые + пленные; нет — null. */
export function histPeople(h: HistoricalLoss): number | null {
  if (h.total != null) return h.total;
  if (h.irrecoverable != null || h.sanitary != null) return (h.irrecoverable ?? 0) + (h.sanitary ?? 0);
  if (h.killed != null || h.captured != null) return (h.killed ?? 0) + (h.captured ?? 0);
  return null;
}
/** Историческая убыль людей в сутки: среднесуточная по источнику, иначе люди / сутки периода. */
export function histPerDay(h: HistoricalLoss): number | null {
  if (h.perDay != null) return h.perDay;
  const p = histPeople(h), n = histDays(h);
  return p != null && n ? Math.round(p / n) : null;
}
/** Расчётная убыль людей стороны в сутки: за сколько суток посчитано и сколько в среднем. */
export function sidePerDay(s: OperationSummary, scope: string): { days: number; perDay: number } | null {
  const r = s.losses.rows.find((x) => x.id === scope);
  if (!r) return null;
  const days = Math.max(0.1, Math.round((s.losses.upTo / 24) * 10) / 10);
  return { days, perDay: Math.round(r.total.personnel / days) };
}
/** Исторические строки по стороне или штабу. */
export function historyOf(s: OperationSummary, scope: string): HistoricalLoss[] {
  return s.history.losses.filter((h) => h.scope === scope);
}
/** Первая историческая строка стороны с людьми — для сравнения в сутки. */
export function sideHistory(s: OperationSummary, side: 'su' | 'de'): HistoricalLoss | null {
  return historyOf(s, side).find((h) => histPeople(h) != null) ?? null;
}
/** Что в исторической строке словами (числа с пробелами): «безвозвратные 78 291, санитарные 274 184, всего 352 475». */
export function histText(h: HistoricalLoss): string {
  const n = (x: number) => x.toLocaleString('ru-RU');
  const parts: string[] = [];
  if (h.irrecoverable != null) parts.push(`безвозвратные ${n(h.irrecoverable)}`);
  if (h.sanitary != null) parts.push(`санитарные ${n(h.sanitary)}`);
  if (h.killed != null) parts.push(`убито ${n(h.killed)}`);
  if (h.captured != null) parts.push(`пленных ${n(h.captured)}`);
  if (h.total != null) parts.push(`${parts.length ? 'всего ' : ''}${n(h.total)} чел.`);
  if (h.tanks != null) parts.push(`танков и САУ ${n(h.tanks)}`);
  if (h.guns != null) parts.push(`орудий и миномётов ${n(h.guns)}`);
  return parts.join(', ');
}
/** Период исторической строки: «16.04–08.05» или «к 01.05». */
export function histPeriod(h: HistoricalLoss): string {
  const dm = (x: string) => `${x.slice(8, 10)}.${x.slice(5, 7)}`;
  return h.from ? `${dm(h.from)}–${dm(h.to)}` : `к ${dm(h.to)}`;
}
