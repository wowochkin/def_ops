/**
 * Оценка выставочного сеанса по трём осям против истории своего фронта и звание по их сумме.
 *
 * Скорость — средний сдвиг ключевых событий фронта против исторических дат: несостоявшееся событие, чья дата в истории
 * уже прошла, считается опоздавшим на всё прошедшее время. Цена — потери фронта (личный состав) против эталона —
 * потерь того же фронта в ходе «как было» на тот же час. Замысел — доля состоявшихся ключевых событий из тех, что к
 * этому часу уже случились в истории (или случились в ходе). Каждая ось — от −1 (много хуже истории) до +1.
 */
import type { EventResult } from '@def-ops/sim';

export interface Axes { speed: number; cost: number; intent: number }
export interface AxesDetail extends Axes {
  /** Средний сдвиг ключевых событий, сут (+ — позже истории); null — ни одно ещё не наступило. */
  days: number | null;
  /** Потери против эталона (1 — как в истории); null — эталона нет. */
  lossRatio: number | null;
  done: number;
  due: number;
}

const DAY = 86_400_000;
const clamp = (x: number) => Math.max(-1, Math.min(1, x)) + 0;
const dayOf = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);

/** Сутки, на которые сдвиг скорости даёт полную шкалу. */
export const SPEED_FULL_DAYS = 3;
/** Доля потерь сверх эталона (или ниже), дающая полную шкалу цены. */
export const COST_FULL_SHARE = 0.3;

/**
 * Оси на момент `now` (ISO, время хода): ключевые события `keys`, потери фронта `loss` и эталон `refLoss` на тот же час.
 */
export function axes(events: EventResult[], keys: string[], now: string, loss: number, refLoss: number | null): AxesDetail {
  const t = dayOf(now);
  const shifts: number[] = [];
  let done = 0;
  let due = 0;
  for (const id of keys) {
    const e = events.find((x) => x.id === id);
    if (!e) continue;
    if (e.simulated !== null && e.days !== null) {
      done++;
      due++;
      shifts.push(e.days);
    } else if (dayOf(e.historical) < t) {
      due++;
      shifts.push(Math.round((t - dayOf(e.historical)) / DAY));
    }
  }
  const days = shifts.length ? shifts.reduce((a, b) => a + b, 0) / shifts.length : null;
  const lossRatio = refLoss && refLoss > 0 ? loss / refLoss : null;
  return {
    speed: days === null ? 0 : clamp(-days / SPEED_FULL_DAYS),
    cost: lossRatio === null ? 0 : clamp((1 - lossRatio) / COST_FULL_SHARE),
    intent: due ? clamp((2 * done) / due - 1) : 0,
    days,
    lossRatio,
    done,
    due,
  };
}

export const RANKS = [
  { min: 1.5, title: 'Маршал Советского Союза' },
  { min: 0.5, title: 'Генерал армии' },
  { min: -0.5, title: 'Генерал-полковник' },
  { min: -1.5, title: 'Генерал-лейтенант' },
  { min: -Infinity, title: 'Генерал-майор' },
] as const;

export const axesSum = (a: Axes) => a.speed + a.cost + a.intent;
export const rankOf = (a: Axes) => RANKS.find((r) => axesSum(a) >= r.min)!.title;

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
/** «29 апреля». */
export const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]}`;

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}
/** «на три дня раньше истории», «в срок, как в истории». */
export function shiftText(days: number): string {
  const d = Math.round(Math.abs(days));
  if (d === 0) return 'в тот же день, что и в истории';
  const words = ['', 'день', 'два дня', 'три дня', 'четыре дня'];
  const n = d < words.length ? words[d] : `${d} ${plural(d, 'день', 'дня', 'дней')}`;
  return `на ${n} ${days < 0 ? 'раньше' : 'позже'} истории`;
}

/** Прогноз по ходу: «Берлин пал бы 29 апреля — на три дня раньше истории». */
export function forecast(events: EventResult[], berlinEvent: string): string {
  const e = events.find((x) => x.id === berlinEvent);
  if (!e) return '';
  if (e.simulated === null || e.days === null) return `К концу расчёта Берлин не пал бы (в истории — ${dayMonth(e.historical)})`;
  return `Берлин пал бы ${dayMonth(e.simulated)} — ${shiftText(e.days)}`;
}

/** Строки хода за отрезок (from, to]: события, состоявшиеся в расчёте за это время, — с датой и сравнением с историей. */
export function feedLines(before: EventResult[], after: EventResult[]): string[] {
  const was = new Set(before.filter((e) => e.simulated !== null).map((e) => e.id));
  return after
    .filter((e) => e.simulated !== null && !was.has(e.id))
    .sort((a, b) => a.simulated!.localeCompare(b.simulated!))
    .map((e) => `${dayMonth(e.simulated!)} — ${e.title} (${e.days === 0 ? 'как в истории' : `в истории — ${dayMonth(e.historical)}`})`);
}

/** Подпись оси для шкалы. */
export function axisNote(kind: keyof Axes, d: AxesDetail): string {
  if (kind === 'speed') return d.days === null ? 'события ещё впереди' : Math.abs(d.days) < 0.5 ? 'как в истории' : `${d.days < 0 ? 'быстрее' : 'медленнее'} истории на ${Math.abs(d.days).toFixed(1).replace('.', ',')} сут`;
  if (kind === 'cost') return d.lossRatio === null ? 'нет эталона' : Math.abs(d.lossRatio - 1) < 0.03 ? 'как в истории' : `потери ${d.lossRatio < 1 ? 'меньше' : 'больше'} истории на ${Math.round(Math.abs(d.lossRatio - 1) * 100)} %`;
  return d.due ? `выполнено ${d.done} из ${d.due}` : 'задачи впереди';
}
