/**
 * Возврат к ходу и переход на ветвь (поток игры, game-worker.ts): когда возврат допустим, сколько первых ходов у двух
 * линий общие, с каким отпечатком сверить мир после возврата, порядок перезапуска штаба противника.
 */
import type { GameRecord, GameTurn } from '@def-ops/sim';

/** Можно ли вернуться к ходу turn (с 1) при сыгранных played ходах: null — можно, иначе — почему нельзя. */
export const BUSY_REFUSAL = 'идёт расчёт хода — вернуться можно, когда он закончится';
/** Ход отдан, пока идёт возврат или переход на ветвь, — не принят. */
export const TURN_REFUSAL = 'идёт возврат к ходу — ход не отдан';

export function rewindCheck(s: { busy: boolean; played: number; turn: number }): string | null {
  if (s.busy) return BUSY_REFUSAL;
  if (!Number.isInteger(s.turn) || s.turn < 1) return 'такого хода нет: ходы — с первого';
  if (s.turn > s.played + 1) return `сыграно ходов: ${s.played}, хода ${s.turn} ещё не было`;
  if (s.turn === s.played + 1) return 'это и есть текущий ход';
  return null;
}

/** Ход как сравнимое: без отпечатка — по входу хода (время, приказы, распоряжения, команды, поправки посредника). */
const turnKey = (t: GameTurn) => JSON.stringify([t.time, t.orders, t.actions, t.command, t.umpire]);

/** Число первых ходов, равных в обеих линиях: у обоих есть отпечаток — по времени и отпечатку, иначе — по входу хода. */
export function commonPrefix(a: GameTurn[], b: GameTurn[]): number {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    const x = a[k], y = b[k];
    const same = x.digest !== undefined && y.digest !== undefined ? x.time === y.time && x.digest === y.digest : turnKey(x) === turnKey(y);
    if (!same) return k;
  }
  return n;
}

/** Отпечаток мира, который должен быть после возврата к началу хода keep + 1: keep 0 — начало игры. */
export function expectedDigest(rec: GameRecord, keep: number): string | undefined {
  return keep === 0 ? rec.startDigest : rec.turns[keep - 1]?.digest;
}

/** Штаб противника заново: прежний запрос (и ожидание доклада посредника) снять, затем спросить по новой обстановке. */
export function restartAi(deps: { drop(): void; start(): void }): void {
  deps.drop();
  deps.start();
}

/** Принять ли ход: идёт возврат или переход на ветвь — нет (текст отказа). */
export const turnGate = (rewinding: boolean): string | null => (rewinding ? TURN_REFUSAL : null);

const errText = (e: unknown) => (e as Error)?.message ?? String(e);

/**
 * Снять с линии ходы keep + 1…: сначала ядро (если игра на нём), затем — состояние потока из stash[keep] (apply, пока
 * ходы ещё в линии); ядро отказало — ни линия, ни состояние не меняются. Возвращает снятые ходы.
 */
export async function rewindLine<S, C>(line: { stash: S[]; turns: GameTurn[] }, keep: number, core: ((keep: number) => Promise<C>) | null, apply: (s: S, core: C | undefined) => void): Promise<GameTurn[]> {
  if (!Number.isInteger(keep) || keep < 0 || keep >= line.stash.length) throw new Error(`нет состояния на начало хода ${keep + 1}`);
  const c = core ? await core(keep) : undefined;
  apply(line.stash[keep], c);
  line.stash.length = keep + 1;
  return line.turns.splice(keep);
}

/**
 * Ход возврата или перехода на ветвь: отказ — ответ без изменений; иначе — под флагом возврата, ошибка — отказ с её
 * текстом; в конце штаб противника — заново в любом случае (прежний запрос мог быть снят).
 */
export async function rewindFlow(o: { refusal: string | null; run(): Promise<void>; refuse(text: string): void; restart(ok: boolean): void; setRewinding(on: boolean): void }): Promise<boolean> {
  if (o.refusal) { o.refuse(o.refusal); return false; }
  o.setRewinding(true);
  let ok = false;
  try {
    await o.run();
    ok = true;
  } catch (e) {
    o.refuse(errText(e));
  } finally {
    o.setRewinding(false);
    o.restart(ok);
  }
  return ok;
}

/**
 * Снять то, что готовилось к прежней обстановке: ожидание доклада посредника, запросы к модели (штаб противника,
 * советник, варианты решения), затем — ждущий ход и прочее (reset).
 */
export function dropPending(d: { holdDrop(): void; aborts: (AbortController | null | undefined)[]; reset(): void }): void {
  d.holdDrop();
  for (const a of d.aborts) a?.abort();
  d.reset();
}

/** Что умеет линия игры для перехода на ветвь (поток игры). */
export interface BranchOps {
  /** Вернуться к началу хода keep + 1; снятые ходы — в ответ. */
  rewindTo(keep: number): Promise<GameTurn[]>;
  /** Посчитать ход повтором записи (на линию — push, только после расчёта). */
  play(t: GameTurn): Promise<void>;
  /** Игра окончена — дальше ходы не считаются. */
  over(): boolean;
  push(t: GameTurn): void;
  notice(text: string): void;
}

async function playAll(ts: GameTurn[], ops: BranchOps) {
  for (const t of ts) {
    if (ops.over()) break;
    await ops.play(t);
    ops.push(t);
  }
}

/**
 * Перейти с линии cur на ветвь turns: общая часть остаётся, ходы ветви считаются по одному и встают в линию после
 * расчёта. Ход ветви не посчитался — возврат к общей части и прежние ходы заново (линия как была), notice «ветвь не
 * применена». Отказ первого возврата — ошибкой наверх (ничего не изменилось).
 */
export async function applyBranch(cur: GameTurn[], turns: GameTurn[], ops: BranchOps): Promise<{ ok: boolean; error?: string }> {
  const p = commonPrefix(cur, turns);
  const old = await ops.rewindTo(p);
  try {
    await playAll(turns.slice(p), ops);
    return { ok: true };
  } catch (e) {
    const why = errText(e);
    try {
      await ops.rewindTo(p);
      await playAll(old, ops);
    } catch (e2) {
      throw new Error(`ветвь не применена: ${why}; линия не восстановлена: ${errText(e2)} (сыграно ходов: ${cur.length})`);
    }
    ops.notice(`ветвь не применена: ${why}`);
    return { ok: false, error: why };
  }
}

/**
 * Переход на ветвь целиком: applyBranch, затем show(ok) — на любом исходе, и при ошибке восстановления тоже (обстановка
 * и запись — как есть сейчас, а не прежняя линия). Ошибка восстановления — наверх.
 */
export async function switchLine(cur: GameTurn[], turns: GameTurn[], ops: BranchOps & { show(ok: boolean): void }): Promise<boolean> {
  let ok = false;
  try {
    ok = (await applyBranch(cur, turns, ops)).ok;
  } finally {
    ops.show(ok);
  }
  return ok;
}
