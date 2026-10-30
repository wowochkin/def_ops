/**
 * Ветви игры: возврат к ходу не стирает сыгранное — прежняя линия остаётся ветвью, к ней можно вернуться. Всё лежит в
 * одной записи def_ops.game (record — текущая линия, branches — остальные); чистые функции над записью.
 */
import type { GameRecord, GameTurn } from '@def-ops/sim';
import { commonPrefix } from './sim/game-rewind';
import type { EnemyMode } from './sim/game-protocol';

export interface SavedBranch {
  id: string;
  name: string;
  /** Ход N, с которого линия расходится с текущей. */
  from: number;
  /** Начало хода N, время игры. */
  at: string;
  /** Когда сохранена (ISO). */
  created: string;
  /** Все ходы линии. */
  turns: GameTurn[];
  enemy: EnemyMode;
}
export interface SavedGame {
  record: GameRecord; enemy: EnemyMode; title: string; turn: string;
  branches?: SavedBranch[];
  /** Имя текущей линии; нет — MAIN_LINE. */
  line?: string;
}
export const MAIN_LINE = 'основная линия';
export const QUOTA_TEXT = 'Запись игры не сохранилась: в хранилище окна нет места. Удалите лишние ветви.';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «ветвь от хода 5 (18 апреля, 06:00)»; имя занято — « — 2», « — 3». */
export function branchName(n: number, at: string, taken: string[]): string {
  const base = `ветвь от хода ${n} (${+at.slice(8, 10)} ${MONTHS[+at.slice(5, 7) - 1]}, ${at.slice(11, 16)})`;
  let name = base;
  for (let k = 2; taken.includes(name); k++) name = `${base} — ${k}`;
  return name;
}

const newId = (taken: string[], now: string) => {
  let id = `b${Date.parse(now) || 0}`;
  for (let k = 2; taken.includes(id); k++) id = `b${Date.parse(now) || 0}-${k}`;
  return id;
};

/** Ход записи (время начала последнего хода или передача командования) — как пишет CommandView. */
export const turnOf = (r: GameRecord): string => (r.turns.length ? r.turns[r.turns.length - 1].time : r.takeover).slice(0, 16);

/**
 * Возврат к ходу n: снятые ходы tail остаются ветвью (линия = первые n − 1 ходов + tail). Такая линия уже есть среди
 * ветвей — новой не делается; tail пуст — нечего хранить.
 */
export function forkBranch(s: SavedGame, n: number, at: string, tail: GameTurn[], now: string): SavedGame {
  if (!tail.length) return s;
  const kept = s.record.turns.slice(0, n - 1);
  const old = [...kept, ...tail];
  const branches = s.branches ?? [];
  if (branches.some((b) => { const c = commonPrefix(b.turns, old); return c === b.turns.length && c === old.length; })) {
    return { ...s, record: { ...s.record, turns: kept } };
  }
  const name = branchName(n, at, [s.line ?? MAIN_LINE, ...branches.map((b) => b.name)]);
  const b: SavedBranch = { id: newId(branches.map((x) => x.id), now), name, from: n, at, created: now, turns: old, enemy: s.enemy };
  return { ...s, record: { ...s.record, turns: kept }, branches: [...branches, b] };
}

/** Перейти на ветвь: текущая линия уходит в ветви (под именем линии), выбранная становится записью; ничего не теряется. */
export function checkoutBranch(s: SavedGame, id: string): SavedGame {
  const branches = s.branches ?? [];
  const b = branches.find((x) => x.id === id);
  if (!b) return s;
  const cp = commonPrefix(s.record.turns, b.turns);
  const old: SavedBranch = {
    id: b.id, name: s.line ?? MAIN_LINE, from: cp + 1, created: b.created,
    at: s.record.turns[cp]?.time ?? b.turns[cp]?.time ?? s.turn, turns: s.record.turns, enemy: s.enemy,
  };
  const record = { ...s.record, turns: b.turns };
  return { ...s, record, enemy: b.enemy, line: b.name, turn: turnOf(record), branches: branches.map((x) => (x.id === id ? old : x)) };
}

/** Линии игры: текущая первой (id: null), затем ветви по времени сохранения. */
export function lines(s: SavedGame): { id: string | null; name: string; turns: number; from: number | null; current: boolean }[] {
  const rest = [...(s.branches ?? [])].sort((a, b) => a.created.localeCompare(b.created))
    .map((b) => ({ id: b.id as string | null, name: b.name, turns: b.turns.length, from: b.from as number | null, current: false }));
  return [{ id: null, name: s.line ?? MAIN_LINE, turns: s.record.turns.length, from: null, current: true }, ...rest];
}

/** Новая запись игры при смене хода: ветви и имя линии — из прежней записи. */
export function withRecord(prev: SavedGame | null, record: GameRecord, enemy: EnemyMode, title: string, turn: string): SavedGame {
  return { record, enemy, title, turn, ...(prev?.branches ? { branches: prev.branches } : {}), ...(prev?.line ? { line: prev.line } : {}) };
}

/** Записать игру; не вышло (хранилище окна переполнено) — текст для уведомления, иначе null. */
export function storeGame(st: Pick<Storage, 'setItem'>, key: string, s: SavedGame): string | null {
  try { st.setItem(key, JSON.stringify(s)); return null; } catch { return QUOTA_TEXT; }
}
