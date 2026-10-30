/**
 * Ветви игры: возврат к ходу не стирает сыгранное — прежняя линия остаётся ветвью, к ней можно вернуться. В записи
 * def_ops.game (localStorage) — текущая линия и только сведения о ветвях; ходы ветвей лежат в IndexedDB (BranchStore),
 * иначе несколько ветвей длинной игры не помещаются в квоту окна. Доктрина в ходах хранится номерами таблицы текстов.
 * Чистые функции планируют перемену, асинхронные — пишут ходы ветвей в хранилище раньше, чем запись игры меняется.
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
  /** Число ходов линии (сами ходы — в хранилище ветвей). В самых старых записях нет — тогда по turns. */
  count: number;
  /** Только в старых записях: ходы лежали здесь; при первой записи уходят в хранилище ветвей. */
  turns?: GameTurn[];
}
export interface SavedGame {
  record: GameRecord; enemy: EnemyMode; title: string; turn: string;
  branches?: SavedBranch[];
  /** Имя текущей линии; нет — MAIN_LINE. */
  line?: string;
  /** Код игры — ключ ходов её ветвей в хранилище. */
  gid?: string;
  /** Только в записанном виде: тексты доктрины, на которые ссылаются ходы номерами. */
  doctrines?: string[];
}
export const MAIN_LINE = 'основная линия';
export const QUOTA_TEXT = 'Запись игры не сохранилась: в хранилище окна нет места. Удалите лишние ветви.';

