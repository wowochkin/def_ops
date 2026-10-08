/**
 * Игра: с выбранного хода переигровки одна сторона переходит к человеку, другая — к
 * модели (или к любому другому штабу), и так до конца операции. До этого момента —
 * исторические задачи сценария; исторические приказы после него отменяются (приказы,
 * отданные раньше и ещё не дошедшие до войск, остаются в пути).
 *
 * Запись игры — сценарий, правила, seed, момент передачи командования и приказы по
 * ходам. Движок детерминирован, поэтому по записи игра восстанавливается целиком
 * (сохранение, продолжение, разбор), без хранения состояний.
 */
import { snapshotOf, type Snapshot } from './history';
import { createState, issueOrder, step, type SimContext } from './step';
import type { Order, SimState } from './types';

export interface GameTurn {
  /** Начало хода — когда отданы приказы. */
  time: string;
  /** Приказы обеих сторон за этот ход. */
  orders: Order[];
  /** Сведения о решении штаба модели (оценка, замысел, риски, замеры) — для разбора; на расчёт не влияют. */
  ai?: unknown;
}

export interface GameRecord {
  version: 1;
  scenario: string;
  rules: string;
  seed: number;
  /** С какого хода командование у человека и модели. */
  takeover: string;
  human: string;
  ai: string;
  turns: GameTurn[];
}

export interface GameState {
  state: SimState;
  /** Состояние на начало предыдущего хода (для итога суток). */
  prev: SimState | null;
  snapshots: Snapshot[];
}

/** Прогнать сценарий по истории до хода takeover (ход, начинающийся не раньше этого времени) и снять будущие исторические приказы. */
export function startGame(ctx: SimContext, seed: number, takeover: string): GameState {
  let s = createState(ctx, seed), prev: SimState | null = null;
  const snapshots = [snapshotOf(s)];
  while (s.time < takeover && s.time < ctx.scenario.end) {
    prev = s;
    s = step(s, ctx);
    snapshots.push(snapshotOf(s));
  }
  s = { ...s, pending: s.pending.filter((o) => o.issuedAt < s.time) };
  return { state: s, prev, snapshots };
}

/** Ход: приказы обеих сторон (с задержкой доведения по ступени) и расчёт арбитра. */
export function playTurn(ctx: SimContext, g: GameState, orders: Order[]): GameState {
  const s = step(orders.reduce(issueOrder, g.state), ctx);
  return { state: s, prev: g.state, snapshots: [...g.snapshots, snapshotOf(s)] };
}

/** Игра окончена: время сценария вышло. */
export const gameOver = (ctx: SimContext, g: GameState) => g.state.time >= ctx.scenario.end;

/** Восстановить игру по записи. */
export function replayGame(ctx: SimContext, rec: GameRecord): GameState {
  let g = startGame(ctx, rec.seed, rec.takeover);
  for (const t of rec.turns) {
    if (gameOver(ctx, g)) break;
    if (t.time !== g.state.time) throw new Error(`запись игры не сходится: ход ${t.time}, расчёт ${g.state.time}`);
    g = playTurn(ctx, g, t.orders);
  }
  return g;
}
