/** Моменты времени в редакторе: разбор, форматирование, шаги шкалы. Время — UTC (без перевода поясов). */
import { toTime, isTime, type TimeInstant } from '@def-ops/core';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const pad = (n: number) => String(n).padStart(2, '0');

/** Момент из миллисекунд: полночь — только дата, иначе дата и время до минут. */
export function fromMs(ms: number): TimeInstant {
  const d = new Date(ms);
  const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  return d.getUTCHours() || d.getUTCMinutes() ? `${date}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : date;
}

/** «25 апреля 1945» или «25 апреля 1945, 06:00». */
export function fmtMoment(t: TimeInstant | null | undefined, short = false): string {
  if (!t || !isTime(t)) return '—';
  const d = new Date(toTime(t));
  const day = short ? `${d.getUTCDate()}.${pad(d.getUTCMonth() + 1)}.${d.getUTCFullYear()}` : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return d.getUTCHours() || d.getUTCMinutes() ? `${day}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}` : day;
}

/** Значение для <input type="datetime-local"> и обратно. */
export function toInput(t: TimeInstant | null | undefined): string {
  if (!t || !isTime(t)) return '';
  const d = new Date(toTime(t));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
export function fromInput(v: string): TimeInstant | null {
  if (!v) return null;
  return isTime(v) ? fromMs(toTime(v)) : null;
}

export const HOUR = 3600_000;
export const DAY = 24 * HOUR;