/** Ходы ветви в хранилище: доктрина номерами таблицы. */
export interface BranchPayload { turns: GameTurn[]; doctrines?: string[] }
export interface BranchStore {
  put(key: string, p: BranchPayload): Promise<void>;
  get(key: string): Promise<BranchPayload | undefined>;
  del(key: string): Promise<void>;
  /** Все ключи хранилища (для уборки ходов, на которые запись игры не ссылается); нет — уборки нет. */
  keys?(): Promise<string[]>;
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** «ветвь от хода 5 (18 апреля, 06:00)»; имя занято — « — 2», « — 3». */
export function branchName(n: number, at: string, taken: string[]): string {
  const base = `ветвь от хода ${n} (${+at.slice(8, 10)} ${MONTHS[+at.slice(5, 7) - 1]}, ${at.slice(11, 16)})`;
  let name = base;
  for (let k = 2; taken.includes(name); k++) name = `${base} — ${k}`;
  return name;
}

const newId = (taken: string[], now: string) => {
  const base = `b${Date.parse(now) || 0}`;
  let id = base;
  for (let k = 2; taken.includes(id); k++) id = `${base}-${k}`;
  return id;
};
const keyOf = (s: SavedGame, id: string) => `${s.gid}:${id}`;
const withGid = (s: SavedGame, now: string): SavedGame => (s.gid ? s : { ...s, gid: `g${Date.parse(now) || 0}` });

/** Ход записи (время начала последнего хода или передача командования) — как пишет CommandView. */
export const turnOf = (r: GameRecord): string => (r.turns.length ? r.turns[r.turns.length - 1].time : r.takeover).slice(0, 16);

// --- доктрина номерами ---------------------------------------------------------------------------------------------

type Doc = { su?: string; de?: string } | null | undefined;
type Packed = { su?: number; de?: number } | null | undefined;

/** Тексты доктрины в ходах → номера в таблице (одинаковый текст — один раз). */
export function packTurns(turns: GameTurn[]): BranchPayload {
  const table: string[] = [];
  const idx = (x: string) => { let i = table.indexOf(x); if (i < 0) { i = table.length; table.push(x); } return i; };
  const out = turns.map((t) => {
    const d = t.doctrine as Doc;
    if (!d) return t;
    const p: Packed = { ...(d.su !== undefined ? { su: idx(d.su) } : {}), ...(d.de !== undefined ? { de: idx(d.de) } : {}) };
    return { ...t, doctrine: p } as unknown as GameTurn;
  });
  return { turns: out, ...(table.length ? { doctrines: table } : {}) };
}
/** Обратно: номера → тексты. Записи без таблицы (старые) отдаются как есть. */
export function unpackTurns(p: BranchPayload): GameTurn[] {
  const table = p.doctrines;
  if (!table) return p.turns;
  return p.turns.map((t) => {
    const d = t.doctrine as unknown as Packed;
    if (!d) return t;
    const num = (v: unknown) => (typeof v === 'number' ? table[v] : (v as string | undefined));
    const su = num(d.su), de = num(d.de);
    return { ...t, doctrine: { ...(su !== undefined ? { su } : {}), ...(de !== undefined ? { de } : {}) } };
  });
}
/** Запись для хранения: ходы текущей линии с доктриной номерами, таблица — в doctrines. */
export function packGame(s: SavedGame): SavedGame {
  const { turns, doctrines } = packTurns(s.record.turns);
  const { doctrines: _old, ...rest } = s;
  return { ...rest, record: { ...s.record, turns }, ...(doctrines ? { doctrines } : {}) };
}
/** Запись из хранилища: доктрина — текстами (как в потоке игры и повторе). */
export function unpackGame(s: SavedGame): SavedGame {
  const { doctrines, ...rest } = s;
  return doctrines ? { ...rest, record: { ...s.record, turns: unpackTurns({ turns: s.record.turns, doctrines }) } } : rest;
}

// --- планирование (чистое) ----------------------------------------------------------------------------------------

/** Ходы ветви: из хранилища (или из старой записи). Нет ходов — ошибка, а не пустая линия. */
async function turnsOfBranch(store: BranchStore, s: SavedGame, b: SavedBranch): Promise<GameTurn[]> {
  if (b.turns) return b.turns;
  const p = await store.get(keyOf(s, b.id));
  if (!p) throw new Error(`ходы ветви «${b.name}» не найдены в хранилище окна`);
  return unpackTurns(p);
}
const putTurns = (store: BranchStore, key: string, turns: GameTurn[]) => store.put(key, packTurns(turns));
const meta = (b: SavedBranch): SavedBranch => { const { turns: _t, ...m } = b; return m; };
const countOf = (b: SavedBranch) => b.count ?? b.turns?.length ?? 0;
const errText = (e: unknown) => String((e as Error)?.message ?? e).replace(/[.\s]+$/, '');

/**
 * Линия line уже есть среди ветвей (кроме skip): совпадает с ветвью или с её началом — хранить её ещё раз незачем.
 * Ходы ветви не прочитались — ветвь не в счёт (лучше лишняя ветвь, чем потерянная линия).
 */
async function covered(store: BranchStore, s: SavedGame, line: GameTurn[], skip?: string): Promise<boolean> {
  for (const b of s.branches ?? []) {
    if (b.id === skip || countOf(b) < line.length) continue;
    const bt = await turnsOfBranch(store, s, b).catch(() => null);
    if (bt && commonPrefix(bt, line) === line.length) return true;
  }
  return false;
}
/** Ветвь, что расходилась с прежней линией с хода from, с новой линией расходится не позже хода n (начало — at). */
const divergeBy = (b: SavedBranch, n: number, at: string): SavedBranch => (b.from > n ? { ...b, from: n, at } : b);

/** Результат перемены: новая запись игры и ключи ходов, что после её записи больше не нужны. */
export interface Change { game: SavedGame; stale: string[] }

/**
 * Возврат к ходу n: снятые ходы tail остаются ветвью (линия = первые n − 1 ходов + tail). Такая линия уже есть среди
 * ветвей (целиком или началом ветви) — новой не делается; tail пуст — нечего хранить. Ветви, что расходились с линией
 * позже хода n, теперь расходятся с ходом n. Ходы ветви пишутся в хранилище до возврата записи; хранилище отказало —
 * ходы остаются в самой записи (следующая запись перенесёт), причина — в onStoreError.
 */
export async function forkBranch(store: BranchStore, s0: SavedGame, n: number, at: string, tail: GameTurn[], now: string, onStoreError?: (why: string) => void): Promise<SavedGame> {
  if (!tail.length) return s0;
  const s = withGid(s0, now);
  const kept = s.record.turns.slice(0, n - 1);
  const old = [...kept, ...tail];
  const branches = (s.branches ?? []).map((b) => divergeBy(b, n, at));
  const cut = { ...s, record: { ...s.record, turns: kept }, ...(branches.length ? { branches } : {}) };
  if (await covered(store, s, old)) return cut;
  const name = branchName(n, at, [s.line ?? MAIN_LINE, ...branches.map((b) => b.name)]);
  const b: SavedBranch = { id: newId(branches.map((x) => x.id), now), name, from: n, at, created: now, count: old.length };
  try { await putTurns(store, keyOf(s, b.id), old); } catch (e) {
    if (!onStoreError) throw e;
    onStoreError(errText(e));
    return { ...cut, branches: [...branches, { ...b, turns: old }] };
  }
  return { ...cut, branches: [...branches, b] };
}

/**
 * Перейти на ветвь: текущая линия уходит в ветви (под именем линии, новым кодом), выбранная становится записью.
 * Текущая линия пуста или уже есть (начало выбранной или другой ветви) — в ветви не уходит. Прочие ветви расходятся
 * с новой линией не позже, чем выбранная расходилась с прежней. Ходы прежней линии пишутся в хранилище сразу; ходы
 * выбранной ветви (stale) убирает commitGame после записи игры.
 */
export async function checkoutBranch(store: BranchStore, s0: SavedGame, id: string, now: string): Promise<Change> {
  const branches = s0.branches ?? [];
  const b = branches.find((x) => x.id === id);
  if (!b) return { game: s0, stale: [] };
  const s = withGid(s0, now);
  const chosen = await turnsOfBranch(store, s, b);
  const cp = commonPrefix(s.record.turns, chosen);
  // начало хода cp + 1: свой ход прежней линии, иначе — ход выбранной; обе линии совпали целиком — конец последнего общего
  const at = (s.record.turns[cp] ?? chosen[cp])?.time ?? (cp ? chosen[cp - 1].time : s.record.takeover);
  const cur = s.record.turns;
  const keep = cur.length > 0 && cp < cur.length && !(await covered(store, s, cur, id));
  let old: SavedBranch | null = null;
  if (keep) {
    old = { id: newId(branches.map((x) => x.id), now), name: s.line ?? MAIN_LINE, from: cp + 1, at, created: b.created, count: cur.length };
    await putTurns(store, keyOf(s, old.id), cur);
  }
  const rest = branches.flatMap((x) => (x.id === id ? (old ? [old] : []) : [divergeBy(x, b.from, b.at)]));
  const record = { ...s.record, turns: chosen };
  const { branches: _b, ...base } = s;
  const game: SavedGame = { ...base, record, line: b.name, turn: turnOf(record), ...(rest.length ? { branches: rest } : {}) };
  return { game, stale: b.turns ? [] : [keyOf(s, id)] };
}

/**
 * Переход на ветвь, отданный потоку игры: prev — запись до перехода, next — после него (записана до того, как переход
 * отдан потоку; нет — ещё не отдан), stale — ходы выбранной ветви в хранилище (не нужны, когда поток на ветви).
 */
export interface SwitchPending { prev: SavedGame; next: SavedGame | null; stale: string[] }

/**
 * Что сделать с записью игры на ответ потока о переходе (late — ожидание уже снято по сроку или ошибке потока):
 * - fail — срок вышел или поток упал: запись — prev; переход уже отдан потоку — помнить его (keep): поток может ещё
 *   ответить. Ходы прежней линии, что checkoutBranch положил в хранилище, не убираются — они понадобятся;
 * - switched — поток на ветви: запись next (late — её уже сменили на prev, записать снова), ходы ветви (stale) убрать;
 * - record без switched — поток остался на прежней линии: запись prev (late — она уже prev).
 * save: null — запись менять не нужно. Так поздний ответ не теряет ни одной линии и запись совпадает с потоком.
 */
export function switchReply(w: SwitchPending, ev: 'fail' | 'switched' | 'record', late: boolean): { save: SavedGame | null; del: string[]; keep: boolean } {
  if (ev === 'fail') return { save: w.prev, del: [], keep: !!w.next };
  if (ev === 'switched') return { save: late ? w.next : null, del: w.stale, keep: false };
  return { save: late ? null : w.prev, del: [], keep: false };
}

/** Убрать ветвь из записи; её ходы (stale) удаляет commitGame после записи игры. */
export function removeBranch(s: SavedGame, id: string): Change {
  const b = s.branches?.find((x) => x.id === id);
  if (!b) return { game: s, stale: [] };
  const rest = s.branches!.filter((x) => x.id !== id);
  const { branches: _b, ...base } = s;
  return { game: rest.length ? { ...base, branches: rest } : base, stale: b.turns ? [] : [keyOf(s, id)] };
}

/** Линии игры: текущая первой (id: null), затем ветви по времени сохранения. */
export function lines(s: SavedGame): { id: string | null; name: string; turns: number; from: number | null; current: boolean }[] {
  const rest = [...(s.branches ?? [])].sort((a, b) => a.created.localeCompare(b.created))
    .map((b) => ({ id: b.id as string | null, name: b.name, turns: b.count ?? b.turns?.length ?? 0, from: b.from as number | null, current: false }));
  return [{ id: null, name: s.line ?? MAIN_LINE, turns: s.record.turns.length, from: null, current: true }, ...rest];
}

/** Новая запись игры при смене хода: ветви, имя линии и код игры — из прежней записи. */
export function withRecord(prev: SavedGame | null, record: GameRecord, enemy: EnemyMode, title: string, turn: string): SavedGame {
  return { record, enemy, title, turn, ...(prev?.branches ? { branches: prev.branches } : {}), ...(prev?.line ? { line: prev.line } : {}), ...(prev?.gid ? { gid: prev.gid } : {}) };
}

// --- запись ---------------------------------------------------------------------------------------------------------

/** Записать игру (ходы — с доктриной номерами); не вышло — текст для уведомления, иначе null. */
export function storeGame(st: Pick<Storage, 'setItem'>, key: string, s: SavedGame): string | null {
  try { st.setItem(key, JSON.stringify(packGame(s))); return null; } catch (e) {
    const x = e as { name?: string; code?: number; message?: string };
    if (x?.name === 'QuotaExceededError' || x?.name === 'NS_ERROR_DOM_QUOTA_REACHED' || x?.code === 22 || x?.code === 1014) return QUOTA_TEXT;
    return `Запись игры не сохранилась: ${x?.message || x?.name || 'ошибка хранилища'}.`;
  }
}

/**
 * Записать игру после перемены: ходы ветвей из старой записи (они в ней ещё лежат целиком) сначала уходят в
 * хранилище; хранилище отказало — запись игры всё равно пишется, ходы ветвей остаются в ней (следующая запись снова
 * попробует их перенести). Ходы, что записи больше не нужны (stale), убираются только после удачной записи.
 * saved — запись игры легла; error — что сказать (и при saved: ветви не перенесены).
 */
export async function commitGame(store: BranchStore, st: Pick<Storage, 'setItem'>, key: string, c: Change): Promise<{ error: string | null; game: SavedGame; saved: boolean }> {
  let game = c.game, moved: string | null = null;
  if (game.branches?.some((b) => b.turns)) {
    try { game = await migrateBranches(store, game); } catch (e) { moved = errText(e); }
  }
  const error = storeGame(st, key, game);
  if (error) return { error, game, saved: false };
  for (const k of c.stale) await store.del(k).catch(() => { /* осталась лишняя запись — не потеря */ });
  return { error: moved && `Ветви не перенесены в хранилище окна: ${moved}. Запись игры сохранена, ходы ветвей — в ней; следующая запись попробует перенести их ещё раз.`, game, saved: true };
}

/** Старая запись: ходы ветвей — в хранилище, в записи остаются сведения. */
export async function migrateBranches(store: BranchStore, s0: SavedGame, now = new Date().toISOString()): Promise<SavedGame> {
  if (!s0.branches?.some((b) => b.turns)) return s0;
  const s = withGid(s0, now);
  for (const b of s.branches!) if (b.turns) await putTurns(store, keyOf(s, b.id), b.turns);
  return { ...s, branches: s.branches!.map((b) => (b.turns ? { ...meta(b), count: b.turns.length } : b)) };
}

/** Убрать ветвь: запись игры без неё, затем её ходы из хранилища. */
export async function deleteBranch(store: BranchStore, st: Pick<Storage, 'setItem'>, key: string, s: SavedGame, id: string) {
  return commitGame(store, st, key, removeBranch(s, id));
}

/** Игру сбросили: ходы всех её ветвей из хранилища (что не удалось — не страшно). */
export async function dropGame(store: BranchStore, s: SavedGame | null): Promise<void> {
  if (!s?.gid) return;
  for (const b of s.branches ?? []) if (!b.turns) await store.del(keyOf(s, b.id)).catch(() => { /* */ });
}

/** Запись игры заменяется или удаляется: ходы её ветвей, затем сама запись. */
export async function discardSave(store: BranchStore, st: Pick<Storage, 'removeItem'>, key: string, s: SavedGame | null): Promise<void> {
  try { st.removeItem(key); } catch { /* */ }
  await dropGame(store, s);
}

/**
 * Уборка при открытии: ходы в хранилище, на которые запись игры s не ссылается (прежняя игра, неудачная запись,
 * переход на ветвь, прерванный закрытием окна), — удалить. Запуск — только когда переходов не идёт (при загрузке).
 */
export async function sweepBranches(store: BranchStore, s: SavedGame | null): Promise<void> {
  if (!store.keys) return;
  const live = new Set(s?.gid ? (s.branches ?? []).filter((b) => !b.turns).map((b) => keyOf(s, b.id)) : []);
  const all = await store.keys().catch(() => [] as string[]);
  for (const k of all) if (!live.has(k)) await store.del(k).catch(() => { /* */ });
}
