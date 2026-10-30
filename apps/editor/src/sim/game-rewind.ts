/**
 * Возврат к ходу и переход на ветвь (поток игры, game-worker.ts): когда возврат допустим, сколько первых ходов у двух
 * линий общие, с каким отпечатком сверить мир после возврата, порядок перезапуска штаба противника.
 */
import type { GameRecord, GameTurn } from '@def-ops/sim';

/** Можно ли вернуться к ходу turn (с 1) при сыгранных played ходах: null — можно, иначе — почему нельзя. */
export function rewindCheck(s: { busy: boolean; played: number; turn: number }): string | null {
  if (s.busy) return 'идёт расчёт хода — вернуться можно, когда он закончится';
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
