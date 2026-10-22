/**
 * «Командование»: игра с выбранного момента переигровки до победы (Знамя Победы) или поражения.
 * Советской стороной командует человек — с полной штабной работой: доклады
 * подчинённых, разведсводка, боевое распоряжение (приказы с задержкой доведения),
 * журнал боевых действий. Немецкой стороной — штаб на модели (LM Studio): решает
 * одновременно с человеком по своей обстановке. Посредник видит решения модели и
 * может снять туман войны. Игра сохраняется в браузере после каждого хода.
 */
import { confirmAsync } from './dialogs';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { Resizer, usePanelWidth } from './panel-resize';
import { createFeature, migrateDocument, type ArrowFeature, type LngLat, type MapDocument } from '@def-ops/core';
import { sideOf, TASK_RU, UMPIRE_FACTOR_RU, type ActionCheck, type GameRecord, type Order, type StaffAction, type Task, type UnitReport } from '@def-ops/sim';
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
import { divisionsUnder, postDocs, postIntel, postReports, postReserves } from './post-views';
import { postContext, recipients, resolveFrom, suggestionToDir, toDirective } from './command-post';
import { formTitle, initialCmds, markFor, placeText, queueOp, MODE_TITLE, overHead, type CommandOp } from './command-forms';
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
import { act, ActButton, openModal, register, speak, useAction, voiceRecent } from './voice/registry';
import { useSpeakAnswers } from './voice/advisor-voice';
import { hl, setFlashMapView } from './voice/highlight';
import { setTourMap } from './voice/tour';
import { createTourMap } from './voice/tour-map';
import { zoneOverlays, zoneUrl } from './zones-overlay';
import { blockedArrived, releaseTurn, turnActions, type Missing, type ReviewCtl, type TurnDeps } from './voice/actions/turn';
import { releaseScreen, screenActions, type ScreenDeps } from './voice/actions/screen';
import { announceTurn, resetUmpire, type UmpireModel } from './voice/umpire';
import { bindModelHold, setModelBusy } from './voice/model-queue';
import { askText, RETRY_DELAYS_MS } from './voice/llm';
import { commandActions, releaseCommand, TAKEOVER_REMIND, takeoverIsAnswer, takeoverParse, takeoverRead, type CommandDeps } from './voice/actions/command';
import {
  adviceReady, decisionMissing, NEEDS_TARGET, planReady, press, projectHas, releaseStaff, staffActions, TASKS,
  type BoundsDraft, type OrderDraft, type PlanState, type StaffAct, type StaffDeps,
} from './voice/actions/staff';
import { dayMonth } from './voice/report';
import { speakable } from './voice/speech';
import { showAt } from './engine/free-center';

export const SAVE_KEY = 'def_ops.game';

