import type { CommandTerms, OperationSummary, TurnDebrief } from '@def-ops/sim';
import type { LngLat, MapDocument } from '@def-ops/core';
import type { ActionCheck, AgentGameSpec, CommandOp, GameOutcome, GameRecord, GameTurn, IntelReport, Order, StaffAction, Target, Task, TurnBattle, UnitReport, ZoneGrid } from '@def-ops/sim';
import type { AiTurn } from '@def-ops/staff-service/live';
import type { KbRefAnswer, KbRefRequest } from './kb-ref';
import type { CommandView, EnemyEntry } from './agents-game';
import type { PostContext } from '../command-post';
import type { PetitionDraft } from '../petition';

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
  /** Модель-Ставка: разграничительные линии между фронтами, когда есть повод (по умолчанию — да, если в игре есть модель). */
  stavka?: boolean;
  /** База знаний: своя модель и размышление для ответов и разбора документов; пусто — как в разделе «ИИ». */
  kbModel?: string;
  kbThinking?: Thinking;
  /** Чтение сканов (модель со зрением) и перекрёстная проверка цитат: свои модели и размышление; пусто — как в «ИИ». */
  scanModel?: string;
  scanThinking?: Thinking;
  crossModel?: string;
  crossThinking?: Thinking;
  /** Перекрёстная проверка цитаты второй моделью (по умолчанию включена). */
  crossCheck?: boolean;
  /** Штаб противника в игре: своя модель и размышление; пусто — как в разделе «ИИ». */
  enemyModel?: string;
  enemyThinking?: Thinking;
  /** Советник в игре: своя модель и размышление; пусто — как в разделе «ИИ». */
  advModel?: string;
  advThinking?: Thinking;
  /** Разбор операции: своя модель и размышление; пусто — как в разделе «ИИ». */
  revModel?: string;
  revThinking?: Thinking;
  /** Голосовое управление (свободные формулировки): своя модель — пусто, как в «ИИ»; размышление — пусто, выключено. */
  voiceModel?: string;
  voiceThinking?: Thinking;
}

/** Противник: штаб на модели или «без штаба» — держится прежних приказов (для пробы без LM Studio). */
/** agents — противник: штабы-агенты по уставам, его верхняя инстанция подаёт исторические решения (агентная модель). */
export type EnemyMode = 'llm' | 'passive' | 'agents' | 'intent';

export interface GameStart {
  scenario: string;
  rules: string;
  seed: number;
  /** Момент передачи командования (начало хода). */
  takeover: string;
  /** Игра на агентной модели (настольное приложение): ход считает ядро через основное окно (agents-call). */
  agents?: AgentGameSpec;
}

