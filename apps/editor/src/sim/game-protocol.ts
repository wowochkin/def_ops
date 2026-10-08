import type { LngLat, MapDocument } from '@def-ops/core';
import type { ActionCheck, GameOutcome, GameRecord, IntelReport, Order, StaffAction, Target, Task, UnitReport } from '@def-ops/sim';
import type { AiTurn } from '@def-ops/staff-service/live';

export type Thinking = 'off' | 'low' | 'medium' | 'high';

/** Связь с моделью (LM Studio) — хранится в браузере, общая для разделов. */
export interface LlmSettings {
  /** Адрес API: по умолчанию — через сервер разработки (/llm → LM Studio на этом компьютере). */
  url: string;
  /** Модель; пусто — первая загруженная. */
  model: string;
  thinking: Thinking;
  /** Модель эмбеддингов для смыслового поиска по базе знаний: пусто — первая найденная (Qwen3-Embedding), 'off' — без неё. */
  embedModel?: string;
  /** Длина вектора (MRL): меньше — быстрее и меньше места, чуть хуже поиск. */
  embedDims?: number;
  /** Посредник на модели: перед каждым ходом — поправки к ожидаемым боям по справкам из базы знаний. */
  umpire?: boolean;
  /** База знаний: своя модель и размышление для ответов и разбора документов; пусто — как в разделе «ИИ». */
  kbModel?: string;
  kbThinking?: Thinking;
  /** Советник в игре: своя модель и размышление; пусто — как в разделе «ИИ». */
  advModel?: string;
  advThinking?: Thinking;
  /** Разбор операции: своя модель и размышление; пусто — как в разделе «ИИ». */
  revModel?: string;
  revThinking?: Thinking;
}

/** Противник: штаб на модели или «без штаба» — держится прежних приказов (для пробы без LM Studio). */
export type EnemyMode = 'llm' | 'passive';

export interface GameStart {
  scenario: string;
  rules: string;
  seed: number;
  /** Момент передачи командования (начало хода). */
  takeover: string;
}

export type GameRequest =
  | { kind: 'start'; start: GameStart; record?: GameRecord; llm: LlmSettings; enemy: EnemyMode }
  /** Конец хода человека: решение, приказы и распоряжения (issuedAt — начало хода). */
  | { kind: 'turn'; orders: Order[]; actions: StaffAction[]; decision: HumanDecision }
  /** Проверить распоряжение до конца хода (pendingBridges — переправы, уже включённые в распоряжение). */
  | { kind: 'check'; id: number; action: StaffAction; pendingBridges: number }
  | { kind: 'settings'; llm: LlmSettings; enemy: EnemyMode }
  | { kind: 'retry-ai' }
  /** Ход без новых приказов противника (модель не ответила). */
  | { kind: 'skip-ai' }
  /** Вопрос советнику: категория, вопрос, проект решения словами, предыдущие вопросы и ответы. */
  | { kind: 'advise'; id: number; category: string; topic: string; question: string; draft: string; thread: { q: string; a: string }[]; reference: string }
  /** Советник: варианты решения на ход (count — сколько), проект решения словами, справка из базы знаний; остановить. */
  | { kind: 'plan'; id: number; count: number; draft: string; reference: string }
  | { kind: 'plan-stop' }
  /** Остановить ответ советника. */
  | { kind: 'advise-stop' }
  /** Разбор операции: написать раздел (done — уже написанные разделы, для итога); остановить. */
  | { kind: 'review-section'; id: number; section: string; done: { title: string; text: string }[] }
  | { kind: 'review-stop' }
  /** Посредник: показать на карте всех (без тумана войны). */
  | { kind: 'reveal'; on: boolean };

export interface Place { id: string; title: string; at: LngLat }

/** Решение штаба человека на ход — те же части, что у штаба модели. */
export interface HumanDecision {
  /** Оценка обстановки. */
  assessment: string;
  /** Замысел противника, как его понимает штаб. */
  enemyIntent: string;
  /** Решение: замысел своих действий. */
  intent: string;
  /** Боевое донесение вышестоящему (Ставке). */
  report: string;
  /** Риски решения. */
  risks: string;
}

export interface BaseView { id: string; name: string; at: LngLat; state: 'active' | 'moving' | 'idle'; activeFrom: string | null }
export interface BridgeView { id: string; name: string; at: LngLat; openFrom: string | null; building: boolean }

export interface JournalDay {
  /** Начало хода. */
  time: string;
  /** Наши приказы этого хода — словами. */
  orders: string[];
  /** Распоряжения штаба (тыл, переправы, резервы) и как исполнены. */
  actions: string[];
  /** Решение штаба на этот ход. */
  decision?: HumanDecision;
  /** Что произошло за ход (донесения). */
  events: string[];
}