/** Куда кнопки штабной работы пишут причину, если действие сейчас недоступно (CommandView подключает уведомление). */
let noticeSink: ((text: string) => void) | null = null;
/** Кнопка → действие реестра; недоступно (идёт расчёт хода, игра окончена) — причина в уведомлении, а не молча. */
const tap = (id: string, params?: unknown) => { void press(id, params, (r) => noticeSink?.(r)); };
/** Кнопка действия штабной работы (как ActButton, но с причиной, если сейчас нельзя). */
function StaffButton({ action, params, children, ...rest }: { action: string; params?: unknown; children?: ReactNode } & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'>) {
  return <button {...rest} data-action={action} onClick={() => tap(action, params)}>{children}</button>;
}
export interface SavedGame { record: GameRecord; enemy: EnemyMode; title: string; turn: string }
export function loadSaved(): SavedGame | null {
  try { const s = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null') as SavedGame | null; return s?.record?.version === 1 ? s : null; } catch { return null; }
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
type Tab = 'reports' | 'intel' | 'decision' | 'orders' | 'journal' | 'umpire' | 'staffs';
type Sub = 'units' | 'rear' | 'bridges' | 'reserves' | 'bounds';
/** Распоряжение штаба в проекте: ключ (одно на базу, на резерв; приоритет — одно), действие и что сказала проверка. */
type Act = StaffAct;
type Pick = { kind: 'order' } | { kind: 'line' } | { kind: 'bridge' } | { kind: 'base'; base: string; name: string; from: LngLat } | { kind: 'commit'; formation: string; name: string; members?: { id: string; name: string }[] };
interface AdvMsg { id: number; cat: string; catId: string; q: string; answer: string; wait?: string; result?: AdviceView }
const EMPTY: HumanDecision = { assessment: '', enemyIntent: '', intent: '', report: '', risks: '' };

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

export function CommandView({ bm, llm, start, saved, enemy: enemy0, onExit, onOpenInEditor }: {
  bm: Basemaps; llm: Llm; start: GameStart | null; saved: SavedGame | null; enemy: EnemyMode;
  onExit: (opts: { discard: boolean }) => void; onOpenInEditor: (d: MapDocument) => void;
}) {
  const [view, setView] = useState<TurnView | null>(null);
  const [progress, setProgress] = useState<string | null>('запуск…');
  const [error, setError] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus>({ state: 'off' });
  const [stream, setStream] = useState('');
  const [aiPhase, setAiPhase] = useState('');
  const [blocked, setBlocked] = useState<string | null>(null);
  const [record, setRecord] = useState<GameRecord | null>(saved?.record ?? null);
  const [enemy, setEnemy] = useState<EnemyMode>(saved?.enemy ?? enemy0);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [tab, setTab] = useState<Tab>('reports');
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
  const [decision, setDecision] = useState<HumanDecision>(EMPTY);
  /** Решения штабов ступеней ниже Ставки (пункт управления): по штабу. */
  const [postDecisions, setPostDecisions] = useState<Record<string, HumanDecision>>({});
  // разбор операции: окно открывается после игры (или из меню); пока пишется, остаётся смонтированным
  const [review, setReview] = useState<'closed' | 'open' | 'hidden'>('closed');
  const reviewListener = useRef<((m: Extract<GameResponse, { kind: 'review-stream' | 'review-wait' | 'review-think' | 'review-done' }>) => void) | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
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
  useEffect(() => (eng ? setTourMap(createTourMap({
    engine: () => engine.current, setTime, now: () => liveView.current?.time ?? null, level: () => levelRef.current, setLevel,
    frame: (cb) => requestAnimationFrame(cb), cancel: (id) => cancelAnimationFrame(id), clock: () => performance.now(),
  })) : undefined), [eng]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const post = usePost(view, level, levelTo, cmds, setCmds, !!progress, staffsOn(view), () => { setTab('orders'); setSub('units'); });
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
      if (m.kind === 'progress') setProgress(m.text);
      else if (m.kind === 'error') { setProgress(null); setError(m.message); }
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
        const last = m.view.lastDecision;
        // новый ход — новая оценка и новое донесение; замысел, замысел противника и риски — от прошлого решения, для правки
        setDecision((d) => (liveView.current?.time === m.view.time ? d : { ...EMPTY, enemyIntent: last?.enemyIntent ?? '', intent: last?.intent ?? '', risks: last?.risks ?? '' }));
      } else if (m.kind === 'ai') setAi(m.status);
      else if (m.kind === 'ai-stream') { setStream((s) => (m.reset ? '' : (s + m.text).slice(-4000))); }
      else if (m.kind === 'ai-phase') setAiPhase(m.text);
      else if (m.kind === 'llm-busy') setModelBusy('game', m.who); // голос знает, чем занята модель, и ждёт её
      else if (m.kind === 'blocked') { setProgress(null); setBlocked(m.error); blockedArrived(m.error); }
      else if (m.kind === 'check') { checks.current.get(m.id)?.(m.result); checks.current.delete(m.id); }
      else if (m.kind === 'advice-stream') setAdv((l) => l.map((x) => (x.id === m.id ? { ...x, answer: x.answer + m.text, wait: undefined } : x)));
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
        setAdv((l) => l.map((x) => (x.id === m.id ? { ...x, answer: m.result.answer, result: m.result } : x)));
        // спрашивали голосом — ответ коротко вслух
        adviceReady(m.id, m.result);
      }
      else if (m.kind === 'agents-call') {
        // ход агентной модели считает ядро приложения: поток вызывает команду через окно; к ходу — доктрина из базы
        // окна на время игры для штабов на модели (базы нет — без поля, ядро берёт зашитый текст)
        void Promise.all([import('@tauri-apps/api/core'), m.cmd === 'game_turn' ? import('./sim/kb-doctrine').then((d) => d.agentDoctrineText(m.moment)) : undefined])
          .then(([{ invoke }, doctrineText]) => invoke(m.cmd, doctrineText ? { ...m.args, doctrineText } : m.args))
          .then((result) => w.postMessage({ kind: 'agents-reply', id: m.id, ok: true, result } satisfies GameRequest))
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
        try { localStorage.setItem(SAVE_KEY, JSON.stringify({ record: m.record, enemy: enemyRef.current, title: titleRef.current, turn: m.record.turns.length ? addH(m.record.turns[m.record.turns.length - 1].time, 0) : m.record.takeover } satisfies SavedGame)); } catch { /* */ }
      }
    };
    w.onerror = (e) => { setProgress(null); setError(e.message || 'ошибка игры'); };
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
        if (postRef.current?.issuers.some((x) => x.id === id) && postRef.current.issuer !== id) { tap('command.post', { name: id }); return; }
        if (v.own.some((u) => u.id === id)) { showUnit(id); return; }
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
    const r = await check(action, action.kind === 'bridge' ? liveActs.current.filter((a) => a.action.kind === 'bridge').length : 0);
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
  const showUnit = (id: string) => {
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
    d.features = [...view.doc.features, ...plan];
    return withFocus(d, focus);
  }, [view, drafts, vis, acts, focus, linePts, post.dirs, post.level]); // eslint-disable-line react-hooks/exhaustive-deps
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
  const draftList = Object.values(drafts);
  /** Ход — на расчёт (проверки готовности — в действии command.turn). */
  const sendTurn = () => {
    if (!view) return;
    // командование по ступеням: приказы — документами пункта управления (проекты старого вида не уходят)
    const orders: Order[] = (staffsOn(view) ? [] : draftList).map((d) => ({ id: `human@${view.time}:${d.formation}`, formation: d.formation, task: d.task, target: d.target, issuedAt: view.time, source: 'human', note: d.note || undefined, ...(d.form && staffsOn(view) ? { form: d.form } : {}) }));
    setProgress('отправка приказов…');
    send({ kind: 'turn', orders, actions: acts.map((a) => a.action), decision, ...(Object.keys(postDecisions).length ? { posts: postDecisions } : {}), ...(cmds.length ? { command: staffsOn(view) ? resolveFrom(view, cmds) : cmds } : {}) });
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
    if (!projectHas({ drafts, acts, decision }, view?.lastDecision ?? null)) { tap('command.variant.pick', { n: idx + 1 }); return; }
    if (await confirmAsync(`Заменить проект вариантом «${v.title}»? Текущие решение, приказы и распоряжения будут заменены (их можно будет поправить).`, { ok: 'Заменить' })) tap('command.variant.replace', { n: idx + 1 });
  };
  /** Принять вариант idx в проект без вопросов: целиком (решение, приказы, распоряжения) или только решение; итог словами. */
  const applyPlan = async (idx: number, only: boolean): Promise<string> => {
    const v = planLive.current?.variants[idx];
    if (!v) return 'Такого варианта нет.';
    // пункт ниже Ставки: решение — его штаба
    const putDecision = (x: HumanDecision) => { if (lowPost()) setPostDecisions((m) => ({ ...m, [post.issuer!]: x })); else setDecision(x); };
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
  const askAdvisor = (cat: string, topic: string, q: string): number => {
    if (!view) return 0;
    const id = ++checkId.current;
    const thread = adv.filter((x) => x.result?.ok).slice(-3).map((x) => ({ q: x.q, a: x.result!.answer }));
    setAdv((l) => [...l, { id, cat: topic, catId: cat, q, answer: '' }]);
    setAdvOpen(true); setAdvMin(false);
    const draft = draftText();
    void kb.roleRef([`${topic} ${q}`], advisorScope(view, cat === 'history')).catch(() => ({ refs: [], text: '' })).then((r) => send({ kind: 'advise', id, category: cat, topic, question: q, thread, draft, reference: r.text, post: postCtx() }));
    return id;
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
    const lines = [`# Журнал боевых действий: ${view.scenarioName}`, '', `Командование принято ${ddmm(view.takeover)} ${hhmm(view.takeover)}. Сторона: ${view.human.name}. Противник: ${view.ai.name} — ${enemy === 'llm' ? 'штаб на модели' : 'без штаба (прежние приказы)'}.`, ''];
    for (const d of view.journal) {
      lines.push(`## ${dayLong(d.time)}, ${hhmm(d.time)}`, '');
      if (d.decision) lines.push('**Оценка обстановки.** ' + d.decision.assessment, '', '**Замысел противника.** ' + (d.decision.enemyIntent || '—'), '', '**Решение.** ' + d.decision.intent, '', '**Риски.** ' + (d.decision.risks || '—'), '', '**Боевое донесение в Ставку.** ' + d.decision.report, '');
      lines.push('**Отданы приказы:**', '', ...(d.orders.length ? d.orders.map((o) => `- ${o}`) : ['- новых приказов нет']), '');
      if (d.actions.length) lines.push('**Распоряжения по тылу, инженерным войскам, резервам:**', '', ...d.actions.map((a) => `- ${a}`), '');
      lines.push('**Донесения за ход:**', '', ...(d.events.length ? d.events.map((x) => `- ${x}`) : ['- существенных событий нет']), '');
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
    view, engine: eng, setTab, showUnit, showEnemy: (id) => setIntelSel(id), enemy, setEnemy,
    reveal, setReveal: (on) => { setReveal(on); send({ kind: 'reveal', on }); }, exit: (discard) => onExit({ discard }),
  };
  useEffect(() => { const get = () => voice.current; const offs = commandActions(get).map(register); return () => { offs.forEach((o) => o()); releaseCommand(get); }; }, []);
  // штабная работа на ход: советник, решение, приказы, распоряжения — те же действия у кнопок
  const staff = useRef<StaffDeps>(null!);
  const lastAdvice = [...adv].reverse().find((x) => x.result?.ok);
  staff.current = {
    view, busy: view ? progress : null, setTab, setSub, goTo: (at) => goTo(at), select: setSel,
    plan, planN, askPlan, stopAdvisor: () => { send({ kind: 'advise-stop' }); send({ kind: 'plan-stop' }); },
    openVariant: (i) => { setPlanOpen(i); setAdvOpen(true); setAdvMin(false); }, applyPlan,
    advisorText: advQ, setAdvisorText: setAdvQ,
    advisorBusy: adv.some((m) => !m.result), askAdvisor: (q) => askAdvisor('situation', 'свободный вопрос', q),
    suggestions: lastAdvice?.result?.suggestions.filter((x) => x.ok) ?? [], takeSuggestion,
    decision, setDecision: (p) => setDecision((d) => ({ ...d, ...p })),
    drafts, setDraft: (id, d) => setDrafts((all) => { const n = { ...all }; if (d) n[id] = d; else delete n[id]; return n; }),
    acts, addAct: addActCheck, dropAct,
    commit: (g, at, title) => pickAction(g.members ? { kind: 'commit', formation: g.id, name: g.name, members: g.members } : { kind: 'commit', formation: g.id, name: g.name }, at, title),
    bounds: { ...bnd, pts: linePts }, setBounds: ({ pts, ...b }) => { setBnd(b); setLinePts(pts); if (pickMode?.kind === 'line') setPickMode(null); },
  };
  useEffect(() => { const get = () => staff.current; const offs = staffActions(get).map(register); return () => { offs.forEach((o) => o()); releaseStaff(get); }; }, []);
  // ход, штаб противника, посредник, разбор, файлы — те же действия у кнопок
  const turnDeps = useRef<TurnDeps>(null!);
  turnDeps.current = {
    view, prev: turnStart.current, busy: view ? progress : null, blocked, enemy, ai, aiTurns, record, drafts, acts, decision, plan, planN,
    sendTurn, showMissing, notice: setNotice, setTab, setUmpirePart: setUmpPart,
    retryAi: () => { setBlocked(null); setProgress('повторный запрос…'); send({ kind: 'retry-ai' }); },
    skipAi: () => { setBlocked(null); setProgress('расчёт хода…'); send({ kind: 'skip-ai' }); },
    // окно разбора монтируется позже отрисовки — его управление читается в момент вызова
    review: { open: review === 'open', get ctl() { return reviewCtl.current; }, show: (on) => setReview(on ? 'open' : 'hidden') },
    journal: () => ({ name: `${view?.scenario}-журнал.md`, text: journalMd() }),
    gameRecord: () => (record ? { name: `${record.scenario}-игра.json`, text: JSON.stringify(record, null, 1) } : null),
  };
  useEffect(() => { const get = () => turnDeps.current; const offs = turnActions(get).map(register); return () => { offs.forEach((o) => o()); releaseTurn(get); }; }, []);
  // экранные действия: выбор объединения, правка приказа, подвкладки, окно советника, «на карте», события
  const screen = useRef<ScreenDeps>(null!);
  screen.current = {
    view, busy: view ? progress : null, setTab, setSub: (x) => { setSub(x); setPickMode(null); }, closeCard: closeIntel, select: setSel, sel, goTo: (at, z) => goTo(at, z !== false),
    drafts, setDraft: staff.current.setDraft,
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
        <nav className="cmd-tabs" data-tour="cmd-tabs">
          {([['reports', 'Доклады'], ['intel', 'Разведка'], ['decision', 'Решение'], ['orders', `Приказы${draftList.length + acts.length ? ` · ${draftList.length + acts.length}` : ''}`], ...(staffsOn(view) ? [['staffs', `Штабы${cmds.length ? ` · ${cmds.length}` : ''}`]] : []), ['journal', 'Журнал'], ['umpire', 'Посредник']] as [Tab, string][]).map(([k, t]) => (
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
              ? <Decision v={view} d={decision} set={(p) => setDecision((d) => ({ ...d, ...p }))} planN={planN} planBusy={!!plan && !plan.done} />
              : <Decision v={view} who={view.command!.hqs[post.issuer].name} d={postDecisions[post.issuer] ?? EMPTY} set={(p) => setPostDecisions((m) => ({ ...m, [post.issuer!]: { ...(m[post.issuer!] ?? EMPTY), ...p } }))} planN={planN} planBusy={!!plan && !plan.done} />)}
            {tab === 'orders' && <>
              <div className="seg subtabs">
                {([['units', staffsOn(view) ? 'Пункт управления' : 'Войска', staffsOn(view) ? cmds.filter((c) => c.op === 'directive').length : draftList.length], ['rear', 'Тыл', acts.filter((a) => a.action.kind === 'base' || a.action.kind === 'priority').length], ['bridges', 'Переправы', acts.filter((a) => a.action.kind === 'bridge').length], ['reserves', 'Резервы', acts.filter((a) => a.action.kind === 'commit').length], ['bounds', 'Полосы', acts.filter((a) => a.action.kind === 'boundary').length]] as [Sub, string, number][])
.map(([k, t, n]) => (
                  <ActButton key={k} className={sub === k ? 'on' : ''} action="command.orders.sub" params={{ sub: k }} data-hl={`sub-${k}`}>{t}{n ? ` · ${n}` : ''}</ActButton>))}
              </div>
              {sub === 'units' && (staffsOn(view) ? <CommandPost v={view} post={post} cmds={cmds} /> : <Orders v={fv!} drafts={drafts} sel={sel} pick={pick} setPick={setPick} blank={blankDraft} />)}
              {sub === 'rear' && <Rear v={view} acts={acts} pickMode={pickMode} setPickMode={setPickMode}
                setPriority={(ids) => tap('command.rear.priority', { armies: ids })} />}
              {sub === 'bridges' && <Bridges v={view} acts={acts} pickMode={pickMode} setPickMode={setPickMode} />}
              {sub === 'bounds' && <Bounds v={view} acts={acts} picking={pickMode?.kind === 'line'} setPicking={(b) => setPickMode(b ? { kind: 'line' } : null)} pts={linePts} setPts={setLinePts}
                sel={bnd} />}
              {sub === 'reserves' && <Reserves v={staffsOn(view) && post.issuer ? { ...view, reserveGroups: postReserves(view, post.issuer) } : view} acts={acts} pickMode={pickMode} setPickMode={setPickMode}
                onOrder={(id) => tap('command.order.open', { name: id })} />}
            </>}
            {tab === 'staffs' && staffsOn(view) && <Staffs v={view} cmds={cmds} />}
            {tab === 'journal' && staffsOn(view) && post.issuer && <PostDocs v={view} issuer={post.issuer} />}
            {tab === 'journal' && <Journal v={view} />}
            {tab === 'umpire' && <Umpire record={record} ai={ai} turns={aiTurns} current={current} stream={stream} phase={aiPhase} reveal={reveal} setReveal={(on) => tap('command.reveal', { on })}
              enemy={enemy} setEnemy={(mode) => tap('command.enemyMode', { mode })} llm={llm} part={umpPart} />}
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
            : pickMode.kind === 'bridge' ? 'Щёлкните по реке — место переправы' : pickMode.kind === 'base' ? `Щёлкните по карте — новое место базы «${pickMode.name}»` : `Щёлкните по карте — район сосредоточения: ${short(pickMode.name)}`}
            <button onClick={() => setPickMode(null)}>Отмена</button></div>}
          {notice && <div className="cmd-notice" onClick={() => setNotice(null)}>{notice}</div>}
          {intelE && eng && <AgentMark engine={eng} at={intelE.at} />}
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
        <span className="ucard-bars"><Bar v={u.strength} label={`укомплектованность ${pct(u.strength)}`} /><Bar v={u.ammo / 2} label={`боеприпасы ${num(u.ammo)} бк`} /><Bar v={u.fuel / 2} label={`горючее ${num(u.fuel)} запр.`} /></span>
        <span className="ucard-p">{u.status === 'active' ? `${u.posture}, ${u.place}` : u.status === 'reserve' ? `резерв ${topGen}, готова к вводу с ${ddmm(u.reserveFrom!)} — ввести: «Приказы» → «Резервы»` : u.status === 'arriving' ? `вводится в сражение, сосредоточится ${ddmm(u.arrives!)} ${hhmm(u.arrives!)}` : 'уничтожена'}</span>
        {chips.length > 0 && <span className="ucard-chips">{chips.map(([c, t]) => <i key={t} className={c}>{t}</i>)}</span>}
      </button>
      {open && <div className="ucard-b">
        <dl>
          <dt>Задача</dt><dd>{u.task ? `${u.task} — ${u.target}` : 'нет'}{u.orderSource && <small> · {u.orderSource === 'script' ? 'по историческому плану' : u.orderSource === 'human' ? 'ваш приказ' : u.orderSource}</small>}</dd>
          {u.pending.length > 0 && <><dt>В пути</dt><dd>{u.pending.map((p, i) => <div key={i}>{p.task} — {p.target} <small>(отдан {ddmm(p.issuedAt)} {hhmm(p.issuedAt)})</small></div>)}</dd></>}
          <dt>Состав</dt><dd>{pct(u.strength)} — {u.personnel.toLocaleString('ru')} чел., танков и САУ {u.tanks}, орудий {u.guns}</dd>
          <dt>Запасы</dt><dd>боеприпасы {num(u.ammo)} бк, горючее {num(u.fuel)} запр.{u.cutOff ? ' · подвоз прерван' : ''}</dd>
          <dt>Усталость</dt><dd>{pct(u.fatigue)}</dd>
          <dt>За ход</dt><dd>{u.movedKm >= 0.5 ? `переместилась на ${Math.round(u.movedKm)} км` : 'на месте'}{u.combats.map((c, i) => <div key={i}>{c.role === 'attack' ? 'наступала на' : 'отражала'} {c.against.map(short).join(', ')}: {c.outcome}{c.advanceKm ? ` на ${num(c.advanceKm)} км` : ''}, соотношение {num(c.ratio)}:1, потери {c.lossPct} %</div>)}</dd>
        </dl>
        {u.status !== 'destroyed' && <button className="link" onClick={onOrder}>{draft ? 'Изменить приказ →' : 'Отдать приказ →'}</button>}
      </div>}
    </div>
  );
}