export type GameRequest =
  | { kind: 'start'; start: GameStart; record?: GameRecord; llm: LlmSettings; enemy: EnemyMode }
  /** Конец хода человека: решение, приказы и распоряжения (issuedAt — начало хода). */
  /** posts — решения штабов ступеней ниже верхней инстанции (пункт управления): в запись хода, для журнала и разбора. */
  | { kind: 'turn'; orders: Order[]; actions: StaffAction[]; decision: HumanDecision; command?: CommandOp[]; posts?: Record<string, HumanDecision> }
  /** Проверить распоряжение до конца хода (pendingBridges — переправы, уже включённые в распоряжение). */
  | { kind: 'check'; id: number; action: StaffAction; pendingBridges: number }
  | { kind: 'settings'; llm: LlmSettings; enemy: EnemyMode }
  | { kind: 'retry-ai' }
  /** Ход без новых приказов противника (модель не ответила). */
  | { kind: 'skip-ai' }
  /** Доклад посредника голосом закончен (или снят): штаб противника может занимать модель. */
  | { kind: 'umpire-done' }
  /** Вернуться к началу хода turn (с 1): ходы turn… снимаются с линии (в ответ — rewound с ними), штаб противника — заново. */
  | { kind: 'rewind'; turn: number }
  /** Перейти на другую линию игры (ветвь): turns — её ходы целиком; общая с нынешней часть не пересчитывается. */
  | { kind: 'switch'; turns: GameTurn[] }
  /** Голос ждёт модель или спрашивает её (on): новые запросы к модели ждут, пока он не отпустит; начатый доходит. */
  | { kind: 'llm-hold'; on: boolean }
  /** Вопрос советнику: категория, вопрос, проект решения словами, предыдущие вопросы и ответы. */
  /** post — пункт управления (агентная модель): советник думает за его штаб, приказы — его подчинённым. */
  | { kind: 'advise'; id: number; category: string; topic: string; question: string; draft: string; thread: { q: string; a: string }[]; reference: string; post?: PostContext }
  /** Советник: варианты решения на ход (count — сколько), проект решения словами, справка из базы знаний; остановить. */
  | { kind: 'plan'; id: number; count: number; draft: string; reference: string; post?: PostContext }
  /** Варианты решения по правилам (ядро агентной модели, game_variants) для штаба hq; null — верхняя инстанция стороны. */
  | { kind: 'plan-rules'; id: number; count: number; hq: string | null }
  | { kind: 'plan-stop' }
  /** Остановить ответ советника. */
  | { kind: 'advise-stop' }
  /** Разбор операции: написать раздел (done — уже написанные разделы, для итога); остановить. */
  | { kind: 'review-section'; id: number; section: string; done: { title: string; text: string }[] }
  | { kind: 'review-stop' }
  /** Посредник: показать на карте всех (без тумана войны). */
  | { kind: 'reveal'; on: boolean }
  /** Ответ основного окна на вызов ядра агентной модели. */
  | { kind: 'agents-reply'; id: number; ok: boolean; result?: unknown; error?: string; doctrineText?: { su?: string; de?: string } | null }
  /** Справка из базы знаний окна (ответ на kbRef); ошибка — ok: false, поток считает по сиду. */
  | { kind: 'kbRefResult'; id: number; ok: boolean; answer?: KbRefAnswer; error?: string };

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
  /** Ходатайство в Ставку (о разграничительных линиях) текстом — для модели-Ставки нынешней модели (из petition при отправке хода). */
  request?: string;
  /** Ходатайство о разграничительной линии с соседним фронтом: сосед, линия, обоснование (petition.ts). */
  petition?: PetitionDraft;
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
  /** Действия противника за ход, которые видит разведка (агентная модель, «история как замысел» и штабы-агенты). */
  enemy?: string[];
}

export interface Goal { title: string; historical: string; simulated: string | null; days: number | null; at: string | null; place: LngLat | null }

