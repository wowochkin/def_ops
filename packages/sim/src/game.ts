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
import { checkEvents, snapshotOf, type History, type Snapshot } from './history';
import { applyActions, prepareTakeover } from './staff';
import { createState, issueOrder, onMap, step, type SimContext } from './step';
import type { Order, SimState, StaffAction, UmpireMod } from './types';

export interface GameTurn {
  /** Начало хода — когда отданы приказы. */
  time: string;
  /** Приказы обеих сторон за этот ход. */
  orders: Order[];
  /** Распоряжения штаба человека: тыл, переправы, резервы. */
  actions?: StaffAction[];
  /** Поправки посредника на этот ход (модель-посредник); влияют на расчёт — поэтому в записи. */
  umpire?: UmpireMod[];
  /** Решение штаба человека (оценка, замысел, донесение) — для журнала и разбора; на расчёт не влияет. */
  human?: unknown;
  /** Сведения о решении штаба модели (оценка, замысел, риски, замеры) — для разбора; на расчёт не влияют. */
  ai?: unknown;
  /** Разбор посредника (оценка, отброшенные поправки, справки) — для разбора; на расчёт влияют только umpire. */
  umpireNote?: unknown;
  /** Обращения к модели-Ставке (поводы, ответ, директивы) — для журнала и разбора; директивы на расчёт — в actions. */
  stavka?: unknown;
  /** Команды управления на агентной модели (до приказов хода). */
  command?: CommandOp[];
}

export interface GameRecord {
  version: 1;
  scenario: string;
  rules: string;
  seed: number;
  /** С какого хода командование у человека и модели. */
  takeover: string;
  /** Штаб модели ведёт тыл, переправы, резервы своей стороны (иначе они идут по историческому графику). */
  aiStaff?: boolean;
  human: string;
  ai: string;
  turns: GameTurn[];
  /** Игра на агентной модели (дивизии, ядро crates/agents-core): её сценарий, история и длина хода. */
  agents?: AgentGameSpec;
  /**
   * Данные из базы знаний на момент начала игры (редактор): собранные поправки нынешней модели, поправки ядра,
   * состояние при передаче командования. Восстановление игры идёт на них, а не на нынешней базе.
   */
  kb?: { compiled: unknown; core: unknown; takeoverState?: TakeoverState };
}

/**
 * Состояние соединений на момент передачи командования по фактам базы знаний (абсолютные значения):
 * численность, танки, орудия, положение [долгота, широта], вышестоящий. Чего нет — остаётся рассчитанным.
 */
export type TakeoverState = Record<string, { personnel?: number; tanks?: number; guns?: number; position?: [number, number]; parent?: string }>;

/**
 * Наложить состояние при передаче на рассчитанное: численность — как есть; положение — только формированию на
 * карте (маршрут пересчитывается); вышестоящий — только существующий в сценарии. Неизвестные id и уничтоженные
 * соединения пропускаются (факт о численности выбывшего соединения его не возрождает).
 */
export function applyTakeoverState(s: SimState, ts: TakeoverState): SimState {
  const ids = new Set(s.formations.map((f) => f.id));
  const formations = s.formations.map((f) => {
    const t = ts[f.id];
    if (!t || f.destroyed) return f;
    const n = { ...f };
    for (const k of ['personnel', 'tanks', 'guns'] as const) if (typeof t[k] === 'number') n[k] = Math.max(0, t[k]!);
    if (t.position && onMap(f, s.time)) { n.position = [t.position[0], t.position[1]]; n.route = null; }
    if (t.parent && t.parent !== f.id && ids.has(t.parent)) n.parent = t.parent;
    return n;
  });
  return { ...s, formations };
}

/** Агентная модель в игре: сценарий и история ядра (пути от корня данных), длина хода, часов. */
/** Режим игры на агентной модели: как сейчас (приказ — каждой дивизии штаба), штабы-агенты, гибрид. */
export type GameMode = 'legacy' | 'agents' | 'hybrid' | 'commanders' | 'intent';
export interface AgentGameSpec { path: string; history: string; turnHours: number; mode?: GameMode }
/** Команда управления на ход (командование по ступеням): взять штаб, вернуть, ответ на запрос отхода, подать историческую директиву. */
export type CommandOp = { op: 'take'; hq: string } | { op: 'release'; id: string } | { op: 'permit'; hq: string; yes: boolean } | { op: 'historical'; id: string }
  /** Директива пункта управления (game::PlayerDirective): to, task, form, from, ось, рубежи, границы… */
  | { op: 'directive'; directive: { to: string; task: string; form: string; from?: string } & Record<string, unknown> };

export interface GameState {
  state: SimState;
  /** Состояние на начало предыдущего хода (для итога суток). */
  prev: SimState | null;
  snapshots: Snapshot[];
}

