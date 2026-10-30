/**
 * «Командование»: игра с выбранного момента переигровки до победы (Знамя Победы) или поражения.
 * Советской стороной командует человек — с полной штабной работой: доклады
 * подчинённых, разведсводка, боевое распоряжение (приказы с задержкой доведения),
 * журнал боевых действий. Немецкой стороной — штаб на модели (LM Studio): решает
 * одновременно с человеком по своей обстановке. Посредник видит решения модели и
 * может снять туман войны. Игра сохраняется в браузере после каждого хода.
 */
import { confirmAsync, IN_APP } from './dialogs';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Resizer, usePanelWidth } from './panel-resize';
import { createFeature, migrateDocument, type ArrowFeature, type LngLat, type MapDocument } from '@def-ops/core';
import { groupManning, sideOf, TASK_RU, UMPIRE_FACTOR_RU, type ActionCheck, type GameRecord, type GameTurn, type Order, type StaffAction, type Task, type UnitReport } from '@def-ops/sim';
import { ADVICE_TREE, type AdviceNode, type AiTurn } from '@def-ops/staff-service/live';
import type { AdviceView, PlanVariantView, AiStatus, EnemyMode, GameRequest, GameResponse, GameStart, HumanDecision, Place, TurnView } from './sim/game-protocol';
import { MapView } from './MapView';
import type { MapEngine } from './engine/types';
import { BasemapControls, dmy, Popover } from './ui';
import { basemapDate } from './engine/basemaps';
import type { Basemaps, Llm } from './shared';
import { ZonesContext } from './time';
import { hiddenOn, LAYER_TITLE, LayersMenu, Legend, LevelSwitch, Player, useLegendHidden, useMapLabels, useMapLevel, type MapLevel } from './ReplayView';
import { withLevel } from './map-levels';
import { withHidden } from './map-legend';
import { MapHover, withoutLabels } from './MapHover';
import { shownFeatures, unitAt } from './map-pick';
import { IntelPanel, useEsc } from './FormationCard';
import { AgentMark } from './AgentCard';
import { Staffs, staffsOn, useStaffActions } from './CommandStaffs';
import { CommandPost, PostBar, usePost, type PostState } from './CommandPost';
import { ancestry, divisionsUnder, hqCenter, postDocs, postIntel, postJournal, postReports, postReserves } from './post-views';
import { ALL_SUBS, mergePriority, ordersSubs, parksKey, postBases, postBridges, postSupply, priorityLimit, priorityPool, staffDeny, staffScope, type StaffScope } from './post-staff';
import { dictate, dictateReady, sayAloud } from './voice/standalone';
import { petitionAnswer, petitionOp, petitionState, petitionText, type PetitionState } from './petition';
import { DIR_TASK_RU, issuers, postContext, recipients, resolveFrom, suggestionToDir, toDirective } from './command-post';
import { DRAFT_ACC, DRAFT_FIELDS, draftField, ensurePost, fieldPrompt, lastPostDecision, prefillDecision, type DraftField, type DraftScope } from './decision-drafts';

type AiFieldState = 'wait' | 'typing' | 'done';
/** Общий заказ советнику: сколько полей готово, какое пишется. */
type AiBatch = { issuer: string | null; done: number; total: number; cur: DraftField };
import { findHq, formTitle, initialCmds, markFor, placeText, queueOp, MODE_TITLE, overHead, savedGameMode, saveGameMode, defaultEnemy, enemyOptions, fitEnemy, liveEnemyOptions, modeReply, historyBackText, ENEMY_TITLE, umpireApplies, type CommandOp } from './command-forms';
import type { GameMode } from '@def-ops/sim';
import { inSector, SectorPicker, withFocus, type Sector } from './Sectors';
import * as kb from './kb/kb';
import { windowAnswer } from './sim/kb-ref';
import { KB_WAIT, kbBuilding, kbSettled } from './sim/kb-recompile';
import { openKbEntry } from './modeling/BasisTab';
import type { RoleScope } from '@def-ops/knowledge';
import { ModelPicker } from './ModelPicker';
import { ReviewView } from './ReviewView';
import { mdToHtml } from './markdown';
import { takeoverText, type TakeoverSummary } from './sim/takeover-state';
import { act, ActButton, openModal, register, speak, useAction, voiceLive, voiceRecent } from './voice/registry';
import { speakAnswersOn, useSpeakAnswers } from './voice/advisor-voice';
import { hl, setFlashMapView } from './voice/highlight';
import { setTourMap, type TourMapControl } from './voice/tour';
import { createTourMap } from './voice/tour-map';
import { zoneOverlays, zoneUrl } from './zones-overlay';
import { blockedArrived, releaseTurn, turnActions, type Missing, type ReviewCtl, type RewindResult, type SwitchResult, type TurnDeps } from './voice/actions/turn';
import { releaseScreen, screenActions, type ScreenDeps } from './voice/actions/screen';
import { announceTurn, resetUmpire, type UmpireModel } from './voice/umpire';
import { bindModelHold, setModelBusy } from './voice/model-queue';
import { askText, RETRY_DELAYS_MS } from './voice/llm';
import { commandActions, releaseCommand, TAKEOVER_REMIND, takeoverIsAnswer, takeoverParse, takeoverRead, type CommandDeps } from './voice/actions/command';
import {
  adviceReady, decisionMissing, NEEDS_TARGET, planReady, press, prevOf, projectHas, releaseStaff, staffActions, TASKS,
  type BoundsDraft, type OrderDraft, type PlanState, type StaffAct, type StaffDeps,
} from './voice/actions/staff';
import { dayMonth } from './voice/report';
import { speakable } from './voice/speech';
import { flyToHq, showAt } from './engine/free-center';
import { ECHELON_LEVEL } from './map-level-scale';
import { manningText } from './num-format';
import { branchName, checkoutBranch, commitGame, deleteBranch, forkBranch, lines as gameLines, MAIN_LINE, switchReply, unpackGame, withRecord, type SavedGame, type SwitchPending } from './game-branches';
import { TURN_REFUSAL } from './sim/game-rewind';
import { ribbonItems } from './turn-ribbon';
import { TurnRibbon } from './TurnRibbon';
import { idbBranchStore } from './game-branch-store';
import { ResultsTab } from './ResultsTab';
import { TurnDebriefPanel, useDebrief } from './TurnDebrief';
import { debriefResetKey } from './debrief-view';
import { DebriefOverlay } from './DebriefOverlay';
import { debriefFor } from '@def-ops/sim';
import type { BaselineState, ResultsPart } from './results-view';
import { baselineSummary } from './sim/baseline';
import { releaseResults, resultsActions, type ResultsDeps } from './voice/actions/results';

export const SAVE_KEY = 'def_ops.game';

/** Куда кнопки штабной работы пишут причину, если действие сейчас недоступно (CommandView подключает уведомление). */
let noticeSink: ((text: string) => void) | null = null;
/** Кнопка → действие реестра; недоступно (идёт расчёт хода, игра окончена) — причина в уведомлении, а не молча. */
const tap = (id: string, params?: unknown) => { void press(id, params, (r) => noticeSink?.(r)); };
/** Кнопка действия штабной работы (как ActButton, но с причиной, если сейчас нельзя). */
function StaffButton({ action, params, children, ...rest }: { action: string; params?: unknown; children?: ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return <button {...rest} data-action={action} onClick={() => tap(action, params)}>{children}</button>;
}
export type { SavedGame };
export function loadSaved(): SavedGame | null {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as SavedGame | null; return s?.record?.version === 1 ? unpackGame(s) : null; } catch { return null; }
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const toMs = (t: string) => Date.parse((t.length <= 16 ? t + ':00' : t) + 'Z');
const addH = (t: string, h: number) => new Date(toMs(t) + h * 3600_000).toISOString().slice(0, 16);
const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)}`;
const hhmm = (t: string) => t.slice(11, 16);
const dayLong = (t: string) => { const d = new Date(toMs(t)); return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`; };
const pct = (x: number) => `${Math.round(x * 100)} %`;
const num = (x: number) => x.toFixed(1).replace('.', ',');
const short = (n: string) => n.replace(/\s*\(.*?\)\s*/g, ' ').trim();
/** Справка советнику: операция игры, сторона игрока (пометка «своя сторона»/«противник»), история — только в вопросах истории. */
const advisorScope = (v: TurnView, history: boolean): RoleScope => ({
  role: 'advisor', operation: v.scenario, history, ...(v.human.id === 'su' || v.human.id === 'de' ? { side: v.human.id } : {}),
});

type Draft = OrderDraft;
type Tab = 'reports' | 'intel' | 'decision' | 'orders' | 'journal' | 'umpire' | 'staffs' | 'results';
type Sub = 'units' | 'rear' | 'bridges' | 'reserves' | 'bounds';
/** Распоряжение штаба в проекте: ключ (одно на базу, на резерв; приоритет — одно), действие и что сказала проверка. */
type Act = StaffAct;
type Pick = { kind: 'order' } | { kind: 'line' } | { kind: 'petition' } | { kind: 'bridge' } | { kind: 'base'; base: string; name: string; from: LngLat } | { kind: 'commit'; formation: string; name: string; members?: { id: string; name: string }[] };
interface AdvMsg { id: number; cat: string; catId: string; q: string; answer: string; wait?: string; result?: AdviceView }
const EMPTY: HumanDecision = { assessment: '', enemyIntent: '', intent: '', report: '', risks: '' };
/** Решение нового хода: оценка и донесение — заново; замысел, замысел противника и риски — от прошлого решения, для правки. */
const freshDecision = (last: HumanDecision | null | undefined): HumanDecision => ({ ...EMPTY, enemyIntent: last?.enemyIntent ?? '', intent: last?.intent ?? '', risks: last?.risks ?? '' });
const capFirst = (x: string) => `${x.charAt(0).toUpperCase()}${x.slice(1).replace(/[.!\s]+$/, '')}.`;
/** Возврат к ходу или переход на ветвь, отданный потоку: ответ ждёт rewound / switched / rewind-refused. */
const WAIT_FAIL = 'поток игры остановился — возврат не выполнен';
/** Предельное ожидание ответа потока на возврат или переход на ветвь. */
const REWIND_WAIT_MS = 5 * 60_000;
type RewindWait = { kind: 'rewind'; resolve: (r: RewindResult) => void } | ({ kind: 'switch'; resolve: (r: SwitchResult) => void } & SwitchPending);

const TOGGLES = [
  { key: 'ghosts', title: 'Ист. положения', match: (id: string) => id === 'hist-units' || id === 'hist-marks' || id === 'lvl-op-hist' },
  { key: 'hfront', title: 'Ист. фронт', match: (id: string) => id === 'hist-front' },
  { key: 'front', title: 'Фронт', match: (id: string) => id === 'sim-front' || id.startsWith('sim-front-') },
  { key: 'combat', title: 'Бои', match: (id: string) => id === 'sim-combat' },
  { key: 'plan', title: 'Замысел', match: (id: string) => id === 'plan' },
  { key: 'rear', title: 'Тыл', match: (id: string) => id === 'logistics' },
  { key: 'rivers', title: 'Реки', match: (id: string) => id === 'rivers' },
  { key: 'pockets', title: 'Котлы', match: (id: string) => id === 'sim-pockets' },
  { key: 'fortress', title: 'Крепости', match: (id: string) => id === 'sim-fortress' },
  { key: 'hbounds', title: 'Ист. разгр. линии', match: (id: string) => id === 'hist-bounds' },
  { key: 'bounds', title: 'Полосы', match: (id: string) => id === 'sim-bounds' },
  // зоны влияния сторон — не слой знаков, а картинка под ними (zones-overlay.ts)
  { key: 'zones', title: 'Зоны влияния', match: () => false },
];