export interface TurnView {
  /** Расчётная модель: нынешняя (армии и корпуса) или агентная (дивизии). */
  engine?: 'army' | 'agents';
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
  /** Как называются высшее командование и объединения стороны игрока: Ставка и фронты, ОКХ и группы армий. */
  terms: CommandTerms;
  /** Объединения верхнего уровня (фронты) — для группировки докладов. */
  groups: { id: string; name: string }[];
  own: UnitReport[];
  intel: IntelReport[];
  /** Донесения за прошедший ход. */
  events: string[];
  /** Бои за прошедший ход: место, свои и противник (соприкосновение), исход, наши потери — для разбора хода на карте. */
  battles: TurnBattle[];
  /**
   * Зоны влияния сторон на конец хода и на его начало (свои — красноватые, противник — голубоватые, только
   * обнаруженный разведкой; спорное — без цвета); null — не считались (до первого хода нет начала).
   */
  zones: ZoneGrid | null;
  zonesPrev: ZoneGrid | null;
  places: Place[];
  /** Рубежи театра, мосты и переправы театра, не разрушенные к ходу (с названием), — для выбора объектов в приказах. */
  lines?: { id: string; name: string; line: LngLat[] }[];
  crossings?: { id: string; name: string; at: LngLat }[];
  /** Большие реки театра (для переправ в вариантах по правилам). */
  rivers?: { name: string; major: boolean; line: LngLat[] }[];
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
  /** Итоги игры (агентная модель): потери сторон по сыгранным часам (с часами до передачи командования) и исторические. */
  results?: OperationSummary;
  /** Разбор последнего хода (агентная модель, после первого сыгранного хода): ключевые события по правилам и штабы своей стороны. */
  debrief?: TurnDebrief;
  rangeHours: number;
  /** Свои переправы: действующие и наводимые; понтонных парков всего. */
  bridges: BridgeView[];
  parks: number;
  /** Понтонные парки по штабам: приданные, свои (минус приданные подчинённым), занятые наводкой; «top» — верхняя инстанция. */
  parksBy?: Record<string, { allot: number; own: number; busy: number }>;
  /** Решение прошлого хода (для продолжения работы над ним). */
  lastDecision: HumanDecision | null;
  /** Полосы и разграничительные линии своей стороны словами; действующие линии по директивам; объединение (фронт) каждого своего формирования. */
  sectors: string[];
  boundaries: { right: string; left: string; rightName: string; leftName: string; title: string; line: LngLat[] }[];
  groupOf: Record<string, string>;
  /** Армии стороны игрока с войсками на театре и их объединение верхнего уровня — для линий между армиями. */
  armies: { id: string; name: string; group: string; at: LngLat }[];
  /** Резервы (ждут ввода) и прибывающие войска — по армиям: объединение, его фронт, соединения. */
  reserveGroups: { id: string; name: string; status: 'reserve' | 'arriving'; front: string | null; members: string[] }[];
  /** Командование по ступеням (агентная модель): режим, кто решает за штабы, запросы, исторические директивы, документы. */
  command?: CommandView;
  /** Действия противника по ходам — все, без тумана войны (вкладка «Посредник»; последние 400). */
  enemyLog?: EnemyEntry[];
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
  /** Этап запроса штаба противника: ждёт очереди, модель читает обстановку, размышляет, пишет ответ. */
  | { kind: 'ai-phase'; text: string }
  /** Очередь к модели: чем она сейчас занята (метка запроса; null — свободна). */
  | { kind: 'llm-busy'; who: string | null }
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
  /** Варианты по правилам (game_variants): лучшие n и, если «продолжать» не среди них, — он с extra. */
  | { kind: 'plan-rules'; id: number; ok: boolean; variants?: CoreVariant[]; error?: string }
  | { kind: 'error'; message: string }
  /** Сообщение игроку, игра продолжается (например, запись разошлась с расчётом). */
  | { kind: 'notice'; text: string }
  /** Возврат сделан: игра на начале хода turn (время игры at), tail — снятые ходы turn… (приходит до record). */
  | { kind: 'rewound'; turn: number; at: string; tail: GameTurn[] }
  /** Переход на ветвь сделан: в линии turns сыгранных ходов. */
  | { kind: 'switched'; turns: number }
  /** Возврат не начат (идёт расчёт хода, такого хода нет): почему — словами. */
  | { kind: 'rewind-refused'; text: string }
  /** Вызов команды ядра агентной модели (Tauri) — поток сам её вызвать не может, вызывает основное окно; moment — время игры (доктрина штабов на момент хода). */
  | { kind: 'agents-call'; id: number; cmd: string; args: Record<string, unknown>; moment?: string }
  /** Справка по роли (и доктрина) из базы знаний окна — со слоем пользователя, закреплениями, смысловым поиском. */
  | { kind: 'kbRef'; id: number; req: KbRefRequest };

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

/** Приказ варианта по правилам ядра (game_variants). */
export interface CoreOrder {
  to: string; task: string; form: 'order' | 'instruction';
  axis: LngLat[]; immediate: LngLat[]; subsequent: LngLat[]; right: LngLat[]; left: LngLat[];
  commit?: boolean;
  /** Роль в построении: первый, второй эшелон, подвижная группа, введённая. */
  echelon?: 'first' | 'second' | 'mobile' | 'committed' | null;
  note: string;
  rule?: string | null;
}
/** Вариант командующего по правилам: вид, название, правило, оценка, ось, главный удар и резерв, приказы всем подчинённым. */
export interface CoreVariant { kind: string; label: string; rule: string; score: number; axis: LngLat[]; mainBlow: string[]; reserve?: string[]; extra?: boolean; orders: CoreOrder[] }
/** Приказ варианта получателю: имя, главный удар варианта; filled — дополнен правилом. */
export interface VariantDir extends CoreOrder { name: string; mainBlow: string[]; filled?: boolean; /** цель словами: «Зелов» */ target?: string }

/** Вариант решения на ход от советника: решение целиком, приказы и распоряжения, сопоставленные с обстановкой. */
export interface PlanVariantView {
  title: string;
  idea: string;
  decision: HumanDecision;
  orders: AdviceView['suggestions'];
  acts: PlanActView[];
  /** Откуда вариант: языковая модель (дополнена правилом) или правила ядра без модели. */
  source?: 'llm' | 'rules';
  /** Приказы всем подчинённым пункта: задача, ось, рубежи, разграничительные линии (пункт управления). */
  dirs?: VariantDir[];
  /** Нынешняя модель: объединения без новых приказов — прежние задачи. */
  kept?: string[];
  /** Пункт: подчинённые, чьи приказы дополнены правилом (у модели их не было). */
  filled?: string[];
  /** Исправление неисполнимых приказов по подсказке: сколько было отброшено и сколько исправлено. */
  fix?: { failed: number; fixed: number; error?: string; notes?: { n: number; text: string }[] };
}