/** Доклады подчинённых штаба пункта управления: сводка по его дивизиям, донесения о них за ход, доклады подчинённых. */
function PostReports({ v, issuer, drafts, sel, onUnit, onOrder }: { v: TurnView; issuer: string; drafts: Record<string, Draft>; sel: string | null; onUnit: (id: string) => void; onOrder: (id: string) => void }) {
  const h = v.command!.hqs[issuer];
  const top = h.echelon === 'high_command';
  const divs = top ? v.own.filter((u) => u.echelon === 'division' && u.status === 'active') : divisionsUnder(v, issuer);
  const names = new Set(divs.map((u) => u.name));
  const events = top ? v.events : v.events.filter((e) => [...names].some((n) => e.includes(n)) || e.includes(h.name));
  const subs = postReports(v, issuer);
  const P = divs.reduce((s, u) => s + u.personnel, 0) || 1;
  const strength = divs.reduce((s, u) => s + u.strength * u.personnel, 0) / P;
  return (
    <div className="cmd-sec">
      <h3>{top ? 'Оперативная сводка' : `Донесения — ${h.name}`} к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <div className="kpis small">
        <div><b>{divs.length}</b><span>дивизий в строю</span></div>
        <div><b>{pct(strength)}</b><span>средняя укомплектованность</span></div>
        <div className={divs.some((u) => u.cutOff) ? 'alarm' : ''}><b>{divs.filter((u) => u.cutOff).length}</b><span>отрезано от подвоза</span></div>
      </div>
      {v.turn > 1 && <div className="dispatch"><h4>Донесения за ход</h4>
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
  const strength = active.length ? active.reduce((s, u) => s + u.strength, 0) / active.length : 0;
  const reached = v.goals.filter((g) => g.simulated);
  return (
    <div className="cmd-sec">
      <h3>Оперативная сводка к {hhmm(v.time)} {ddmm(v.time)}</h3>
      <div className="kpis small">
        <div><b>{active.length}</b><span>объединений в строю</span></div>
        <div><b>{pct(strength)}</b><span>средняя укомплектованность</span></div>
        <div className={cut ? 'alarm' : ''}><b>{cut}</b><span>отрезано от подвоза</span></div>
      </div>
      {v.turn > 1 && <div className="dispatch">
        <h4>Донесения за ход <ActButton className="turn-show" action="command.turn.show" data-hl="turn-show" title="Посредник покажет прошедший ход на карте: общее, главные бои, цели, тыл, противник">Разбор хода на карте ▸</ActButton></h4>
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
      <div className="adv-in">
        <textarea rows={2} value={text} placeholder={node ? `Свой вопрос (${topic})…` : 'Свой вопрос…'} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); go(text); } }} />
        {busy ? <StaffButton action="command.advisor.stop" title="Прервать ответ (модель освобождается)">Остановить</StaffButton>
          : <button className="primary" disabled={!text.trim()} onClick={() => go(text)}>Спросить</button>}
      </div>
      <label className="adv-voice" title="Ответ зачитывается коротко, остальное — по «подробнее». Голосом: «Штаб, читай ответы советника вслух» / «не читай ответы».">
        <input type="checkbox" checked={speakAns} onChange={(e) => { void act('command.advisor.voice', { on: e.target.checked }); }} /> Читать ответы вслух
        <small>Голосом: «запиши в вопрос …», «отправь вопрос»</small>
      </label>
      <div className="adv-note">Вопросы читает только советник. Арбитр исполняет лишь утверждённые вами приказы в строгой форме — объединение, задача, цель.</div>
    </div>
  );
}