export interface Goal { title: string; historical: string; simulated: string | null; days: number | null; at: string | null; place: LngLat | null }

export interface TurnView {
  scenario: string; scenarioName: string; rules: string; seed: number;
  start: string; end: string; takeover: string; time: string; turnHours: number;
  /** Ход игры (с передачи командования). Конечной даты нет: игра идёт до победы или поражения. */
  turn: number;
  over: boolean;
  outcome: GameOutcome | null;
  /** Условие победы (словами), предельный срок, доля численности от исходной и порог поражения. */
  victory: string; deadline: string; strength: number; strengthBelow: number;
  human: { id: string; name: string };
  ai: { id: string; name: string };
  /** Объединения верхнего уровня (фронты) — для группировки докладов. */
  groups: { id: string; name: string }[];
  own: UnitReport[];
  intel: IntelReport[];
  /** Донесения за прошедший ход. */
  events: string[];
  places: Place[];
  /** Задержка доведения приказов по ступеням, часов. */
  delays: Record<string, number>;
  detectKm: number;
  goals: Goal[];
  journal: JournalDay[];
  doc: MapDocument;
  /** Тыл: базы снабжения, приоритет подвоза, время подвоза до объединений (часов; null — не доходит) и предел. */
  bases: BaseView[];
  priority: string[];
  priorityMax: number;
  supplyHours: Record<string, number | null>;
  rangeHours: number;
  /** Свои переправы: действующие и наводимые; понтонных парков всего. */
  bridges: BridgeView[];
  parks: number;
  /** Решение прошлого хода (для продолжения работы над ним). */
  lastDecision: HumanDecision | null;
}

export type AiStatus =
  | { state: 'off' }
  | { state: 'thinking'; time: string; since: number }
  | { state: 'done'; time: string; turn: AiTurn }
  | { state: 'error'; time: string; error: string; turn?: AiTurn };

export type GameResponse =
  | { kind: 'progress'; text: string }
  | { kind: 'view'; view: TurnView }
  | { kind: 'ai'; status: AiStatus }
  /** Поток ответа модели (для посредника), кусками. */
  | { kind: 'ai-stream'; text: string; reset?: boolean }
  /** Ход ждёт решения посредника: модель не ответила. */
  | { kind: 'blocked'; error: string }
  | { kind: 'record'; record: GameRecord }
  | { kind: 'check'; id: number; result: ActionCheck }
  | { kind: 'advice-stream'; id: number; text: string }
  /** Вопрос ждёт очереди к модели (она занята другим запросом). */
  | { kind: 'advice-wait'; id: number; text: string }
  /** Разбор операции: текст раздела потоком, ожидание очереди, готово. */
  | { kind: 'review-stream'; id: number; text: string; reset?: boolean }
  | { kind: 'review-wait'; id: number; text: string }
  /** Размышление модели над разделом — кусками. */
  | { kind: 'review-think'; id: number; text: string }
  | { kind: 'review-done'; id: number; ok: boolean; text: string; error?: string; model?: string; seconds?: number }
  | { kind: 'advice'; id: number; result: AdviceView }
  /** Варианты решения: ход генерации (знаков, хвост размышления), очередной готовый вариант, конец. */
  | { kind: 'plan-progress'; id: number; text: string }
  | { kind: 'plan-variant'; id: number; index: number; variant: PlanVariantView }
  | { kind: 'plan-done'; id: number; ok: boolean; error?: string; warning?: string; model?: string; seconds?: number }
  | { kind: 'error'; message: string };

/** Ответ советника для интерфейса: текст, предложенные приказы (готовые к включению в распоряжение), следующие вопросы. */
export interface AdviceView {
  ok: boolean;
  error?: string;
  answer: string;
  /** На что опирается ответ (доклады, разведка, правила, история, общие знания) и чего штаб не знает. */
  basis: string[];
  unknowns: string[];
  /** Ответ всё же упоминает то, чего нет в сведениях штаба; переписан по требованию проверки. */
  warning?: string;
  rewritten?: boolean;
  followUps: string[];
  suggestions: { formation: string; name: string; task: Task; target: Target; targetText: string; at: LngLat | null; why: string; issue?: string; ok: boolean }[];
  seconds?: number;
}

/** Распоряжение варианта (тыл, переправы, резервы) — готовое к включению в проект; ok=false — не исполнимо. */
export interface PlanActView { key: string; action: StaffAction | null; label: string; text: string; at?: LngLat; from?: LngLat; given: string; ok: boolean }

/** Вариант решения на ход от советника: решение целиком, приказы и распоряжения, сопоставленные с обстановкой. */
export interface PlanVariantView {
  title: string;
  idea: string;
  decision: HumanDecision;
  orders: AdviceView['suggestions'];
  acts: PlanActView[];
}
