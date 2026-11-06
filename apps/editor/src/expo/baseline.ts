/**
 * Нуль шкал стенда — ход «как было»: тот же расчёт, что три исторические карточки (приказов нет).
 * Скорость и даты «в истории» считаются от дат событий этого хода, а не от календаря 1945 года:
 * отставание модели от календаря есть и у базы, в оценку посетителя оно не входит.
 * Цена и так сравнивается с потерями этого хода.
 */
import type { EventResult } from '@def-ops/sim';

/** Сдвиг события базы против календаря и дата, когда оно в базе случилось. */
let shifts: Record<string, { days: number | null; at: string | null }> | null = null;

const addDays = (iso: string, days: number) => {
  const t = Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + Math.round(days) * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
};

/** Запомнить даты событий хода «как было». Пустой набор не затирает уже известную базу. */
export function setExpoBaseline(events: EventResult[]) {
  const next: Record<string, { days: number | null; at: string | null }> = {};
  for (const e of events) next[e.id] = { days: e.days, at: e.simulated?.slice(0, 10) ?? null };
  if (events.length) shifts = next;
}

/** Когда событие случилось в базе (дата) или не случилось (`null`). Нет записи — база ещё не посчитана. */
export function baselineAt(id: string): string | null | undefined {
  if (!shifts) return undefined;
  return shifts[id]?.at ?? null;
}
export function clearExpoBaseline() {
  shifts = null;
}

/**
 * События сеанса относительно базы. `days` — разница с ходом «как было», не с календарём.
 * Дата `historical` сдвигается на тот же сдвиг: «в истории» на экране — дата базы.
 */
export function rebaseEvents(events: EventResult[]): EventResult[] {
  if (!shifts) return events;
  return events.map((e) => {
    const shift = shifts![e.id];
    if (!shift || shift.days === null) return e;
    return {
      ...e,
      days: e.days === null ? null : e.days - shift.days,
      historical: shift.days === 0 ? e.historical : addDays(e.historical, shift.days),
    };
  });
}