/**
 * Прогнать сценарий по истории до хода takeover (ход, начинающийся не раньше этого времени) и снять будущие
 * исторические приказы. human — сторона человека: её будущие наводки переправ и прибытия резервов тоже сняты,
 * тыл — под управлением штаба (prepareTakeover). takeoverState — состояние соединений по фактам базы на этот момент
 * (applyTakeoverState).
 */
export function startGame(ctx: SimContext, seed: number, takeover: string, human?: string, aiStaff?: string, takeoverState?: TakeoverState): GameState {
  let s = createState(ctx, seed), prev: SimState | null = null;
  const snapshots = [snapshotOf(s)];
  while (s.time < takeover && s.time < ctx.scenario.end) {
    prev = s;
    s = step(s, ctx);
    snapshots.push(snapshotOf(s));
  }
  s = { ...s, pending: s.pending.filter((o) => o.issuedAt < s.time) };
  // состояние по фактам — и на карте момента передачи (последний снимок)
  if (takeoverState) { s = applyTakeoverState(s, takeoverState); snapshots[snapshots.length - 1] = snapshotOf(s); }
  // директивы с этого момента — по обстановке: вступившие по истории остаются, будущие ждут своего условия
  const done = Object.fromEntries((ctx.scenario.boundaries ?? []).filter((b) => b.trigger && b.from <= s.time).map((b) => [b.id, b.from]));
  s = { ...s, directives: { conditional: true, activated: done } };
  if (human) s = prepareTakeover(ctx, s, human);
  // штаб модели ведёт и тыл, переправы, резервы своей стороны (если включён при передаче командования)
  if (aiStaff) s = prepareTakeover(ctx, s, aiStaff);
  return { state: s, prev, snapshots };
}

/** Ход: распоряжения штаба, приказы обеих сторон (с задержкой доведения по ступени) и расчёт арбитра. */
export function playTurn(ctx: SimContext, g: GameState, orders: Order[], actions: StaffAction[] = [], umpire: UmpireMod[] = []): GameState & { results: ReturnType<typeof applyActions>['results'] } {
  const a = applyActions(ctx, g.state, actions);
  const s = step({ ...orders.reduce(issueOrder, a.state), ...(umpire.length ? { umpire } : {}) }, ctx);
  return { state: s, prev: a.state, snapshots: [...g.snapshots, snapshotOf(s)], results: a.results };
}

/** Игра окончена: время сценария вышло (для игры с условиями победы и поражения — gameOutcome). */
export const gameOver = (ctx: SimContext, g: GameState) => g.state.time >= ctx.scenario.end;

/**
 * Когда кончается игра: конечной даты нет — победа (событие истории случилось в игре, например Знамя
 * Победы над рейхстагом) или поражение (сторона человека потеряла боеспособность — численность ниже
 * доли от той, что была при передаче командования, — или предельный срок вышел).
 */
export interface GameEnd {
  victory: { event: string; title: string };
  defeat: { strengthBelow: number; deadline: string; deadlineText: string };
}

export interface GameOutcome { result: 'victory' | 'defeat'; text: string; at: string | null }

/** Численность действующих войск стороны (для условия поражения). */
export const sideStrength = (s: SimState, side: string) => s.formations.filter((f) => f.side === side && onMap(f, s.time)).reduce((a, f) => a + f.personnel, 0);

export function gameOutcome(ctx: SimContext, history: History, g: GameState, end: GameEnd, human: string, baseStrength: number): GameOutcome | null {
  const ev = history.events?.find((e) => e.id === end.victory.event);
  if (ev) {
    const r = checkEvents(ctx, { final: g.state, snapshots: g.snapshots }, { ...history, events: [ev] })[0];
    if (r?.at) return { result: 'victory', text: `${end.victory.title} — ${r.simulated?.slice(8, 10)}.${r.simulated?.slice(5, 7)} (в истории ${ev.date.slice(8, 10)}.${ev.date.slice(5, 7)})`, at: r.at };
  }
  const k = baseStrength ? sideStrength(g.state, human) / baseStrength : 1;
  if (k < end.defeat.strengthBelow) return { result: 'defeat', text: `войска потеряли боеспособность: в строю ${Math.round(k * 100)} % численности на момент принятия командования`, at: g.state.time };
  if (g.state.time >= end.defeat.deadline) return { result: 'defeat', text: end.defeat.deadlineText, at: g.state.time };
  return null;
}

/** Восстановить игру по записи. */
export function replayGame(ctx: SimContext, rec: GameRecord): GameState {
  let g: GameState = startGame(ctx, rec.seed, rec.takeover, rec.human, rec.aiStaff ? rec.ai : undefined, rec.kb?.takeoverState);
  for (const t of rec.turns) {
    if (t.time !== g.state.time) throw new Error(`запись игры не сходится: ход ${t.time}, расчёт ${g.state.time}`);
    g = playTurn(ctx, g, t.orders, t.actions ?? [], t.umpire ?? []);
  }
  return g;
}