export function CommandView({ bm, llm, start, saved, enemy: enemy0, note, onExit, onOpenInEditor }: {
  bm: Basemaps; llm: Llm; start: GameStart | null; saved: SavedGame | null; enemy: EnemyMode; /** Сообщение при входе (например, замена недопустимого противника при продолжении). */ note?: string;
  onExit: (opts: { discard: boolean }) => void; onOpenInEditor: (d: MapDocument) => void;
}) {
  const [view, setView] = useState<TurnView | null>(null);
  // проверки в браузере (сквозные скрипты): обстановка хода — только при разработке
  useEffect(() => { if (import.meta.env.DEV) (window as unknown as { __cmdView: TurnView | null }).__cmdView = view; }, [view]);
  const [progress, setProgress] = useState<string | null>('запуск…');
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus>({ state: 'off' });
  const [stream, setStream] = useState('');
  const [aiPhase, setAiPhase] = useState('');
  const [blocked, setBlocked] = useState<string | null>(null);
  const [record, setRecord] = useState<GameRecord | null>(saved?.record ?? null);
  const [enemy, setEnemy] = useState<EnemyMode>(saved?.enemy ?? enemy0);
  // противники, которых допускает режим игры (ядро — game::enemy_for): в ходе игры сменить можно только их
  const gameSpec = record?.agents ?? start?.agents;
  const enemyChoices = liveEnemyOptions(!!gameSpec, gameSpec?.mode ?? 'legacy');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [tab, setTab] = useState<Tab>('reports');
  const [resPart, setResPart] = useState<ResultsPart>('losses');
  // «переигровка без вмешательства» того же сценария и seed — при первом открытии части «Сравнение»
  const [baseline, setBaseline] = useState<BaselineState>({ state: 'off' });
  const [sel, setSel] = useState<string | null>(null);
  const [pickMode, setPickMode] = useState<Pick | null>(null);
  const pick = pickMode?.kind === 'order';
  const setPick = (b: boolean) => setPickMode(b ? { kind: 'order' } : null);
  const [sub, setSub] = useState<Sub>('units');
  const [acts, setActs] = useState<Act[]>([]);
  /** Команды управления на ход (командование по ступеням): взять, вернуть, ответ на запрос, исторические директивы. */
  const [cmds, setCmds] = useState<CommandOp[]>([]);
  /** Линия армий, указываемая на карте: точки по щелчкам. */
  const [linePts, setLinePts] = useState<LngLat[]>([]);
  /** Добавить точку в линию ходатайства открытого пункта (щелчок по карте; обработчик карты — один на сценарий). */
  const petPoint = useRef<(at: LngLat) => void>(() => undefined);
  const [decision, setDecision] = useState<HumanDecision>(EMPTY);
  /** Решения штабов ступеней ниже Ставки (пункт управления): по штабу. */
  const [postDecisions, setPostDecisions] = useState<Record<string, HumanDecision>>({});
  /** Поля решения, составленные по обстановке и ещё не правленые (пометка «проверьте»): по штабу, «» — верхняя инстанция. */
  const [autoFields, setAutoFields] = useState<Record<string, DraftField[]>>({});
  const unAuto = (k: string, fs: string[]) => setAutoFields((m) => (m[k]?.some((f) => fs.includes(f)) ? { ...m, [k]: m[k].filter((f) => !fs.includes(f)) } : m));
  /** Счётчик открытий хода (новый ход, проект с чистого листа): решение составляется после отрисовки обстановки. */
  const [opened, setOpened] = useState(0);
  // разбор операции: окно открывается после игры (или из меню); пока пишется, остаётся смонтированным
  const [review, setReview] = useState<'closed' | 'open' | 'hidden'>('closed');
  const reviewListener = useRef<((m: Extract<GameResponse, { kind: 'review-stream' | 'review-wait' | 'review-think' | 'review-done' }>) => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(note ?? null);
  useEffect(() => { noticeSink = setNotice; return () => { if (noticeSink === setNotice) noticeSink = null; }; }, []);
  const checks = useRef(new Map<number, (r: ActionCheck) => void>());
  const checkId = useRef(0);
  const [advOpen, setAdvOpen] = useState(false);
  /** Советник свёрнут во вкладку у края карты (беседа сохраняется). */
  const [advMin, setAdvMin] = useState(false);
  const [advSeen, setAdvSeen] = useState(0);
  /** Узкий экран (телефон): панель штаба или карта. */
  const [mob, setMob] = useState<'staff' | 'map'>('staff');
  /** Участок в фокусе; focusOnly — доклады, разведка, приказы только по нему. */
  const [focus, setFocus] = useState<Sector | null>(null);
  const [focusOnly, setFocusOnly] = useState(true);
  const [eng, setEng] = useState<MapEngine | null>(null);
  // метка места на карте при подсветке исполненного голосом (voice/highlight)
  useEffect(() => (eng ? setFlashMapView(eng) : undefined), [eng]);
  // карта шагов разбора хода (voice/tour-map): переезд к месту, метка и рамка, проигрывание хода
  // та же карта — и у разбора хода во вкладке «Итоги» (щелчок по событию): tourMapRef
  const tourMapRef = useRef<TourMapControl | null>(null);
  useEffect(() => {
    if (!eng) return undefined;
    const m = createTourMap({
      engine: () => engine.current, setTime, now: () => liveView.current?.time ?? null, level: () => levelRef.current, setLevel,
      frame: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id), clock: () => performance.now(),
    });
    tourMapRef.current = m;
    const off = setTourMap(m);
    return () => { off(); if (tourMapRef.current === m) tourMapRef.current = null; };
  }, [eng]); // eslint-disable-line react-hooks/exhaustive-deps
  const [adv, setAdv] = useState<AdvMsg[]>([]);
  const [advQ, setAdvQ] = useState('');  // поле вопроса советнику (общее с голосом: «запиши в вопрос …»)
  const [plan, setPlanState] = useState<PlanState | null>(null);
  /** Варианты — и в ref: сообщения потока идут чаще отрисовки, итог («готово») говорится по самому свежему. */
  const planLive = useRef<PlanState | null>(null);
  const setPlan = (p: PlanState | null | ((p: PlanState | null) => PlanState | null)) => {
    const n = typeof p === 'function' ? p(planLive.current) : p;
    planLive.current = n;
    setPlanState(n);
  };
  /** Вариант, раскрытый на экране (щелчком или «подробнее о …»). */
  const [planOpen, setPlanOpen] = useState<number | null>(0);
  const [time, setTime] = useState<string | null>(null);
  const [level, setLevel] = useMapLevel();
  const [legendHidden, setLegendHidden, clearLegend] = useLegendHidden();
  const lvHidden = useMemo(() => hiddenOn(legendHidden, level), [legendHidden, level]);
  // ширина панели командования и окна советника — перетаскиванием края
  const [sideW, setSideW, resetSideW] = usePanelWidth('def_ops.command.sideW', 410, 320, 900);
  const [advW, setAdvW, resetAdvW] = usePanelWidth('def_ops.command.advW', 390, 300, 900);
  /** Пункт управления по уровню карты (агентная модель); ссылка — для обработчика щелчка по карте. */
  // смена уровня из пункта управления — как переключателем: с масштабом уровня
  const levelTo = (l: MapLevel) => { void act('map.level', { level: l }); };
  const post = usePost(view, level, levelTo, cmds, setCmds, !!progress, staffsOn(view), () => { setTab('orders'); setSub('units'); }, (id) => tap('map.hq', { name: id }));
  const postRef = useRef<PostState | null>(null);
  postRef.current = post;
  /** Пункт управления для советника (агентная модель, режимы командования по ступеням). */
  const postCtx = () => (view && staffsOn(view) && post.issuer ? postContext(view, post.level, post.issuer, cmds) : undefined);
  /** Пункт ниже Ставки: решение — его штаба, не Ставки. */
  const lowPost = () => !!(view && staffsOn(view) && post.issuer && view.command?.hqs[post.issuer]?.echelon !== 'high_command');
  /** Предложенный приказ → документ пункта в очереди хода. */
  const toPostDir = (o: { formation: string; task: string; at: LngLat | null; why: string }) => {
    const d = suggestionToDir(o, post.level);
    setCmds((q) => queueOp(q, { op: 'directive', directive: { ...toDirective(d, view!), issuer: post.issuer } as unknown as { to: string; task: string; form: string } }));
  };
  // указание пункта управления и прежние указания на карте (полосы, тыл) друг друга снимают; смена вкладки — тоже
  const wantBaseline = tab === 'results' && resPart === 'compare' && view?.engine === 'agents' && !!view.results;
  const baseScen = view?.scenario, baseSeed = view?.seed;
  useEffect(() => {
    if (!wantBaseline || baseline.state !== 'off' || !baseScen || baseSeed == null) return;
    setBaseline({ state: 'wait' });
    // на поправках ядра, с которыми игра начата (запись; как у потока игры — gameKbData), записи ещё нет — на нынешних
    const rec = savedRef.current?.record;
    baselineSummary(baseScen, baseSeed, {}, rec ? { edits: rec.kb ? rec.kb.core ?? null : null } : {})
      .then((summary) => setBaseline({ state: 'ready', summary }))
      .catch((e) => setBaseline({ state: 'error', text: String((e as Error)?.message ?? e) }));
  }, [wantBaseline, baseScen, baseSeed]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { post.cancelPick(); }, [tab, sub]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (pickMode) post.cancelPick(); }, [pickMode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (post.pick) setPickMode(null); }, [post.pick]);
  const levelRef = useRef(level);
  levelRef.current = level;
  const [labels, toggleLabels] = useMapLabels();
  const [vis, setVis] = useState<Record<string, boolean>>({ ghosts: false, hfront: false, front: true, combat: true, plan: true, rear: true, rivers: true, hbounds: true, bounds: true });
  const [reveal, setReveal] = useState(false);
  const [now, setNow] = useState(Date.now());
  const worker = useRef<Worker | null>(null);
  const engine = useRef<MapEngine | null>(null);
  const [intelSel, setIntelSel] = useState<string | null>(null);
  /** Вкладка «Посредник»: как действовал противник или поправки посредника. */
  const [umpPart, setUmpPart] = useState<'enemy' | 'umpire'>('enemy');
  /** Разбор операции, пока его окно смонтировано (голосом: составить, прочитать, сохранить). */
  const reviewCtl = useRef<ReviewCtl | null>(null);
  const llmRef = useRef(llm); llmRef.current = llm;
  const aiRef = useRef(ai); aiRef.current = ai;
  /** Обстановка хода — сразу по сообщению (до отрисовки) и предыдущая: доклад посредника о только что посчитанном ходе. */
  const viewNow = useRef<{ cur: TurnView | null; prev: TurnView | null }>({ cur: null, prev: null });
  /** Обстановка на начало прошедшего хода (последняя с другим временем) — разбор хода: откуда проигрывать. */
  const turnStart = useRef<TurnView | null>(null);
  /** Сколько ходов было в записи игры, когда она пришла впервые (новый ход — запись длиннее: посредник докладывает). */
  const turnsSeen = useRef<number | null>(null);
  const live = useRef<{ pickMode: Pick | null; sel: string | null; mapDoc: MapDocument | null; time: string | null }>({ pickMode, sel, mapDoc: null, time: null });
  live.current = { ...live.current, pickMode, sel };
  const liveView = useRef<TurnView | null>(null);
  liveView.current = view;

  const send = (m: GameRequest) => worker.current?.postMessage(m);

  useEffect(() => {
    // база знаний окна — заранее: первая справка посреднику и штабу противника не ждёт загрузки базы до срока потока
    void kb.load().catch(() => undefined);
    const w = new Worker(new URL('./sim/game-worker.ts', import.meta.url), { type: 'module' });
    worker.current = w;
    w.onmessage = (e: MessageEvent<GameResponse>) => {
      const m = e.data;
      lastBeat.current = Date.now();
      if (m.kind === 'progress') setProgress(m.text);
      else if (m.kind === 'error') { setProgress(null); setError(m.message); failWait(rewindWait.current, WAIT_FAIL); }
      else if (m.kind === 'notice') setNotice(m.text);
      else if (m.kind === 'view') {
        // первая обстановка игры — голосом (если голосом пользуются): можно спрашивать
        if (!liveView.current && voiceRecent()) speak(speakable(`Обстановка готова, ход ${m.view.turn}. Скажите, например: «Штаб, доложи обстановку».`, { full: true }));
        setProgress(null); setBlocked(null);
        if (viewNow.current.cur && viewNow.current.cur.time !== m.view.time) turnStart.current = viewNow.current.cur;
        viewNow.current = { cur: m.view, prev: viewNow.current.cur };
        // новый ход — прежние уведомления («решение не готово») устарели
        if (viewNow.current.prev && viewNow.current.prev.time !== m.view.time) setNotice(null);
        setView({ ...m.view, doc: migrateDocument(m.view.doc) });
        setTime(m.view.time);
        // победа — к моменту и месту события (Знамя Победы)
        const o = m.view.outcome;
        if (o?.result === 'victory' && o.at) {
          setTime(o.at);
          const g = m.view.goals.find((x) => x.at === o.at && x.place);
          if (g?.place) setTimeout(() => engine.current?.setView({ center: g.place!, zoom: 12 }), 300);
        }
        setDrafts({}); setActs([]); setLinePts([]); setPickMode(null);
        // новый ход — очередь команд пуста; первый ход — уже действующие исторические директивы (в «гибриде» — все)
        setCmds((q) => (liveView.current?.time === m.view.time ? q : initialCmds(m.view)));
        // новый ход — решение составляется заново по обстановке (эффект по opened): оценка и донесение — новые; замысел,
        // замысел противника и риски — от прошлого решения; решения штабов ступеней — при открытии их пунктов
        if (liveView.current?.time !== m.view.time) { setDecision(freshDecision(m.view.lastDecision)); setPostDecisions({}); setAutoFields({}); setOpened((n) => n + 1); }
      } else if (m.kind === 'ai') setAi(m.status);
      else if (m.kind === 'ai-stream') { setStream((s) => (m.reset ? '' : (s + m.text).slice(-4000))); }
      else if (m.kind === 'ai-phase') setAiPhase(m.text);
      else if (m.kind === 'llm-busy') setModelBusy('game', m.who); // голос знает, чем занята модель, и ждёт её
      else if (m.kind === 'blocked') { setProgress(null); setBlocked(m.error); blockedArrived(m.error); }
      else if (m.kind === 'rewound') {
        // возврат к ходу: проект хода — с чистого листа, доклад посредника за снятые ходы не звучит; прежняя линия — ветвью
        // (по сохранённой записи, пока в ней все ходы: запись потока придёт следом и ляжет после развилки — очередь saveStep)
        turnsSeen.current = m.turn - 1;
        freshProject();
        const w8 = rewindWait.current?.kind === 'rewind' ? rewindWait.current : null;
        if (w8) rewindWait.current = null;
        void saveStep(async () => {
          const r = await forkLine(m.turn, m.at, m.tail);
          w8?.resolve(r);
        });
      } else if (m.kind === 'switched') {
        turnsSeen.current = m.turns;
        freshProject();
        const w8 = rewindWait.current?.kind === 'switch' ? rewindWait.current : null;
        if (w8) rewindWait.current = null;
        // ожидание уже снято (срок, ошибка потока), запись вернули прежней — а поток всё же на ветви: запись снова после перехода
        const late = w8 ? null : lateSwitch.current;
        lateSwitch.current = null;
        const x = w8 ? switchReply(w8, 'switched', false) : late ? switchReply(late, 'switched', true) : null;
        void saveStep(async () => {
          if (x?.save) {
            putSaved(x.save);
            const r = await commitGame(idbBranchStore, localStorage, SAVE_KEY, { game: x.save, stale: [] });
            setNotice(r.error ? capFirst(r.error) : `Переход на ветвь «${x.save.line ?? MAIN_LINE}» всё же выполнен — запись игры на ней.`);
          }
          // ходы выбранной ветви теперь в записи игры — её прежняя копия в хранилище не нужна
          for (const k of x?.del ?? []) await idbBranchStore.del(k).catch(() => { /* лишняя запись — не потеря */ });
          w8?.resolve({ ok: true, name: savedRef.current?.line ?? MAIN_LINE, turns: m.turns });
        });
      } else if (m.kind === 'rewind-refused') {
        const w8 = rewindWait.current;
        setNotice(capFirst(m.text));
        // ход отдан во время возврата — отказ ходу, возврат идёт дальше
        if (m.text === TURN_REFUSAL || !w8) { if (!w8) setProgress(null); }
        else {
          rewindWait.current = null;
          setProgress(null);
          if (w8.kind === 'switch') {
            // поток на ветвь не перешёл — запись игры прежняя
            void saveStep(async () => { putSaved(w8.prev); await commitGame(idbBranchStore, localStorage, SAVE_KEY, { game: w8.prev, stale: [] }).catch(() => undefined); w8.resolve({ ok: false, text: m.text }); });
          } else w8.resolve({ ok: false, text: m.text });
        }
      }
      else if (m.kind === 'check') { checks.current.get(m.id)?.(m.result); checks.current.delete(m.id); }
      else if (m.kind === 'advice-stream') { if (!fieldFns.current.stream(m.id, m.text)) setAdv((l) => l.map((x) => (x.id === m.id ? { ...x, answer: x.answer + m.text, wait: undefined } : x))); }
      else if (m.kind === 'advice-wait') setAdv((l) => l.map((x) => (x.id === m.id ? { ...x, wait: m.text } : x)));
      else if (m.kind === 'review-stream' || m.kind === 'review-wait' || m.kind === 'review-think' || m.kind === 'review-done') reviewListener.current?.(m);
      else if (m.kind === 'plan-progress') setPlan((p) => (p?.id === m.id ? { ...p, progress: m.text } : p));
      else if (m.kind === 'plan-variant') setPlan((p) => { if (p?.id !== m.id) return p; const v = [...p.variants]; v[m.index] = m.variant; return { ...p, variants: v }; });
      else if (m.kind === 'plan-done') {
        const p = planLive.current;
        if (p?.id === m.id) {
          const n = { ...p, done: true, error: m.error, warning: m.warning, seconds: m.seconds, model: m.model };
          setPlan(n);
          // просили голосом — штаб докладывает, что варианты готовы
          planReady(n);
        }
      }
      else if (m.kind === 'advice') {
        // советник писал поле решения — текст в поле, не в ленту и не вслух
        if (fieldFns.current.done(m.id, m.result)) { /* поле */ }
        else {
          setAdv((l) => l.map((x) => (x.id === m.id ? { ...x, answer: m.result.answer, result: m.result } : x)));
          // спрашивали голосом — ответ коротко вслух (голосовое управление на связи)
          adviceReady(m.id, m.result);
          // голосового управления нет (выключено, дежурит, сервиса нет) — ответ читается своим голосом, если включено чтение
          if (speakAnswersOn() && !voiceLive() && m.result.ok && m.result.answer.trim()) { readStop.current?.(); readStop.current = sayAloud(m.result.answer); }
        }
      }
      else if (m.kind === 'agents-call') {
        // ход агентной модели считает ядро приложения: поток вызывает команду через окно; к ходу — доктрина из базы
        // окна на время игры для штабов на модели (базы нет — без поля, ядро берёт зашитый текст)
        // повтор записи: доктрина хода уже в args (поле есть, null — база не давала) — из записи, а не из нынешней базы;
        // в ответ — доктрина, с которой ход считан (в запись игры)
        const given = m.cmd === 'game_turn' && 'doctrineText' in m.args;
        void Promise.all([import('@tauri-apps/api/core'), m.cmd !== 'game_turn' ? undefined : given ? (m.args.doctrineText as { su?: string; de?: string } | null) ?? undefined : import('./sim/kb-doctrine').then((d) => d.agentDoctrineText(m.moment))])
          .then(([{ invoke }, doctrineText]) => invoke(m.cmd, m.cmd === 'game_turn' ? { ...m.args, doctrineText } : m.args).then((result) => ({ result, doctrineText })))
          .then(({ result, doctrineText }) => w.postMessage({ kind: 'agents-reply', id: m.id, ok: true, result, ...(m.cmd === 'game_turn' ? { doctrineText: doctrineText ?? null } : {}) } satisfies GameRequest))
          .catch((err) => w.postMessage({ kind: 'agents-reply', id: m.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies GameRequest));
      } else if (m.kind === 'kbRef') {
        // справка по роли из базы окна (слой пользователя, закрепления, смысловой поиск), доктрина — на момент хода;
        // ошибка базы — ok: false, поток считает по сиду и пишет заметку в журнал
        void windowAnswer(kb, m.req)
          .then((answer) => w.postMessage({ kind: 'kbRefResult', id: m.id, ok: true, answer } satisfies GameRequest))
          .catch((err) => w.postMessage({ kind: 'kbRefResult', id: m.id, ok: false, error: String((err as Error)?.message ?? err) } satisfies GameRequest));
      } else if (m.kind === 'record') {
        setRecord(m.record);
        // ход посчитан (запись стала длиннее): доклад посредника его голосом — по обстановке, что пришла перед записью
        const n = m.record.turns.length;
        if (turnsSeen.current !== null && n > turnsSeen.current && viewNow.current.cur) {
          // штаб противника ждёт доклада посредника (umpire-done): не занимает модель раньше него
          void announceTurn({ view: viewNow.current.cur, prev: turnStart.current, record: m.record, ai: aiRef.current, model: umpireModel(),
            onDone: () => w.postMessage({ kind: 'umpire-done' } satisfies GameRequest) });
        }
        turnsSeen.current = n;
        const rec = m.record;
        // поздний ответ на снятый переход без switched: поток остался на прежней линии — запись уже прежняя
        lateSwitch.current = null;
        // запись — по очереди с развилкой и переходом на ветвь (они меняют сохранённую запись асинхронно)
        void saveStep(async () => {
          // переход на ветвь не удался (запись пришла без switched): сохранённая запись — прежняя
          const w8 = rewindWait.current;
          if (w8?.kind === 'switch') { rewindWait.current = null; setProgress(null); putSaved(switchReply(w8, 'record', false).save!); w8.resolve({ ok: false, text: 'ветвь не применена — подробности на экране' }); }
          const next = withRecord(savedRef.current, rec, enemyRef.current, titleRef.current, rec.turns.length ? addH(rec.turns[rec.turns.length - 1].time, 0) : rec.takeover);
          putSaved(next);
          // ветви: ходы — в IndexedDB (старая запись с ходами в localStorage переносится при первой записи); сообщение об ошибке — один раз
          const r = await commitGame(idbBranchStore, localStorage, SAVE_KEY, { game: next, stale: [] });
          if (savedRef.current === next && r.game.branches !== next.branches) putSaved({ ...next, branches: r.game.branches, ...(r.game.gid ? { gid: r.game.gid } : {}) });
          if (r.error && r.error !== lostShown.current) { lostShown.current = r.error; setNotice(r.error); }
        });
      }
    };
    w.onerror = (e) => { setProgress(null); setError(e.message || 'ошибка игры'); failWait(rewindWait.current, WAIT_FAIL); };
    const st: GameStart = saved ? { scenario: saved.record.scenario, rules: saved.record.rules, seed: saved.record.seed, takeover: saved.record.takeover } : start!;
    // новая игра берёт данные операции и состояние при передаче из нынешней сборки базы знаний — сначала дождаться
    // её (идёт после запуска и после правки базы); сохранённая игра восстанавливается на данных своего начала
    let live = true;
    if (!saved && kbBuilding()) setProgress(KB_WAIT);
    void (saved ? Promise.resolve() : kbSettled()).then(() => { if (live) w.postMessage({ kind: 'start', start: st, record: saved?.record, llm: llm.settings, enemy } satisfies GameRequest); });
    // голос — первым в очереди к модели: пока он ждёт её или спрашивает, новые запросы игры не начинаются
    const unhold = bindModelHold((on) => w.postMessage({ kind: 'llm-hold', on } satisfies GameRequest));
    return () => { live = false; unhold(); w.terminate(); setModelBusy('game', null); resetUmpire(); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  /** Модель посредника для доклада: обычный срок и повторы (связь с моделью не прошла проверку — без неё, честно). */
  const umpireModel = (): UmpireModel | null => (llmRef.current.check.state === 'fail' ? null
    : (system, text, o) => askText(system, text, { settings: llmRef.current.settings, signal: o.signal, delays: RETRY_DELAYS_MS }));
  const enemyRef = useRef(enemy); enemyRef.current = enemy;
  /** Запись игры как лежит в хранилище (ветви и имя линии сохраняются при каждой записи хода). */
  const savedRef = useRef<SavedGame | null>(saved);
  /** Та же запись для отрисовки (лента ходов, окно «Ветви»). */
  const [savedGame, setSavedGame] = useState<SavedGame | null>(saved);
  const putSaved = (s: SavedGame | null) => { savedRef.current = s; setSavedGame(s); };
  const lostShown = useRef<string | null>(null);
  /** Перемены сохранённой записи — строго по очереди (развилка, запись хода, переход на ветвь, удаление ветви). */
  const chain = useRef<Promise<void>>(Promise.resolve());
  const saveStep = (f: () => Promise<void>) => { chain.current = chain.current.then(f).catch(() => { /* хранилища нет — игра идёт без записи */ }); return chain.current; };
  const rewindWait = useRef<RewindWait | null>(null);
  /** Переход на ветвь, ожидание которого снято по сроку или ошибке потока: поток может ещё ответить (switchReply). */
  const lateSwitch = useRef<SwitchPending | null>(null);
  /** Когда поток последний раз что-то прислал (предельное ожидание возврата). */
  const lastBeat = useRef(0);
  // ход решений штабов в ядре приложения (staff-progress) — тоже знак, что игра жива: поток ждёт ядро и молчит
  useEffect(() => {
    if (!IN_APP) return;
    let off: (() => void) | null = null, live = true;
    void import('@tauri-apps/api/event').then(({ listen }) => listen('staff-progress', () => { lastBeat.current = Date.now(); }))
      .then((u) => { if (live) off = u; else u(); }).catch(() => undefined);
    return () => { live = false; off?.(); };
  }, []);
  const [branchesOpen, setBranchesOpen] = useState(false);
  /** Номер линии: возврат к ходу и переход на ветвь — новый (разбор хода того же времени на другой линии — с чистого листа). */
  const [lineEpoch, setLineEpoch] = useState(0);
  /** Проект хода — с чистого листа (возврат, переход на ветвь): как при смене хода, плюс решения пунктов и доклад посредника. */
  const freshProject = () => {
    const v = viewNow.current.cur;
    setLineEpoch((n) => n + 1);
    turnStart.current = null;
    resetUmpire();
    setProgress(null); setBlocked(null);
    setDrafts({}); setActs([]); liveActs.current = []; setPostDecisions({}); setLinePts([]); setPickMode(null);
    setAutoFields({});
    if (v) { setCmds(initialCmds(v)); setDecision(freshDecision(v.lastDecision)); setOpened((n) => n + 1); }
  };
  /**
   * Прежняя линия после возврата к ходу n — ветвью. Хранилище ветвей отказало — ходы ветви остаются в самой записи
   * (как в старых записях): следующая запись игры снова попробует перенести их в хранилище, ничего не теряется.
   */
  const forkLine = async (n: number, at: string, tail: GameTurn[]): Promise<RewindResult> => {
    const cur = savedRef.current;
    if (!cur || !tail.length) return { ok: true, at, branch: null };
    const now = new Date().toISOString();
    try {
      const s = await forkBranch(idbBranchStore, cur, n, at, tail, now);
      const added = (s.branches ?? []).find((b) => !(cur.branches ?? []).some((x) => x.id === b.id));
      putSaved(s);
      return added ? { ok: true, at, branch: added.name } : { ok: true, at, branch: null, dup: true };
    } catch (e) {
      const old = [...cur.record.turns.slice(0, n - 1), ...tail];
      const name = branchName(n, at, [cur.line ?? MAIN_LINE, ...(cur.branches ?? []).map((b) => b.name)]);
      putSaved({ ...cur, record: { ...cur.record, turns: cur.record.turns.slice(0, n - 1) },
        branches: [...(cur.branches ?? []), { id: `b${Date.parse(now)}`, name, from: n, at, created: now, count: old.length, enemy: cur.enemy, turns: old }] });
      setNotice(`Ветвь пока не в хранилище окна: ${(e as Error)?.message ?? e}. Запись попробует ещё раз.`);
      return { ok: true, at, branch: name };
    }
  };
  /**
   * Возврат или переход не закончится (поток упал, не ответил за REWIND_WAIT_MS): ждущий ответ — отказом, переход —
   * с прежней сохранённой записью, индикатор хода снят.
   */
  const failWait = (w8: RewindWait | null, text: string) => {
    if (!w8 || rewindWait.current !== w8) return;
    rewindWait.current = null;
    setProgress(null);
    setNotice(capFirst(text));
    if (w8.kind === 'switch') {
      // переход уже отдан потоку — он может ещё ответить switched: тогда запись снова после перехода (switchReply)
      const x = switchReply(w8, 'fail', false);
      if (x.keep) lateSwitch.current = w8;
      void saveStep(async () => { putSaved(x.save); await commitGame(idbBranchStore, localStorage, SAVE_KEY, { game: x.save!, stale: [] }); });
      w8.resolve({ ok: false, text });
    } else w8.resolve({ ok: false, text });
  };
  /** Поток молчит REWIND_WAIT_MS (ни одного сообщения: переход на длинную ветвь шлёт ход за ходом) — отказ. */
  const guard = (w8: RewindWait) => {
    const tick = () => { if (rewindWait.current !== w8) return; const idle = Date.now() - lastBeat.current; if (idle >= REWIND_WAIT_MS) failWait(w8, WAIT_FAIL); else setTimeout(tick, REWIND_WAIT_MS - idle); };
    lastBeat.current = Date.now();
    setTimeout(tick, REWIND_WAIT_MS);
  };
  /** «Вернуться к ходу N»: поток возвращается, ответ — после развилки. */
  const rewindTo = (turn: number) => new Promise<RewindResult>((resolve) => {
    if (rewindWait.current) { resolve({ ok: false, text: 'идёт возврат к ходу — подождите' }); return; }
    const w8: RewindWait = { kind: 'rewind', resolve };
    rewindWait.current = w8;
    guard(w8);
    setProgress(`возврат к ходу ${turn}…`);
    send({ kind: 'rewind', turn });
  });
  /** Перейти на ветвь: сначала запись игры (текущая линия — ветвью), затем поток досчитывает ходы ветви. */
  const switchTo = (id: string) => new Promise<SwitchResult>((resolve) => {
    const prev = savedRef.current;
    if (rewindWait.current) { resolve({ ok: false, text: 'идёт возврат к ходу — подождите' }); return; }
    if (!prev) { resolve({ ok: false, text: 'запись игры ещё не сохранена' }); return; }
    const w8: RewindWait = { kind: 'switch', resolve, prev, next: null, stale: [] };
    rewindWait.current = w8;
    guard(w8);
    setProgress('переход на ветвь…');
    void saveStep(async () => {
      try {
        const c = await checkoutBranch(idbBranchStore, prev, id, new Date().toISOString());
        const r = await commitGame(idbBranchStore, localStorage, SAVE_KEY, { game: c.game, stale: [] });
        if (!r.saved) throw new Error(r.error ?? 'запись игры не сохранилась');
        // ожидание сняли, пока шла запись (поток упал): переход потоку не отдаётся, следующий шаг очереди вернёт прежнюю запись
        if (rewindWait.current !== w8) return;
        if (r.error) setNotice(capFirst(r.error));
        w8.stale = c.stale;
        w8.next = r.game;
        putSaved(r.game);
        send({ kind: 'switch', turns: r.game.record.turns });
      } catch (e) {
        if (rewindWait.current === w8) rewindWait.current = null;
        setProgress(null);
        const text = String((e as Error)?.message ?? e);
        // и для мыши: «Перейти» в окне «Ветви» — причина на экране
        setNotice(capFirst(`ветвь не открыта: ${text}`));
        resolve({ ok: false, text });
      }
    });
  });
  /** Удалить ветвь: запись игры без неё, затем её ходы. */
  const dropBranch = (id: string) => new Promise<string | null>((resolve) => {
    // переход на ветвь ещё не закончен (или поток может ответить на снятый) — запись игры может смениться
    if (rewindWait.current?.kind === 'switch' || lateSwitch.current) { resolve('идёт переход на ветвь — удалить ветвь можно, когда он закончится'); return; }
    void saveStep(async () => {
      const s = savedRef.current;
      if (!s) { resolve('запись игры ещё не сохранена'); return; }
      const r = await deleteBranch(idbBranchStore, localStorage, SAVE_KEY, s, id);
      if (r.saved) putSaved(r.game);
      if (r.error) setNotice(capFirst(r.error));
      resolve(r.saved ? null : r.error);
    });
  });
  const titleRef = useRef(''); titleRef.current = view?.scenarioName ?? saved?.title ?? '';

  // телефон: выбор места на карте — показать карту, выбрано — вернуться к штабу
  const hadPick = useRef(false);
  useEffect(() => { if (pickMode) { hadPick.current = true; setMob('map'); } else if (hadPick.current) { hadPick.current = false; setMob('staff'); } }, [pickMode]);
  useEffect(() => { send({ kind: 'settings', llm: llm.settings, enemy }); }, [llm.settings, enemy]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (ai.state !== 'thinking') return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [ai.state]);

  // выбор точки на карте (цель приказа) и знака (формирование)
  useEffect(() => {
    const en = engine.current;
    if (!en) return;
    return en.on('click', (e) => {
      const pm = live.current.pickMode;
      // пункт управления: точки оси, рубежей, разграничительных линий
      if (postRef.current?.pick && postRef.current.pick !== 'mainBlow') { postRef.current.addPoint(e.lngLat); return; }
      if (pm?.kind === 'line') { setLinePts((l) => [...l, e.lngLat]); return; }
      if (pm?.kind === 'petition') { petPoint.current(e.lngLat); return; }
      if (pm && pm.kind !== 'order') { void pickAction(pm, e.lngLat, null); return; }
      if (!pm || !live.current.sel) {
        // щелчок по знаку: своё объединение (дивизия на агентной модели) — выбрать и показать его доклад;
        // противник — карточка разведданных; штаб без своего доклада (фронт) — доклады его объединений
        const v = liveView.current, { mapDoc, time: t } = live.current;
        if (!v) return;
        const pt = e.point as [number, number];
        const f = mapDoc && t ? unitAt(shownFeatures(mapDoc, t, ['focus']), (p) => en.project(p), pt) : null;
        let id = f?.ref ?? null;
        if (!id) {
          // знак без ref (нарисован не расчётом) — ближайшее своё объединение по месту, как раньше
          let bd = 18;
          for (const u of v.own) {
            if (u.status !== 'active') continue;
            const p = en.project(u.at);
            const dd = Math.hypot(p[0] - pt[0], p[1] - pt[1]);
            if (dd < bd) { bd = dd; id = u.id; }
          }
        }
        if (!id) return;
        // вкладка «Приказы» с пунктом управления: штаб ступени — пункт, подчинённый — его документ
        if (liveTab.current.tab === 'orders' && liveTab.current.sub === 'units' && postRef.current?.click(id)) return;
        // штаб ступени уровня — пункт управления на любой вкладке: доклады, разведка, решение — его
        if (postRef.current?.issuers.some((x) => x.id === id) && postRef.current.issuer !== id) { tap('command.post', { name: id, fly: false }); return; }
        if (v.own.some((u) => u.id === id)) { showUnit(id, false); return; }
        if (v.intel.some((x) => x.id === id)) { setIntelSel(id); return; }
        const g = v.groups.find((x) => x.id === id);
        if (g) { setIntelSel(null); setTab('reports'); setNotice(`${g.name}: доклады его объединений — во вкладке «Доклады»`); }
        return;
      }
      const at = e.lngLat;
      setDrafts((d) => ({ ...d, [live.current.sel!]: { ...(d[live.current.sel!] ?? blankDraft(live.current.sel!)), target: at, at, targetText: `точка ${at[1].toFixed(3)}° с.ш., ${at[0].toFixed(3)}° в.д.` } }));
      setPickMode(null);
    });
  }, [view?.scenario, engine.current]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Проверить распоряжение в расчёте (исполнимо ли, когда вступит в силу). */
  const check = (action: StaffAction, pendingBridges = 0) => new Promise<ActionCheck>((res) => {
    const id = ++checkId.current;
    checks.current.set(id, res);
    send({ kind: 'check', id, action, pendingBridges });
  });
  const liveActs = useRef(acts); liveActs.current = acts;
  /** Включить распоряжение в проект (после проверки); неисполнимое — сообщение. Итог проверки — для голоса. */
  const addActCheck = async (key: string, action: StaffAction, label: string, extra: Partial<Act> = {}): Promise<ActionCheck> => {
    // пункт управления: распоряжение — в ведении его штаба (тыл фронта и армии, понтонные парки, линии армий фронта)
    let pending = action.kind === 'bridge' ? liveActs.current.filter((a) => a.action.kind === 'bridge').length : 0;
    if (view && staffsOn(view) && post.issuer) {
      const deny = staffDeny(view, staffScope(view, post.level, post.issuer), action, postReserves(view, post.issuer).flatMap((g) => [g.id, ...g.members]));
      if (deny) { setNotice(`${label}: ${deny}`); return { ok: false, text: deny }; }
      // переправу наводит штаб пункта своими (приданными) парками; заняты — его же наводки этого хода
      if (action.kind === 'bridge') {
        const by = parksKey(view, post.issuer);
        action = { ...action, by };
        pending = liveActs.current.filter((a) => a.action.kind === 'bridge' && a.action.by === by).length;
      }
    }
    const r = await check(action, pending);
    if (!r.ok) { setNotice(`${label}: ${r.text}`); return r; }
    const next = [...liveActs.current.filter((a) => a.key !== key), { key, action: action.kind === 'bridge' && r.at ? { ...action, at: r.at } : action, label, text: r.text, at: r.at ?? (action.kind === 'base' ? action.to : action.kind === 'commit' ? action.at : undefined), ...extra }];
    liveActs.current = next; // несколько подряд (вариант, резерв по соединениям) — до отрисовки
    setActs(next);
    setNotice(null);
    return r;
  };
  const addAct = async (key: string, action: StaffAction, label: string, extra: Partial<Act> = {}) => (await addActCheck(key, action, label, extra)).ok;
  const dropAct = (key: string) => { liveActs.current = liveActs.current.filter((a) => a.key !== key); setActs(liveActs.current); };
  /** Место выбрано (на карте или из списка пунктов) для распоряжения, ожидающего места; итог проверки — для голоса. */
  const pickAction = async (pm: Pick, at: LngLat, title: string | null): Promise<ActionCheck> => {
    const v = liveView.current;
    if (!v) return { ok: false, text: 'обстановка ещё готовится' };
    const side = v.human.id, t = v.time;
    setPickMode(null);
    if (pm.kind === 'bridge') return addActCheck(`bridge:${Date.now()}`, { kind: 'bridge', side, at, issuedAt: t }, 'Переправа');
    if (pm.kind === 'base') return addActCheck(`base:${pm.base}`, { kind: 'base', side, base: pm.base, to: at, toName: title ?? undefined, issuedAt: t }, `База «${pm.name}»`, { from: pm.from });
    if (pm.kind === 'commit' && pm.members?.length) {
      // объединение целиком: соединения — в один район, разнесены в 3–4 км (сам пункт, круги в 3,5 и 7 км), чтобы не стояли
      // в одной точке; точка за линией фронта пропускается — соединение встаёт в следующую
      const ms = pm.members, kx = 1 / Math.cos((at[1] * Math.PI) / 180);
      const ring = (km: number, n: number) => Array.from({ length: n }, (_, k): LngLat => [at[0] + (km / 111) * Math.cos((2 * Math.PI * k) / n) * kx, at[1] + (km / 111) * Math.sin((2 * Math.PI * k) / n)]);
      const spots = [at, ...ring(3.5, 8), ...ring(7, 12)];
      let k = 0, first: ActionCheck | null = null, last: ActionCheck = { ok: false, text: 'нечего вводить' };
      for (const m of ms) {
        last = { ok: false, text: '' };
        for (let tries = 0; tries < spots.length && !last.ok; tries++, k++) {
          last = await addActCheck(`commit:${m.id}`, { kind: 'commit', side, formation: m.id, at: spots[k % spots.length], atName: title ?? undefined, issuedAt: t }, `${short(pm.name)}: ${short(m.name)}`);
        }
        if (!last.ok) break; // во всём районе нет своей территории — остальным тоже некуда
        first ??= last;
      }
      return first ?? last;
    }
    if (pm.kind === 'commit') return addActCheck(`commit:${pm.formation}`, { kind: 'commit', side, formation: pm.formation, at, atName: title ?? undefined, issuedAt: t }, short(pm.name));
    return { ok: false, text: 'не то распоряжение' };
  };

  const unit = (id: string | null) => view?.own.find((u) => u.id === id) ?? null;
  /** Показать доклад своего объединения: выбрать его; если открыта не «Доклады» и не «Приказы → Войска» — открыть «Доклады». */
  const showUnit = (id: string, fly = true) => {
    // карточка штаба (не дивизии): карта переезжает к его войскам; подчинённый пункта — без смены пункта и уровня
    const ech = view?.command?.hqs[id]?.echelon ?? view?.own.find((u) => u.id === id)?.echelon;
    const keep = !!view && !!post.issuer && ancestry(view, id).includes(post.issuer);
    if (fly && ech && ech !== 'division' && staffsOn(view)) tap('map.hq', { name: id, ...(keep ? { keep: true } : {}) });
    setSel(id); setIntelSel(null);
    const tb = liveTab.current;
    if (tb.tab === 'orders' && tb.sub !== 'units') setSub('units');
    else if (tb.tab !== 'reports' && tb.tab !== 'orders') setTab('reports');
    setMob('staff');
  };
  const liveTab = useRef({ tab, sub }); liveTab.current = { tab, sub };
  const blankDraft = (id: string): Draft => ({ formation: id, task: 'attack', target: null, targetText: '', at: null, note: '' });

  /** Документ карты: туман войны (из расчёта), замысел — стрелки проекта приказов, видимость слоёв. */
  const doc = useMemo(() => {
    if (!view) return null;
    const d: MapDocument = { ...view.doc, layers: [...view.doc.layers, { id: 'plan', name: 'Замысел: проект приказов', role: 'custom', visible: true, locked: true, opacity: 0.9 }] };
    d.layers = d.layers.map((l) => { const t = TOGGLES.find((x) => x.match(l.id)); return t ? { ...l, visible: vis[t.key] } : l; });
    const plan = Object.values(drafts).flatMap((dr) => {
      const u = unit(dr.formation);
      if (!u || !dr.at) return [];
      const mid: LngLat = [(u.at[0] + dr.at[0]) / 2, (u.at[1] + dr.at[1]) / 2];
      const preset = dr.task === 'withdraw' ? 'inf.retreat' : ['attack', 'counterattack', 'breakout', 'relieve'].includes(dr.task) ? 'inf.attack' : 'inf.attackFade';
      const a = createFeature('arrow', preset, { points: [u.at, mid, dr.at], layerId: 'plan' }, 0.55, 'own') as ArrowFeature;
      a.name = `${short(u.name)}: ${TASK_RU[dr.task]} — ${dr.targetText}`;
      a.time = { from: view.time, to: null };
      return [a];
    });
    for (const a of acts) {
      if (!a.at) continue;
      if (a.action.kind === 'bridge') {
        const f = createFeature('symbol', 'std.pontoon', { at: a.at, layerId: 'plan' }, 1, 'own');
        f.name = `Переправа (проект): ${a.text}`; f.time = { from: view.time, to: null }; plan.push(f as never);
      } else if (a.action.kind === 'base' && a.from) {
        const mid: LngLat = [(a.from[0] + a.at[0]) / 2, (a.from[1] + a.at[1]) / 2];
        const f = createFeature('arrow', 'inf.attackFade', { points: [a.from, mid, a.at], layerId: 'plan' }, 0.4, 'own') as ArrowFeature;
        f.name = `${a.label}: перенос`; f.time = { from: view.time, to: null }; plan.push(f);
      } else if (a.action.kind === 'commit') {
        const f = createFeature('symbol', 'std.unitOval', { at: a.at, layerId: 'plan' }, 0.9, 'own');
        f.name = `${a.label}: район сосредоточения`; f.time = { from: view.time, to: null }; plan.push(f as never);
      } else if (a.action.kind === 'boundary' && a.action.line.length > 1) {
        const f = createFeature('line', 'rkka.boundaryArmy', { points: a.action.line, layerId: 'plan' }, 1, 'own');
        f.name = `${a.label} (проект): ${a.text}`; f.time = { from: view.time, to: null }; plan.push(f as never);
      }
    }
    // проекты пункта управления: ось — стрелкой, рубежи задач и разграничительные линии — линиями
    // только документы ступени на карте: директива Ставки на уровне армии заслоняла бы корпуса
    for (const dd of Object.values(post.dirs).filter((x) => x.level === post.level)) {
      const nm = view.command?.hqs[dd.to]?.name ?? unit(dd.to)?.name ?? dd.to;
      const add = (pts: LngLat[], what: string, preset: string, k = 1) => {
        if (pts.length < 2) return;
        const f = pts.length >= 2 && preset.startsWith('inf.') ? createFeature('arrow', preset, { points: pts, layerId: 'plan' }, 0.55, 'own') : createFeature('line', preset, { points: pts, layerId: 'plan' }, k, 'own');
        f.name = `${nm}: ${what} (проект)`; f.time = { from: view.time, to: null }; plan.push(f as never);
      };
      add(dd.axis, 'главный удар', 'inf.attack');
      add(dd.immediate, 'ближайшая задача', 'atlas.defense', 1.6);
      add(dd.subsequent, 'последующая задача', 'atlas.defense', 1.2);
      add(dd.boundaries[0], 'правая разграничительная линия', 'rkka.boundaryArmy');
      add(dd.boundaries[1], 'левая разграничительная линия', 'rkka.boundaryArmy');
      if (dd.immediate.length === 1) { const f = createFeature('symbol', 'std.unitOval', { at: dd.immediate[0], layerId: 'plan' }, 0.6, 'own'); f.name = `${nm}: пункт (проект)`; f.time = { from: view.time, to: null }; plan.push(f as never); }
    }
    if (linePts.length > 1) {
      const f = createFeature('line', 'rkka.boundaryArmy', { points: linePts, layerId: 'plan' }, 1, 'own');
      f.name = 'Разграничительная линия (указывается)'; f.time = { from: view.time, to: null }; plan.push(f as never);
    }
    // ходатайство открытого пункта: линия с соседом — пунктиром разграничительной линии; одна точка — знаком
    const pet = (lowPost() ? postDecisions[post.issuer!] : decision)?.petition;
    if (pet?.line.length) {
      const nb = view.command?.hqs[pet.neighbour]?.name ?? view.groups.find((g) => g.id === pet.neighbour)?.name ?? 'соседом';
      const f = pet.line.length > 1 ? createFeature('line', 'rkka.boundaryArmy', { points: pet.line, layerId: 'plan' }, 1, 'own') : createFeature('symbol', 'std.unitOval', { at: pet.line[0], layerId: 'plan' }, 0.5, 'own');
      f.name = `Ходатайство: линия с ${nb}`; f.time = { from: view.time, to: null }; plan.push(f as never);
    }
    d.features = [...view.doc.features, ...plan];
    return withFocus(d, focus);
  }, [view, drafts, vis, acts, focus, linePts, post.dirs, post.level, post.issuer, decision.petition, postDecisions]); // eslint-disable-line react-hooks/exhaustive-deps
  // зоны влияния сторон — картинкой под знаками; за ход — переход от зон на начало к зонам на конец (по времени карты)
  // стороны зон — по легенде уровня
  const zSides = { own: !lvHidden.has('zones-own'), enemy: !lvHidden.has('zones-enemy') };
  const zoneUrls = useMemo(() => ({ cur: view?.zones ? zoneUrl(view.zones, zSides) : null, prev: view?.zonesPrev ? zoneUrl(view.zonesPrev, zSides) : null }),
    [view?.zones, view?.zonesPrev, zSides.own, zSides.enemy]); // eslint-disable-line react-hooks/exhaustive-deps
  const zonesOn = (vis.zones ?? true) && (zSides.own || zSides.enemy);
  const zoneTime = time && view ? (time >= view.time ? 'end' : time) : null;
  const zoneOv = useMemo(() => (view && zoneTime ? zoneOverlays({ cur: view.zones, prev: view.zonesPrev, urls: zoneUrls, from: turnStart.current?.time ?? addH(view.time, -view.turnHours), to: view.time, time: zoneTime === 'end' ? view.time : zoneTime, on: zonesOn }) : []),
    [view, zoneUrls, zoneTime, zonesOn]); // eslint-disable-line react-hooks/exhaustive-deps
  const zoneKey = zoneOv.map((o) => `${o.id}:${o.opacity}`).join(',');
  /** Зоны влияния — не знаки карты: в легенде, когда они посчитаны на этот час. */
  const zoneAlways = useMemo(() => new Set(view?.zones && zoneTime ? ['zones-own', 'zones-enemy'] : []), [view?.zones, !!zoneTime]); // eslint-disable-line react-hooks/exhaustive-deps
  const shownDoc = useMemo(() => {
    if (!doc) return null;
    const d = withoutLabels(withHidden(withLevel(doc, level), level, lvHidden), labels);
    return zoneOv.length ? { ...d, overlays: [...d.overlays, ...zoneOv] } : d;
  }, [doc, level, labels, zoneKey, lvHidden]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Обстановка для списков: при фокусе — только объединения и противник на участке. */
  /** Карта, как она нарисована (уровень обобщения) — для щелчка по знаку. */
  const pickDoc = useMemo(() => (doc ? withHidden(withLevel(doc, level), level, lvHidden) : null), [doc, level, lvHidden]);
  live.current.mapDoc = pickDoc; live.current.time = time;
  const intelE = view?.intel.find((x) => x.id === intelSel) ?? null;
  const closeIntel = useCallback(() => setIntelSel(null), []);
  useEsc(!!intelE, closeIntel);
  const fv = useMemo(() => (!view || !focus || !focusOnly ? view : { ...view, own: view.own.filter((u) => u.status !== 'active' || inSector(focus, u.at)), intel: view.intel.filter((e) => inSector(focus, e.at)) }), [view, focus, focusOnly]);

  // место — в свободной части карты, не под панелью голоса и легендой
  const goTo = (at: LngLat | null, zoomIn = true) => {
    const en = engine.current;
    if (!at || !en) return;
    const z = en.getView().zoom;
    showAt(en, at, zoomIn ? Math.max(z, 9) : z);
  };
  useAction({
    id: 'map.hq', section: 'replay', title: 'Показать штаб на карте', describe: 'Карта плавно переезжает к войскам штаба (фронта, армии, корпуса) на масштабе его ступени; штаб становится пунктом управления, уровень карты переключается вместе с ним. keep — только переезд карты, пункт и уровень прежние (карточка подчинённого). Только в игре.',
    params: { type: 'object', properties: { name: { type: 'string' }, keep: { type: 'boolean', description: 'true — не менять пункт и уровень' } }, required: ['name'] }, say: ['штаб, покажи восьмую гвардейскую армию на карте'],
    available: () => (view?.command ? true : 'штабы на карте — в игре на агентной модели'), highlight: () => hl('post-bar'),
    run: async (p: { name: string; keep?: boolean }) => {
      const hqs = view!.command!.hqs;
      const id = findHq(hqs, String(p?.name ?? ''));
      if (!id) return 'Такого штаба нет.';
      const en = engine.current;
      const at = hqCenter(view!, id);
      const text = at ? '' : `${hqs[id].name}: у штаба нет войск на карте`;
      if (!at) { setNotice(text); return text; }
      if (p?.keep) { if (en) flyToHq(en, at, level); return `Карта: ${hqs[id].name}.`; }
      // штаб — пунктом своей ступени (список пунктов, «Штабы»); не отдаёт приказов — только уровень карты
      const lv = post.choose(id) ?? ECHELON_LEVEL[hqs[id].echelon] ?? level;
      setLevel(lv);
      if (en) flyToHq(en, at, lv);
      return `Карта: ${hqs[id].name}.`;
    },
  });
  const draftList = Object.values(drafts);
  /** Ход — на расчёт (проверки готовности — в действии command.turn). */
  const sendTurn = () => {
    if (!view) return;
    // командование по ступеням: приказы — документами пункта управления (проекты старого вида не уходят)
    const orders: Order[] = (staffsOn(view) ? [] : draftList).map((d) => ({ id: `human@${view.time}:${d.formation}`, formation: d.formation, task: d.task, target: d.target, issuedAt: view.time, source: 'human', note: d.note || undefined, ...(d.form && staffsOn(view) ? { form: d.form } : {}) }));
    setProgress('отправка приказов…');
    // ходатайства: агентная модель — команда ядру от каждого взятого фронта, где оно действует; нынешняя — текст модели-Ставке
    const pets = view.command ? Object.entries(postDecisions).flatMap(([id, d]) => {
      const op = petitionState(view, id, petOpts, cmds).show ? petitionOp(id, d.petition) : null;
      return op ? [op] : [];
    }) : [];
    const command = [...(cmds.length ? (staffsOn(view) ? resolveFrom(view, cmds) : cmds) : []), ...pets];
    const p = decision.petition;
    const request = !view.command && petNow?.show && p ? (p.neighbour && p.line.length ? petitionText(p, (id) => view.groups.find((g) => g.id === id)?.name ?? id, view.places) : p.note.trim()) : '';
    send({ kind: 'turn', orders, actions: acts.map((a) => a.action), decision: { ...decision, request }, ...(Object.keys(postDecisions).length ? { posts: postDecisions } : {}), ...(command.length ? { command } : {}) });
  };
  /** Противник — цель удара выбранного объединения (никто не выбран — вкладка «Приказы»: выбрать объединение). */
  const targetEnemy = (id: string) => {
    // пункт управления: противник — пункт ближайшей задачи открытого документа
    if (staffsOn(view)) { const e = view!.intel.find((x) => x.id === id); if (post.draft && e) tap('command.dir.set', { point: e.at }); else tap('command.orders.sub', { sub: 'units' }); return; }
    if (!sel) { tap('command.orders.sub', { sub: 'units' }); return; }
    tap('command.order.set', { unit: sel, task: 'attack', enemy: id });
    tap('command.orders.sub', { sub: 'units' });
  };
  /** Чего не хватает для хода — на экране: приказ без цели (вкладка «Приказы») или решение (вкладка «Решение»). */
  const showMissing = (m: Missing) => {
    if (m.targets.length) {
      setTab('orders'); setSub('units'); setSel(m.targets[0]);
      setNotice(`Не указана цель: ${m.targets.map((id) => `${short(unit(id)?.name ?? id)} — ${TASK_RU[drafts[id]?.task ?? 'attack']}`).join('; ')}`);
    } else {
      // ход проводится по решению верхней инстанции: пункт управления — на её уровень
      if (staffsOn(view) && post.level !== 'stavka') levelTo('stavka');
      setTab('decision'); setNotice(`Решение ${staffsOn(view) ? `${view?.terms?.topGen ?? 'Ставки'} ` : ''}на ход не готово: ${m.decision.join(', ')}`);
    }
  };
  /** Ветви дерева тем советника из обстановки: фронты, армии, обнаруженный противник, резервы. */
  const advDyn = useMemo(() => ({
    own: (view?.own ?? []).filter((u) => u.status === 'active').map((u) => ({ id: u.id, name: u.name })),
    group: (view?.groups ?? []).filter((g) => view?.own.some((u) => u.parent === g.id && u.status === 'active')).map((g) => ({ id: g.id, name: g.name })),
    enemy: (view?.intel ?? []).map((e) => ({ id: e.id, name: e.name })),
    // резервы — по армиям (на агентной модели резерв — дивизии армии)
    reserve: (view?.reserveGroups ?? []).filter((g) => g.status === 'reserve').map((g) => ({ id: g.id, name: g.name })),
  }), [view]);
  /** Проект решения словами — советнику (он видит, что командующий уже готовит). */
  const draftText = () => [
    decision.assessment && `Оценка обстановки: ${decision.assessment}`,
    decision.intent && `Решение: ${decision.intent}`,
    ...draftList.map((d) => `Приказ: ${unit(d.formation)?.name} — ${TASK_RU[d.task]} — ${d.targetText || 'на месте'}`),
    ...acts.map((a) => `Распоряжение: ${a.label} — ${a.text}`),
  ].filter(Boolean).map((x) => `- ${x}`).join('\n');
  /** Сколько вариантов просить у советника (общая настройка вкладки «Решение» и советника, запоминается). */
  const [planN, setPlanNRaw] = useState<number>(() => { try { const n = Number(localStorage.getItem('def_ops.planVariants')); return n >= 1 && n <= 3 ? n : 3; } catch { return 3; } });
  const setPlanN = (n: number) => { setPlanNRaw(n); try { localStorage.setItem('def_ops.planVariants', String(n)); } catch { /* */ } };
  /** Попросить советника о вариантах решения на ход; возвращает номер запроса. */
  const askPlan = (count: number): number => {
    if (!view) return 0;
    const id = ++checkId.current;
    setPlan({ id, time: view.time, count, variants: [], progress: 'подготовка…', done: false });
    setPlanOpen(0);
    setAdvOpen(true); setAdvMin(false);
    const draft = draftText();
    void kb.roleRef([`решение на сутки: замысел, главный удар, тыл, переправы, резервы. ${decision.intent}`], advisorScope(view, false)).catch(() => ({ refs: [], text: '' })).then((r) => send({ kind: 'plan', id, count, draft, reference: r.text, post: postCtx() }));
    return id;
  };
  const planDraft = (o: PlanVariantView['orders'][number]): Draft => ({ formation: o.formation, task: o.task, target: o.target, targetText: o.targetText, at: o.at, note: o.why });
  /** В проекте уже что-то есть: принятие варианта его заменит. */
  /** Кнопка «Принять вариант»: непустой проект — после вопроса (действие замены), пустой — сразу. */
  const acceptByButton = async (v: PlanVariantView, idx: number) => {
    if (!projectHas(staff.current, prevOf(staff.current))) { tap('command.variant.pick', { n: idx + 1 }); return; }
    if (await confirmAsync(`Заменить проект вариантом «${v.title}»? Текущие решение, приказы и распоряжения будут заменены (их можно будет поправить).`, { ok: 'Заменить' })) tap('command.variant.replace', { n: idx + 1 });
  };
  /** Принять вариант idx в проект без вопросов: целиком (решение, приказы, распоряжения) или только решение; итог словами. */
  const applyPlan = async (idx: number, only: boolean): Promise<string> => {
    const v = planLive.current?.variants[idx];
    if (!v) return 'Такого варианта нет.';
    // пункт ниже Ставки: решение — его штаба
    const putDecision = (x: HumanDecision) => {
      if (lowPost()) setPostDecisions((m) => ({ ...m, [post.issuer!]: x })); else setDecision(x);
      setAutoFields((m) => ({ ...m, [lowPost() ? post.issuer! : '']: [] }));
    };
    if (only) {
      putDecision({ ...v.decision }); setTab('decision');
      const t = `Решение из варианта «${v.title}» — во вкладке «Решение»; приказы не менялись.`;
      setNotice(t);
      return t;
    }
    putDecision({ ...v.decision });
    const orders = v.orders.filter((o) => o.ok);
    // командование по ступеням: приказы — документами пункта в очереди хода
    if (view && staffsOn(view)) { const subs = new Set(post.issuer ? recipients(view, post.issuer).map((x) => x.id) : []); setCmds((q) => q.filter((c) => !(c.op === 'directive' && subs.has(c.directive.to)))); orders.forEach(toPostDir); }
    else setDrafts(Object.fromEntries(orders.map((o) => [o.formation, planDraft(o)])));
    setActs([]); liveActs.current = [];
    let added = 0;
    const failed: string[] = [];
    for (const a of v.acts) if (a.ok && a.action) { if (await addAct(a.key, a.action, a.label, a.from ? { from: a.from } : {})) added++; else failed.push(a.label); }
    setPlan((p) => (p ? { ...p, accepted: idx } : p));
    setTab('decision');
    // телефон: советник закрывает экран — убрать, чтобы был виден проект (беседа и варианты сохраняются)
    if (window.matchMedia?.('(max-width: 760px)').matches) setAdvOpen(false);
    setNotice(`Вариант «${v.title}» принят в проект: решение, приказов ${orders.length}, распоряжений ${added}${failed.length ? ` (не исполнимы: ${failed.join(', ')})` : ''}. Проверьте и поправьте во вкладках «Решение» и «Приказы», затем завершите ход.`);
    return `Вариант «${v.title}» принят: решение, приказов ${orders.length}, распоряжений ${added}${failed.length ? `; не исполнимы: ${failed.map(short).join(', ')}` : ''}. Проверить — скажите «что не готово?».`;
  };
  /** Вопрос советнику (из дерева тем, своими словами, голосом); возвращает номер вопроса. */
  const askAdvisor = (cat: string, topic: string, q: string, o: { silent?: boolean } = {}): number => {
    if (!view) return 0;
    readStop.current?.(); readStop.current = null;
    const id = ++checkId.current;
    const thread = o.silent ? [] : adv.filter((x) => x.result?.ok).slice(-3).map((x) => ({ q: x.q, a: x.result!.answer }));
    // тихий вопрос (советник пишет поле решения) — не в ленту советника и панель не открывается: ответ печатается в поле
    if (!o.silent) { setAdv((l) => [...l, { id, cat: topic, catId: cat, q, answer: '' }]); setAdvOpen(true); setAdvMin(false); }
    const draft = draftText();
    void kb.roleRef([`${topic} ${q}`], advisorScope(view, cat === 'history')).catch(() => ({ refs: [], text: '' })).then((r) => send({ kind: 'advise', id, category: cat, topic, question: q, thread, draft, reference: r.text, post: postCtx() }));
    return id;
  };
  /** Что штаб пункта ведёт во вкладке «Приказы» (тыл, переправы, полосы); нынешняя модель — null, всё как прежде. */
  const scopeNow = (): StaffScope | null => (view && staffsOn(view) && post.issuer ? staffScope(view, post.level, post.issuer) : null);
  /** Подвкладки «Приказов» с доступным на уровне действием (`true`) или причиной, почему их нет. */
  const subsOk = view ? ordersSubs(view, scopeNow()) : ALL_SUBS;
  // открытая подвкладка стала недоступной (сменили уровень) — назад в «Пункт управления»
  useEffect(() => { if (subsOk[sub] !== true) { setSub('units'); setPickMode(null); } }, [sub, subsOk.rear, subsOk.bridges, subsOk.reserves, subsOk.bounds]);
  /** Решение на экране: штаба пункта (ниже Ставки) или верхней инстанции. */
  const curDecision = (): HumanDecision => (lowPost() ? postDecisions[post.issuer!] ?? EMPTY : decision);
  const setCur = (p: Partial<HumanDecision>) => {
    if (lowPost()) { const id = post.issuer!; setPostDecisions((m) => ({ ...m, [id]: { ...(m[id] ?? EMPTY), ...p } })); } else setDecision((d) => ({ ...d, ...p }));
    unAuto(lowPost() ? post.issuer! : '', Object.keys(p)); // правка руками (голосом) — уже не «составлено по обстановке»
  };
  /** Ходатайство на открытом пункте: действует ли, кто рассматривает, соседи. */
  const petOpts = { stavkaLlm: llm.settings.stavka !== false, llmOk: llm.check.state === 'ok', enemy, umpire: !!llm.settings.umpire };
  const petNow: PetitionState | null = view ? petitionState(view, staffsOn(view) ? post.issuer : null, petOpts, cmds) : null;
  /** Точка линии ходатайства щелчком по карте — в конец линии решения открытого пункта. */
  petPoint.current = (at: LngLat) => { const cur = curDecision().petition ?? { neighbour: '', line: [], note: '' }; setCur({ petition: { ...cur, line: [...cur.line, at] } }); };
  /** Обстановка для черновиков решения: штаб пункта — его подчинённые, противник в его полосе, его документы на ход. */
  const scopeFor = (v: TurnView, issuer: string | null, lvl: MapLevel): DraftScope => {
    if (staffsOn(v) && issuer) {
      const ids = new Set(recipients(v, issuer).map((x) => x.id));
      const plans = cmds.flatMap((c) => (c.op === 'directive' && ids.has(c.directive.to)
        ? [`${short(v.command?.hqs[c.directive.to]?.name ?? unit(c.directive.to)?.name ?? c.directive.to)} — ${DIR_TASK_RU[c.directive.task as keyof typeof DIR_TASK_RU] ?? c.directive.task}${(c.directive as { note?: string }).note ? `: ${(c.directive as { note?: string }).note}` : ''}`] : []));
      return { who: v.command?.hqs[issuer]?.name ?? v.human.name, own: postReports(v, issuer), intel: postIntel(v, lvl, issuer).flatMap((g) => g.members), plans };
    }
    return { who: v.human.name, own: v.own, intel: v.intel,
      plans: Object.values(drafts).map((d) => `${short(unit(d.formation)?.name ?? d.formation)} — ${TASK_RU[d.task as Task]}${d.targetText ? `: ${d.targetText}` : ''}`) };
  };
  const draftScope = (): DraftScope => scopeFor(view!, post.issuer, post.level);
  /** Прошлое решение штаба ступени (запись хода хранит решения пунктов при решении верхней инстанции). */
  const lastPost = (id: string): HumanDecision | null => lastPostDecision(record?.turns, id);
  /** В решениях штабов ступеней есть своё: правленое, не только составленное по обстановке или перенесённое. */
  const postEdited = Object.entries(postDecisions).some(([id, d]) => projectHas({ drafts: {}, acts: [], decision: d, auto: autoFields[id] }, lastPost(id)));
  // открыт ход — решение верхней инстанции составлено по обстановке (без модели); правленое на этом ходу не трогается
  useEffect(() => {
    if (!opened || !view) return;
    const top = staffsOn(view) ? issuers(view, 'stavka')[0]?.id ?? null : null;
    const r = prefillDecision(view, scopeFor(view, top, 'stavka'), view.lastDecision);
    setDecision(r.decision);
    setAutoFields((m) => ({ ...m, '': r.auto }));
  }, [opened]); // eslint-disable-line react-hooks/exhaustive-deps
  // открыт пункт штаба ступени ниже Ставки — его решение составлено, если на этом ходу его ещё нет (правленое не заменяется)
  const lowId = view && lowPost() ? post.issuer : null;
  useEffect(() => {
    if (!view || !lowId || postDecisions[lowId]) return;
    const r = prefillDecision(view, scopeFor(view, lowId, post.level), lastPost(lowId));
    setPostDecisions((m) => ensurePost(m, lowId, () => r.decision));
    setAutoFields((m) => (m[lowId] ? m : { ...m, [lowId]: r.auto }));
  }, [view?.time, lowId, opened]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Чтение ответа советника своим голосом (без голосового управления): остановить. */
  const readStop = useRef<(() => void) | null>(null);
  useEffect(() => () => readStop.current?.(), []);
  const [speakAll] = useSpeakAnswers();
  useEffect(() => { if (!speakAll) { readStop.current?.(); readStop.current = null; } }, [speakAll]);
  /** Советник пишет поле решения: номер вопроса → поле, штаб, накопленный текст, общий заказ. */
  const fieldAsk = useRef(new Map<number, { field: DraftField; issuer: string | null; buf: string; batch?: boolean }>());
  /** Поля, которые пишет советник, по штабам («» — верхняя инстанция): ждёт, печатает, готово (вспышка). */
  const [aiFields, setAiFields] = useState<Record<string, Partial<Record<DraftField, AiFieldState>>>>({});
  const markAi = (issuer: string | null, f: DraftField, st: AiFieldState | null) => setAiFields((m) => {
    const k = issuer ?? '', cur = { ...(m[k] ?? {}) };
    if (st) cur[f] = st; else delete cur[f];
    return { ...m, [k]: cur };
  });
  /** Общий заказ «Составить советником (ИИ)»: поля по очереди, каждое — с уже написанными. */
  const batch = useRef<{ issuer: string | null; queue: DraftField[]; base: HumanDecision; written: Partial<HumanDecision>; total: number } | null>(null);
  const [batchView, setBatchView] = useState<AiBatch | null>(null);
  const writeTo = (issuer: string | null, f: DraftField, text: string) => {
    if (issuer) setPostDecisions((all) => ({ ...all, [issuer]: { ...(all[issuer] ?? EMPTY), [f]: text } }));
    else setDecision((d) => ({ ...d, [f]: text }));
    unAuto(issuer ?? '', [f]);
  };
  const askField = (f: DraftField, d: HumanDecision, inBatch = false) => {
    const issuer = lowPost() ? post.issuer : null;
    const id = askAdvisor('decision', `Решение › ${DRAFT_ACC[f]}`, fieldPrompt(f, draftScope(), d), { silent: true });
    fieldAsk.current.set(id, { field: f, issuer, buf: '', batch: inBatch });
    markAi(issuer, f, 'wait');
  };
  /** Ответ советника по полю (поток и конец): в поле; общий заказ — следующее поле. */
  const fieldStream = (id: number, chunk: string): boolean => {
    const fa = fieldAsk.current.get(id);
    if (!fa) return false;
    fa.buf += chunk;
    writeTo(fa.issuer, fa.field, fa.buf.replace(/^\s+/, ''));
    markAi(fa.issuer, fa.field, 'typing');
    return true;
  };
  const fieldDone = (id: number, r: AdviceView): boolean => {
    const fa = fieldAsk.current.get(id);
    if (!fa) return false;
    fieldAsk.current.delete(id);
    const text = r.ok ? r.answer.trim() : '';
    if (text) {
      writeTo(fa.issuer, fa.field, text);
      markAi(fa.issuer, fa.field, 'done');
      window.setTimeout(() => markAi(fa.issuer, fa.field, null), 1800);
    } else {
      markAi(fa.issuer, fa.field, null);
      if (fa.buf) writeTo(fa.issuer, fa.field, fa.buf.trim());
    }
    const b = batch.current;
    if (fa.batch && b) {
      if (!text) { batch.current = null; setBatchView(null); setNotice(r.error === 'остановлено' ? 'Советник остановлен — написанное осталось в полях.' : `Советник не дописал решение: ${r.error ?? 'пустой ответ'}.`); return true; }
      b.written[fa.field] = text;
      const nx = b.queue.shift();
      if (nx) { askField(nx, { ...b.base, ...b.written }, true); setBatchView({ issuer: b.issuer, done: b.total - b.queue.length - 1, total: b.total, cur: nx }); }
      else { batch.current = null; setBatchView(null); setNotice(`Советник составил решение: ${b.total} ${b.total === 5 ? 'полей' : 'поля'} — прочитайте и поправьте.`); }
      return true;
    }
    setNotice(text ? `Советник написал ${DRAFT_ACC[fa.field]} — поправьте при необходимости.` : `Советник не написал ${DRAFT_ACC[fa.field]}: ${r.error ?? 'пустой ответ'}. Можно составить по обстановке.`);
    return true;
  };
  // обработчик сообщений потока создан один раз — зовёт свежие функции (обстановка, пункт управления) через ссылку
  const fieldFns = useRef({ stream: fieldStream, done: fieldDone });
  fieldFns.current = { stream: fieldStream, done: fieldDone };
  /** Составить поле решения: по обстановке сразу или советником (текст печатается в поле по мере ответа). */
  const composeField = (f: DraftField, advisor: boolean): string => {
    if (!view) return 'Обстановка ещё не готова.';
    const s = draftScope(), d = curDecision();
    setTab('decision');
    if (!advisor) {
      setCur({ [f]: draftField(f, view, s, d) });
      const k = lowPost() ? post.issuer! : '';
      setAutoFields((m) => ({ ...m, [k]: [...(m[k] ?? []).filter((x) => x !== f), f] }));
      return `Составил ${DRAFT_ACC[f]} по обстановке — прочитайте и поправьте.`;
    }
    askField(f, d);
    return `Советник пишет ${DRAFT_ACC[f]} за штаб «${s.who}».`;
  };
  /** Все поля решения советником, одно за другим (каждое учитывает написанные). */
  const composeAll = (): string => {
    if (!view) return 'Обстановка ещё не готова.';
    if (batch.current) return 'Советник уже пишет решение.';
    const [first, ...queue] = DRAFT_FIELDS;
    batch.current = { issuer: lowPost() ? post.issuer : null, queue, base: { ...curDecision(), ...Object.fromEntries(DRAFT_FIELDS.map((k) => [k, ''])) }, written: {}, total: DRAFT_FIELDS.length };
    askField(first, batch.current.base, true);
    setBatchView({ issuer: batch.current.issuer, done: 0, total: DRAFT_FIELDS.length, cur: first });
    setTab('decision');
    return `Советник составляет решение за штаб «${draftScope().who}»: оценка, замысел противника, решение, риски и донесение — по очереди.`;
  };
  /** Предложенный советником приказ — в проект. */
  const takeSuggestion = (sg: AdviceView['suggestions'][number]) => {
    if (view && staffsOn(view)) { toPostDir(sg); setNotice(`Документ пункта в очереди хода: ${short(sg.name)} — ${TASK_RU[sg.task]}, ${sg.targetText}`); return; }
    setDrafts((d) => ({ ...d, [sg.formation]: { formation: sg.formation, task: sg.task, target: sg.target, targetText: sg.targetText, at: sg.at, note: sg.why } }));
    setNotice(`В распоряжение: ${short(sg.name)} — ${TASK_RU[sg.task]}, ${sg.targetText}`);
  };
  /** Разграничительная линия, намечаемая во вкладке «Полосы»: фронт и две армии (точки — linePts). */
  const [bnd, setBnd] = useState<Omit<BoundsDraft, 'pts'>>({ front: '', a: '', b: '' });
  const aiTurns = (record?.turns ?? []).filter((t) => t.ai).map((t) => t.ai as AiTurn).reverse();
  const current = ai.state === 'done' || ai.state === 'error' ? ai.turn : undefined;

  const journalMd = () => {
    if (!view) return '';
    const lines = [`# Журнал боевых действий: ${view.scenarioName}`, '', `Командование принято ${ddmm(view.takeover)} ${hhmm(view.takeover)}. Сторона: ${view.human.name}. Противник: ${view.ai.name} — ${enemy === 'llm' ? 'штаб на модели' : enemy === 'intent' ? 'штабы по истории как замыслу' : enemy === 'agents' ? 'штабы-агенты по уставам' : 'без штаба (прежние приказы)'}.`, ''];
    for (const d of view.journal) {
      lines.push(`## ${dayLong(d.time)}, ${hhmm(d.time)}`, '');
      if (d.decision) lines.push('**Оценка обстановки.** ' + d.decision.assessment, '', '**Замысел противника.** ' + (d.decision.enemyIntent || '—'), '', '**Решение.** ' + d.decision.intent, '', '**Риски.** ' + (d.decision.risks || '—'), '', '**Боевое донесение в Ставку.** ' + d.decision.report, '');
      lines.push('**Отданы приказы:**', '', ...(d.orders.length ? d.orders.map((o) => `- ${o}`) : ['- новых приказов нет']), '');
      if (d.actions.length) lines.push('**Распоряжения по тылу, инженерным войскам, резервам:**', '', ...d.actions.map((a) => `- ${a}`), '');
      lines.push('**Донесения за ход:**', '', ...(d.events.length ? d.events.map((x) => `- ${x}`) : ['- существенных событий нет']), '');
      if (d.enemy || view.enemyLog) lines.push('**Противник (по разведке):**', '', ...(d.enemy?.length ? d.enemy.map((x) => `- ${placeText(x, view.places)}`) : ['- действий противника разведка не обнаружила']), '');
    }
    if (aiTurns.length) {
      lines.push('# Решения штаба противника (для разбора)', '');
      for (const t of [...aiTurns].reverse()) {
        lines.push(`## ${dayLong(t.time)}, ${hhmm(t.time)} — ${t.model}`, '');
        if (!t.ok) { lines.push(`Ошибка: ${t.error}`, ''); continue; }
        const d = t.decision!;
        lines.push('**Оценка обстановки.** ' + d.assessment, '', '**Замысел противника (как его понял штаб).** ' + d.enemyIntent, '', '**Замысел.** ' + d.intent, '', '**Приказы:**', '',
          ...t.applied.map((a) => `- ${a.given.formation}: ${TASK_RU[a.given.task]} — ${a.target ?? a.given.toArea ?? a.given.area}${a.order ? '' : ' (не исполнен)'}${a.given.details ? `. ${a.given.details}` : ''}${a.issue ? ` — ${a.issue}` : ''}`),
          '', '**Доклады наверх:**', '', ...d.requests.map((x) => `- ${x}`), '', '**Риски:**', '', ...d.risks.map((x) => `- ${x}`), '');
      }
    }
    return lines.join('\n');
  };

  const zones = useMemo(() => ({ local: 'Europe/Berlin', localFixed: true, input: 'msk' as const, setInput: () => {} }), []);
  const layerOn = (k: string) => vis[k] ?? true;
  const toggle = (k: string) => setVis((h) => ({ ...h, [k]: !(h[k] ?? true) }));
  const goals = view?.goals ?? [];
  const playerEvents = goals.map((g) => ({ title: g.title, historical: g.historical, simulated: g.simulated, days: [g.days], at: g.at, place: g.place, marker: false }));

  // голос и кнопки: вкладки, доклады, карта, туман войны, выход — одни действия реестра
  const voice = useRef<CommandDeps>(null!);
  voice.current = {
    view, engine: eng, setTab, showUnit, showEnemy: (id) => setIntelSel(id), enemy, enemyChoices, setEnemy,
    reveal, setReveal: (on) => { setReveal(on); send({ kind: 'reveal', on }); }, exit: (discard) => onExit({ discard }),
  };
  useEffect(() => { const get = () => voice.current; const offs = commandActions(get).map(register); return () => { offs.forEach((o) => o()); releaseCommand(get); }; }, []);
  // «Итоги» игры: потери сторон по сыгранным часам (агентная модель); вкладка есть и у нынешней модели — с пояснением
  // разбор хода (часть «Ход»): позиция, раскрытое событие, связный текст модели — сбрасываются новым ходом
  const debrief = useDebrief({ debrief: view?.debrief ?? null, resetKey: debriefResetKey(view?.time ?? '', lineEpoch), model: () => (llmRef.current.check.state === 'ok' ? umpireModel() : null), show: (m) => tourMapRef.current?.show(m),
    active: tab === 'results' && resPart === 'turn', reset: () => tourMapRef.current?.reset() });
  // после хода «Итоги» открываются на разборе хода
  useEffect(() => { if (view?.debrief) setResPart('turn'); }, [view?.time]); // eslint-disable-line react-hooks/exhaustive-deps
  const resultsDeps = useRef<ResultsDeps>(null!);
  resultsDeps.current = {
    section: () => 'command', summary: () => view?.results ?? null, side: () => (view?.human.id === 'de' ? 'de' : 'su'),
    setPart: (p) => { setTab('results'); setResPart(p); },
    debrief: () => view?.debrief ?? null, terms: () => view!.terms, hq: () => debrief.hq, setHq: debrief.setHq, openEvent: debrief.openEvent,
    narrate: debrief.narrate, modelOn: () => llm.check.state === 'ok',
  };
  useEffect(() => { const get = () => resultsDeps.current; const offs = resultsActions(get).map(register); return () => { offs.forEach((o) => o()); releaseResults(get); }; }, []);
  // штабная работа на ход: советник, решение, приказы, распоряжения — те же действия у кнопок
  const staff = useRef<StaffDeps>(null!);
  const lastAdvice = [...adv].reverse().find((x) => x.result?.ok);
  staff.current = {
    view, busy: view ? progress : null, setTab, setSub, subsOk, goTo: (at) => goTo(at), select: setSel,
    plan, planN, askPlan, stopAdvisor: () => { send({ kind: 'advise-stop' }); send({ kind: 'plan-stop' }); },
    openVariant: (i) => { setPlanOpen(i); setAdvOpen(true); setAdvMin(false); }, applyPlan,
    advisorText: advQ, setAdvisorText: setAdvQ,
    advisorBusy: adv.some((m) => !m.result), askAdvisor: (q) => askAdvisor('situation', 'свободный вопрос', q),
    suggestions: lastAdvice?.result?.suggestions.filter((x) => x.ok) ?? [], takeSuggestion,
    decision: view ? curDecision() : decision, setDecision: setCur, auto: autoFields[view && lowPost() ? post.issuer! : ''] ?? [],
    prevDecision: view && lowPost() ? lastPost(post.issuer!) : view?.lastDecision ?? null,
    composeField, composeAll, advisorReady: llm.check.state === 'ok', composing: !!batchView, petition: petNow ?? undefined,
    mergePriority: (() => { const sc = scopeNow(); if (!sc || !view) return undefined; const pool = priorityPool(view, sc); const pa = acts.find((a) => a.action.kind === 'priority')?.action; const cur = pa?.kind === 'priority' ? pa.formations : view.priority; return (ids: string[]) => mergePriority(cur, pool, ids); })(),
    drafts, setDraft: (id, d) => setDrafts((all) => { const n = { ...all }; if (d) n[id] = d; else delete n[id]; return n; }),
    acts, addAct: addActCheck, dropAct,
    commit: (g, at, title) => pickAction(g.members ? { kind: 'commit', formation: g.id, name: g.name, members: g.members } : { kind: 'commit', formation: g.id, name: g.name }, at, title),
    bounds: { ...bnd, pts: linePts }, setBounds: ({ pts, ...b }) => { setBnd(b); setLinePts(pts); if (pickMode?.kind === 'line') setPickMode(null); },
  };
  useEffect(() => { const get = () => staff.current; const offs = staffActions(get).map(register); return () => { offs.forEach((o) => o()); releaseStaff(get); }; }, []);
  // ход, штаб противника, посредник, разбор, файлы — те же действия у кнопок
  const turnDeps = useRef<TurnDeps>(null!);
  turnDeps.current = {
    view, prev: turnStart.current, busy: view ? progress : null, blocked, enemy, ai, aiTurns, record, drafts, acts, decision, auto: autoFields[''] ?? [], plan, planN,
    sendTurn, showMissing, notice: setNotice, setTab, setUmpirePart: setUmpPart,
    retryAi: () => { setBlocked(null); setProgress('повторный запрос…'); send({ kind: 'retry-ai' }); },
    skipAi: () => { setBlocked(null); setProgress('расчёт хода…'); send({ kind: 'skip-ai' }); },
    // окно разбора монтируется позже отрисовки — его управление читается в момент вызова
    review: { open: review === 'open', get ctl() { return reviewCtl.current; }, show: (on) => setReview(on ? 'open' : 'hidden') },
    journal: () => ({ name: `${view?.scenario}-журнал.md`, text: journalMd() }),
    postProject: postEdited,
    lines: savedGame ? gameLines(savedGame) : [],
    branches: { open: branchesOpen, show: setBranchesOpen },
    rewind: rewindTo, switchBranch: switchTo, deleteBranch: dropBranch,
    gameRecord: () => (record ? { name: `${record.scenario}-игра.json`, text: JSON.stringify(record, null, 1) } : null),
  };
  useEffect(() => { const get = () => turnDeps.current; const offs = turnActions(get).map(register); return () => { offs.forEach((o) => o()); releaseTurn(get); }; }, []);
  // экранные действия: выбор объединения, правка приказа, подвкладки, окно советника, «на карте», события
  const screen = useRef<ScreenDeps>(null!);
  screen.current = {
    view, busy: view ? progress : null, setTab, setSub: (x) => { setSub(x); setPickMode(null); }, closeCard: closeIntel, select: setSel, sel, goTo: (at, z) => goTo(at, z !== false),
    drafts, setDraft: staff.current.setDraft, subsOk,
    advisor: { open: advOpen, min: advMin }, setAdvisor: (o, mn) => { setAdvOpen(o); setAdvMin(mn); if (!mn) setAdvSeen(adv.length); },
    clearAdvisor: () => { send({ kind: 'advise-stop' }); send({ kind: 'plan-stop' }); setAdv([]); setPlan(null); }, talk: adv.length,
    setPlanN, plan, planOpen, setPlanOpen, takeSuggestion,
    suggestion: (msg, i) => adv.find((x) => x.id === msg)?.result?.suggestions[i] ?? null,
    hasAct: (k) => acts.some((a) => a.key === k), acts, dropAct,
    addAct: async (a) => { if (!a.action) return false; const ok = await addAct(a.key, a.action, a.label, a.from ? { from: a.from } : {}); if (ok) setNotice(`В распоряжение: ${a.label} — ${a.text}`); return ok; },
    focus: !!focus, focusOnly, setFocusOnly, setTime,
    toEditor: () => { if (!doc) return false; onOpenInEditor(doc); return true; },
    setUmpirePart: setUmpPart,
    setBounds: (b) => setBnd((x) => ({ ...x, ...b })),
  };
  useEffect(() => { const get = () => screen.current; const offs = screenActions(get).map(register); return () => { offs.forEach((o) => o()); releaseScreen(get); }; }, []);
  useStaffActions(view, cmds, setCmds, !!progress, levelTo);

  if (error && !view) return <div className="rp-empty"><div><b>Игра не запустилась</b><p className="err">{error}</p><ActButton action="command.exit">Назад к переигровке</ActButton></div></div>;

  return (
    <ZonesContext.Provider value={zones}>
    <div className={`replay cmd mob-${mob}`} style={{ '--cmd-w': `${sideW}px`, '--adv-w': `${advW}px` } as CSSProperties}>
      <div className="mob-switch"><button className={mob === 'staff' ? 'on' : ''} onClick={() => setMob('staff')}>Штаб</button><button className={mob === 'map' ? 'on' : ''} onClick={() => setMob('map')}>Карта</button><ActButton className={advOpen ? 'on' : ''} action="command.advisor.show" params={{ mode: advOpen ? 'close' : 'open' }}>Советник</ActButton></div>
      <aside className="rp-side cmd-side">
        <Resizer width={sideW} setWidth={setSideW} reset={resetSideW} edge="right" />
        <div className="cmd-head" data-tour="cmd-head">
          <div className="cmd-top">
            <span className="cmd-kicker" title={view?.scenarioName}>Командование · {(view?.scenarioName ?? saved?.title ?? '').split(':')[0]}</span>
            <Popover label="⋯" align="right" title="Игра" data-tour="cmd-menu">{(close) => (
              <div className="menu">
                <button data-action="command.review.open" onClick={() => { close(); tap('command.review.open'); }} disabled={!view || !record?.turns.length}>Разбор операции (отчёт, PDF)…</button>
                <button data-action="command.journal.save" onClick={() => { close(); tap('command.journal.save'); }}>Сохранить журнал боевых действий (.md)</button>
                <button data-action="command.record.save" onClick={() => { close(); tap('command.record.save'); }} disabled={!record}>Сохранить запись игры (.json)</button>
                <button data-action="command.toEditor" onClick={() => { close(); tap('command.toEditor'); }}>Открыть карту в редакторе</button>
                <hr />
                <button data-action="command.exit" onClick={() => { close(); void act('command.exit'); }}>Выйти (игра сохранена)</button>
                <button data-action="command.discard" className="danger" onClick={() => { close(); void confirmAsync('Завершить игру и удалить её запись?', { ok: 'Завершить и удалить', danger: true }).then((ok) => { if (ok) void act('command.discard'); }); }}>Завершить и удалить игру</button>
              </div>
            )}</Popover>
          </div>
          {view && <div className="cmd-date">
            <b>{dayLong(view.time)}, {hhmm(view.time)}</b>
            <span>ход {view.turn} · вы командуете: {view.human.name}{view.engine === 'agents' ? ' · агентная модель: дивизии, расчёт по часам' : ''}</span>
            <span className="cmd-goal" title={`Победа: ${view.victory}. Поражение: численность ниже ${Math.round(view.strengthBelow * 100)} % исходной или предельный срок ${ddmm(view.deadline)}`}>цель — {view.victory}; срок — {ddmm(view.deadline)}; в строю {pct(view.strength)}</span>
          </div>}
          <div className="cmd-chips"><AiChip ai={ai} enemy={enemy} now={now} model={llm.settings.enemyModel || llm.settings.model} onClick={() => tap('command.tab', { tab: 'umpire' })} />
            <ActButton className={`adv-btn${advOpen ? ' on' : ''}`} data-tour="cmd-advisor" action="command.advisor.show" params={{ mode: 'toggle' }} title="ИИ-советник: вопросы по обстановке, решению, тылу, правилам">Советник</ActButton></div>
        </div>
        {view && staffsOn(view) && <PostBar v={view} post={post} cmds={cmds} />}
        {view && record && <TurnRibbon items={ribbonItems(record, view.journal, view.time, savedGame?.branches ?? [])} lines={savedGame ? gameLines(savedGame) : []}
          busy={progress} open={branchesOpen} notice={setNotice}
          project={projectHas({ drafts, acts, decision, auto: autoFields[''] }, view.lastDecision) || postEdited} />}
        <nav className="cmd-tabs" data-tour="cmd-tabs">
          {([['reports', 'Доклады'], ['intel', 'Разведка'], ['decision', 'Решение'], ['orders', `Приказы${draftList.length + acts.length ? ` · ${draftList.length + acts.length}` : ''}`], ...(staffsOn(view) ? [['staffs', `Штабы${cmds.length ? ` · ${cmds.length}` : ''}`]] : []), ['journal', 'Журнал'], ['umpire', 'Посредник'], ['results', 'Итоги']] as [Tab, string][]).map(([k, t]) => (
            <ActButton key={k} data-tour={`cmd-tab-${k}`} data-hl={`tab-${k}`} action="command.tab" params={{ tab: k }} className={`${tab === k ? 'on' : ''}${k === 'decision' && decisionMissing(decision).length ? ' todo' : ''}`}>{t}</ActButton>
          ))}
        </nav>
        <div className="cmd-body" data-tour="cmd-body">
          {!view ? <div className="cmd-wait"><span className="spinner" /> {progress}</div> : <>
            {focus && <div className="focus-bar"><span>Участок: <b>{focus.title}</b></span><label><input type="checkbox" data-action="map.focusOnly" checked={focusOnly} onChange={(e) => tap('map.focusOnly', { on: e.target.checked })} /> только он в списках</label><ActButton className="x" title="Снять фокус" action="map.sector" params={{ name: '' }}>×</ActButton></div>}
            {tab === 'reports' && staffsOn(view) && post.issuer && <PostReports v={view} issuer={post.issuer} drafts={drafts} sel={sel} onUnit={(id) => { if (id) tap('command.unit.show', { name: id }); else tap('command.unit.close'); }} onOrder={(id) => tap('command.dir.for', { name: id })} />}
            {tab === 'reports' && !staffsOn(view) && <Reports v={fv!} drafts={drafts} onUnit={(id) => { if (id) tap('command.unit.show', { name: id }); else tap('command.unit.close'); }} onOrder={(id) => tap(staffsOn(view) ? 'command.dir.for' : 'command.order.open', { name: id })} sel={sel} />}
            {tab === 'intel' && staffsOn(view) && post.issuer && <PostIntel v={view} level={post.level} issuer={post.issuer} onGo={(id) => tap('map.show', { name: id })} onAttack={(id) => targetEnemy(id)} />}
            {tab === 'intel' && !staffsOn(view) && <Intel v={fv!} onGo={(id) => tap('map.show', { name: id })} onAttack={(id) => targetEnemy(id)} />}
            {tab === 'decision' && (!staffsOn(view) || !post.issuer || view.command?.hqs[post.issuer]?.echelon === 'high_command'
              ? <Decision v={view} d={decision} auto={autoFields[''] ?? []} set={setCur} pet={petNow} issuer={null} petPick={pickMode?.kind === 'petition'} setPetPick={(b) => setPickMode(b ? { kind: 'petition' } : null)} planN={planN} planBusy={!!plan && !plan.done} llmOk={llm.check.state === 'ok'}
                ai={aiFields[''] ?? {}} batch={batchView && batchView.issuer === null ? batchView : null} otherBusy={!!batchView && batchView.issuer !== null} />
              : <Decision v={view} who={view.command!.hqs[post.issuer].name} d={postDecisions[post.issuer] ?? EMPTY} auto={autoFields[post.issuer] ?? []} set={setCur} pet={petNow} issuer={post.issuer} petPick={pickMode?.kind === 'petition'} setPetPick={(b) => setPickMode(b ? { kind: 'petition' } : null)} planN={planN} planBusy={!!plan && !plan.done} llmOk={llm.check.state === 'ok'}
                ai={aiFields[post.issuer] ?? {}} batch={batchView && batchView.issuer === post.issuer ? batchView : null} otherBusy={!!batchView && batchView.issuer !== post.issuer} />)}
            {tab === 'orders' && <>
              <div className="seg subtabs">
                {([['units', staffsOn(view) ? 'Пункт управления' : 'Войска', staffsOn(view) ? cmds.filter((c) => c.op === 'directive').length : draftList.length], ['rear', 'Тыл', acts.filter((a) => a.action.kind === 'base' || a.action.kind === 'priority').length], ['bridges', 'Переправы', acts.filter((a) => a.action.kind === 'bridge').length], ['reserves', 'Резервы', acts.filter((a) => a.action.kind === 'commit').length], ['bounds', 'Полосы', acts.filter((a) => a.action.kind === 'boundary').length]] as [Sub, string, number][])
.filter(([k]) => subsOk[k] === true).map(([k, t, n]) => (
                  <ActButton key={k} className={sub === k ? 'on' : ''} action="command.orders.sub" params={{ sub: k }} data-hl={`sub-${k}`}>{t}{n ? ` · ${n}` : ''}</ActButton>))}
              </div>
              {sub === 'units' && (staffsOn(view) ? <CommandPost v={view} post={post} cmds={cmds} /> : <Orders v={fv!} drafts={drafts} sel={sel} pick={pick} setPick={setPick} blank={blankDraft} />)}
              {sub === 'rear' && <Rear v={view} acts={acts} pickMode={pickMode} setPickMode={setPickMode} scope={scopeNow()}
                setPriority={(ids) => tap('command.rear.priority', { ids })} />}
              {sub === 'bridges' && <Bridges v={view} acts={acts} pickMode={pickMode} setPickMode={setPickMode} scope={scopeNow()} />}
              {sub === 'bounds' && <Bounds v={view} acts={acts} picking={pickMode?.kind === 'line'} setPicking={(b) => setPickMode(b ? { kind: 'line' } : null)} pts={linePts} setPts={setLinePts}
                sel={bnd} scope={scopeNow()} />}
              {sub === 'reserves' && <Reserves v={staffsOn(view) && post.issuer ? { ...view, reserveGroups: postReserves(view, post.issuer) } : view} acts={acts} pickMode={pickMode} setPickMode={setPickMode}
                scope={scopeNow()} onOrder={(id) => tap('command.order.open', { name: id })} />}
            </>}
            {tab === 'staffs' && staffsOn(view) && <Staffs v={view} cmds={cmds} issuer={post.issuer} />}
            {tab === 'results' && <ResultsTab summary={view.results ?? null} baseline={baseline} side={view.human.id === 'de' ? 'de' : 'su'} part={resPart} parts={view.engine === 'agents' ? ['turn', 'losses', 'compare'] : ['losses', 'compare']}
              empty={view.engine === 'agents' ? 'Итоги ещё не посчитаны.' : undefined}
              turn={view.debrief && <TurnDebriefPanel d={view.debrief} terms={view.terms} hq={debrief.hq} open={debrief.open} narrative={debrief.narrative} modelOn={llm.check.state === 'ok'} />} />}
            {tab === 'journal' && staffsOn(view) && post.issuer && view.command?.hqs[post.issuer]?.echelon !== 'high_command' && <PostJournal v={view} issuer={post.issuer} record={record} />}
            {tab === 'journal' && staffsOn(view) && post.issuer && <PostDocs v={view} issuer={post.issuer} />}
            {tab === 'journal' && (!staffsOn(view) || !post.issuer || view.command?.hqs[post.issuer]?.echelon === 'high_command') && <Journal v={view} />}
            {tab === 'umpire' && <Umpire view={view} record={record} ai={ai} turns={aiTurns} current={current} stream={stream} phase={aiPhase} reveal={reveal} setReveal={(on) => tap('command.reveal', { on })}
              enemy={enemy} choices={enemyChoices} setEnemy={(mode) => tap('command.enemyMode', { mode })} llm={llm} part={umpPart} />}
          </>}
        </div>
        {view && !view.over && <div className="cmd-foot" data-tour="cmd-foot" data-hl="foot">
          {blocked ? <div className="cmd-blocked">
            <b>Штаб противника не дал решения</b><span>{blocked}</span>
            <div><StaffButton action="command.ai.retry">Повторить запрос</StaffButton>
              <StaffButton action="command.ai.skip">Ход без новых приказов противника</StaffButton></div>
          </div> : progress ? <button className="rp-go" disabled><span className="spinner" /> {progress}</button>
            : <>
              <div className="cmd-check">
                <span className={decisionMissing(decision).length ? 'no' : 'yes'}>{decisionMissing(decision).length ? '○' : '✓'} решение{staffsOn(view) ? ` ${view?.terms?.topGen ?? 'Ставки'}` : ''}</span>
                {staffsOn(view) ? <span>документов: {cmds.filter((c) => c.op === 'directive').length}</span> : <span>приказов войскам: {draftList.length}</span>}
                <span>распоряжений: {acts.length}</span>
                {staffsOn(view) && <span>команд: {cmds.filter((c) => c.op !== 'directive').length}</span>}
              </div>
              <StaffButton className="rp-go primary" action="command.turn" title="Утвердить решение, отдать приказы и распоряжения и посчитать ход">
                Провести {view.turnHours === 24 ? 'сутки' : `${view.turnHours} ч`} ▸
              </StaffButton>
            </>}
        </div>}
        {view?.over && <div className={`cmd-foot cmd-over ${view.outcome?.result ?? ''}`} data-tour="cmd-over"><b>{view.outcome?.result === 'victory' ? 'Победа' : 'Поражение'}</b>
          <span>{view.outcome?.text}</span>
          <span className="muted">{goals.filter((g) => g.simulated).length} из {goals.length} контрольных событий случились. Журнал и запись игры — в меню «⋯».</span>
          <div className="row-btns"><StaffButton className="primary" action="command.review.open">Разбор операции</StaffButton><StaffButton action="command.journal.save">Сохранить журнал</StaffButton></div></div>}
      </aside>
      <main className={`rp-main${pickMode || post.pick ? ' picking' : ''}`}>
        {doc && time ? <>
          <div className="rp-bar">
          <div className="rp-tools" data-tour="cmd-tools">
            <LevelSwitch level={level} setLevel={setLevel} engine={eng} />
            <LayersMenu labels={labels} toggleLabels={toggleLabels} items={TOGGLES.filter((t) => level === 'division' || t.key !== 'combat').map((t) => ({ key: t.key, title: LAYER_TITLE[t.key] ?? t.title, on: layerOn(t.key), toggle: () => toggle(t.key) }))}
              setAll={(on) => { if (on) clearLegend(); setVis((h) => ({ ...h, ...Object.fromEntries(TOGGLES.map((t) => [t.key, on])) })); }} />
            {view && <SectorPicker scenario={view.scenario} engine={eng} bm={bm} focus={focus} setFocus={setFocus} opYear={+view.start.slice(0, 4)} onNotice={setNotice} />}
            <Popover label="Подложка" align="right"><BasemapControls bm={bm} dateNote={view ? `начала операции, ${dmy(view.start)}` : null} /></Popover>
          </div>
          </div>
          <div className="rp-map" data-tour="cmd-map">
          <MapView doc={shownDoc ?? doc} setDoc={() => {}} selected={null} setSelected={() => {}}
            selectedOverlay={null} tool={{ mode: 'select' }} setTool={() => {}} activeLayer={null} basemap={bm.current} basemapOpacity={bm.opacity} basemapDate={basemapDate(bm.current, view?.start, bm.year)}
            onEngineReady={(e) => { engine.current = e; setEng(e); if (import.meta.env.DEV) (window as unknown as { __cmdEngine: MapEngine }).__cmdEngine = e; }} onStatus={() => {}} time={time} newFromNow={false} />
          {post.pick && <div className="pick-hint"><ActButton className="link" action="command.dir.pick" params={{ field: '' }}>Готово</ActButton> Щёлкайте по карте — {({ axis: 'ось', immediate: 'рубеж ближайшей задачи', subsequent: 'рубеж последующей задачи', boundaryR: 'правая разграничительная линия', boundaryL: 'левая разграничительная линия', mainBlow: 'знаки армий главного удара' } as const)[post.pick]}; закончить — «Готово» в пункте управления</div>}
          {!pickMode && !post.pick && <MapHover engine={eng} doc={pickDoc} time={time} />}
          {pickMode && <div className="pick-hint">{pickMode.kind === 'order' ? `Щёлкните по карте — цель приказа для «${short(unit(sel)?.name ?? '')}»`
            : pickMode.kind === 'line' ? `Щёлкайте по карте — точки разграничительной линии (${linePts.length}); закончить — «Готово» во вкладке «Полосы»`
            : pickMode.kind === 'petition' ? `Щёлкайте по карте — точки линии ходатайства (${curDecision().petition?.line.length ?? 0}); закончить — «Готово» во вкладке «Решение»`
            : pickMode.kind === 'bridge' ? 'Щёлкните по реке — место переправы' : pickMode.kind === 'base' ? `Щёлкните по карте — новое место базы «${pickMode.name}»` : `Щёлкните по карте — район сосредоточения: ${short(pickMode.name)}`}
            <button onClick={() => setPickMode(null)}>Отмена</button></div>}
          {notice && <div className="cmd-notice" onClick={() => setNotice(null)}>{notice}</div>}
          {intelE && eng && <AgentMark engine={eng} at={intelE.at} />}
          {tab === 'results' && resPart === 'turn' && view?.debrief && eng && <DebriefOverlay engine={eng} events={debriefFor(view.debrief, debrief.hq).events} open={debrief.open} side={view.debrief.side} />}
          {intelE && view && <IntelPanel e={intelE} time={view.time} first={view.turn === 1} onClose={() => tap('command.card.close')}
            actions={<><button data-action="command.tab" onClick={() => { tap('command.tab', { tab: 'intel' }); setMob('staff'); }}>Разведсводка →</button>
              {unit(sel) && unit(sel)!.status !== 'destroyed' && <button data-action="command.order.set" onClick={() => targetEnemy(intelE.id)}
                title="Цель удара для выбранного объединения — во вкладке «Приказы»">Целью удара для «{short(unit(sel)!.name)}»</button>}</>} />}
          <Legend level={level} doc={doc} time={time} on={layerOn} hidden={lvHidden} setHidden={(id, h) => setLegendHidden(level, id, h)} command
            always={zoneAlways} remember="def_ops.command.legend" />
          {view && <Player start={view.start} end={view.time > view.start ? view.time : addH(view.start, view.turnHours)} time={time} setTime={setTime} events={playerEvents}
            onEvent={(e) => { if (e.at) tap('map.event', { name: e.title.split(':')[0] }); else goTo(e.place ?? null); }} mark={{ at: view.takeover, title: `Командование принято: ${ddmm(view.takeover)} ${hhmm(view.takeover)}` }} />}
          </div>
        </> : <div className="rp-empty"><div><div className="rp-empty-ic"><span className="spinner big" /></div><b>{progress ?? 'Подготовка…'}</b></div></div>}
      </main>
      {advOpen && view && advMin && <ActButton className="adv-tab" action="command.advisor.show" params={{ mode: 'open' }} title="Развернуть советника" data-hl="adv-tab">
        <span>Советник</span>{adv.some((m) => !m.result) ? <i className="spinner" /> : adv.length > advSeen ? <b className="adv-new">ответ</b> : null}</ActButton>}
      {advOpen && view && !advMin && <Advisor resize={{ width: advW, setWidth: setAdvW, reset: resetAdvW }} llm={llm} msgs={adv} text={advQ} setText={setAdvQ}
        dyn={advDyn} focus={focus}
        drafted={(f) => (staffsOn(view) ? cmds.some((c) => c.op === 'directive' && c.directive.to === f) : !!drafts[f])} postName={staffsOn(view) && post.issuer ? view.command?.hqs[post.issuer]?.name : undefined}
        plan={plan} planStale={!!plan && plan.time !== view.time} planN={planN} acceptPlan={(v, i) => void acceptByButton(v, i)}
        planOpen={planOpen}
        hasAct={(k) => acts.some((a) => a.key === k)} />}
      {review !== 'closed' && view && <div hidden={review === 'hidden'}><ReviewView view={view} llm={llm} send={send} listen={(f) => { reviewListener.current = f; }} ctl={reviewCtl} /></div>}
    </div>
    </ZonesContext.Provider>
  );
}

function AiChip({ ai, enemy, now, model, onClick }: { ai: AiStatus; enemy: EnemyMode; now: number; model: string; onClick: () => void }) {
  const sec = ai.state === 'thinking' ? Math.max(0, Math.round((now - ai.since) / 1000)) : 0;
  const text = enemy === 'passive' ? 'противник без штаба: держится прежних приказов'
    : enemy === 'intent' ? 'противник: штабы по истории как замыслу'
    : enemy === 'agents' ? 'противник: штабы-агенты по уставам'
    : ai.state === 'thinking' ? `штаб противника принимает решение… ${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
    : ai.state === 'done' ? `штаб противника принял решение${ai.turn.timings ? ` (${Math.round(ai.turn.timings.totalMs / 1000)} с)` : ''}`
    : ai.state === 'error' ? 'штаб противника: нет решения — см. «Посредник»' : 'штаб противника: ожидание';
  return <button className={`ai-chip ${enemy !== 'llm' ? 'off' : ai.state}`} onClick={onClick} title={model ? `модель: ${model}` : 'модель: первая загруженная в LM Studio'}><i />{text}</button>;
}

/* ───────────── доклады ───────────── */

function Bar({ v, warn = 0.5, bad = 0.25, label }: { v: number; warn?: number; bad?: number; label: string }) {
  const cls = v <= bad ? 'bad' : v <= warn ? 'warn' : 'ok';
  return <span className={`bar ${cls}`} title={label}><i style={{ width: `${Math.max(3, Math.min(100, v * 100))}%` }} /></span>;
}

function UnitCard({ u, open, onToggle, onOrder, draft, topGen = 'Ставки', mark }: { u: UnitReport; open: boolean; onToggle: () => void; onOrder: () => void; draft?: Draft; topGen?: string; mark?: { text: string; cls: string } | null }) {
  const chips: [string, string][] = [];
  if (mark) chips.push([mark.cls, mark.text]);
  if (u.status === 'arriving') chips.push(['muted', `прибудет ${ddmm(u.arrives!)}`]);
  if (u.status === 'reserve') chips.push(['warn', 'не введена']);
  if (u.status === 'destroyed') chips.push(['bad', 'утратила боеспособность']);
  if (u.cutOff) chips.push(['bad', 'отрезана']);
  if (u.status === 'active' && u.ammo < 0.5) chips.push(['warn', 'мало боеприпасов']);
  if (u.status === 'active' && u.fuel <= 0.05) chips.push(['warn', 'нет горючего']);
  for (const c of u.combats.slice(0, 1)) chips.push([c.outcome === 'прорыв' || c.outcome === 'продвижение' ? 'ok' : 'warn', c.role === 'attack' ? c.outcome : c.outcome === 'оборона удержана' || c.outcome === 'атака отбита' ? 'отбила атаку' : 'под натиском']);
  if (draft) chips.push(['plan', 'новый приказ']);
  return (
    <div className={`ucard${open ? ' open' : ''}${u.status !== 'active' ? ' dim' : ''}`} data-hl={`unit-${u.id}`}>
      <button className="ucard-h" data-action="command.unit.show" onClick={onToggle}>
        <span className="ucard-n">{short(u.name)}</span>
        <span className="ucard-bars"><Bar v={u.strength} label={`укомплектованность ${manningText(u)}`} /><Bar v={u.ammo / 2} label={`боеприпасы ${num(u.ammo)} бк`} /><Bar v={u.fuel / 2} label={`горючее ${num(u.fuel)} запр.`} /></span>
        <span className="ucard-p">{u.status === 'active' ? `${u.posture}, ${u.place}` : u.status === 'reserve' ? `резерв ${topGen}, готова к вводу с ${ddmm(u.reserveFrom!)} — ввести: «Приказы» → «Резервы»` : u.status === 'arriving' ? `вводится в сражение, сосредоточится ${ddmm(u.arrives!)} ${hhmm(u.arrives!)}` : 'уничтожена'}</span>
        {chips.length > 0 && <span className="ucard-chips">{chips.map(([c, t]) => <i key={t} className={c}>{t}</i>)}</span>}
      </button>
      {open && <div className="ucard-b">
        <dl>
          <dt>Задача</dt><dd>{u.task ? `${u.task} — ${u.target}` : 'нет'}{u.orderSource && <small> · {u.orderSource === 'script' ? 'по историческому плану' : u.orderSource === 'human' ? 'ваш приказ' : u.orderSource}</small>}</dd>
          {u.pending.length > 0 && <><dt>В пути</dt><dd>{u.pending.map((p, i) => <div key={i}>{p.task} — {p.target} <small>(отдан {ddmm(p.issuedAt)} {hhmm(p.issuedAt)})</small></div>)}</dd></>}
          <dt>Состав</dt><dd>{manningText(u)} — {u.personnel.toLocaleString('ru')} чел., танков и САУ {u.tanks}, орудий {u.guns}</dd>
          <dt>Запасы</dt><dd>боеприпасы {num(u.ammo)} бк, горючее {num(u.fuel)} запр.{u.cutOff ? ' · подвоз прерван' : ''}</dd>
          <dt>Усталость</dt><dd>{pct(u.fatigue)}</dd>
          <dt>За ход</dt><dd>{u.movedKm >= 0.5 ? `переместилась на ${Math.round(u.movedKm)} км` : 'на месте'}{u.combats.map((c, i) => <div key={i}>{c.role === 'attack' ? 'наступала на' : 'отражала'} {c.against.map(short).join(', ')}: {c.outcome}{c.advanceKm ? ` на ${num(c.advanceKm)} км` : ''}, соотношение {num(c.ratio)}:1, потери {c.lossPct} %</div>)}</dd>
        </dl>
        {u.status !== 'destroyed' && <button className="link" onClick={onOrder}>{draft ? 'Изменить приказ →' : 'Отдать приказ →'}</button>}
      </div>}
    </div>
  );
}

/** Средняя укомплектованность группы в сводке: крупно — от штата (штата нет — от начала операции), подпись — оба мерила. */
function ManningKpi({ g }: { g: { strength: number; manning: number | null } | null }) {
  if (!g) return <div><b>{pct(0)}</b><span>средняя укомплектованность</span></div>;
  return <div title={`средняя укомплектованность: ${manningText(g)}`}><b>{pct(g.manning ?? g.strength)}</b><span>{g.manning != null ? `от штата; ${pct(g.strength)} от начала операции` : 'от начала операции'}</span></div>;
}

/** Доклады подчинённых штаба пункта управления: сводка по его дивизиям, донесения о них за ход, доклады подчинённых. */
function PostReports({ v, issuer, drafts, sel, onUnit, onOrder }: { v: TurnView; issuer: string; drafts: Record<string, Draft>; sel: string | null; onUnit: (id: string) => void; onOrder: (id: string) => void }) {
  const h = v.command!.hqs[issuer];
  const top = h.echelon === 'high_command';
  const divs = top ? v.own.filter((u) => u.echelon === 'division' && u.status === 'active') : divisionsUnder(v, issuer);
  const names = new Set(divs.map((u) => u.name));
  const events = top ? v.events : v.events.filter((e) => [...names].some((n) => e.includes(n)) || e.includes(h.name));
  const subs = postReports(v, issuer);
  const g = groupManning(divs);
  return (
    <div className="cmd-sec">
      <h3>{top ? 'Оперативная сводка' : `Донесения — ${h.name}`} к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <div className="kpis small">
        <div><b>{divs.length}</b><span>дивизий в строю</span></div>
        <ManningKpi g={divs.length ? g : null} />
        <div className={divs.some((u) => u.cutOff) ? 'alarm' : ''}><b>{divs.filter((u) => u.cutOff).length}</b><span>отрезано от подвоза</span></div>
      </div>
      {v.turn > 1 && <div className="dispatch"><h4>Донесения за ход {v.debrief && <ActButton className="turn-show" action="results.show" params={{ part: 'turn' }} data-hl="results-turn-link" title="Вкладка «Итоги», разбор хода: ключевые события на карте, «разобрать с позиции …»">Итоги хода ▸</ActButton>}</h4>
        {events.length ? <ul>{events.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="muted">Существенных событий нет.</p>}</div>}
      <h4 className="cmd-h4">{top ? 'Фронты' : 'Подчинённые'}</h4>
      {subs.length ? subs.map((u) => <UnitCard topGen={v.terms?.topGen} mark={markFor(v, u.id)} key={u.id} u={u} open={sel === u.id} draft={drafts[u.id]} onToggle={() => onUnit(sel === u.id ? '' : u.id)} onOrder={() => onOrder(u.id)} />)
        : <p className="muted">Подчинённых в строю нет.</p>}
    </div>
  );
}

/** Разведсводка пункта: противник по его штабам ступени пункта, в полосе пункта. */
function PostIntel({ v, level, issuer, onGo, onAttack }: { v: TurnView; level: MapLevel; issuer: string; onGo: (id: string) => void; onAttack: (id: string) => void }) {
  const g = postIntel(v, level, issuer);
  const h = v.command!.hqs[issuer];
  return (
    <div className="cmd-sec">
      <h3>Разведсводка{h.echelon === 'high_command' ? '' : ` — перед ${h.name}`} к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <p className="note">Противник в пределах разведки ({v.detectKm} км от наших войск){h.echelon === 'high_command' ? '' : ' и в полосе штаба'}, по его объединениям ступени этого пункта. Силы — оценка, округлённо.</p>
      {!g.length && <p className="muted">Противник в полосе не обнаружен.</p>}
      {g.map((x) => (
        <div key={x.id} className="intel" data-action="map.show" onClick={() => onGo(x.members[0].id)}>
          <div className="intel-h"><b>{short(x.name)}</b>{x.fresh && <i className="fresh">новое</i>}<span className="muted">{x.members.length > 1 ? `${x.members.length} соед.` : x.members[0].posture}</span></div>
          {x.nearestKm !== null && <div>{Math.round(x.nearestKm)} км до наших войск</div>}
          {x.members.length === 1 ? <div className="muted">{x.members[0].estimate}</div>
            : <details onClick={(ev) => ev.stopPropagation()}><summary className="muted">состав: {x.members.slice(0, 3).map((m) => short(m.name)).join(', ')}{x.members.length > 3 ? ` и ещё ${x.members.length - 3}` : ''}</summary>
              <ul className="intel-list">{x.members.map((m) => <li key={m.id}>{short(m.name)}: {m.estimate}</li>)}</ul></details>}
          <button className="link" onClick={(ev) => { ev.stopPropagation(); onAttack(x.members[0].id); }} title="Пункт ближайшей задачи открытого документа">назначить целью →</button>
        </div>
      ))}
    </div>
  );
}

/** Документы штаба пункта и его подчинённых (над журналом боевых действий). */
function PostDocs({ v, issuer }: { v: TurnView; issuer: string }) {
  const d = postDocs(v, issuer).slice().reverse();
  const h = v.command!.hqs[issuer];
  return (
    <div className="cmd-sec">
      <h3>Документы — {h.name} и подчинённые</h3>
      {d.length ? <div className="staffs-docs">{d.map((x, k) => <div key={k} className={`doc doc-${x.kind}`}><b>{x.time}</b> {x.hqName}: {placeText(x.text, v.places)}{x.rule && <small className="muted"> ({x.rule})</small>}</div>)}</div>
        : <p className="muted">Документов нет.</p>}
    </div>
  );
}

function Grouped({ v, children }: { v: TurnView; children: (u: UnitReport) => ReactNode }) {
  const groups = [...v.groups, { id: '', name: 'Прочие' }];
  return <>{groups.map((g) => {
    const list = v.own.filter((u) => (g.id ? u.parent === g.id : !v.groups.some((x) => x.id === u.parent)));
    if (!list.length) return null;
    return <section key={g.id || 'other'} className="grp"><h4>{g.name} <small>{list.filter((u) => u.status === 'active').length} в строю</small></h4>{list.map(children)}</section>;
  })}</>;
}

function Reports({ v, drafts, onUnit, onOrder, sel }: { v: TurnView; drafts: Record<string, Draft>; onUnit: (id: string) => void; onOrder: (id: string) => void; sel: string | null }) {
  const active = v.own.filter((u) => u.status === 'active');
  // выбран щелчком на карте — раскрытый доклад прокручивается в поле зрения
  useEffect(() => { if (sel) document.querySelector('.cmd-body .ucard.open')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [sel]);
  const cut = active.filter((u) => u.cutOff).length;
  const g = groupManning(active);
  const reached = v.goals.filter((g) => g.simulated);
  return (
    <div className="cmd-sec">
      <h3>Оперативная сводка к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <div className="kpis small">
        <div><b>{active.length}</b><span>объединений в строю</span></div>
        <ManningKpi g={active.length ? g : null} />
        <div className={cut ? 'alarm' : ''}><b>{cut}</b><span>отрезано от подвоза</span></div>
      </div>
      {v.turn > 1 && <div className="dispatch">
        <h4>Донесения за ход <ActButton className="turn-show" action="command.turn.show" data-hl="turn-show" title="Посредник покажет прошедший ход на карте: общее, главные бои, цели, тыл, противник">Разбор хода на карте ▸</ActButton>{v.debrief && <ActButton className="turn-show" action="results.show" params={{ part: 'turn' }} data-hl="results-turn-link" title="Вкладка «Итоги», разбор хода: ключевые события на карте, «разобрать с позиции …»">Итоги хода ▸</ActButton>}</h4>
        {v.events.length ? <ul>{v.events.map((e, i) => <li key={i}>{e}</li>)}</ul> : <p className="muted">Существенных событий нет.</p>}
      </div>}
      {v.turn === 1 && <p className="note">{staffsOn(v) ? 'Командование принято. Вы — верхняя инстанция: исторические директивы, директивы штабам и взятие штабов под управление — во вкладке «Штабы», приказы — во вкладке «Приказы».' : 'Командование принято. Войска выполняют задачи, полученные до этого момента; исторические приказы дальше не поступают. Новые приказы — во вкладке «Приказы».'}</p>}
      {reached.length > 0 && <div className="dispatch"><h4>Достигнуто</h4><ul>{reached.map((g) => <li key={g.title}>{g.title.split(':')[0]} — {ddmm(g.simulated!)} <small className="muted">(в истории {ddmm(g.historical)})</small></li>)}</ul></div>}
      <h4 className="cmd-h4">Доклады объединений</h4>
      <Grouped v={v}>{(u) => <UnitCard topGen={v.terms?.topGen} mark={markFor(v, u.id)} key={u.id} u={u} open={sel === u.id} draft={drafts[u.id]} onToggle={() => onUnit(sel === u.id ? '' : u.id)} onOrder={() => onOrder(u.id)} />}</Grouped>
    </div>
  );
}

function Intel({ v, onGo, onAttack }: { v: TurnView; onGo: (id: string) => void; onAttack: (id: string, name: string) => void }) {
  return (
    <div className="cmd-sec">
      <h3>Разведсводка к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <p className="note">Противник виден в пределах {v.detectKm} км от наших войск (войсковая и авиационная разведка). Силы — оценка, округлённо. Что дальше — неизвестно.</p>
      {!v.intel.length && <p className="muted">Противник в пределах разведки не обнаружен.</p>}
      {v.intel.map((e) => (
        <div key={e.id} className="intel" data-action="map.show" onClick={() => onGo(e.id)}>
          <div className="intel-h"><b>{short(e.name)}</b>{e.fresh && <i className="fresh">новое</i>}<span className="muted">{e.posture}</span></div>
          <div>{e.place}{e.nearest ? ` · ${Math.round(e.nearest.km)} км от: ${short(e.nearest.name)}` : ''}</div>
          <div className="muted">{e.estimate}</div>
          <button className="link" onClick={(ev) => { ev.stopPropagation(); onAttack(e.id, e.name); }} title="Цель для выбранного объединения во вкладке «Приказы»">назначить целью удара →</button>
        </div>
      ))}
    </div>
  );
}

/* ───────────── приказы ───────────── */

function Orders({ v, drafts, sel, pick, setPick, blank }: {
  v: TurnView; drafts: Record<string, Draft>; sel: string | null; pick: boolean; setPick: (b: boolean) => void; blank: (id: string) => Draft;
}) {
  const u = v.own.find((x) => x.id === sel && x.status !== 'destroyed') ?? null;
  const d = u ? drafts[u.id] ?? null : null;
  const list = Object.values(drafts);
  return (
    <div className="cmd-sec">
      <h3>Боевое распоряжение на {ddmm(v.time)}</h3>
      <p className="note">Приказ доходит до войск не сразу: армиям — {v.delays.army ?? 0} ч, корпусам — {v.delays.corps ?? 0} ч. Отданные приказы не пропадают: объединения выполняют их, пока не получат новый («в силе» в списке ниже). Здесь — только новые приказы на этот ход.</p>
      {list.length > 0 && <div className="draft-list" data-hl="drafts">
        {list.map((x) => { const w = v.own.find((y) => y.id === x.formation)!; return (
          <div key={x.formation} className={`draft${x.formation === sel ? ' on' : ''}`} data-hl={`order-${x.formation}`} data-action="command.order.open" onClick={() => tap('command.order.open', { name: x.formation })}>
            <b>{short(w.name)}</b> — {TASK_RU[x.task]}{x.targetText ? `: ${x.targetText}` : ''}
            <button className="x" title="Отменить приказ" data-action="command.order.cancel" onClick={(e) => { e.stopPropagation(); tap('command.order.cancel', { unit: x.formation }); }}>×</button>
          </div>); })}
      </div>}
      {u ? <OrderEditor v={v} u={u} d={d ?? blank(u.id)} isNew={!d} pick={pick} setPick={setPick} />
        : <p className="muted">Выберите объединение — в списке ниже или щелчком по его знаку на карте.</p>}
      {(v.sectors?.length ?? 0) > 0 && <details className="sect-note"><summary>Полосы и разграничительные линии</summary><ul>{v.sectors.map((t) => <li key={t}>{t}</li>)}</ul>
        <p className="muted small">Объединения идут к цели своей полосой; выход в полосу соседа по директиве не запрещён, но отмечается в разборе.</p></details>}
      <h4 className="cmd-h4">Объединения</h4>
      <Grouped v={v}>{(x) => x.status === 'destroyed' ? null : (
        <button key={x.id} className={`orow${x.id === sel ? ' on' : ''}`} data-hl={`orow-${x.id}`} data-action="command.order.open" onClick={() => tap('command.order.open', { name: x.id })}>
          <span className="orow-n">{short(x.name)}</span>
          <span className="orow-t">{drafts[x.id] ? <b className="plan">новый: {TASK_RU[drafts[x.id].task]}{drafts[x.id].targetText ? `: ${drafts[x.id].targetText}` : ''}</b>
            : x.status === 'reserve' ? `резерв ${v.terms?.topGen ?? 'Ставки'}, не введена` : x.status === 'arriving' ? `прибудет ${ddmm(x.arrives!)}`
            : x.pending.length ? <span className="pend">в пути: {x.pending[x.pending.length - 1].task} — {x.pending[x.pending.length - 1].target}</span>
            : x.task ? <span className="keep" title="Приказ прошлых ходов в силе, пока не отдан новый">в силе: {x.task} — {x.target}</span> : 'без задачи'}</span>
        </button>)}</Grouped>
    </div>
  );
}

/** Цель приказа в полосе соседа по действующей директиве: чья полоса (null — в своей или директивы нет). */
function neighbourAt(v: TurnView, unit: string, at: LngLat): { name: string; title: string } | null {
  const g = v.groupOf?.[unit];
  for (const b of v.boundaries ?? []) {
    if (b.right !== g && b.left !== g) continue;
    const k = Math.cos((at[1] * Math.PI) / 180) * 111.32;
    const xy = (p: LngLat): [number, number] => [p[0] * k, p[1] * 110.57];
    const sd = sideOf(b.line.map(xy), xy(at));
    const own = b.right === g ? 1 : -1;
    if (sd !== 0 && sd !== own) return { name: own > 0 ? b.leftName : b.rightName, title: b.title };
  }
  return null;
}

function OrderEditor({ v, u, d, isNew, pick, setPick }: { v: TurnView; u: UnitReport; d: Draft; isNew: boolean; pick: boolean; setPick: (b: boolean) => void }) {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<'place' | 'enemy' | 'point'>(Array.isArray(d.target) ? 'point' : d.target && typeof d.target === 'object' ? 'enemy' : 'place');
  useEffect(() => { setQ(''); }, [u.id]);
  const delay = v.delays[u.echelon] ?? 0;
  const P = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111;
  const nearPlaces = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return v.places.map((p) => ({ ...p, km: P(u.at, p.at) })).filter((p) => !ql || p.title.toLowerCase().includes(ql)).sort((a, b) => a.km - b.km).slice(0, ql ? 30 : 12);
  }, [q, u.id, v.places]); // eslint-disable-line react-hooks/exhaustive-deps
  /** Правка приказа — действие реестра (как голосом): задача, цель, указания. */
  const set = (p: { task?: Task; place?: string; enemy?: string; clear?: boolean; note?: string }) => tap('command.order.set', { unit: u.id, ...p });
  const needs = NEEDS_TARGET.includes(d.task);
  const arrive = addH(v.time, delay);
  const ranks = staffsOn(v);
  const form = d.form ?? 'instruction';
  const foreign = d.at ? neighbourAt(v, u.id, d.at) : null;
  return (
    <div className="oedit" data-hl="oedit">
      <div className="oedit-h"><b>{u.name}</b><ActButton className="x" action="command.order.close" title="Закрыть">×</ActButton></div>
      <div className="muted small">{u.status === 'arriving' ? `прибудет ${ddmm(u.arrives!)} — приказ будет ждать` : `${u.posture}, ${u.place} · сейчас: ${u.task ? `${u.task} — ${u.target}` : 'без задачи'}`}</div>
      <label>Задача
        <select value={d.task} data-action="command.order.set" onChange={(e) => set({ task: e.target.value as Task })}>
          {TASKS.map((t) => <option key={t} value={t}>{TASK_RU[t]}</option>)}
        </select>
      </label>
      <div className="seg">
        {([['place', 'Пункт'], ['enemy', 'Противник'], ['point', 'Точка на карте']] as const).map(([k, t]) => <button key={k} className={mode === k ? 'on' : ''} onClick={() => setMode(k)}>{t}</button>)}
      </div>
      {mode === 'place' && <div className="pick-list">
        <input placeholder="Поиск пункта…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="pl-items">{nearPlaces.map((p) => <button key={p.id} className={d.target === p.id ? 'on' : ''} onClick={() => set({ place: p.id })}>{p.title}<small>{Math.round(p.km)} км</small></button>)}</div>
      </div>}
      {mode === 'enemy' && <div className="pick-list"><div className="pl-items">
        {v.intel.length ? v.intel.map((e) => <button key={e.id} className={typeof d.target === 'object' && d.target && !Array.isArray(d.target) && d.target.formation === e.id ? 'on' : ''}
          onClick={() => set({ enemy: e.id })}>{short(e.name)}<small>{Math.round(P(u.at, e.at))} км</small></button>) : <span className="muted">Противник в пределах разведки не обнаружен</span>}
      </div></div>}
      {mode === 'point' && <button className={pick ? 'on' : ''} onClick={() => setPick(!pick)}>{pick ? 'Щёлкните по карте… (отмена)' : Array.isArray(d.target) ? 'Указать другую точку' : 'Указать точку на карте'}</button>}
      <div className={`otarget${needs && !d.target && !isNew ? ' miss' : ''}`}>{d.target ? <>Цель: <b>{d.targetText}</b> <button className="link" onClick={() => set({ clear: true })}>убрать</button></> : needs ? 'Для этой задачи нужна цель — выберите пункт, противника или точку' : 'Цель не указана — на месте'}</div>
      {foreign && <div className="adv-warn">⚠ Цель — в полосе соседа ({foreign.name}) по директиве «{foreign.title}». Войска пойдут туда, но своей полосой, где можно; выход в чужую полосу отмечается в разборе.</div>}
      <label>Указания <textarea rows={2} value={d.note} placeholder="Силы, порядок, взаимодействие, срок…" onChange={(e) => set({ note: e.target.value })} /><small className="muted">для журнала и разбора; арбитр исполняет задачу и цель</small></label>
      {ranks && <div className="oform" data-hl="oform">
        <div className="seg">{([['instruction', 'Распоряжение'], ['order', 'Приказ']] as const).map(([k, t]) => <ActButton key={k} className={form === k ? 'on' : ''} action="command.order.set" params={{ unit: u.id, form: k }}
          title={k === 'order' ? 'Подготовленный приказ: около суток на ступень, полная слаженность' : 'Боевое распоряжение: 1–3 ч на ступень, слаженность ниже'}>{t}</ActButton>)}</div>
        <small>{formTitle(v.human.id, u.echelon, form)}{overHead(u.echelon) ? ' — пропущенные штабы получат извещение' : ''}; до войск — {form === 'order' ? 'около суток на каждую ступень' : '1–3 ч на каждую ступень'}</small>
      </div>}
      {!ranks && <div className="muted small">Дойдёт до войск ≈ {hhmm(arrive)} {ddmm(arrive)} (через {delay} ч).</div>}
      <div className="oedit-f">
        {isNew ? <span className="muted small">Приказ войдёт в распоряжение, как только вы выберете задачу или цель.</span>
          : <StaffButton className="link danger" action="command.order.cancel" params={{ unit: u.id }}>Отменить приказ</StaffButton>}
      </div>
    </div>
  );
}

/* ───────────── советник ───────────── */

type Dyn = { own: { id: string; name: string }[]; group: { id: string; name: string }[]; enemy: { id: string; name: string }[]; reserve: { id: string; name: string }[] };
interface Leaf { q: string; path: string[]; cat: string }

/** Все вопросы дерева (с раскрытыми по обстановке ветвями) — для поиска. */
function allLeaves(dyn: Dyn, tree: AdviceNode[] = ADVICE_TREE): Leaf[] {
  const out: Leaf[] = [];
  const walk = (n: AdviceNode, path: string[], cat: string) => {
    const p = [...path, n.title];
    for (const q of n.questions ?? []) out.push({ q, path: p, cat });
    if (n.dyn) for (const x of dyn[n.dyn]) out.push({ q: n.template!.replace('{name}', x.name), path: p, cat });
    for (const c of n.children ?? []) walk(c, p, cat);
  };
  for (const c of tree) walk(c, [], c.id);
  return out;
}

function Advisor({ resize, postName, llm, msgs, text, setText, drafted, dyn, focus, plan, planStale, planN, acceptPlan, planOpen, hasAct }: {
  resize: { width: number; setWidth: (w: number) => void; reset: () => void };
  /** Пункт управления: советник думает за этот штаб. */
  postName?: string;
  llm: Llm; msgs: AdvMsg[]; text: string; setText: (s: string) => void; drafted: (f: string) => boolean; dyn: Dyn; focus: Sector | null;
  plan: PlanState | null; planStale: boolean; planN: number; acceptPlan: (v: PlanVariantView, i: number) => void;
  planOpen: number | null; hasAct: (key: string) => boolean;
}) {
  /** Путь по дереву: индексы узлов (пусто — категории). */
  const [path, setPath] = useState<AdviceNode[]>([]);
  const [find, setFind] = useState('');
  const [navOpen, setNavOpen] = useState(true);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs, plan?.variants.length, plan?.id]);
  const [speakAns] = useSpeakAnswers();
  const busy = msgs.some((m) => !m.result);
  // диктовка в поле вопроса — своим микрофоном, независимо от голосового управления (voice/standalone.ts)
  const [mic, setMic] = useState<{ on: boolean; err: string | null }>({ on: false, err: null });
  const micStop = useRef<(() => void) | null>(null);
  useEffect(() => () => micStop.current?.(), []);
  const micReady = dictateReady();
  const toggleMic = () => {
    if (mic.on) { micStop.current?.(); return; }
    const before = text.trim();
    setMic({ on: true, err: null });
    micStop.current = dictate({
      onText: (t) => setText(before ? `${before} ${t}` : t.charAt(0).toUpperCase() + t.slice(1)),
      onEnd: (err) => { micStop.current = null; setMic({ on: false, err: err ?? null }); },
    });
  };
  const planBusy = !!plan && !plan.done;
  // запрошены варианты — свернуть темы, чтобы карточки были видны
  useEffect(() => { if (plan) setNavOpen(false); }, [plan?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const node = path[path.length - 1] ?? null;
  const cat = path[0]?.id ?? 'situation';
  const topic = path.map((n) => n.title).join(' › ');
  const go = (q: string, c = cat, t = topic) => {
    if (!q.trim() || busy) return;
    tap('command.advisor.ask', { text: q.trim(), cat: c, topic: t || 'свободный вопрос' }); setText('');
    // телефон: свернуть темы, чтобы ответ был виден
    if (window.matchMedia?.('(max-width: 760px)').matches) setNavOpen(false);
  };
  // участок в фокусе — своя категория вопросов первой
  const tree = useMemo<AdviceNode[]>(() => (focus ? [{ id: 'situation', title: `Участок: ${focus.title}`, hint: 'обстановка, противник, решение на участке', children: [
    { id: 'sector', title: 'На участке', questions: [
      `Обстановка на участке «${focus.title}»: силы сторон, итоги суток, угрозы`,
      `Что противник может предпринять на участке «${focus.title}»?`,
      `Как действовать нашим войскам на участке «${focus.title}»? Предложи приказы`,
      `Что мешает продвижению на участке «${focus.title}» — местность, реки, подвоз?`,
      `Чего мы не знаем о противнике на участке «${focus.title}»?`,
    ] }] }, ...ADVICE_TREE] : ADVICE_TREE), [focus]);
  const leaves = useMemo(() => allLeaves(dyn, tree), [dyn, tree]);
  const found = find.trim() ? leaves.filter((l) => l.q.toLowerCase().includes(find.trim().toLowerCase()) || l.path.join(' ').toLowerCase().includes(find.trim().toLowerCase())).slice(0, 40) : null;
  const items = node ? [...(node.children ?? [])] : tree;
  const questions = node ? [...(node.questions ?? []), ...(node.dyn ? dyn[node.dyn].map((x) => node.template!.replace('{name}', x.name)) : [])] : [];
  const dynEmpty = node?.dyn && !dyn[node.dyn].length;
  return (
    <div className="advisor" data-tour="cmd-advisor-panel" data-hl="advisor">
      <Resizer {...resize} edge="left" />
      <div className="adv-h"><b>Советник</b><span className="muted">{postName ? `штаб: ${postName}` : 'видит то же, что и вы'}</span><span style={{ flex: 1 }} />
        {msgs.length > 0 && <ActButton className="link" action="command.advisor.clear">очистить</ActButton>}<ActButton className="x adv-min" action="command.advisor.show" params={{ mode: 'min' }} title="Свернуть к краю карты (беседа сохранится)">–</ActButton><ActButton className="x" action="command.advisor.show" params={{ mode: 'close' }} title="Скрыть советника (беседа сохранится)">×</ActButton></div>
      <ModelPicker llm={llm} who="adv" purpose="ответов советника" />
      <div className="adv-plan-bar">
        <span><b>Варианты решения на ход</b><small>решение, приказы, тыл — принять целиком и поправить</small></span>
        <select value={planN} disabled={planBusy} data-action="command.variants.count" onChange={(e) => tap('command.variants.count', { n: +e.target.value })} title="Сколько вариантов">{[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? '1 вариант' : `${n} варианта`}</option>)}</select>
        {planBusy ? <StaffButton action="command.advisor.stop">Стоп</StaffButton> : <StaffButton className="primary" action="command.variants" params={{ count: planN }}>Предложить</StaffButton>}
      </div>
      <div className="adv-body">
        {!msgs.length && <div className="adv-empty">
          <p>Выберите тему ниже — категория, раздел, вопрос; разделы «По армиям», «По соединениям», «По резервам» собраны из текущей обстановки. Или найдите вопрос поиском, или спросите своими словами. Советник знает только то, что знает ваш штаб: доклады, разведсводку, ваш проект решения и правила арбитра; о противнике вне разведки сведений у него нет. Каждый ответ помечен, на что он опирается и чего штаб не знает. Предложенные приказы включаются в распоряжение одним нажатием.</p>
        </div>}
        {msgs.map((m) => (
          <div key={m.id} className="adv-msg">
            <div className="adv-q"><small>{m.cat}</small>{m.q}</div>
            <div className="adv-a">
              {m.result && !m.result.ok ? <span className="err">{m.result.error === 'остановлено' ? 'Остановлено.' : `Советник не ответил: ${m.result.error}`} <StaffButton className="link" action="command.advisor.ask" params={{ text: m.q, cat: m.catId, topic: m.cat }}>спросить ещё раз</StaffButton></span>
                : m.answer ? <div className="adv-md" dangerouslySetInnerHTML={{ __html: mdToHtml(m.answer) }} />
                : !m.result && m.wait ? <span className="muted">{m.wait}</span> : <span className="muted">…</span>}
              {!m.result && <span className="spinner" />}
              {m.result?.ok && m.result.rewritten && <span className="adv-rew" key="rw">ответ переписан: в первом варианте были сведения, которых у штаба нет</span>}
              {m.result?.warning && <div className="adv-warn">⚠ {m.result.warning}</div>}
              {m.result?.ok && m.result.unknowns.length > 0 && <div className="adv-unk"><b>Неизвестно штабу:</b><ul>{m.result.unknowns.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}
              {m.result?.ok && m.result.basis.length > 0 && <div className="adv-basis">опора: {m.result.basis.map((b) => <i key={b} className={b === 'история' || b === 'общие знания' ? 'ext' : ''}>{b}</i>)}</div>}
              {m.result?.suggestions.map((sg, i) => (
                <div key={i} className={`adv-sug${sg.ok ? '' : ' bad'}`}>
                  <div><b>{short(sg.name)}</b> — {TASK_RU[sg.task]}{sg.targetText ? `: ${sg.targetText}` : ''}</div>
                  <div className="muted">{sg.why}</div>
                  {sg.ok ? <StaffButton disabled={drafted(sg.formation)} action="command.suggestion.take" params={{ msg: m.id, i }}>{drafted(sg.formation) ? 'в распоряжении' : 'В распоряжение'}</StaffButton>
                    : <div className="iss">{sg.issue ?? 'не удалось сопоставить с обстановкой'} — не может быть исполнен</div>}
                </div>
              ))}
              {m.result?.followUps.length ? <div className="adv-fu"><small className="muted">Дальше можно спросить:</small>{m.result.followUps.map((f) => <button key={f} disabled={busy} onClick={() => go(f, m.catId, m.cat)}>{f}</button>)}</div> : null}
              {m.result?.seconds != null && <small className="muted">{m.result.seconds} с</small>}
            </div>
          </div>
        ))}
        {plan && <PlanBlock plan={plan} stale={planStale} open={planOpen} accept={acceptPlan} drafted={drafted} hasAct={hasAct} />}
        <div ref={end} />
      </div>
      <div className={`adv-nav${navOpen ? '' : ' closed'}`}>
        <div className="adv-crumbs">
          <button className="adv-toggle" onClick={() => setNavOpen(!navOpen)} title={navOpen ? 'Свернуть темы' : 'Показать темы'}>{navOpen ? '▾' : '▸'} Темы</button>
          {navOpen && !found && <>
            <button className={path.length ? 'crumb' : 'crumb on'} onClick={() => setPath([])}>все</button>
            {path.map((n, i) => <span key={n.id + i}>› <button className={i === path.length - 1 ? 'crumb on' : 'crumb'} onClick={() => setPath(path.slice(0, i + 1))}>{n.title}</button></span>)}
          </>}
          {navOpen && <input className="adv-find" placeholder="Найти вопрос…" value={find} onChange={(e) => setFind(e.target.value)} />}
        </div>
        {navOpen && <div className="adv-list">
          {found ? (found.length ? found.map((l, i) => <button key={i} className="adv-leaf" disabled={busy} onClick={() => { go(l.q, l.cat, l.path.join(' › ')); setFind(''); }}><small>{l.path.join(' › ')}</small>{l.q}</button>)
            : <span className="muted">Ничего не найдено — спросите своими словами ниже.</span>)
            : <>
              {!node && <div className="adv-tiles">{items.map((c) => <button key={c.id} onClick={() => setPath([c])}><b>{c.title}</b><small>{c.hint}</small></button>)}</div>}
              {node && items.map((c) => <button key={c.id} className="adv-sub" onClick={() => setPath([...path, c])}>
                <span>{c.title}</span><small>{c.dyn ? `${dyn[c.dyn].length}` : (c.questions?.length ?? c.children?.length ?? 0)} ›</small></button>)}
              {questions.map((q) => <button key={q} className="adv-leaf" disabled={busy} onClick={() => go(q)}>{q}</button>)}
              {dynEmpty && <span className="muted">Сейчас таких нет.</span>}
            </>}
        </div>}
      </div>
      <div className={`adv-in${mic.on ? ' rec' : ''}`}>
        <textarea rows={2} value={text} placeholder={mic.on ? 'Говорите — вопрос записывается…' : node ? `Свой вопрос (${topic})…` : 'Свой вопрос…'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(text); } }} />
        <div className="adv-in-ic">
          {busy ? <StaffButton className="ic-btn stop" action="command.advisor.stop" title="Прервать ответ (модель освобождается)" aria-label="Остановить ответ"><svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="1.5" /></svg></StaffButton>
            : <button className="ic-btn" disabled={!text.trim()} title="Спросить (Enter)" aria-label="Спросить" onClick={() => go(text)}><svg viewBox="0 0 24 24"><path d="M19 6v6a2 2 0 0 1-2 2H6" /><path d="m10 10-4 4 4 4" /></svg></button>}
          <button className={`ic-btn mic${mic.on ? ' on' : ''}`} disabled={micReady !== true} aria-label={mic.on ? 'Остановить запись' : 'Продиктовать вопрос'}
            title={micReady !== true ? micReady : mic.on ? 'Остановить запись' : 'Продиктовать вопрос — микрофон работает и без голосового управления'} onClick={toggleMic}>
            <svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg></button>
        </div>
      </div>
      {mic.err && <div className="adv-mic-err">Микрофон: {mic.err}.</div>}
      <label className="adv-voice" title="Ответ советника читается вслух — и без голосового управления: голосом штаба, если сервис голоса на связи, иначе синтезом речи окна. Голосом: «Штаб, читай ответы советника вслух» / «не читай ответы».">
        <input type="checkbox" checked={speakAns} onChange={(e) => { void act('command.advisor.voice', { on: e.target.checked }); }} /> Читать ответы вслух
        <small> · голосом: «запиши в вопрос …», «отправь вопрос»</small>
      </label>
      <div className="adv-note">Вопросы читает только советник. Арбитр исполняет лишь утверждённые вами приказы в строгой форме — объединение, задача, цель.</div>
    </div>
  );
}

/** Варианты решения от советника: карточки по мере генерации; принять целиком, только решение или отдельные приказы и распоряжения. */
function PlanBlock({ plan, stale, open, accept, drafted, hasAct }: {
  plan: PlanState; stale: boolean; open: number | null; accept: (v: PlanVariantView, i: number) => void; drafted: (f: string) => boolean; hasAct: (key: string) => boolean;
}) {
  const D: [Exclude<keyof HumanDecision, 'petition'>, string][] = [['assessment', 'Оценка обстановки'], ['enemyIntent', 'Замысел противника'], ['intent', 'Решение'], ['risks', 'Риски'], ['report', 'Донесение вышестоящему']];
  return (
    <div className="adv-msg plan" data-hl="plan">
      <div className="adv-q"><small>Решение › Варианты решения на ход · {ddmm(plan.time)} {hhmm(plan.time)}</small>Предложите {plan.count === 1 ? 'вариант' : `${plan.count} варианта`} решения на ход</div>
      {stale && <div className="adv-warn">Ход сменился — эти варианты составлены для прошлой обстановки; принять их нельзя. <StaffButton className="link" action="command.variants" params={{ count: plan.count }}>предложить заново</StaffButton></div>}
      {plan.warning && <div className="adv-warn">⚠ {plan.warning}</div>}
      {plan.variants.map((v, i) => v && (
        <div key={i} className={`plan-var${plan.accepted === i ? ' on' : ''}`} data-hl={`variant-${i + 1}`}>
          <div className="plan-h" data-action="command.variant.open" onClick={() => tap('command.variant.open', open === i ? { open: false } : { n: i + 1 })}>
            <b>{i + 1}. {v.title}</b>{plan.accepted === i && <i className="plan-ok">принят</i>}<span className="muted">{open === i ? '▾' : '▸'}</span>
          </div>
          <div className="plan-idea">{v.idea}</div>
          <div className="plan-sum muted">приказов {v.orders.filter((o) => o.ok).length}{v.orders.some((o) => !o.ok) ? ` (+${v.orders.filter((o) => !o.ok).length} не сопоставлено)` : ''} · распоряжений {v.acts.filter((a) => a.ok).length}{v.fix ? ` · исправление по подсказке: ${v.fix.fixed} из ${v.fix.failed} ${v.fix.failed === 1 ? 'приказа' : 'приказов'} исправлено` : ''}</div>
          {open === i && <div className="plan-body">
            {D.filter(([k]) => v.decision[k]).map(([k, t]) => <div key={k} className="plan-f"><small>{t}</small><div>{v.decision[k]}</div></div>)}
            {v.orders.length > 0 && <div className="plan-f"><small>Приказы войскам</small>
              {v.orders.map((o, j) => <div key={j} className={`plan-row${o.ok ? '' : ' bad'}`}>
                <span><b>{short(o.name)}</b> — {TASK_RU[o.task]}{o.targetText ? `: ${o.targetText}` : ''}<em className="muted"> {o.why}</em>{!o.ok && <em className="iss"> {o.issue ?? 'не сопоставлено с обстановкой'}</em>}</span>
                {o.ok && !stale && <StaffButton className="link" disabled={drafted(o.formation)} action="command.variant.take" params={{ n: i + 1, order: j + 1 }}>{drafted(o.formation) ? 'в проекте' : 'взять'}</StaffButton>}
              </div>)}</div>}
            {v.acts.length > 0 && <div className="plan-f"><small>Тыл, переправы, резервы</small>
              {v.acts.map((a, j) => <div key={j} className={`plan-row${a.ok ? '' : ' bad'}`}>
                <span><b>{a.label}</b> <em className="muted">{a.text}</em>{!a.ok && <em className="muted"> ({a.given})</em>}</span>
                {a.ok && !stale && <StaffButton className="link" disabled={hasAct(a.key)} action="command.variant.take" params={{ n: i + 1, act: j + 1 }}>{hasAct(a.key) ? 'в проекте' : 'взять'}</StaffButton>}
              </div>)}</div>}
          </div>}
          {!stale && <div className="plan-act">
            <button className="primary" data-action="command.variant.pick" disabled={!plan.done} title={plan.done ? '' : 'дождитесь всех вариантов'} onClick={() => accept(v, i)}>{plan.accepted === i ? 'Принять заново' : 'Принять вариант'}</button>
            <StaffButton action="command.variant.pick" params={{ n: i + 1, only: true }} disabled={!plan.done}>Только решение</StaffButton>
          </div>}
        </div>
      ))}
      {!plan.done && <div className="plan-wait"><span className="spinner" /> {plan.progress}{plan.variants.length ? ` · готово вариантов: ${plan.variants.filter(Boolean).length} из ${plan.count}` : ''}</div>}
      {plan.done && plan.error && <div className={plan.variants.length ? 'muted' : 'err'}>{plan.variants.length ? `Не все варианты: ${plan.error}` : `Советник не дал вариантов: ${plan.error}`} <StaffButton className="link" action="command.variants" params={{ count: plan.count }}>ещё раз</StaffButton></div>}
      {plan.done && <small className="muted">{plan.seconds != null ? `${plan.seconds} с` : ''}{plan.model ? ` · ${plan.model}` : ''} · после принятия правьте решение и приказы как обычно — вариант лишь заполняет проект.</small>}
    </div>
  );
}

/* ───────────── решение на ход ───────────── */


/** Пиктограммы полей решения: черновик по обстановке, советник (ИИ). */
const IcDraft = () => <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /><path d="M9 13h6M9 17h4" /></svg>;
const IcSpark = () => <svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" /><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z" /></svg>;

function Decision({ v, d, auto, set, planN, planBusy, who, llmOk, ai, batch, otherBusy, pet, issuer, petPick, setPetPick }: { v: TurnView; d: HumanDecision; auto: DraftField[]; set: (p: Partial<HumanDecision>) => void; planN: number; planBusy: boolean; who?: string; llmOk: boolean;
  ai: Partial<Record<DraftField, AiFieldState>>; batch: AiBatch | null; otherBusy: boolean; pet: PetitionState | null; issuer: string | null; petPick: boolean; setPetPick: (b: boolean) => void }) {
  const last = v.lastDecision;
  const filled = DRAFT_FIELDS.some((k) => d[k].trim());
  const all = () => {
    if (!filled) { tap('decision.compose.all'); return; }
    void confirmAsync('Заменить всё решение текстом советника?', { ok: 'Заменить' }).then((ok) => { if (ok) tap('decision.compose.all.replace'); });
  };
  const aiCls = (k: DraftField) => (ai[k] ? ` ai-${ai[k]}` : '');
  /** Составить поле: по обстановке или советником; написанное — заменить только после вопроса («текст будет заменён»). */
  const compose = (k: DraftField, advisor: boolean) => (e: React.MouseEvent) => {
    e.preventDefault();
    if (!d[k].trim()) { tap('decision.compose', { field: k, advisor }); return; }
    void confirmAsync(advisor ? 'Составить заново советником? Текст будет заменён.' : 'Составить заново? Текст будет заменён черновиком по обстановке.', { ok: 'Составить заново' })
      .then((ok) => { if (ok) tap('decision.compose.replace', { field: k, advisor }); });
  };
  /** Пометка поля, составленного по обстановке и ещё не правленого. */
  const Auto = ({ k }: { k: DraftField }) => (auto.includes(k) && d[k].trim() ? <small className="dauto">составлено по обстановке — проверьте</small> : null);
  const Gen = ({ k }: { k: DraftField }) => <em className="dgen">
    {ai[k] === 'wait' || ai[k] === 'typing' ? <small className="ai-writing"><IcSpark />советник пишет<i className="dots"><b>.</b><b>.</b><b>.</b></i></small> : <>
      <button className="ic-btn" data-action="decision.compose" title={d[k].trim() ? 'Составить заново по обстановке' : 'Составить по обстановке — доклады, разведка, документы на ход (без модели)'} aria-label={d[k].trim() ? 'Составить заново по обстановке' : 'Составить по обстановке'} onClick={compose(k, false)}><IcDraft /></button>
      <button className="ic-btn ai" data-action="decision.compose" disabled={!llmOk || !!batch} title={llmOk ? 'Написать советником (ИИ) — за этот штаб, текст печатается в поле' : 'Советник не на связи — языковая модель не отвечает'} aria-label="Написать советником" onClick={compose(k, true)}><IcSpark /></button>
    </>}
  </em>;
  const F = ({ k, label, hint, rows, req }: { k: Exclude<keyof HumanDecision, 'request' | 'report' | 'petition'>; label: string; hint: string; rows: number; req?: boolean }) => (
    <label className={`dfield${req && !d[k].trim() ? ' need' : ''}`} data-hl={`field-${k}`}>
      <span>{label}{req && <i> обязательно</i>}<Gen k={k} />{last?.[k] && last[k] !== d[k] && <button className="link" data-action="decision.fromLast" title={last[k]} onClick={(e) => { e.preventDefault(); tap('decision.fromLast', { field: k }); }}>взять с прошлого хода</button>}</span>
      <Auto k={k} />
      <textarea className={aiCls(k).trim()} rows={rows} value={d[k]} placeholder={hint} onChange={(e) => set({ [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="cmd-sec">
      <h3>Решение{who ? ` — ${who}` : ''} на {ddmm(v.time)} {hhmm(v.time)}</h3>
      {who && <p className="note">Решение этого штаба — для журнала и разбора; ход проводится по решению {v.terms?.topGen ?? 'Ставки'} (уровень «{v.terms?.top ?? 'Ставка'}»).</p>}
      <div className={`ai-compose${batch ? ' run' : ''}`} data-hl="ai-compose">
        <button className="ai-btn" data-action="decision.compose.all" disabled={!llmOk || !!batch || otherBusy} onClick={all}
          title={!llmOk ? 'Советник не на связи — языковая модель не отвечает' : otherBusy ? 'Советник пишет решение другого штаба' : 'Советник (языковая модель) пишет все поля решения за этот штаб — одно за другим'}>
          <span className="ai-spark"><IcSpark /></span>
          <span className="ai-btn-t"><b>Составить советником (ИИ)</b>
            <small>{batch ? `пишет ${DRAFT_ACC[batch.cur]} · ${batch.done + 1} из ${batch.total}` : 'оценка, замысел противника, решение, риски, донесение'}</small></span>
        </button>
        {batch && <StaffButton className="link" action="command.advisor.stop">остановить</StaffButton>}
        {batch && <div className="ai-prog"><i style={{ width: `${(batch.done / batch.total) * 100}%` }} /></div>}
      </div>
      <div className="plan-cta" data-hl="plan-cta"><span>Не знаете, с чего начать? Советник предложит полные варианты — решение, приказы, тыл, переправы, резервы; выберите, примите и поправьте. Сколько вариантов — выберите рядом (один готовится быстрее).</span>
        <div className="plan-cta-act">
          <select value={planN} disabled={planBusy} data-action="command.variants.count" onChange={(e) => tap('command.variants.count', { n: +e.target.value })} title="Сколько вариантов просить (запоминается)">{[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? '1 вариант' : `${n} варианта`}</option>)}</select>
          {planBusy ? <StaffButton action="command.advisor.stop"><i className="spinner" /> Стоп</StaffButton> : <StaffButton className="primary" action="command.variants" params={{ count: planN }}>Варианты от советника</StaffButton>}
        </div></div>
      <p className="note">Решение штаба на ход — те же части, что у штаба противника. Без оценки обстановки, решения и боевого донесения ход не проводится. Решение составлено при открытии хода по обстановке (без модели): оценка обстановки и донесение — заново, замысел, замысел противника и риски — с прошлого хода (не было — по обстановке). Поля с пометкой «составлено по обстановке — проверьте» прочитайте и поправьте; лист у поля — составить заново. Все прошлые решения — во вкладке «Журнал».</p>
      {F({ k: 'assessment', label: 'Оценка обстановки', hint: 'Положение своих войск и противника, соотношение сил, местность, состояние снабжения, что изменилось за сутки…', rows: 6, req: true })}
      {F({ k: 'enemyIntent', label: 'Замысел противника', hint: 'Что противник, по-видимому, намерен делать: где держит, куда отходит, где готовит контрудар…', rows: 3 })}
      {F({ k: 'intent', label: 'Решение (замысел действий)', hint: 'Цель на сутки, главный удар, кто наступает, кто обеспечивает, куда вводятся резервы…', rows: 4, req: true })}
      {F({ k: 'risks', label: 'Риски', hint: 'Что может пойти не так и как парировать…', rows: 2 })}
      <label className={`dfield${!d.report.trim() ? ' need' : ''}`} data-hl="field-report">
        <span>Боевое донесение {v.terms?.topTo ?? 'в Ставку'}<i> обязательно</i><Gen k="report" /></span>
        <Auto k="report" />
        <textarea className={aiCls('report').trim()} rows={5} value={d.report} placeholder="Положение войск к утру, итоги суток, решение на следующие сутки, просьбы…" onChange={(e) => set({ report: e.target.value })} />
      </label>
      <Petition v={v} d={d} set={set} pet={pet} issuer={issuer} picking={petPick} setPicking={setPetPick} />
    </div>
  );
}

/** Ходатайство о разграничительной линии: где действует — сосед, линия (на карте или по пунктам), обоснование, последний ответ; где нет — пояснение. */
function Petition({ v, d, set, pet, issuer, picking, setPicking }: { v: TurnView; d: HumanDecision; set: (p: Partial<HumanDecision>) => void; pet: PetitionState | null; issuer: string | null; picking: boolean; setPicking: (b: boolean) => void }) {
  const [open, setOpen] = useState(false);
  const title = `Ходатайство ${v.terms?.topTo ?? 'в Ставку'} о разграничительной линии`;
  if (!pet) return null;
  if (!pet.show) return <div className="dfield" data-hl="field-request"><span>{title}</span><p className="note">{pet.why}</p></div>;
  const p = d.petition ?? { neighbour: '', line: [], note: '' };
  const nb = pet.neighbours;
  const ans = issuer ? petitionAnswer(v, issuer) : null;
  const from: LngLat = p.line.at(-1) ?? v.own.find((u) => u.status !== 'destroyed')?.at ?? v.places[0]?.at ?? [14, 52];
  const n = p.line.length;
  return (
    <div className="dfield pet" data-hl="field-request">
      <span>{title}</span>
      <div className="pet-row">
        <label>С соседом <select value={p.neighbour} data-action="decision.petition.neighbour" onChange={(e) => tap('decision.petition.neighbour', { name: e.target.value })}>
          <option value="" disabled>— выберите —</option>{nb.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        {nb.length === 0 && <small className="muted">соседних фронтов с войсками нет</small>}
      </div>
      <div className="pet-row">
        <span className="muted">Линия: {n === 0 ? 'точек нет' : `точек — ${n}`}{n === 1 ? ' (нужна ещё)' : ''}</span>
        <button className={picking ? 'on' : ''} onClick={() => setPicking(!picking)}>{picking ? 'Готово' : 'На карте'}</button>
        <button className={open ? 'on' : ''} onClick={() => setOpen(!open)}>Пункт…</button>
        {(n > 0 || p.neighbour || p.note) && <StaffButton className="link" action="decision.petition.clear">очистить</StaffButton>}
      </div>
      {open && <PlacePicker v={v} from={from} mapOn={picking} onMap={() => setPicking(!picking)} onPick={(x) => tap('decision.petition.point', { place: x.id })} />}
      <textarea rows={2} value={p.note} placeholder="Обоснование: например, войска соседа вышли в нашу полосу у …" onChange={(e) => set({ petition: { ...p, note: e.target.value } })} />
      <small className="muted">{pet.why}</small>
      {ans && <small className={`pet-ans ${ans.accepted ? 'ok' : 'no'}`}>Ответ {v.terms?.topGen ?? 'Ставки'} {ans.time}: {ans.accepted ? ans.text : `отклонено: ${ans.text}`}</small>}
    </div>
  );
}

/* ───────────── тыл, переправы, резервы ───────────── */

function PlacePicker({ v, from, onPick, onMap, mapOn }: { v: TurnView; from: LngLat; onPick: (p: Place) => void; onMap: () => void; mapOn: boolean }) {
  const [q, setQ] = useState('');
  const P = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * Math.cos((a[1] * Math.PI) / 180), a[1] - b[1]) * 111;
  const list = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return v.places.map((p) => ({ ...p, km: P(from, p.at) })).filter((p) => !ql || p.title.toLowerCase().includes(ql)).sort((a, b) => a.km - b.km).slice(0, ql ? 30 : 12);
  }, [q, from, v.places]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="pick-list inline">
      <div className="row"><input placeholder="Поиск пункта…" value={q} onChange={(e) => setQ(e.target.value)} /><button className={mapOn ? 'on' : ''} onClick={onMap}>{mapOn ? 'Отмена' : 'На карте'}</button></div>
      <div className="pl-items">{list.map((p) => <button key={p.id} onClick={() => onPick(p)}>{p.title}<small>{Math.round(p.km)} км</small></button>)}</div>
    </div>
  );
}

function ActLine({ a }: { a: Act }) {
  return <div className="draft" data-hl={`act-${a.key}`}><b>{a.label}</b> — {a.text}<StaffButton className="x" title="Отменить распоряжение" action="command.act.drop" params={{ key: a.key }}>×</StaffButton></div>;
}

function Rear({ v, acts, pickMode, setPickMode, setPriority, scope }: {
  v: TurnView; acts: Act[]; pickMode: Pick | null; setPickMode: (p: Pick | null) => void;
  setPriority: (ids: string[]) => void; scope: StaffScope | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pa = acts.find((a) => a.action.kind === 'priority');
  const prio = pa && pa.action.kind === 'priority' ? pa.action.formations : v.priority;
  if (scope) return <PostRear v={v} acts={acts} pickMode={pickMode} setPickMode={setPickMode} setPriority={setPriority} scope={scope} prio={prio} pa={pa} />;
  const active = v.own.filter((u) => u.status === 'active');
  const toggle = (id: string) => setPriority(prio.includes(id) ? prio.filter((x) => x !== id) : prio.length >= v.priorityMax ? prio : [...prio, id]);
  return (
    <div className="cmd-sec">
      <h3>Тыл и подвоз</h3>
      <p className="note">Подвоз идёт от баз снабжения по своей территории; дальше {v.rangeHours} ч пути — не доходит. Базу можно перенести вперёд: на время переноса она не действует; на чужой территории — не работает.</p>
      <h4 className="cmd-h4">Базы снабжения</h4>
      {v.bases.map((b) => {
        const a = acts.find((x) => x.key === `base:${b.id}`);
        const pm = pickMode?.kind === 'base' && pickMode.base === b.id;
        return (
          <div key={b.id} className="brow">
            <div className="brow-h" data-action="map.center" onClick={() => tap('map.center', { at: b.at })}>
              <b>{b.name}</b>
              <span className={`st ${b.state}`}>{b.state === 'active' ? 'действует' : b.state === 'moving' ? `переносится, заработает ${ddmm(b.activeFrom!)} ${hhmm(b.activeFrom!)}` : 'не действует — чужая территория'}</span>
              {!a && <button className="link" onClick={(e) => { e.stopPropagation(); setOpen(open === b.id ? null : b.id); }}>{open === b.id ? 'отмена' : 'перенести…'}</button>}
            </div>
            {a && <ActLine a={a} />}
            {open === b.id && !a && <PlacePicker v={v} from={b.at} mapOn={pm} onMap={() => setPickMode(pm ? null : { kind: 'base', base: b.id, name: b.name, from: b.at })}
              onPick={(p) => { setOpen(null); tap('command.rear.base', { army: b.id, place: p.id }); }} />}
          </div>
        );
      })}
      <h4 className="cmd-h4">Приоритет подвоза <small>не более {v.priorityMax}; приоритетным ×1,5, остальным ×0,75</small></h4>
      {pa && <ActLine a={pa} />}
      <div className="prio" data-hl="prio">{active.map((u) => {
        const h = v.supplyHours[u.id];
        const bad = h == null || h > v.rangeHours;
        return (
          <label key={u.id} className={prio.includes(u.id) ? 'on' : ''}>
            <input type="checkbox" data-action="command.rear.priority" checked={prio.includes(u.id)} disabled={!prio.includes(u.id) && prio.length >= v.priorityMax} onChange={() => toggle(u.id)} />
            <span className="prio-n">{short(u.name)}</span>
            <span className={`prio-h${bad ? ' bad' : ''}`} title="Время подвоза от ближайшей действующей базы">{h == null ? 'подвоз не доходит' : `${h} ч${bad ? ' — дальше предела' : ''}`}</span>
            <Bar v={u.ammo / 2} label={`боеприпасы ${num(u.ammo)} бк`} /><Bar v={u.fuel / 2} label={`горючее ${num(u.fuel)} запр.`} />
          </label>
        );
      })}</div>
    </div>
  );
}

/** Тыл пункта управления: базы, которыми штаб распоряжается или которые видит; приоритет подвоза — между его подчинёнными; подвоз его войск. */
function PostRear({ v, acts, pickMode, setPickMode, setPriority, scope, prio, pa }: {
  v: TurnView; acts: Act[]; pickMode: Pick | null; setPickMode: (p: Pick | null) => void; setPriority: (ids: string[]) => void;
  scope: StaffScope; prio: string[]; pa: Act | undefined;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const bases = postBases(v, scope);
  const rows = postSupply(v, scope);
  const pool = priorityPool(v, scope);
  const mineP = prio.filter((x) => pool.includes(x));
  const lim = priorityLimit(pool.length);
  const toggle = (id: string) => {
    const next = mineP.includes(id) ? mineP.filter((x) => x !== id) : mineP.length >= lim ? mineP : [...mineP, id];
    setPriority(mergePriority(prio, pool, next));
  };
  const who = scope.level === 'stavka' ? 'фронтами' : scope.level === 'front' ? 'армиями фронта' : scope.level === 'army' ? 'корпусами армии' : 'частями корпуса';
  return (
    <div className="cmd-sec">
      <h3>Тыл и подвоз — {scope.whose}</h3>
      <p className="note">Подвоз идёт от баз снабжения по своей территории; дальше {v.rangeHours} ч пути — не доходит.{' '}
        {scope.bases === 'move' ? 'Базы, питающие ваши войска, можно перенести вперёд: на время переноса база не действует, на чужой территории — не работает.'
          : scope.bases === 'view' ? 'Базы переносят штабы фронтов и армий (уровни «Фронт», «Армия»); Ставка распределяет подвоз между фронтами.'
            : scope.priority ? 'У танкового и механизированного корпуса свой тыл: подвоз между его бригадами и дивизиями распределяет он; базы — у армии и фронта.'
              : 'Баз у стрелкового корпуса нет — тыл ведут армия и фронт, снабжение идёт от армии прямо в дивизии; здесь — подвоз ваших войск. Перенести базу или дать приоритет — на уровне «Армия».'}</p>
      {scope.bases !== 'none' && <><h4 className="cmd-h4">Базы снабжения{scope.level !== 'stavka' ? ', питающие ваши войска' : ''}</h4>
        {!bases.length && <p className="muted">Ни одна действующая база не питает войска штаба.</p>}
        {bases.map((b) => {
          const a = acts.find((x) => x.key === `base:${b.id}`);
          const pm = pickMode?.kind === 'base' && pickMode.base === b.id;
          return (
            <div key={b.id} className="brow">
              <div className="brow-h" data-action="map.center" onClick={() => tap('map.center', { at: b.at })}>
                <b>{b.name}</b>
                <span className={`st ${b.state}`}>{b.state === 'active' ? 'действует' : b.state === 'moving' ? `переносится, заработает ${ddmm(b.activeFrom!)} ${hhmm(b.activeFrom!)}` : 'не действует — чужая территория'}</span>
                {scope.bases === 'move' && !a && <button className="link" onClick={(e) => { e.stopPropagation(); setOpen(open === b.id ? null : b.id); }}>{open === b.id ? 'отмена' : 'перенести…'}</button>}
              </div>
              {a && <ActLine a={a} />}
              {open === b.id && !a && <PlacePicker v={v} from={b.at} mapOn={pm} onMap={() => setPickMode(pm ? null : { kind: 'base', base: b.id, name: b.name, from: b.at })}
                onPick={(p) => { setOpen(null); tap('command.rear.base', { army: b.id, place: p.id }); }} />}
            </div>
          );
        })}</>}
      <h4 className="cmd-h4">{scope.priority ? <>Приоритет подвоза между {who} <small>не более {lim}; приоритетным ×1,5, остальным ×0,75 — и всем их дивизиям</small></> : 'Подвоз ваших войск'}</h4>
      {scope.priority && pa && <ActLine a={pa} />}
      <div className="prio" data-hl="prio">{rows.map(({ unit: u, hours: h }) => {
        const bad = h == null || h > v.rangeHours;
        const info = <><span className="prio-n">{short(u.name)}{u.cutOff ? <em className="iss"> отрезан</em> : null}</span>
          <span className={`prio-h${bad ? ' bad' : ''}`} title="Время подвоза от ближайшей действующей базы (худшее по дивизиям)">{h == null ? 'подвоз не доходит' : `${h} ч${bad ? ' — дальше предела' : ''}`}</span>
          <Bar v={u.ammo / 2} label={`боеприпасы ${num(u.ammo)} бк`} /><Bar v={u.fuel / 2} label={`горючее ${num(u.fuel)} запр.`} /></>;
        return scope.priority
          ? <label key={u.id} className={mineP.includes(u.id) ? 'on' : ''}><input type="checkbox" data-action="command.rear.priority" checked={mineP.includes(u.id)} disabled={!mineP.includes(u.id) && mineP.length >= lim} onChange={() => toggle(u.id)} />{info}</label>
          : <div key={u.id} className="prio-row">{info}</div>;
      })}</div>
    </div>
  );
}

function Bridges({ v, acts, pickMode, setPickMode, scope }: { v: TurnView; acts: Act[]; pickMode: Pick | null; setPickMode: (p: Pick | null) => void; scope: StaffScope | null }) {
  const mine = acts.filter((a) => a.action.kind === 'bridge');
  const building = v.bridges.filter((b) => b.building);
  const can = !scope || scope.bridges === 'build';
  const shown = scope ? postBridges(v, scope) : v.bridges;
  const busy = building.length + mine.length;
  return (
    <div className="cmd-sec">
      <h3>Инженерные войска: переправы{scope ? ` — ${scope.whose}` : ''}</h3>
      <p className="note">Через большую реку без моста техника не пройдёт (пехота — медленно), подвоз — тоже. Наводка: большая река — сутки, малая — 12 ч; нужны наши войска рядом. {scope ? '' : `Понтонных парков — ${v.parks}, занято ${busy}.`}
        {scope && scope.bridges === 'build' && ' Штаб наводит переправы в своей полосе своими понтонными парками — их придаёт старший (Ставка — фронтам, фронт — армиям, армия — корпусам).'}
        {scope && scope.bridges === 'view' && ' Ставка переправ не наводит: она придаёт понтонные парки фронтам; наводят фронты, армии и корпуса своими парками.'}</p>
      {scope && <PostParks v={v} scope={scope} acts={acts} />}
      {can && (() => {
        // пункт: свои парки штаба (приданные минус приданные подчинённым); нынешняя модель — общий запас стороны
        const pk = scope ? v.parksBy?.[parksKey(v, scope.issuer)] : undefined;
        const mineBusy = scope ? (pk?.busy ?? 0) + mine.filter((a) => a.action.kind === 'bridge' && a.action.by === parksKey(v, scope.issuer)).length : busy;
        const cap = scope ? (pk?.own ?? 0) : v.parks;
        const full = mineBusy >= cap;
        return <button className={pickMode?.kind === 'bridge' ? 'on' : ''} disabled={full && pickMode?.kind !== 'bridge'} onClick={() => setPickMode(pickMode?.kind === 'bridge' ? null : { kind: 'bridge' })}>
          {pickMode?.kind === 'bridge' ? 'Щёлкните по реке на карте… (отмена)' : full ? (cap ? 'Все понтонные парки штаба заняты' : 'У штаба нет понтонных парков — их придаёт старший') : 'Навести переправу — указать место на карте'}</button>;
      })()}
      {mine.map((a) => <ActLine key={a.key} a={a} />)}
      {building.filter((b) => shown.includes(b)).length > 0 && <><h4 className="cmd-h4">Наводятся</h4>{building.filter((b) => shown.includes(b)).map((b) => <div key={b.id} className="brow-h" data-action="map.center" onClick={() => tap('map.center', { at: b.at })}><b>{b.name}</b><span className="st moving">готова {ddmm(b.openFrom!)} {hhmm(b.openFrom!)}</span></div>)}</>}
      <h4 className="cmd-h4">Действующие переправы{scope && scope.level !== 'stavka' ? ' в полосе' : ''}</h4>
      {!shown.some((b) => !b.building) && <p className="muted">Переправ рядом с вашими войсками нет.</p>}
      {shown.filter((b) => !b.building).map((b) => <div key={b.id} className="brow-h" data-action="map.center" onClick={() => tap('map.center', { at: b.at })}><b>{b.name}</b><span className="st active">действует</span></div>)}
    </div>
  );
}

/** Понтонные парки пункта: свои (приданные минус приданные подчинённым) и придание подчинённым штабам (−/+). */
function PostParks({ v, scope, acts }: { v: TurnView; scope: StaffScope; acts: Act[] }) {
  const key = parksKey(v, scope.issuer);
  const me = v.parksBy?.[key];
  if (!me) return null;
  // ожидающие придания этого хода — поверх приданного
  const want = (hq: string) => { const a = acts.find((x) => x.key === `parks:${hq}`)?.action; return a?.kind === 'parks' ? a.n : v.parksBy?.[hq]?.allot ?? 0; };
  const subs = scope.allotParks ? priorityPool(v, scope).filter((id) => v.parksBy?.[id]).map((id) => ({ id, name: v.command?.hqs[id]?.name ?? id })) : [];
  const given = subs.reduce((m, x) => m + want(x.id), 0);
  const free = me.allot - given - me.busy;
  return (
    <div className="parks" data-hl="parks">
      <p className="parks-sum">Понтонных парков у штаба: <b>{me.allot}</b>{subs.length ? <>, придано подчинённым — <b>{given}</b></> : null}, наводят сейчас — <b>{me.busy}</b>{scope.level !== 'stavka' && <>, свободно для своих наводок — <b>{Math.max(0, me.allot - given - me.busy)}</b></>}.</p>
      {subs.length > 0 && <table className="parks-t"><tbody>{subs.map((x) => {
        const n = want(x.id);
        return <tr key={x.id}><td>{short(x.name)}</td>
          <td className="parks-n"><StaffButton className="ic-btn" action="command.parks" params={{ hq: x.id, n: n - 1 }} disabled={n <= 0} title="Забрать один парк">−</StaffButton>
            <b>{n}</b>
            <StaffButton className="ic-btn" action="command.parks" params={{ hq: x.id, n: n + 1 }} disabled={free <= 0} title="Придать ещё один парк">+</StaffButton></td></tr>;
      })}</tbody></table>}
    </div>
  );
}

/** Резервы: ждущие ввода (по армиям — вводятся целиком или по соединению), прибывающие по плану и резервы на театре. */
function Reserves({ v, acts, pickMode, setPickMode, onOrder, scope }: {
  v: TurnView; acts: Act[]; pickMode: Pick | null; setPickMode: (p: Pick | null) => void; onOrder: (id: string) => void; scope?: StaffScope | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const byId = new Map(v.own.map((u) => [u.id, u]));
  const groups = (v.reserveGroups ?? []).map((g) => ({ ...g, units: g.members.map((id) => byId.get(id)).filter((u): u is UnitReport => !!u) })).filter((g) => g.units.length);
  const waiting = groups.filter((g) => g.status === 'reserve'), coming = groups.filter((g) => g.status === 'arriving');
  const active = v.own.filter((u) => u.status === 'active');
  const center = active.reduce<[number, number]>((c, u, _i, arr) => [c[0] + u.at[0] / arr.length, c[1] + u.at[1] / arr.length], [0, 0]);
  // резервы на театре: соединения в резерве или на марше без боя за ход (без штабов-сводок)
  const hqs = new Set(v.own.filter((u) => v.own.some((x) => x.parent === u.id)).map((u) => u.id));
  // пункт ниже Ставки — только его войска
  const pool = scope && scope.level !== 'stavka' ? divisionsUnder(v, scope.issuer) : active;
  const onTheatre = pool.filter((u) => !hqs.has(u.id) && (u.posture === 'в резерве' || (u.posture === 'на марше' && !u.combats.length)));
  const sum = (us: UnitReport[]) => ({ p: us.reduce((s, u) => s + u.personnel, 0), t: us.reduce((s, u) => s + u.tanks, 0), g: us.reduce((s, u) => s + u.guns, 0) });
  const mid = (us: UnitReport[]): LngLat => [us.reduce((s, u) => s + u.at[0], 0) / us.length, us.reduce((s, u) => s + u.at[1], 0) / us.length];
  const span = (ts: string[]) => { const l = [...ts].sort(); const a = `${ddmm(l[0])} ${hhmm(l[0])}`, b = `${ddmm(l[l.length - 1])} ${hhmm(l[l.length - 1])}`; return a === b ? a : `${a} – ${b}`; };
  const stats = (us: UnitReport[]) => { const x = sum(us); return `${us.length > 1 ? `${us.length} соед. · ` : ''}${x.p.toLocaleString('ru')} чел., танков и САУ ${x.t}, орудий ${x.g}`; };
  const all = sum(waiting.flatMap((g) => g.units));
  return (
    <div className="cmd-sec">
      <h3>{!scope || scope.level === 'stavka' ? `Резервы ${v.terms?.topGen ?? 'Ставки'}` : `Резервы — ${scope.whose}`}</h3>
      <p className="note">Резерв вводится по вашему решению: укажите район сосредоточения на своей территории — для всего объединения сразу или для отдельного соединения. Войска будут там не раньше, чем готовы к вводу, и не раньше чем через сутки после распоряжения. Задачу можно поставить сразу (вкладка «Войска») — приказ дождётся.</p>
      {waiting.length > 0 ? <p className="res-sum">Ждут ввода: <b>{waiting.length}</b> {waiting.length === 1 ? 'объединение' : 'объединения'}, {all.p.toLocaleString('ru')} чел., танков и САУ {all.t}, орудий {all.g}.</p>
        : <p className="muted">Резервов, ждущих вашего решения, нет{coming.length ? ' — прибывающие войска вводятся по плану (ниже)' : ''}.</p>}
      {waiting.map((g) => {
        const free = g.units.filter((u) => !acts.some((a) => a.key === `commit:${u.id}`));
        const done = g.units.filter((u) => acts.some((a) => a.key === `commit:${u.id}`));
        const one = g.units.length === 1 && g.units[0].id === g.id;
        const pm = pickMode?.kind === 'commit' && pickMode.formation === g.id;
        const pickOf = (): Pick => (one ? { kind: 'commit', formation: g.id, name: g.name } : { kind: 'commit', formation: g.id, name: g.name, members: free.map((u) => ({ id: u.id, name: u.name })) });
        return (
          <div key={g.id} className="res-card" data-hl={`res-${g.id}`}>
            <div className="brow-h"><b title={g.name}>{short(g.name)}</b><span className="st idle">готова к вводу с {span(g.units.map((u) => u.reserveFrom!))}</span></div>
            <div className="muted small">{g.front ? `${g.front} · ` : ''}{stats(g.units)}</div>
            <div className="muted small">Сейчас: {g.units[0].place} <StaffButton className="link" action="map.center" params={{ at: mid(g.units) }}>на карте</StaffButton></div>
            {one ? done.map((u) => { const a = acts.find((x) => x.key === `commit:${u.id}`)!; return <ActLine key={a.key} a={a} />; })
              : done.length > 0 && (() => {
                const a = acts.find((x) => x.key === `commit:${done[0].id}`)!;
                const where = a.action.kind === 'commit' && a.action.atName ? ` в район у ${a.action.atName}` : '';
                return <div className="draft"><b>Ввод{where}</b> — {done.length === g.units.length ? 'всё объединение' : `${done.length} из ${g.units.length} соед.`}; {a.text}
                  <button className="x" title="Отменить ввод" data-action="command.reserve.cancel" onClick={() => tap('command.reserve.cancel', { army: g.id })}>×</button></div>;
              })()}
            {free.length > 0 && <div className="row"><button onClick={() => setOpen(open === g.id ? null : g.id)}>{open === g.id ? 'Отмена' : one || free.length === 1 ? 'Ввести…' : `Ввести ${done.length ? 'остальные' : 'всё объединение'} (${free.length})…`}</button>
</div>}
            {open === g.id && free.length > 0 && <PlacePicker v={v} from={center} mapOn={pm} onMap={() => setPickMode(pm ? null : pickOf())}
              onPick={(p) => { setOpen(null); tap('command.reserve.commit', { army: g.id, place: p.id }); }} />}
            {!one && <details className="res-units"><summary>Соединения ({g.units.length})</summary>
              {g.units.map((u) => {
                const a = acts.find((x) => x.key === `commit:${u.id}`);
                const upm = pickMode?.kind === 'commit' && pickMode.formation === u.id;
                return (
                  <div key={u.id} className="brow">
                    <div className="brow-h"><b title={u.name}>{short(u.name)}</b><span className="st">{u.personnel.toLocaleString('ru')} чел., танков {u.tanks}, орудий {u.guns}</span>
                      {a ? <button className="link" data-action="command.reserve.cancel" onClick={() => tap('command.reserve.cancel', { army: u.id })}>не вводить</button> : <button className="link" onClick={() => setOpen(open === u.id ? null : u.id)}>{open === u.id ? 'отмена' : 'ввести…'}</button>}</div>
                    {open === u.id && !a && <PlacePicker v={v} from={center} mapOn={upm} onMap={() => setPickMode(upm ? null : { kind: 'commit', formation: u.id, name: u.name })}
                      onPick={(p) => { setOpen(null); tap('command.reserve.commit', { army: u.id, place: p.id }); }} />}
                  </div>
                );
              })}
            </details>}
          </div>
        );
      })}
      {coming.length > 0 && <><h4 className="cmd-h4">Вводятся</h4>
        <p className="muted small">Введённые резервы и войска, прибывающие по графику сценария: распоряжения не нужны, задачу можно поставить заранее.</p>
        {coming.map((g) => (
          <div key={`a:${g.id}`} className="res-card">
            <div className="brow-h"><b title={g.name}>{short(g.name)}</b><span className="st moving">сосредоточится {span(g.units.map((u) => u.arrives!))}</span></div>
            <div className="muted small">{g.front ? `${g.front} · ` : ''}{stats(g.units)}</div>
            <div className="muted small">Район: {g.units[0].place} <StaffButton className="link" action="map.center" params={{ at: mid(g.units) }}>на карте</StaffButton></div>
          </div>
        ))}</>}
      <h4 className="cmd-h4">{scope && scope.level !== 'stavka' ? 'Резервы в ваших войсках' : 'Резервы на театре'}</h4>
      <p className="muted small">{scope && scope.level !== 'stavka' ? 'Ваши соединения в резерве или на марше без боя — их можно бросить на угрожаемое направление документом подчинённому штабу.' : 'Свои соединения в резерве или на марше без боя — их можно бросить на угрожаемое направление приказом.'}</p>
      {onTheatre.length ? onTheatre.slice(0, more ? undefined : 8).map((u) => (
        <div key={u.id} className="brow">
          <div className="brow-h"><b title={u.name}>{short(u.name)}</b><span className="st">{u.posture}, {u.place}</span><button className="link" onClick={() => onOrder(u.id)}>приказ…</button></div>
          <div className="muted small">{u.personnel.toLocaleString('ru')} чел., танков и САУ {u.tanks}, орудий {u.guns}; укомплектованность {manningText(u)}</div>
        </div>
      )) : <p className="muted">Все соединения на театре заняты в бою или в обороне.</p>}
      {onTheatre.length > 8 && <button className="link" onClick={() => setMore(!more)}>{more ? 'свернуть' : `ещё ${onTheatre.length - 8}`}</button>}
    </div>
  );
}

/** Полосы: линии Ставки словами, линии армий — распоряжением игрока (две армии одного фронта, линия точками на карте). */
function Bounds({ v, acts, picking, setPicking, pts, setPts, sel, scope }: {
  v: TurnView; acts: Act[]; picking: boolean; setPicking: (b: boolean) => void;
  pts: LngLat[]; setPts: (f: (l: LngLat[]) => LngLat[]) => void; sel: Omit<BoundsDraft, 'pts'>; scope?: StaffScope | null;
}) {
  if (scope && scope.bounds !== 'armies') return <PostBounds v={v} scope={scope} />;
  const armies = v.armies ?? [];
  // пункт фронта — только его армии
  const fronts = v.groups.filter((g) => armies.filter((u) => u.group === g.id).length >= 2 && (!scope || g.id === scope.issuer));
  // фронт, армия и соседняя армия — в CommandView: их выбирает и голос («предложи линию между …»)
  const front = sel.front || (fronts[0]?.id ?? '');
  const { a, b } = sel;
  const setB = (x: string) => tap('command.bounds.select', { front, b: x });
  const inFront = armies.filter((u) => u.group === front);
  const mine = acts.filter((x) => x.action.kind === 'boundary');
  const ready = a && b && a !== b && pts.length >= 2;
  const km = (p: LngLat, q: LngLat) => Math.hypot((p[0] - q[0]) * Math.cos((p[1] * Math.PI) / 180), p[1] - q[1]) * 111;
  const near = (p: LngLat) => v.places.reduce<Place | null>((m, x) => (!m || km(p, x.at) < km(p, m.at) ? x : m), null)?.title ?? '';
  const A0 = inFront.find((u) => u.id === a);
  // соседи выбранной армии — ближние первыми
  const others = inFront.filter((u) => u.id !== a).sort((x, y) => (A0 ? km(A0.at, x.at) - km(A0.at, y.at) : 0));
  // действующие линии между армиями этого объединения: кто справа и слева у каждой армии
  const armyLines = (v.boundaries ?? []).filter((l) => inFront.some((u) => u.id === l.right) && inFront.some((u) => u.id === l.left));
  // «Предложить линию» и «В распоряжение» — действия реестра (command.bounds.propose / put), как и голосом
  return (
    <div className="cmd-sec">
      <h3>Полосы и разграничительные линии{scope ? ` — ${scope.whose}` : ''}</h3>
      {v.sectors.length > 0 && <ul className="sect-list">{v.sectors.map((t) => <li key={t}>{t}</li>)}</ul>}
      <p className="note">Линии между {v.terms?.groupsGen ?? 'фронтами'} устанавливает {v.terms?.top ?? 'Ставка'} — исторические {v.terms?.directive === 'приказ' ? 'приказы' : 'директивы'} вступают, когда обстановка совпала с той, что их вызвала, иначе по поводу или по вашему ходатайству (вкладка «Решение») решает модель высшего командования. Линии между армиями одного объединения — ваше распоряжение: вступает в силу с задержкой доведения армиям; армии идут к целям своей полосой, выход в полосу соседа отмечается в разборе.</p>
      {mine.map((x) => <ActLine key={x.key} a={x} />)}
      {fronts.length ? <div className="bnd-form" data-hl="bounds-form">
        <label>{v.terms?.group === 'группа армий' ? 'Группа армий' : 'Фронт'} <select value={front} data-action="command.bounds.select" onChange={(e) => tap('command.bounds.select', { front: e.target.value, a: '', b: '' })}>{fronts.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
        <h4 className="cmd-h4">Армии {v.terms?.group === 'группа армий' ? 'группы армий' : 'фронта'} — с севера на юг</h4>
        <table className="bnd-armies"><tbody>{[...inFront].sort((x, y) => y.at[1] - x.at[1]).map((u) => {
          const ls = armyLines.filter((l) => l.right === u.id || l.left === u.id).map((l) => (l.right === u.id ? `слева — ${short(l.leftName)}` : `справа — ${short(l.rightName)}`));
          return <tr key={u.id} className={u.id === a || u.id === b ? 'on' : ''} title="Показать на карте" data-action="map.center" onClick={() => tap('map.center', { at: u.at, zoom: false })}>
            <td><b>{short(u.name)}</b>{ls.length > 0 && <div className="muted small">линии: {ls.join('; ')}</div>}</td><td className="muted">{near(u.at)}</td></tr>;
        })}</tbody></table>
        {armyLines.length === 0 && <p className="muted small">Действующих линий между армиями нет — армии идут к целям напрямую, полосы задают только линии между {v.terms?.groupsGen ?? 'фронтами'}.</p>}
        <label>Армия <select value={a} onChange={(e) => { const id = e.target.value; const A = inFront.find((u) => u.id === id); const tank = (n: string) => /танков/.test(n);
          const nb = A && inFront.filter((u) => u.id !== id && (tank(A.name) || !tank(u.name))).sort((x, y) => km(A.at, x.at) - km(A.at, y.at))[0]; tap('command.bounds.select', { front, a: id, b: nb?.id ?? '' }); setPts(() => []); }}><option value="">—</option>{inFront.map((u) => <option key={u.id} value={u.id}>{short(u.name)}</option>)}</select></label>
        <label>Соседняя армия <select value={b} onChange={(e) => setB(e.target.value)}><option value="">—</option>{others.map((u) => <option key={u.id} value={u.id}>{short(u.name)}{A0 ? ` — ${Math.round(km(A0.at, u.at))} км` : ''}</option>)}</select></label>
        <div className="row">
          <StaffButton action="command.bounds.propose" params={{ army: a, neighbor: b }} disabled={!a || !b || a === b} title="Линия через середину между войсками двух армий, поперёк, от тыла к противнику — её можно поправить, указав точки заново">Предложить линию</StaffButton>
          <button className={picking ? 'on' : ''} onClick={() => setPicking(!picking)}>{picking ? `Готово (${pts.length} точ.)` : pts.length ? `Продолжить линию (${pts.length} точ.)` : 'Указать линию на карте'}</button>
          {pts.length > 0 && <button className="link" onClick={() => setPts(() => [])}>сбросить точки</button>}
          <StaffButton className="primary" action="command.bounds.put" disabled={!ready}>В распоряжение</StaffButton>
        </div>
        <p className="muted small">Линия — от тыла к переднему краю, хотя бы две точки: «Предложить линию» проводит её между войсками двух армий, «Указать линию на карте» — своими точками. Кто справа по ходу линии, стенд определит по положению армий.</p>
      </div> : <p className="muted">Ни в одном фронте нет двух действующих армий — линии армий не нужны.</p>}
    </div>
  );
}

/** Полосы пункта, который сам линий армий не проводит: Ставка — линии фронтов (директивой), армия и ниже — своя полоса. */
function PostBounds({ v, scope }: { v: TurnView; scope: StaffScope }) {
  const hqs = v.command?.hqs ?? {};
  // своя армия: пункт армии — он сам, корпус — его армия
  const army = scope.level === 'army' ? scope.issuer : hqs[scope.issuer]?.parent ?? null;
  const lines = (v.boundaries ?? []).filter((l) => army && (l.right === army || l.left === army));
  return (
    <div className="cmd-sec">
      <h3>Полосы и разграничительные линии — {scope.whose}</h3>
      {scope.bounds === 'fronts' ? <>
        {v.sectors.length > 0 && <ul className="sect-list">{v.sectors.map((t) => <li key={t}>{t}</li>)}</ul>}
        <p className="note">Линии между {v.terms?.groupsGen ?? 'фронтами'} {v.terms?.top ?? 'Ставка'} задаёт директивой: правая и левая разграничительные линии фронта — в «Пункте управления» (директива фронту), на карте. Линии между армиями проводят штабы фронтов (уровень «Фронт»).</p>
      </> : <>
        <p className="note">{scope.level === 'army'
          ? 'Полосы корпусов армия задаёт боевым приказом: «Пункт управления» → приказ корпусу → полоса корпуса (разграничительные линии на карте). Линии между армиями проводит штаб фронта.'
          : 'Полоса корпуса задана приказом армии; полосы дивизий корпус задаёт своим приказом: «Пункт управления» → приказ дивизии → полоса.'}</p>
        <h4 className="cmd-h4">Линии {scope.level === 'army' ? 'вашей армии' : 'армии корпуса'} с соседями</h4>
        {lines.length ? <ul className="sect-list">{lines.map((l, i) => <li key={i}>{l.right === army ? `слева — ${short(l.leftName)}` : `справа — ${short(l.rightName)}`}</li>)}</ul>
          : <p className="muted">Линий между армиями нет — полосу задают линии между {v.terms?.groupsGen ?? 'фронтами'}.</p>}
      </>}
    </div>
  );
}

/** Журнал боевых действий штаба пункта ниже Ставки: по ходам — обстановка его войск, его решение, отданные и полученные документы. */
function PostJournal({ v, issuer, record }: { v: TurnView; issuer: string; record: GameRecord | null }) {
  const name = v.command?.hqs[issuer]?.name ?? issuer;
  const decisions = (record?.turns ?? []).map((t) => ({ time: t.time, d: (t.human as (HumanDecision & { posts?: Record<string, HumanDecision> }) | undefined)?.posts?.[issuer] ?? null }));
  const days = postJournal(v, issuer, decisions);
  const doc = (x: { time: string; hqName?: string; text: string; rule: string | null }, k: number, from?: boolean) =>
    <li key={k}><b>{x.time}</b> {from && x.hqName ? `${x.hqName}: ` : ''}{placeText(x.text, v.places)}{x.rule && <small className="muted"> ({x.rule})</small>}</li>;
  return (
    <div className="cmd-sec">
      <h3>Журнал боевых действий — {name}</h3>
      <p className="note">Журнал вёл штаб каждой ступени: обстановка его войск за ход, его решение, отданные и полученные документы. Журнал всей стороны — на уровне «{v.terms?.top ?? 'Ставка'}».</p>
      {!days.length && <p className="muted">Записи появятся после первого хода.</p>}
      {[...days].reverse().map((d) => (
        <div key={d.time} className="jday">
          <h4>{dayLong(d.time)}, {hhmm(d.time)}</h4>
          <div className="jsub">Решение</div>
          {d.decision ? <><p>{d.decision.intent || '—'}</p>
            <details><summary className="muted">оценка обстановки и донесение</summary>
              <p><b>Оценка.</b> {d.decision.assessment || '—'}</p>{d.decision.enemyIntent && <p><b>Противник.</b> {d.decision.enemyIntent}</p>}{d.decision.risks && <p><b>Риски.</b> {d.decision.risks}</p>}<p><b>Донесение.</b> {d.decision.report || '—'}</p></details></>
            : <p className="muted">решения штаба за этот ход нет — его войска действовали по прежним приказам</p>}
          <div className="jsub">Отданы документы</div>
          {d.issued.length ? <ul>{d.issued.map((x, k) => doc(x, k))}</ul> : <p className="muted">нет</p>}
          <div className="jsub">Получены документы</div>
          {d.received.length ? <ul>{d.received.map((x, k) => doc(x, k, true))}</ul> : <p className="muted">нет</p>}
          <div className="jsub">Обстановка</div>
          {d.events.length ? <ul>{d.events.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="muted">существенных событий у войск штаба нет</p>}
          {(d.enemy || v.enemyLog) && <><div className="jsub">Противник (по разведке)</div>
            {d.enemy?.length ? <ul className="jenemy">{d.enemy.map((o, i) => <li key={i}>{placeText(o, v.places)}</li>)}</ul> : <p className="muted">действий противника разведка не обнаружила</p>}</>}
        </div>
      ))}
    </div>
  );
}

/* ───────────── журнал и посредник ───────────── */

function Journal({ v }: { v: TurnView }) {
  return (
    <div className="cmd-sec">
      <div className="row"><h3>Журнал боевых действий</h3><StaffButton action="command.journal.save">Сохранить .md</StaffButton></div>
      {!v.journal.length && <p className="muted">Записи появятся после первого хода.</p>}
      {[...v.journal].reverse().map((d) => (
        <div key={d.time} className="jday">
          <h4>{dayLong(d.time)}, {hhmm(d.time)}</h4>
          {d.decision && <><div className="jsub">Решение</div><p>{d.decision.intent}</p><details><summary className="muted">оценка обстановки и донесение</summary><p><b>Оценка.</b> {d.decision.assessment}</p>{d.decision.enemyIntent && <p><b>Противник.</b> {d.decision.enemyIntent}</p>}{d.decision.risks && <p><b>Риски.</b> {d.decision.risks}</p>}<p><b>Донесение в Ставку.</b> {d.decision.report}</p></details></>}
          <div className="jsub">Отданы приказы</div>
          {d.orders.length ? <ul>{d.orders.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="muted">новых приказов нет</p>}
          {d.actions.length > 0 && <><div className="jsub">Тыл, переправы, резервы</div><ul>{d.actions.map((o, i) => <li key={i} className={o.includes('НЕ ИСПОЛНЕНО') ? 'rej' : ''}>{o}</li>)}</ul></>}
          <div className="jsub">Донесения</div>
          {d.events.length ? <ul>{d.events.map((o, i) => <li key={i}>{o}</li>)}</ul> : <p className="muted">существенных событий нет</p>}
          {(d.enemy || v.enemyLog) && <><div className="jsub">Противник (по разведке)</div>
            {d.enemy?.length ? <ul className="jenemy">{d.enemy.map((o, i) => <li key={i}>{placeText(o, v.places)}</li>)}</ul> : <p className="muted">действий противника разведка не обнаружила</p>}</>}
        </div>
      ))}
    </div>
  );
}

/** Действия противника по ходам (новее сверху): ход — по началу хода в журнале. */
function EnemyLogList({ v }: { v: TurnView }) {
  const log = v.enemyLog ?? [];
  const starts = v.journal.map((d) => d.time.slice(0, 16));
  const by = new Map<string, typeof log>();
  for (const e of log) {
    const k = [...starts].reverse().find((t) => t < e.time.slice(0, 16)) ?? starts[0] ?? e.time;
    by.set(k, [...(by.get(k) ?? []), e]);
  }
  if (!log.length) return <p className="muted">Действий противника пока нет — записи появятся после хода.</p>;
  return <>{[...by.entries()].reverse().map(([k, l]) => (
    <div key={k} className="jday">
      <h4>Ход с {ddmm(k)} {hhmm(k)}</h4>
      <ul className="jenemy">{l.map((e, i) => <li key={i} data-kind={e.kind}>{placeText(e.text, v.places)}</li>)}</ul>
    </div>
  ))}</>;
}

function Umpire({ view, record, ai, turns, current, stream, phase, reveal, setReveal, enemy, choices, setEnemy, llm, part }: {
  record: GameRecord | null; ai: AiStatus; turns: AiTurn[]; current?: AiTurn; stream: string; phase: string; reveal: boolean; setReveal: (b: boolean) => void;
  enemy: EnemyMode; choices: EnemyMode[]; setEnemy: (e: EnemyMode) => void; llm: Llm; part: 'enemy' | 'umpire'; view: TurnView | null;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // решение штаба противника за ход — раскрыть (голосом прочитать последнее — «как действовал противник»)
  useAction({ id: 'command.enemy.turn', model: false, section: 'replay', title: 'Раскрыть решение противника', describe: 'Вкладка «Посредник»: раскрывает решение штаба противника за ход (time).',
    params: { type: 'object', properties: { time: { type: 'string' } }, required: ['time'] }, available: () => true,
    run: async (p: { time: string }) => { setOpen((o) => (o === p?.time ? null : p?.time ?? null)); } });
  const list = current && !turns.some((t) => t.time === current.time) ? [current, ...turns] : turns;
  const nUmp = (record?.turns ?? []).filter((t) => t.umpireNote).length;
  // посредник на модели — только на нынешней модели (его поправки к боям); на агентной бои считает ядро
  const applies = umpireApplies(view?.engine);
  const agentEnemy = enemy === 'agents' || enemy === 'intent';
  return (
    <div className="cmd-sec">
      <p className="note warnbox">Посредник видит решения штаба противника и может снять туман войны. Если играете честно — заглядывайте сюда после игры.</p>
      <label className="switch"><input type="checkbox" data-action="command.reveal" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /><span /> Показать на карте всех (снять туман войны)</label>
      <div className="umpire-cfg">
        <label>Противник
          {enemy === 'agents' || enemy === 'intent' ? <b> — {enemy === 'intent' ? 'штабы по истории как замыслу' : 'штабы-агенты по уставам'} (выбрано при передаче командования)</b>
            : choices.length < 2 ? <b> — {ENEMY_TITLE[choices[0] ?? enemy].toLowerCase()} (в этом режиме игры другого нет)</b>
            : <select value={enemy} data-action="command.enemyMode" data-hl="enemy-mode" onChange={(e) => setEnemy(e.target.value as EnemyMode)}>
            {choices.includes('llm') && <option value="llm">штаб на модели (LM Studio)</option>}
            {choices.includes('passive') && <option value="passive">без штаба — держится прежних приказов</option>}
          </select>}
        </label>
      </div>
      {enemy === 'llm' && <label className="umpire-model">Модель штаба противника и размышление <ModelPicker llm={llm} who="enemy" purpose="штаба противника" />
        {llm.check.state === 'fail' && <span className="err small">LM Studio: {llm.check.error}</span>}</label>}
      {applies === true
        ? <label className="switch"><input type="checkbox" checked={!!llm.settings.umpire} onChange={(e) => llm.set({ umpire: e.target.checked })} /><span /> Посредник на модели: нюансы к боям по базе знаний</label>
        : <p className="muted umpire-off">{applies}</p>}
      <label className="switch"><input type="checkbox" checked={llm.settings.stavka !== false} onChange={(e) => llm.set({ stavka: e.target.checked })} /><span /> Модель высшего командования (Ставка, ОКХ): разграничительные линии фронтов и групп армий, когда обстановка разошлась с историей или есть ходатайство</label>
      {applies === true && <p className="muted umpire-about">Перед каждым ходом модель-посредник смотрит на ожидаемые бои и по справкам базы знаний (доктрина, нормативы, техника) добавляет то, чего правила не учитывают: видимость, взаимодействие родов войск, заграждения, качество обороны. Поправки — множители 0,8–1,25 с обоснованием; видны в журнале боя и записываются в игру.</p>}
      <div className="seg umpire-seg">
        <ActButton className={part === 'enemy' ? 'on' : ''} action="command.umpire.part" params={{ part: 'enemy' }} data-hl="ump-enemy">Как действовал противник · {agentEnemy && view?.enemyLog ? view.enemyLog.length : list.length}</ActButton>
        <ActButton className={part === 'umpire' ? 'on' : ''} action="command.umpire.part" params={{ part: 'umpire' }} data-hl="ump-umpire">Поправки посредника · {nUmp}</ActButton>
      </div>
      {part === 'umpire' && (applies !== true ? <p className="muted">Поправок нет: бои считает ядро агентной модели.</p>
        : nUmp ? <UmpireNotes record={record} /> : <p className="muted">Посредник ещё не работал: включите его выше — поправки появятся со следующего хода.</p>)}
      {part === 'enemy' && agentEnemy && view?.enemyLog && <>
      <p className="muted">Все действия противника по ходам, без тумана войны: директивы верховного командования, документы штабов, решения командующих, смены «по истории / замысел сдвинут / решает сам», приказы, полученные дивизиями, запросы на отход и ответы, отходы дивизий. В журнал боевых действий попадает только наблюдаемое: действия и отходы дивизий, обнаруженных разведкой.</p>
      <EnemyLogList v={view} />
      </>}
      {part === 'enemy' && !(agentEnemy && view?.enemyLog) && <>
      <p className="muted">Решения штаба противника по ходам: оценка, замысел, приказы и распоряжения (откройте ход). Где его войска сейчас — «Показать на карте всех» выше.</p>
      {ai.state === 'thinking' && <div className="ai-live"><div className="jsub">Штаб противника думает над решением на {ddmm(ai.time)} {hhmm(ai.time)}…</div>
        {phase && <div className="ai-phase"><i className="spinner" /> {phase}</div>}<pre>{stream.trimEnd().slice(-1500) || '…'}</pre>
        {stream.length - stream.trimEnd().length > 50 && <small className="muted">модель, похоже, зациклилась; запрос повторится без схемы</small>}</div>}
      {ai.state === 'error' && <div className="cmd-blocked"><b>Нет решения на {ddmm(ai.time)}</b><span>{ai.error}</span><div><StaffButton action="command.ai.retry">Повторить запрос</StaffButton></div></div>}
      {!list.length && <p className="muted">Решений пока нет.</p>}
      {list.map((t) => {
        const k = t.time, d = t.decision;
        return (
          <div key={k} className={`aiturn${open === k ? ' open' : ''}`}>
            <ActButton className="aiturn-h" action="command.enemy.turn" params={{ time: k }}>
              <b>{ddmm(t.time)} {hhmm(t.time)}</b>
              <span>{t.ok ? d!.intent : `ошибка: ${t.error}`}</span>
              <small>{t.model}{t.timings ? ` · ${Math.round(t.timings.totalMs / 1000)} с` : ''}{t.repaired ? ' · переписан в JSON' : ''}{t.fix ? ` · приказы исправлены по подсказке: ${t.fix.fixed} из ${t.fix.failed}` : ''}</small>
            </ActButton>
            {open === k && t.ok && d && <div className="aiturn-b">
              {t.basis && t.basis.length > 0 && <KbBasis basis={t.basis} refs={t.refs ?? []} />}
              <div className="jsub">Приказы</div>
              {t.fix && <div className="muted small">исправление по подсказке: {t.fix.fixed} из {t.fix.failed} {t.fix.failed === 1 ? 'приказа' : 'приказов'} исправлено{t.fix.error ? ` (${t.fix.error})` : ''}</div>}
              <ul>{t.applied.map((a, i) => <li key={i} className={a.order ? '' : 'rej'}><b>{short(a.formation ?? a.given.formation)}</b>: {TASK_RU[a.given.task]} — {a.target ?? a.given.toArea ?? a.given.area}{a.given.details ? <span className="muted">. {a.given.details}</span> : null}{a.issue && <div className="iss">{a.issue}</div>}</li>)}</ul>
              {t.staff && t.staff.length > 0 && <><div className="jsub">Тыл, переправы, резервы</div>
                <ul>{t.staff.map((x, i) => { const gv = x.given as { kind: string; subject: string | null; area: string | null; formations: string[] };
                  return <li key={i} className={x.action ? '' : 'rej'}><b>{({ base: 'база', priority: 'приоритет подвоза', bridge: 'переправа', demolish: 'подрыв моста', commit: 'ввод резерва' } as Record<string, string>)[gv.kind] ?? gv.kind}</b>{gv.subject ? `: ${gv.subject}` : ''}{gv.area ? ` — ${gv.area}` : ''}{gv.formations?.length ? ` — ${gv.formations.join(', ')}` : ''}<div className={x.action ? 'muted' : 'iss'}>{x.text}</div></li>; })}</ul></>}
              <div className="jsub">Оценка обстановки</div><p>{d.assessment}</p>
              <div className="jsub">Замысел противника (как его понял штаб)</div><p>{d.enemyIntent}</p>
              {d.requests.length > 0 && <><div className="jsub">Доклады наверх</div><ul>{d.requests.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
              {d.risks.length > 0 && <><div className="jsub">Риски</div><ul>{d.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></>}
            </div>}
          </div>
        );
      })}
      </>}
    </div>
  );
}

/** «по базе: R1, R3» у решения штаба: у номера — заголовок записи, щелчок — запись в «Знаниях». */
function KbBasis({ basis, refs }: { basis: string[]; refs: { id: string; title: string }[] }) {
  return (
    <div className="muted small">по базе: {basis.map((b, i) => {
      const r = refs[Number(b.slice(1)) - 1];
      return <span key={b}>{i ? ', ' : ''}{r ? <button className="link" title={r.title} onClick={() => openKbEntry(r.id)}>{b}</button> : b}</span>;
    })}</div>
  );
}

/** Поправки посредника по ходам (из записи игры). */
function UmpireNotes({ record }: { record: GameRecord | null }) {
  const list = (record?.turns ?? []).filter((t) => t.umpireNote).reverse();
  if (!list.length) return null;
  return (
    <>
      {list.slice(0, 12).map((t) => {
        const n = t.umpireNote as { ok: boolean; error?: string; assessment?: string; issues: { text: string }[]; engagements: number; refs: { id: string; title: string }[]; seconds?: number; names?: Record<string, string>; proposed?: number };
        const refs = new Map(n.refs.map((r) => [r.id, r.title]));
        return (
          <div key={t.time} className="aiturn umpire-turn">
            <div className="aiturn-h"><b>{ddmm(t.time)} {hhmm(t.time)}</b><span>{n.ok ? n.assessment || `боёв ${n.engagements}` : `ошибка: ${n.error}`}</span>
              <small>боёв {n.engagements} · поправок {t.umpire?.length ?? 0}{n.proposed != null && n.proposed !== (t.umpire?.length ?? 0) ? ` (предложено ${n.proposed})` : ''}{n.seconds ? ` · ${n.seconds} с` : ''}</small></div>
            {((t.umpire?.length ?? 0) > 0 || n.issues.length > 0) && <ul className="aiturn-b">{(t.umpire ?? []).map((m, i) => <li key={i}><b>{UMPIRE_FACTOR_RU[m.factor]} ×{String(m.mult).replace('.', ',')}</b> — {m.reason}<div className="muted">{m.formations.map((id) => short(n.names?.[id] ?? id)).join(', ')} · опора: {m.basis.map((b) => refs.get(b) ?? b).join('; ')}</div></li>)}
              {n.issues.map((x, i) => <li key={`i${i}`} className="rej">отброшено: {x.text}</li>)}</ul>}
          </div>
        );
      })}
    </>
  );
}

/* ───────────── передача командования ───────────── */

/** Начало хода, на который приходится момент t (командование принимается с начала хода). */
export function turnStart(t: string, start: string, end: string, turnHours: number): string {
  const H = turnHours * 3600_000;
  let k = Math.max(0, Math.floor((toMs(t) - toMs(start)) / H));
  while (k > 0 && toMs(start) + k * H >= toMs(end)) k--;
  return new Date(toMs(start) + k * H).toISOString().slice(0, 16);
}

/** Открыть «Основу модели» операции: Моделирование → Операции, выбрана эта операция. */
export function openModelBasis(op: string) {
  try { localStorage.setItem('def_ops.modeling.tab', 'ops'); localStorage.setItem('def_ops.modeling.op', op); } catch { /* */ }
  window.dispatchEvent(new CustomEvent('def_ops.modeling.open', { detail: { tab: 'ops', op } }));
  location.hash = '#modeling';
}

export { savedGameMode };

export function TakeoverDialog({ at, turnHours, start, scenarioName, scenario, kbSummary, llm, hasSaved = false, agents = false, onStart, onCancel }: {
  at: string; end: string; turnHours: number; start: string; scenarioName: string; scenario: string; kbSummary: TakeoverSummary | null; llm: Llm;
  /** Есть незавершённая игра: новая её заменит (голосом — после «да»). */
  hasSaved?: boolean;
  /** Игра на агентной модели: выбор режима командования. */
  agents?: boolean;
  onStart: (enemy: EnemyMode, mode: GameMode) => void; onCancel: () => void;
}) {
  const [mode, setMode] = useState<GameMode>(savedGameMode);
  const [enemy, setEnemy] = useState<EnemyMode>(() => defaultEnemy(agents, llm.check.state === 'fail', savedGameMode()));
  // противник — только допустимый при режиме своей стороны: при смене режима недопустимый выбор сменяется умолчанием
  const enemyOk = enemyOptions(agents, mode);
  const modeRef = useRef(mode); modeRef.current = mode;
  useEffect(() => { setEnemy((e) => fitEnemy(e, agents, mode, llm.check.state === 'fail')); }, [mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useAction({
    id: 'command.gameMode', section: 'replay', title: 'Режим командования', describe: 'Режим игры на агентной модели: история как замысел (intent), как сейчас (legacy), штабы-агенты (agents), гибрид (hybrid), командующие (commanders).',
    params: { type: 'object', properties: { mode: { enum: ['intent', 'legacy', 'agents', 'hybrid', 'commanders'] } }, required: ['mode'] }, say: ['режим история как замысел', 'режим штабы-агенты', 'режим гибрид', 'режим командующие'],
    available: () => (agents ? true : 'режим — только в игре на агентной модели'), highlight: (p: { mode: GameMode }) => hl(`mode-${p?.mode}`),
    run: async (p: { mode: GameMode }) => {
      if (!MODE_TITLE[p?.mode]) return 'Скажите: «история как замысел», «как сейчас», «штабы-агенты», «гибрид» или «командующие».';
      setMode(p.mode);
      saveGameMode(p.mode);
      // противник, недопустимый при новом режиме, сменится умолчанием (эффект выше) — ответ называет того, кто в силе
      const before = st.current.enemy;
      return modeReply(p.mode, before, fitEnemy(before, agents, p.mode, llm.check.state === 'fail'));
    },
  });
  const turn = Math.round((toMs(at) - toMs(start)) / (turnHours * 3600_000)) + 1;
  // голосом: окно зачитывается коротко и ждёт ответа — «принимаю», «без штаба» / «штаб на модели», «отмена»
  const st = useRef({ enemy, hasSaved, down: llm.check.state === 'fail' });
  st.current = { enemy, hasSaved, down: llm.check.state === 'fail' };
  useEffect(() => openModal({
    question: 'Принять командование? Скажите «принимаю» или «отмена».',
    // сначала вопрос и как отвечать, потом подробности: отвечают, едва услышав варианты
    get read() {
      const s = st.current;
      return speakable(takeoverRead({ day: dayMonth(at), turn, enemy: s.enemy, down: s.down, saved: s.hasSaved, options: enemyOptions(agents, modeRef.current) }), { full: true });
    },
    remind: TAKEOVER_REMIND,
    how: '«принимаю» или «отмена»',
    isAnswer: takeoverIsAnswer,
    parse: (rest) => takeoverParse(rest, { saved: st.current.hasSaved, enemy: st.current.enemy }),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useAction({
    id: 'command.enemyMode', section: 'replay', title: 'Противник', describe: 'Кто командует противником: штаб на модели или без штаба.',
    params: { type: 'object', properties: { mode: { enum: ['llm', 'passive', 'agents', 'intent'] } }, required: ['mode'] }, say: ['без штаба', 'противник история как замысел'], available: () => true,
    highlight: (p: { mode: EnemyMode }) => hl(`enemy-${p?.mode}`),
    run: async (p: { mode: EnemyMode }) => {
      const ok = enemyOptions(agents, modeRef.current);
      if (!ok.includes(p?.mode)) return `При этом режиме противник — ${ok.map((e) => `«${ENEMY_TITLE[e].toLowerCase()}»`).join(' или ')}. Скажите одно из них.`;
      setEnemy(p.mode);
      if (p.mode === 'intent') return 'Противник — история как замысел: его штабы идут по историческому замыслу, пока обстановка позволяет. Скажите «принимаю».';
      if (p.mode === 'agents') return 'Противник — штабы-агенты по уставам. Скажите «принимаю».';
      return p.mode === 'llm' ? `Противник — штаб на модели.${llm.check.state === 'fail' ? ' Но модель сейчас не на связи.' : ''} Скажите «принимаю».` : 'Противник — без штаба. Скажите «принимаю».';
    },
  });
  // Esc и щелчок по фону — то же, что «Отмена» (действие окна)
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') void act('replay.takeCommand.cancel'); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, []);
  return (
    <div className="modal-bg" onClick={() => { void act('replay.takeCommand.cancel'); }}>
      <div className="modal take" data-modal data-tour="take-dialog" data-hl="take" onClick={(e) => e.stopPropagation()}>
        <h3>Принять командование</h3>
        <p className="take-when"><b>{dayLong(at)}, {hhmm(at)}</b> · ход {turn} · ход — {turnHours === 24 ? 'сутки' : `${turnHours} ч`}</p>
        <ul className="take-list">
          <li>Советской стороной с этого момента командуете вы. Конечной даты нет: игра идёт до победы (Знамя Победы над рейхстагом) или поражения — войска потеряли боеспособность или предельный срок вышел. {historyBackText(!!agents, mode)}</li>
          <li>{enemy === 'intent' ? <>Немецкой стороной с того же момента командуют штабы по истории как замыслу: идут по историческому замыслу, пока обстановка позволяет, а уйдя от него, решают сами по уставам.</>
            : enemy === 'agents' ? <>Немецкой стороной с того же момента командуют штабы-агенты по уставам: верхняя инстанция подаёт исторические решения в их часы, ниже штабы решают сами.</>
            : enemy === 'passive' ? <>Немецкая сторона с того же момента держится прежних приказов — без штаба (для пробы без модели).</>
            : <>Немецкой стороной с того же момента командует штаб на языковой модели. На каждом ходу он получает свою обстановку — то, что знал бы немецкий штаб, — и отдаёт приказы.</>} Обе стороны решают одновременно.</li>
          <li>{agents && mode !== 'legacy' ? mode === 'intent' ? 'Обе стороны идут по историческому замыслу, пока обстановка позволяет. Возьмите штаб (вкладка «Штабы»): он с подчинёнными уходит с истории и дальше решается вами; остальные штабы идут по замыслу, а уйдя от него, решают сами по уставу.' : mode === 'commanders' ? 'Вы — командующий: возьмите штаб (вкладка «Штабы») — его решения становятся вашими. Остальные командующие, свои и немецкие, решают сами: у каждого свой характер, мотивы и устав. Уже действующие исторические директивы встанут в очередь первого хода.' : mode === 'hybrid' ? 'Вы — верхняя инстанция. Исторические директивы встанут в очередь первого хода (вкладка «Штабы»): пока они действуют, войска идут по приказам сценария; своя директива штабу снимает его со сценария — дальше решают штабы-агенты.' : 'Вы — верхняя инстанция: директивы фронтам, ниже решают штабы-агенты. Уже действующие исторические директивы встанут в очередь первого хода (вкладка «Штабы»).' : 'Исторические приказы после этого момента отменяются. Приказы, отданные раньше и ещё не дошедшие до войск, остаются в силе.'}</li>
          <li>Противник виден только в пределах разведки (туман войны). Игра сохраняется автоматически после каждого хода.</li>
          <li className="take-kb">Состояние соединений на этот момент: {kbSummary ? <>{takeoverText(kbSummary)}. </> : <span className="muted">сверка с базой знаний… </span>}
            <button className="link" onClick={() => { onCancel(); openModelBasis(scenario); }} title="Моделирование → Операции: факты базы, из которых собраны входы модели">Основа модели</button></li>
        </ul>
        <div className="take-enemy">
          {enemyOk.includes('intent') && <label className={enemy === 'intent' ? 'on' : ''} data-hl="enemy-intent"><input type="radio" data-action="command.enemyMode" checked={enemy === 'intent'} onChange={() => void act('command.enemyMode', { mode: 'intent' })} />
            <span><b>История как замысел</b> — противник идёт по историческому замыслу, пока обстановка позволяет<small>без модели; в ходе игры не меняется</small></span></label>}
          {enemyOk.includes('llm') && <label className={enemy === 'llm' ? 'on' : ''} data-hl="enemy-llm"><input type="radio" data-action="command.enemyMode" checked={enemy === 'llm'} onChange={() => void act('command.enemyMode', { mode: 'llm' })} />
            <span><b>Штаб на модели</b> — LM Studio на этом компьютере<small className={`llm-st ${llm.check.state}`}>{llm.check.state === 'ok' ? `✓ на связи: ${llm.settings.model || llm.check.models[0]}` : llm.check.state === 'fail' ? `✗ ${llm.check.error} — запустите сервер в LM Studio (настройки — раздел «ИИ»)` : 'проверка связи…'}</small></span></label>}
          {enemyOk.includes('passive') && <label className={enemy === 'passive' ? 'on' : ''} data-hl="enemy-passive"><input type="radio" data-action="command.enemyMode" checked={enemy === 'passive'} onChange={() => void act('command.enemyMode', { mode: 'passive' })} />
            <span><b>Без штаба</b> — противник держится прежних приказов<small>для пробы без модели; переключить можно в ходе игры (вкладка «Посредник»)</small></span></label>}
          {enemyOk.includes('agents') && <label className={enemy === 'agents' ? 'on' : ''} data-hl="enemy-agents"><input type="radio" data-action="command.enemyMode" checked={enemy === 'agents'} onChange={() => void act('command.enemyMode', { mode: 'agents' })} />
            <span><b>Штабы-агенты</b> — противник в той же логике ступеней: его верхняя инстанция подаёт исторические решения, ниже решают штабы по уставам<small>без модели; в ходе игры не меняется</small></span></label>}
        </div>
        {agents && <div className="take-enemy take-mode">
          <div className="take-mode-h">Командование своей стороной</div>
          {(['intent', 'hybrid', 'commanders', 'agents', 'legacy'] as GameMode[]).map((k) => <label key={k} className={mode === k ? 'on' : ''} data-hl={`mode-${k}`}>
            <input type="radio" data-action="command.gameMode" checked={mode === k} onChange={() => void act('command.gameMode', { mode: k })} />
            <span><b>{MODE_TITLE[k].title}</b> — {MODE_TITLE[k].hint}</span></label>)}
        </div>}
        <div className="take-f">
          {llm.check.state === 'fail' && <button className="link" onClick={llm.recheck}>Проверить связь ещё раз</button>}
          <span style={{ flex: 1 }} />
          <ActButton action="replay.takeCommand.cancel">Отмена</ActButton>
          <button className="primary" data-action={hasSaved ? 'replay.startOver' : 'replay.start'} onClick={() => onStart(enemy, mode)} title={scenarioName}>Принять командование с {ddmm(at)}</button>
        </div>
      </div>
    </div>
  );
}
