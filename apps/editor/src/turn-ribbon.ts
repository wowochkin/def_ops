/**
 * Лента ходов игры (TurnRibbon.tsx): по записи игры и журналу — номер хода, начало хода, краткий итог (первое донесение
 * дня без служебных строк) и развилки — ветви, что расходятся с текущей линией на этом ходу. Чистые функции.
 */
import type { GameRecord } from '@def-ops/sim';
import type { JournalDay } from './sim/game-protocol';
import type { SavedBranch } from './game-branches';

export interface RibbonItem {
  n: number;
  /** Начало хода, время игры. */
  time: string;
  /** «5 · 18.04 06:00». */
  label: string;
  summary: string;
  current: boolean;
  forks: { id: string; name: string }[];
}

/** Служебные строки журнала (управление, приказы, неисполненное) — не итог хода. */
const SERVICE = /^(?:Управление:|Приказ |Распоряжение не исполнено|Команда не исполнена)/;
const MAX = 70;

/** Краткий итог хода: первое донесение дня (не служебное), до 70 знаков. */
export function turnSummary(day: JournalDay | undefined): string {
  if (!day) return 'текущий ход';
  const e = day.events.map((x) => x.trim()).find((x) => x && !SERVICE.test(x));
  if (!e) return 'без существенных событий';
  return e.length > MAX ? `${e.slice(0, MAX - 1).trimEnd()}…` : e;
}

const key = (t: string) => t.slice(0, 16);
const label = (n: number, t: string) => `${n} · ${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`;

/** Ходы 1…(сыграно + 1): сыгранные — по записи и журналу, последний — текущий (now — его начало). */
export function ribbonItems(record: GameRecord, journal: JournalDay[], now: string, branches: SavedBranch[]): RibbonItem[] {
  const times = [...record.turns.map((t) => t.time), now];
  return times.map((time, i) => {
    const n = i + 1, current = i === times.length - 1;
    return {
      n, time: key(time), label: label(n, time), current,
      // сыгранный ход без дня в журнале (старая запись) — без событий, а не «текущий ход»
      summary: turnSummary(current ? undefined : journal.find((d) => key(d.time) === key(time)) ?? { time, orders: [], actions: [], events: [] }),
      forks: branches.filter((b) => b.from === n).map((b) => ({ id: b.id, name: b.name })),
    };
  });
}