/** Варианты решения от советника: карточки по мере генерации; принять целиком, только решение или отдельные приказы и распоряжения. */
function PlanBlock({ plan, stale, open, accept, drafted, hasAct }: {
  plan: PlanState; stale: boolean; open: number | null; accept: (v: PlanVariantView, i: number) => void; drafted: (f: string) => boolean; hasAct: (key: string) => boolean;
}) {
  const D: [keyof HumanDecision, string][] = [['assessment', 'Оценка обстановки'], ['enemyIntent', 'Замысел противника'], ['intent', 'Решение'], ['risks', 'Риски'], ['report', 'Донесение вышестоящему']];
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


function Decision({ v, d, set, planN, planBusy, who }: { v: TurnView; d: HumanDecision; set: (p: Partial<HumanDecision>) => void; planN: number; planBusy: boolean; who?: string }) {
  const last = v.lastDecision;
  const F = ({ k, label, hint, rows, req }: { k: Exclude<keyof HumanDecision, 'request'>; label: string; hint: string; rows: number; req?: boolean }) => (
    <label className={`dfield${req && !d[k].trim() ? ' need' : ''}`} data-hl={`field-${k}`}>
      <span>{label}{req && <i> обязательно</i>}{last?.[k] && last[k] !== d[k] && <button className="link" data-action="decision.fromLast" title={last[k]} onClick={(e) => { e.preventDefault(); tap('decision.fromLast', { field: k }); }}>взять с прошлого хода</button>}</span>
      <textarea rows={rows} value={d[k]} placeholder={hint} onChange={(e) => set({ [k]: e.target.value })} />
    </label>
  );
  return (
    <div className="cmd-sec">
      <h3>Решение{who ? ` — ${who}` : ''} на {ddmm(v.time)} {hhmm(v.time)}</h3>
      {who && <p className="note">Решение этого штаба — для журнала и разбора; ход проводится по решению {v.terms?.topGen ?? 'Ставки'} (уровень «{v.terms?.top ?? 'Ставка'}»).</p>}
      <div className="plan-cta" data-hl="plan-cta"><span>Не знаете, с чего начать? Советник предложит полные варианты — решение, приказы, тыл, переправы, резервы; выберите, примите и поправьте. Сколько вариантов — выберите рядом (один готовится быстрее).</span>
        <div className="plan-cta-act">
          <select value={planN} disabled={planBusy} data-action="command.variants.count" onChange={(e) => tap('command.variants.count', { n: +e.target.value })} title="Сколько вариантов просить (запоминается)">{[1, 2, 3].map((n) => <option key={n} value={n}>{n === 1 ? '1 вариант' : `${n} варианта`}</option>)}</select>
          {planBusy ? <StaffButton action="command.advisor.stop"><i className="spinner" /> Стоп</StaffButton> : <StaffButton className="primary" action="command.variants" params={{ count: planN }}>Варианты от советника</StaffButton>}
        </div></div>
      <p className="note">Решение штаба на ход — те же части, что у штаба противника. Без оценки обстановки, решения и боевого донесения ход не проводится. Замысел, замысел противника и риски переносятся с прошлого хода — уточните их; оценку обстановки и донесение пишут заново на каждый ход (обстановка изменилась), прошлые можно взять кнопкой и поправить. Все прошлые решения — во вкладке «Журнал».</p>
      {F({ k: 'assessment', label: 'Оценка обстановки', hint: 'Положение своих войск и противника, соотношение сил, местность, состояние снабжения, что изменилось за сутки…', rows: 6, req: true })}
      {F({ k: 'enemyIntent', label: 'Замысел противника', hint: 'Что противник, по-видимому, намерен делать: где держит, куда отходит, где готовит контрудар…', rows: 3 })}
      {F({ k: 'intent', label: 'Решение (замысел действий)', hint: 'Цель на сутки, главный удар, кто наступает, кто обеспечивает, куда вводятся резервы…', rows: 4, req: true })}
      {F({ k: 'risks', label: 'Риски', hint: 'Что может пойти не так и как парировать…', rows: 2 })}
      <label className={`dfield${!d.report.trim() ? ' need' : ''}`} data-hl="field-report">
        <span>Боевое донесение {v.terms?.topTo ?? 'в Ставку'}<i> обязательно</i><button className="link" data-action="decision.draftReport" onClick={(e) => {
          e.preventDefault();
          // продиктованное донесение — заменить только после вопроса
          if (!d.report.trim()) tap('decision.draftReport');
          else void confirmAsync('Заменить продиктованное донесение черновиком по докладам?', { ok: 'Заменить' }).then((ok) => { if (ok) tap('decision.draftReport.replace'); });
        }}>черновик по докладам</button></span>
        <textarea rows={5} value={d.report} placeholder="Положение войск к утру, итоги суток, решение на следующие сутки, просьбы…" onChange={(e) => set({ report: e.target.value })} />
      </label>
      <label className="dfield" data-hl="field-request">
        <span>Ходатайство {v.terms?.topTo ?? 'в Ставку'} о разграничительных линиях</span>
        <textarea rows={2} value={d.request ?? ''} placeholder="Например: прошу продлить линию с соседом до … — его войска вышли в нашу полосу. Пусто — не ходатайствовать." onChange={(e) => set({ request: e.target.value })} />
        <small className="muted">Рассматривает модель высшего командования ({v.terms?.top ?? 'Ставка'}) на этом ходу; ответ и новая линия — в донесениях следующего хода и в «Журнале».</small>
      </label>
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

function Rear({ v, acts, pickMode, setPickMode, setPriority }: {
  v: TurnView; acts: Act[]; pickMode: Pick | null; setPickMode: (p: Pick | null) => void;
  setPriority: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const pa = acts.find((a) => a.action.kind === 'priority');
  const prio = pa && pa.action.kind === 'priority' ? pa.action.formations : v.priority;
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

function Bridges({ v, acts, pickMode, setPickMode }: { v: TurnView; acts: Act[]; pickMode: Pick | null; setPickMode: (p: Pick | null) => void }) {
  const mine = acts.filter((a) => a.action.kind === 'bridge');
  const building = v.bridges.filter((b) => b.building);
  const busy = building.length + mine.length;
  return (
    <div className="cmd-sec">
      <h3>Инженерные войска: переправы</h3>
      <p className="note">Через большую реку без моста техника не пройдёт (пехота — медленно), подвоз — тоже. Наводка: большая река — сутки, малая — 12 ч; нужны наши войска рядом. Понтонных парков — {v.parks}, занято {busy}.</p>
      <button className={pickMode?.kind === 'bridge' ? 'on' : ''} disabled={busy >= v.parks && pickMode?.kind !== 'bridge'} onClick={() => setPickMode(pickMode?.kind === 'bridge' ? null : { kind: 'bridge' })}>
        {pickMode?.kind === 'bridge' ? 'Щёлкните по реке на карте… (отмена)' : busy >= v.parks ? 'Все понтонные парки заняты' : 'Навести переправу — указать место на карте'}</button>
      {mine.map((a) => <ActLine key={a.key} a={a} />)}
      {building.length > 0 && <><h4 className="cmd-h4">Наводятся</h4>{building.map((b) => <div key={b.id} className="brow-h" data-action="map.center" onClick={() => tap('map.center', { at: b.at })}><b>{b.name}</b><span className="st moving">готова {ddmm(b.openFrom!)} {hhmm(b.openFrom!)}</span></div>)}</>}
      <h4 className="cmd-h4">Действующие переправы</h4>
      {v.bridges.filter((b) => !b.building).map((b) => <div key={b.id} className="brow-h" data-action="map.center" onClick={() => tap('map.center', { at: b.at })}><b>{b.name}</b><span className="st active">действует</span></div>)}
    </div>
  );
}

/** Резервы: ждущие ввода (по армиям — вводятся целиком или по соединению), прибывающие по плану и резервы на театре. */
function Reserves({ v, acts, pickMode, setPickMode, onOrder }: {
  v: TurnView; acts: Act[]; pickMode: Pick | null; setPickMode: (p: Pick | null) => void; onOrder: (id: string) => void;
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
  const onTheatre = active.filter((u) => !hqs.has(u.id) && (u.posture === 'в резерве' || (u.posture === 'на марше' && !u.combats.length)));
  const sum = (us: UnitReport[]) => ({ p: us.reduce((s, u) => s + u.personnel, 0), t: us.reduce((s, u) => s + u.tanks, 0), g: us.reduce((s, u) => s + u.guns, 0) });
  const mid = (us: UnitReport[]): LngLat => [us.reduce((s, u) => s + u.at[0], 0) / us.length, us.reduce((s, u) => s + u.at[1], 0) / us.length];
  const span = (ts: string[]) => { const l = [...ts].sort(); const a = `${ddmm(l[0])} ${hhmm(l[0])}`, b = `${ddmm(l[l.length - 1])} ${hhmm(l[l.length - 1])}`; return a === b ? a : `${a} – ${b}`; };
  const stats = (us: UnitReport[]) => { const x = sum(us); return `${us.length > 1 ? `${us.length} соед. · ` : ''}${x.p.toLocaleString('ru')} чел., танков и САУ ${x.t}, орудий ${x.g}`; };
  const all = sum(waiting.flatMap((g) => g.units));
  return (
    <div className="cmd-sec">
      <h3>Резервы {v.terms?.topGen ?? 'Ставки'}</h3>
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
      <h4 className="cmd-h4">Резервы на театре</h4>
      <p className="muted small">Свои соединения в резерве или на марше без боя — их можно бросить на угрожаемое направление приказом.</p>
      {onTheatre.length ? onTheatre.slice(0, more ? undefined : 8).map((u) => (
        <div key={u.id} className="brow">
          <div className="brow-h"><b title={u.name}>{short(u.name)}</b><span className="st">{u.posture}, {u.place}</span><button className="link" onClick={() => onOrder(u.id)}>приказ…</button></div>
          <div className="muted small">{u.personnel.toLocaleString('ru')} чел., танков и САУ {u.tanks}, орудий {u.guns}; укомплектованность {Math.round(u.strength * 100)} %</div>
        </div>
      )) : <p className="muted">Все соединения на театре заняты в бою или в обороне.</p>}
      {onTheatre.length > 8 && <button className="link" onClick={() => setMore(!more)}>{more ? 'свернуть' : `ещё ${onTheatre.length - 8}`}</button>}
    </div>
  );
}

/** Полосы: линии Ставки словами, линии армий — распоряжением игрока (две армии одного фронта, линия точками на карте). */
function Bounds({ v, acts, picking, setPicking, pts, setPts, sel }: {
  v: TurnView; acts: Act[]; picking: boolean; setPicking: (b: boolean) => void;
  pts: LngLat[]; setPts: (f: (l: LngLat[]) => LngLat[]) => void; sel: Omit<BoundsDraft, 'pts'>;
}) {
  const armies = v.armies ?? [];
  const fronts = v.groups.filter((g) => armies.filter((u) => u.group === g.id).length >= 2);
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
      <h3>Полосы и разграничительные линии</h3>
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
        </div>
      ))}
    </div>
  );
}

function Umpire({ record, ai, turns, current, stream, phase, reveal, setReveal, enemy, setEnemy, llm, part }: {
  record: GameRecord | null; ai: AiStatus; turns: AiTurn[]; current?: AiTurn; stream: string; phase: string; reveal: boolean; setReveal: (b: boolean) => void;
  enemy: EnemyMode; setEnemy: (e: EnemyMode) => void; llm: Llm; part: 'enemy' | 'umpire';
}) {
  const [open, setOpen] = useState<string | null>(null);
  // решение штаба противника за ход — раскрыть (голосом прочитать последнее — «как действовал противник»)
  useAction({ id: 'command.enemy.turn', model: false, section: 'replay', title: 'Раскрыть решение противника', describe: 'Вкладка «Посредник»: раскрывает решение штаба противника за ход (time).',
    params: { type: 'object', properties: { time: { type: 'string' } }, required: ['time'] }, available: () => true,
    run: async (p: { time: string }) => { setOpen((o) => (o === p?.time ? null : p?.time ?? null)); } });
  const list = current && !turns.some((t) => t.time === current.time) ? [current, ...turns] : turns;
  const nUmp = (record?.turns ?? []).filter((t) => t.umpireNote).length;
  return (
    <div className="cmd-sec">
      <p className="note warnbox">Посредник видит решения штаба противника и может снять туман войны. Если играете честно — заглядывайте сюда после игры.</p>
      <label className="switch"><input type="checkbox" data-action="command.reveal" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /><span /> Показать на карте всех (снять туман войны)</label>
      <div className="umpire-cfg">
        <label>Противник
          {enemy === 'agents' ? <b> — штабы-агенты по уставам (выбрано при передаче командования)</b>
            : <select value={enemy} data-action="command.enemyMode" data-hl="enemy-mode" onChange={(e) => setEnemy(e.target.value as EnemyMode)}>
            <option value="llm">штаб на модели (LM Studio)</option>
            <option value="passive">без штаба — держится прежних приказов</option>
          </select>}
        </label>
      </div>
      {enemy === 'llm' && <label className="umpire-model">Модель штаба противника и размышление <ModelPicker llm={llm} who="enemy" purpose="штаба противника" />
        {llm.check.state === 'fail' && <span className="err small">LM Studio: {llm.check.error}</span>}</label>}
      <label className="switch"><input type="checkbox" checked={!!llm.settings.umpire} onChange={(e) => llm.set({ umpire: e.target.checked })} /><span /> Посредник на модели: нюансы к боям по базе знаний</label>
      <label className="switch"><input type="checkbox" checked={llm.settings.stavka !== false} onChange={(e) => llm.set({ stavka: e.target.checked })} /><span /> Модель высшего командования (Ставка, ОКХ): разграничительные линии фронтов и групп армий, когда обстановка разошлась с историей или есть ходатайство</label>
      <p className="muted umpire-about">Перед каждым ходом модель-посредник смотрит на ожидаемые бои и по справкам базы знаний (доктрина, нормативы, техника) добавляет то, чего правила не учитывают: видимость, взаимодействие родов войск, заграждения, качество обороны. Поправки — множители 0,8–1,25 с обоснованием; видны в журнале боя и записываются в игру.</p>
      <div className="seg umpire-seg">
        <ActButton className={part === 'enemy' ? 'on' : ''} action="command.umpire.part" params={{ part: 'enemy' }} data-hl="ump-enemy">Как действовал противник · {list.length}</ActButton>
        <ActButton className={part === 'umpire' ? 'on' : ''} action="command.umpire.part" params={{ part: 'umpire' }} data-hl="ump-umpire">Поправки посредника · {nUmp}</ActButton>
      </div>
      {part === 'umpire' && (nUmp ? <UmpireNotes record={record} /> : <p className="muted">Посредник ещё не работал: включите его выше — поправки появятся со следующего хода.</p>)}
      {part === 'enemy' && <>
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

const MODE_KEY = 'def_ops.command.mode';
/** Режим игры на агентной модели, выбранный в окне передачи командования (по умолчанию — «гибрид», ближе к истории). */
export function savedGameMode(): GameMode {
  try { const v = localStorage.getItem(MODE_KEY); return v === 'legacy' || v === 'agents' || v === 'hybrid' ? v : 'hybrid'; } catch { return 'hybrid'; }
}

export function TakeoverDialog({ at, turnHours, start, scenarioName, scenario, kbSummary, llm, hasSaved = false, agents = false, onStart, onCancel }: {
  at: string; end: string; turnHours: number; start: string; scenarioName: string; scenario: string; kbSummary: TakeoverSummary | null; llm: Llm;
  /** Есть незавершённая игра: новая её заменит (голосом — после «да»). */
  hasSaved?: boolean;
  /** Игра на агентной модели: выбор режима командования. */
  agents?: boolean;
  onStart: (enemy: EnemyMode, mode: GameMode) => void; onCancel: () => void;
}) {
  const [enemy, setEnemy] = useState<EnemyMode>(llm.check.state === 'fail' ? 'passive' : 'llm');
  const [mode, setMode] = useState<GameMode>(savedGameMode);
  useAction({
    id: 'command.gameMode', section: 'replay', title: 'Режим командования', describe: 'Режим игры на агентной модели: как сейчас (legacy), штабы-агенты (agents), гибрид (hybrid).',
    params: { type: 'object', properties: { mode: { enum: ['legacy', 'agents', 'hybrid'] } }, required: ['mode'] }, say: ['режим штабы-агенты', 'режим гибрид'],
    available: () => (agents ? true : 'режим — только в игре на агентной модели'), highlight: (p: { mode: GameMode }) => hl(`mode-${p?.mode}`),
    run: async (p: { mode: GameMode }) => {
      if (!MODE_TITLE[p?.mode]) return 'Скажите: «как сейчас», «штабы-агенты» или «гибрид».';
      setMode(p.mode);
      try { localStorage.setItem(MODE_KEY, p.mode); } catch { /* */ }
      return `Режим — «${MODE_TITLE[p.mode].title}»: ${MODE_TITLE[p.mode].hint}.`;
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
      return speakable(takeoverRead({ day: dayMonth(at), turn, enemy: s.enemy, down: s.down, saved: s.hasSaved }), { full: true });
    },
    remind: TAKEOVER_REMIND,
    how: '«принимаю» или «отмена»',
    isAnswer: takeoverIsAnswer,
    parse: (rest) => takeoverParse(rest, { saved: st.current.hasSaved, enemy: st.current.enemy }),
  }), []); // eslint-disable-line react-hooks/exhaustive-deps
  useAction({
    id: 'command.enemyMode', section: 'replay', title: 'Противник', describe: 'Кто командует противником: штаб на модели или без штаба.',
    params: { type: 'object', properties: { mode: { enum: ['llm', 'passive', 'agents'] } }, required: ['mode'] }, say: ['без штаба'], available: () => true,
    highlight: (p: { mode: EnemyMode }) => hl(`enemy-${p?.mode}`),
    run: async (p: { mode: EnemyMode }) => {
      if (p?.mode !== 'llm' && p?.mode !== 'passive' && !(p?.mode === 'agents' && agents)) return agents ? 'Скажите: «штаб на модели», «без штаба» или «штабы-агенты».' : 'Скажите: «штаб на модели» или «без штаба».';
      setEnemy(p.mode);
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
          <li>Советской стороной с этого момента командуете вы. Конечной даты нет: игра идёт до победы (Знамя Победы над рейхстагом) или поражения — войска потеряли боеспособность или предельный срок вышел. Вернуть командование историческому плану нельзя.</li>
          <li>Немецкой стороной с того же момента командует штаб на языковой модели. На каждом ходу он получает свою обстановку — то, что знал бы немецкий штаб, — и отдаёт приказы. Обе стороны решают одновременно.</li>
          <li>{agents && mode !== 'legacy' ? mode === 'hybrid' ? 'Вы — верхняя инстанция. Исторические директивы встанут в очередь первого хода (вкладка «Штабы»): пока они действуют, войска идут по приказам сценария; своя директива штабу снимает его со сценария — дальше решают штабы-агенты.' : 'Вы — верхняя инстанция: директивы фронтам, ниже решают штабы-агенты. Уже действующие исторические директивы встанут в очередь первого хода (вкладка «Штабы»).' : 'Исторические приказы после этого момента отменяются. Приказы, отданные раньше и ещё не дошедшие до войск, остаются в силе.'}</li>
          <li>Противник виден только в пределах разведки (туман войны). Игра сохраняется автоматически после каждого хода.</li>
          <li className="take-kb">Состояние соединений на этот момент: {kbSummary ? <>{takeoverText(kbSummary)}. </> : <span className="muted">сверка с базой знаний… </span>}
            <button className="link" onClick={() => { onCancel(); openModelBasis(scenario); }} title="Моделирование → Операции: факты базы, из которых собраны входы модели">Основа модели</button></li>
        </ul>
        <div className="take-enemy">
          <label className={enemy === 'llm' ? 'on' : ''} data-hl="enemy-llm"><input type="radio" data-action="command.enemyMode" checked={enemy === 'llm'} onChange={() => void act('command.enemyMode', { mode: 'llm' })} />
            <span><b>Штаб на модели</b> — LM Studio на этом компьютере<small className={`llm-st ${llm.check.state}`}>{llm.check.state === 'ok' ? `✓ на связи: ${llm.settings.model || llm.check.models[0]}` : llm.check.state === 'fail' ? `✗ ${llm.check.error} — запустите сервер в LM Studio (настройки — раздел «ИИ»)` : 'проверка связи…'}</small></span></label>
          <label className={enemy === 'passive' ? 'on' : ''} data-hl="enemy-passive"><input type="radio" data-action="command.enemyMode" checked={enemy === 'passive'} onChange={() => void act('command.enemyMode', { mode: 'passive' })} />
            <span><b>Без штаба</b> — противник держится прежних приказов<small>для пробы без модели; переключить можно в ходе игры (вкладка «Посредник»)</small></span></label>
          {agents && <label className={enemy === 'agents' ? 'on' : ''} data-hl="enemy-agents"><input type="radio" data-action="command.enemyMode" checked={enemy === 'agents'} onChange={() => void act('command.enemyMode', { mode: 'agents' })} />
            <span><b>Штабы-агенты</b> — противник в той же логике ступеней: его верхняя инстанция подаёт исторические решения, ниже решают штабы по уставам<small>без модели; в ходе игры не меняется</small></span></label>}
        </div>
        {agents && <div className="take-enemy take-mode">
          <div className="take-mode-h">Командование своей стороной</div>
          {(['hybrid', 'agents', 'legacy'] as GameMode[]).map((k) => <label key={k} className={mode === k ? 'on' : ''} data-hl={`mode-${k}`}>
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
