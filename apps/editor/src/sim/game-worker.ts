/**
 * Игра в фоновом потоке браузера. С момента передачи командования советской
 * стороной командует человек, немецкой — штаб на модели (LM Studio). Обе стороны
 * решают одновременно, по одной и той же обстановке на утро хода: как только ход
 * посчитан, модели уходит её обстановка, а человек тем временем читает доклады и
 * пишет приказы. «Провести ход» — дождаться решения модели, отдать приказы обеих
 * сторон и посчитать ход арбитром.
 */
import { aiHold } from './ai-hold';
import { createFeature, type LngLat, type SymbolFeature } from '@def-ops/core';
import {
  checkAction, checkEvents, contextFrom, dayEvents, describePlace, describeTarget, detected, detectKm, gameOutcome, intelReport, sideStrength, onMap, places, playTurn,
  agentsHistory, type AgentGameSpec, type AgentHistory, type CommandOp,
  addHours, applyActions, prepareTakeover,
  activeBoundaries, commandTerms, groupOf, runToDocument, sideZones, turnBattles, withBoundaries, sectorText, shortName, startGame, supplyHoursOf, targetPoint, TASK_RU, unitReports, type GameRecord, type GameState, type History, type Order, type SimContext, type Snapshot, type StaffAction, type GameEnd, type GameOutcome, type DataKind,
} from '@def-ops/sim';
import catalogFile from '../../../../packages/sim/data/scenarios/catalog.json';
import { situationTriggers, staffQueries, stavkaNeed, stavkaTurn, type StavkaNeed, type StavkaResult, actionsToStaff, advise, buildAdvice, buildSituation, decideTurn, planOrdersApplied, planVariants, type PlanVariantRaw, type Situation, umpireTurn, REVIEW_SECTIONS, reviewDigest, reviewMessages, type ReviewInput, type AdvisorConfig, type AiTurn, type LiveConfig } from '@def-ops/staff-service/live';
import type { DoctrineRule, Entry, RoleRef } from '@def-ops/knowledge';
import { KB_FALLBACK_NOTE, KB_REF_CHARS, KB_REF_LIMIT, kbRefClient, seedAnswer, umpireRefs } from './kb-ref';
import umpireSystemTpl from '../../../../services/staff/prompts/umpire.system.md?raw';
import umpireUserTpl from '../../../../services/staff/prompts/umpire.user.md?raw';
import { LlmClient } from '@def-ops/staff-service/llm';
import { gameEndOf, getData, liveOf } from './userdata';
import { coreTakeoverFor, gameKbNow, takeoverNow } from './kb-recompile';
import { gameKbData, type GameKb } from './kb-compile';
import systemTpl from '../../../../services/staff/prompts/staff.system.md?raw';
import liveTpl from '../../../../services/staff/prompts/staff.live.md?raw';
import advisorSystemTpl from '../../../../services/staff/prompts/advisor.system.md?raw';
import advisorUserTpl from '../../../../services/staff/prompts/advisor.user.md?raw';
import { agentEvents, agentGame, bridgesOf, commandText, commandView, hourAt, hqReports, staffEffects, territoryFromCore, toAgentOrders, withStaff, type AgentGameTrace, type AgentStaff } from './agents-game';
import type { AdviceView, PlanActView, PlanVariantView, AiStatus, EnemyMode, GameRequest, GameResponse, HumanDecision, JournalDay, LlmSettings, TurnView } from './game-protocol';
import { llmQueue } from './llm-queue';
import { topForces } from './review-forces';

const profilesMd = import.meta.glob('../../../../services/staff/profiles/*.md', { query: '?raw', import: 'default' });
const liveCfg = import.meta.glob('../../../../services/staff/live/*.json', { import: 'default' });
// встроенные данные и свои (правила, загруженные операции)

const post = (m: GameResponse) => (self as unknown as Worker).postMessage(m);

let ctx: SimContext;
let history: History;
let g: GameState;
let rec: GameRecord;
let cfg: LiveConfig & { advisor?: AdvisorConfig };
let advisorProfile = '';
let profileMd = '';
let llm: LlmSettings;
let enemy: EnemyMode = 'llm';
let reveal = false;
let journal: JournalDay[] = [];
/** Решение модели на текущий ход. */
interface AiRun { time: string; promise: Promise<AiTurn | null>; abort: AbortController; result?: AiTurn | null; /** Справка штабу посчитана по сиду. */ kbFallback?: boolean }
let ai: AiRun | null = null;
let skipAi = false;
/** Приказы, распоряжения и решение человека, ждущие решения модели. */
let queued: { orders: Order[]; actions: StaffAction[]; decision: HumanDecision; command: CommandOp[] } | null = null;
let busy = false;
/** После хода штаб противника ждёт доклада посредника голосом (umpire-done) — sim/ai-hold.ts. */
const aiWait = aiHold(() => startAi());
function holdAi(): void { aiWait.hold(); if (enemy === 'llm' && !isOver()) status({ state: 'off' }); }
const releaseAi = () => aiWait.release();
/** Условия окончания игры и численность стороны человека при передаче командования. */
let end: GameEnd;
let baseStrength = 0;
let outcome: GameOutcome | null = null;
const isOver = () => !!outcome;

/** Игра на агентной модели: что считать, ход ядра, контекст сценария до замены формирований. */
let agents: AgentGameSpec | null = null;
let agentTrace: AgentGameTrace | null = null;
let agentBase: SimContext | null = null;
/** Штаб игрока на агентной модели: тыл, линии, директивы, введённые резервы — между ходами. */
let agentStaff: AgentStaff = { committed: {} };
/** Переправы стороны игрока, снятые при передаче командования (ядру — с первым ходом). */
let agentDropped: string[] = [];
let agentHuman = '';

/** Вызов команды ядра через основное окно (у фонового потока нет доступа к командам приложения). */
let callId = 0;
const calls = new Map<number, { res: (v: unknown) => void; rej: (e: Error) => void }>();
function agentsCall<T>(cmd: string, args: Record<string, unknown>, moment?: string): Promise<T> {
  const id = ++callId;
  post({ kind: 'agents-call', id, cmd, args, ...(moment ? { moment } : {}) });
  return new Promise<T>((res, rej) => calls.set(id, { res: res as (v: unknown) => void, rej }));
}
/** Новый ход ядра: контекст и состояние игры по нему. */
function setAgent(t: AgentGameTrace) {
  agentTrace = t;
  ({ ctx, g } = agentGame(agentBase!, t, agents!.turnHours));
  g = { ...g, state: withStaff(ctx, t, g.state, agentStaff, agentHuman) };
}
/**
 * Ход на агентной модели: распоряжения штаба проверяет и исполняет эта модель (applyActions — базы, приоритет,
 * переправы, подрыв, резервы, линии), их последствия и приказы обеих сторон уходят ядру; итог — новые контекст и
 * состояние, донесения — из журнала агентов.
 */
async function agentTurn(orders: Order[], actions: StaffAction[], command: CommandOp[] = []): Promise<{ events: string[]; results: { action: StaffAction; ok: boolean; text: string }[] }> {
  const from = agentTrace!.frames.length - 1;
  const before = g.state;
  const bb = bridgesOf(ctx);
  const a = applyActions(ctx, before, actions);
  agentStaff = { logistics: a.state.logistics, boundaries: a.state.boundaries, directives: a.state.directives, committed: { ...agentStaff.committed } };
  const fx = staffEffects(ctx, agentTrace!.start, before, a.state, bb, agentHuman);
  for (const c of fx.commit) agentStaff.committed[c.division] = { at: c.at, eta: addHours(agentTrace!.start, c.from) };
  fx.demolish.push(...agentDropped.map((id) => ({ bridge: id, from: 0 })));
  agentDropped = [];
  // полосы — на сетке ядра; нет территории ядра (другой театр) — без полос
  if (!agentTrace!.control || !territoryFromCore(ctx.theatre, agentTrace!.control)) fx.sectors = [];
  const t = await agentsCall<AgentGameTrace>('game_turn', { orders: toAgentOrders(ctx, { ...g, state: a.state }, orders), hours: agents!.turnHours, staff: fx, ...(command.length ? { command } : {}) }, before.time);
  setAgent(t);
  const names = new Map([...t.hqs.map((h) => [h.id, h.name] as const), ...t.divisions.map((d) => [d.id, d.name] as const)]);
  const bad = [
    ...(t.game.applied ?? []).filter((x) => x.error).map((x) => `Приказ ${names.get(x.hq) ?? x.hq} не принят: ${x.error}`),
    ...(t.game.staffErrors ?? []).map((x) => `Распоряжение не исполнено: ${x}`),
    ...(t.game.commandErrors ?? []).map((x) => `Команда не исполнена: ${x}`),
  ];
  const ops = command.map((c) => `Управление: ${commandText(c, (id) => names.get(id) ?? id)}`);
  return { events: [...ops, ...bad, ...agentEvents(t, from, t.frames.length - 1, rec.human)], results: a.results };
}

const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`;

self.onmessage = async (e: MessageEvent<GameRequest>) => {
  const m = e.data;
  try {
    if (m.kind === 'kbRefResult') kbc.receive(m);
    else if (m.kind === 'agents-reply') { const c = calls.get(m.id); calls.delete(m.id); if (c) { if (m.ok) c.res(m.result); else c.rej(new Error(m.error ?? 'ошибка ядра агентной модели')); } }
    else if (m.kind === 'start') await start(m.start, m.record, m.llm, m.enemy);
    else if (m.kind === 'turn') { queued = { orders: m.orders, actions: m.actions, decision: m.decision, command: m.command ?? [] }; await advance(); }
    else if (m.kind === 'check') post({ kind: 'check', id: m.id, result: checkAction(ctx, g.state, { ...m.action, issuedAt: g.state.time }, m.pendingBridges) });
    else if (m.kind === 'settings') {
      const was = enemy;
      llm = m.llm; enemy = m.enemy;
      if (was !== enemy) { aiWait.drop(); startAi(); }
    } else if (m.kind === 'review-section') void reviewSection(m);
    else if (m.kind === 'review-stop') reviewAbort?.abort();
    else if (m.kind === 'retry-ai') { aiWait.drop(); startAi(); if (queued) await advance(); }
    else if (m.kind === 'skip-ai') { skipAi = true; if (queued) await advance(); }
    else if (m.kind === 'umpire-done') releaseAi();
    else if (m.kind === 'llm-hold') modelQueue.hold(m.on);
    else if (m.kind === 'advise') void adviseReq(m);
    else if (m.kind === 'plan') void planReq(m);
    else if (m.kind === 'plan-stop') planAbort?.abort();
    else if (m.kind === 'advise-stop') adviseAbort?.abort();
    else if (m.kind === 'reveal') { reveal = m.on; postView(); }
  } catch (err) {
    busy = false;
    post({ kind: 'error', message: (err as Error).message ?? String(err) });
  }
};

async function start(s: { scenario: string; rules: string; seed: number; takeover: string; agents?: AgentGameSpec }, record: GameRecord | undefined, l: LlmSettings, en: EnemyMode) {
  llm = l; enemy = en;
  post({ kind: 'progress', text: 'загрузка данных…' });
  // данные из базы: записанные в игре при начале (восстановление — на тех же данных; запись без них — без данных базы), новой игре — нынешние
  const kb = gameKbData(record as { kb?: GameKb } | undefined, record ? { compiled: null, core: null } : await gameKbNow(s.scenario, !!s.agents));
  // состояние соединений при передаче по фактам базы: новой игре — по нынешней базе (считается один раз и пишется
  // в запись), записанной — то, с которым она начата (нет в записи — без него). База недоступна — игра начинается
  // без состояния по фактам (как прежде), а не падает
  if (!record) {
    try { kb.takeoverState = (await takeoverNow(s.scenario, s.takeover, !!s.agents, kb)).state; }
    catch (e) { console.warn('состояние при передаче по фактам базы не получено:', e); }
  }
  const get = (kind: string, file: string) => getData(kind as DataKind, file, kb.compiled);
  ({ ctx, history } = await contextFrom(get as never, s.scenario, s.rules));
  const cfgLoad = (liveCfg as Record<string, (() => Promise<unknown>) | undefined>)[`../../../../services/staff/live/${s.scenario}.json`];
  const own = cfgLoad ? null : await liveOf(s.scenario);
  if (!cfgLoad && !own) throw new Error(`для сценария ${s.scenario} нет настроек штаба модели (services/staff/live/${s.scenario}.json)`);
  cfg = (cfgLoad ? await cfgLoad() : own) as LiveConfig;
  profileMd = (await profilesMd[`../../../../services/staff/profiles/${cfg.profile}.md`]?.()) as string ?? '';
  const human = ctx.scenario.sides.find((x) => x.id !== cfg.side)!.id;
  advisorProfile = cfg.advisor ? ((await profilesMd[`../../../../services/staff/profiles/${cfg.advisor.profile}.md`]?.()) as string ?? '') : '';
  agents = record?.agents ?? s.agents ?? null;
  // штаб модели ведёт и тыл, переправы, резервы своей стороны, если противник — модель (решается при передаче командования)
  const aiStaff = agents ? false : record ? !!record.aiStaff : en === 'llm';
  end = ((catalogFile as unknown as { scenarios: { id: string; game: GameEnd }[] }).scenarios.find((x) => x.id === s.scenario)?.game) ?? (await gameEndOf(s.scenario) as GameEnd | undefined) ?? { victory: { event: '', title: '' }, defeat: { strengthBelow: 0, deadline: ctx.scenario.end, deadlineText: 'время операции вышло' } };
  if (agents) {
    // агентная модель: история дивизий и ход до передачи командования считает ядро; противник на модели — вне ядра
    post({ kind: 'progress', text: 'агентная модель: расчёт до передачи командования…' });
    history = agentsHistory(JSON.parse(await agentsCall<string>('read_text', { path: agents.history })) as AgentHistory, history);
    agentBase = ctx;
    agentHuman = human;
    agentStaff = { committed: {} };
    const takeover = (record?.takeover ?? s.takeover);
    setAgent(await agentsCall<AgentGameTrace>('game_start', {
      scenario: agents.path, seed: s.seed, takeover: hourAt(ctx.scenario.start, takeover), player: human, mode: agents.mode ?? 'legacy',
      enemy: en === 'llm' ? 'llm' : 'script', until: hourAt(ctx.scenario.start, end.defeat.deadline),
      // поправки сценария из базы знаний (дивизии) — те, с которыми игра началась
      edits: kb.core ?? undefined,
      // состояние дивизий при передаче по фактам базы (game::TakeoverIn)
      takeoverState: kb.takeoverState ? (await coreTakeoverFor(s.scenario, kb.takeoverState, kb.core, record?.takeover ?? s.takeover)) ?? undefined : undefined,
    }));
    // тыл — под управлением штаба: базы снабжения стороны; будущие наводки переправ сняты (ядру — с первым ходом);
    // директивы с этого момента — по обстановке
    const bb = bridgesOf(ctx);
    const p = prepareTakeover(ctx, g.state, human);
    agentDropped = [...bb.keys()].filter((id) => !ctx.theatre.data.bridges.some((b) => b.id === id));
    const done = Object.fromEntries((ctx.scenario.boundaries ?? []).filter((b) => b.trigger && b.from <= p.time).map((b) => [b.id, b.from]));
    agentStaff = { logistics: p.logistics, directives: { conditional: true, activated: done }, committed: {} };
    g = { ...g, state: withStaff(ctx, agentTrace!, g.state, agentStaff, human) };
  } else {
    post({ kind: 'progress', text: 'расчёт до передачи командования…' });
    g = startGame(ctx, s.seed, s.takeover, human, aiStaff ? cfg.side : undefined, kb.takeoverState);
  }
  baseStrength = sideStrength(g.state, human);
  outcome = null;
  rec = record ?? { version: 1, scenario: s.scenario, rules: ctx.rules.id, seed: s.seed, takeover: g.state.time, human, ai: cfg.side, aiStaff, turns: [], ...(agents ? { agents } : {}), kb };
  journal = [];
  for (const [k, t] of rec.turns.entries()) {
    if (outcome) break;
    post({ kind: 'progress', text: `восстановление игры: ход ${k + 1} из ${rec.turns.length}…` });
    if (t.time !== g.state.time) throw new Error(`запись игры не сходится с расчётом (${t.time} ≠ ${g.state.time})`);
    const before = g.state;
    if (agents) {
      const r = await agentTurn(t.orders, t.actions ?? [], t.command ?? []);
      journal.push(day(before.time, t.orders, before, r.results.filter((x) => x.action.side === rec.human), t.human as HumanDecision | undefined, ((t.stavka ?? []) as (StavkaResult & { side: string })[]).filter((x) => x.side === rec.human), r.events));
    } else {
      const r = playTurn(ctx, g, t.orders, t.actions ?? [], t.umpire ?? []);
      g = r;
      journal.push(day(before.time, t.orders, before, r.results, t.human as HumanDecision | undefined, ((t.stavka ?? []) as (StavkaResult & { side: string })[]).filter((x) => x.side === rec.human)));
    }
    outcome = gameOutcome(ctx, history, g, end, rec.human, baseStrength);
  }
  postView();
  post({ kind: 'record', record: rec });
  startAi();
}

/** Запись журнала за ход: наши приказы словами и донесения. */
function day(time: string, orders: Order[], before: GameState['state'], results: { action: StaffAction; ok: boolean; text: string }[], decision?: HumanDecision, stavka: StavkaResult[] = [], agentDay?: string[]): JournalDay {
  const names = new Map([...ctx.scenario.formations.map((f) => [f.id, f.name] as const), ...before.formations.map((f) => [f.id, f.name] as const)]);
  const bases = new Map((before.logistics?.[rec.human]?.bases ?? []).map((b) => [b.id, b.name]));
  const T = commandTerms(ctx, rec.human);
  const what = (a: StaffAction) => a.kind === 'base' ? `Тыл: база «${bases.get(a.base) ?? a.base}» — перенести ${describePlace(ctx.theatre, a.to)}`
    : a.kind === 'priority' ? `Тыл: приоритет подвоза — ${a.formations.length ? a.formations.map((x) => names.get(x)).join(', ') : 'снят'}`
    : a.kind === 'bridge' ? `Инженерные: навести переправу ${describePlace(ctx.theatre, a.at)}`
    : a.kind === 'demolish' ? `Инженерные: подорвать мост ${describePlace(ctx.theatre, a.at)}`
    : a.kind === 'boundary' ? `Разграничительная линия армий${a.places?.length ? ` (${a.places.join(' — ')})` : ''}`
    : a.kind === 'directive' ? `${T.directive === 'приказ' ? 'Приказ' : 'Директива'} ${T.topGen} о разграничительной линии${a.places?.length ? ` (${a.places.join(' — ')})` : ''}`
    : `Резерв ${T.topGen}: ввести ${names.get(a.formation)} — район ${describePlace(ctx.theatre, a.at)}`;
  return {
    time,
    orders: orders.filter((o) => o.source === 'human').map((o) => `${names.get(o.formation)}: ${TASK_RU[o.task]} — ${describeTarget(ctx, o.target, names)}${o.note ? `. ${o.note}` : ''}`),
    actions: results.filter((r) => r.action.side === rec.human).map((r) => `${what(r.action)}${r.ok ? ` — ${r.text}` : ` — НЕ ИСПОЛНЕНО: ${r.text}`}`),
    decision,
    events: [
      ...stavka.map((x) => x.ok ? `${T.top}: ${x.reply ?? ''}${x.issues.length ? ` (не исполнено: ${x.issues.join('; ')})` : ''}` : `${T.top} не ${T.top === 'ОКХ' ? 'ответило' : 'ответила'} (${x.error ?? 'ошибка модели'}) — разграничительные линии прежние.`),
      ...(agentDay ?? dayEvents(ctx, g.state, rec.human, before)),
    ],
  };
}

/** Очередь к модели (sim/llm-queue.ts): окну — чем занята, голос — первым. */
const modelQueue = llmQueue((who) => post({ kind: 'llm-busy', who }));
const exclusive = modelQueue.exclusive;
const busyWho = modelQueue.busyWho;

/** Краткость ответа штаба противника в игре. */
const BRIEF = 'Игра идёт в реальном времени — отвечайте коротко: assessment — 3–4 предложения, enemyIntent и intent — по 1–2 предложения, details приказа — одно предложение, risks и requests — не больше трёх коротких пунктов. Приказы отдавайте объединениям (армиям, корпусам) — они доводятся до всех их соединений; отдельным дивизиям — только тем, у кого задача иная, чем у их объединения.';

function startAi() {
  ai?.abort.abort();
  ai = null;
  skipAi = false;
  if (!g || isOver()) return;
  if (enemy === 'passive') { status({ state: 'off' }); return; }
  const time = g.state.time;
  const prevAi = [...rec.turns].reverse().find((t) => (t.ai as AiTurn | undefined)?.decision);
  const previous = prevAi ? { time: prevAi.time, intent: (prevAi.ai as AiTurn).decision!.intent } : null;
  const gAt = g;
  const abort = new AbortController();
  const client = enemyClient();
  status({ state: 'thinking', time, since: Date.now() });
  post({ kind: 'ai-stream', text: '', reset: true });
  let buf = '', last = 0, phase = '', got = 0, t0 = 0;
  let phaseAt = 0, fixing = false;
  const setPhase = (t: string) => {
    // скорость меняется с каждым куском — не чаще раза в секунду
    if (t === phase || (t.split(' · ')[0] === phase.split(' · ')[0] && Date.now() - phaseAt < 1000)) return;
    phase = t; phaseAt = Date.now(); post({ kind: 'ai-phase', text: t });
  };
  const cur: AiRun = { time, abort, promise: Promise.resolve(null) };
  cur.promise = (async () => {
    // справка и доктрина штабу — из базы окна (до 8 с), иначе по сиду; startAi остаётся синхронной
    setPhase('справка из базы знаний…');
    const kbIn = await staffKb(gAt);
    if (kbIn?.fallback) cur.kbFallback = true;
    if (abort.signal.aborted) return null;
    const sit = buildSituation(ctx, gAt, cfg, { system: systemTpl, user: liveTpl, profile: profileMd }, previous, !!rec.aiStaff, kbIn);
    // в игре ход ждёт штаб противника: ответ — коротко (на локальной модели каждое слово — время; длинная оценка
    // обстановки шла минутами)
    const lastMsg = sit.messages[sit.messages.length - 1];
    lastMsg.content += `\n\n${BRIEF}`;
    const tokens = Math.round(sit.messages.reduce((a, m) => a + m.content.length, 0) / 3.2);
    setPhase(busyWho() ? `ждёт очереди: модель занята (${busyWho()})` : 'отправка запроса…');
    const t = await exclusive('решение штаба противника', () => {
      // до первого токена модель читает обстановку: на локальной модели длинный запрос — минута и больше
      setPhase(`модель читает обстановку: запрос ≈ ${Math.round(tokens / 100) / 10} тыс. токенов — на локальной модели это может занять минуту-две; ответ появится здесь по мере генерации`);
      return decideTurn(client, sit, {
        signal: abort.signal,
        onDelta: (k, t) => {
          got += t.length;
          if (!t0) t0 = Date.now();
          const sec = (Date.now() - t0) / 1000;
          // скорость — примерно: токен ≈ 3,2 символа
          const speed = sec > 3 ? ` · ≈ ${Math.round(got / 3.2 / sec)} ток/с, ${got} симв.` : '';
          setPhase((fixing ? 'исправляет приказы…' : k === 'reasoning' ? 'размышляет…' : 'пишет решение…') + speed);
          buf += t;
          const now = Date.now();
          if (now - last > 250) { post({ kind: 'ai-stream', text: buf }); buf = ''; last = now; }
        },
        onRetry: (why) => { buf = ''; post({ kind: 'ai-stream', text: '', reset: true }); post({ kind: 'ai-stream', text: `[${why}]\n` }); setPhase('повтор запроса без схемы…'); },
        // приказы, которых не исполнить, — одна просьба исправить их по подсказке
        onRepair: (n) => { fixing = true; t0 = 0; got = 0; post({ kind: 'ai-stream', text: `${buf}\n\n[${n === 1 ? 'приказ не исполнить' : `приказов не исполнить: ${n}`} — исправляет по подсказке]\n` }); buf = ''; setPhase('исправляет приказы…'); },
      });
    });
    if (abort.signal.aborted) return null;
    if (buf) post({ kind: 'ai-stream', text: buf });
    if (t.ok && t.decision) {
      const conv = actionsToStaff(ctx, gAt, sit, t.decision.actions ?? []);
      t.staff = conv.applied;
      t.staffActions = conv.actions;
    }
    status(t.ok ? { state: 'done', time, turn: t } : { state: 'error', time, error: t.error ?? 'нет решения', turn: t });
    cur.result = t;
    return t;
  })();
  // ошибка до запроса (сборка обстановки, справка) — не молчаливое «думает»: статус «ошибка», ход узнает при ожидании
  cur.promise.catch((e) => { if (!abort.signal.aborted) status({ state: 'error', time, error: `обстановка для штаба не собрана: ${(e as Error).message ?? e}` }); });
  ai = cur;
}

/**
 * Справка роли «штаб» и доктрина своей стороны к обстановке (триггеры — по журналу за ход и состоянию войск): запросы
 * по триггерам и местность у ориентира; не больше 5 записей по 700 знаков. Сторона не su/de или ошибка — без базы.
 */
async function staffKb(gAt: GameState): Promise<{ refs: RoleRef[]; rules: DoctrineRule[]; fallback?: boolean } | undefined> {
  const side = cfg.side;
  if (side !== 'su' && side !== 'de') return undefined;
  try {
    const triggers = situationTriggers(ctx, gAt, side);
    const queries = staffQueries(triggers, cfg.anchorName);
    const a = await kbc.request({ queries, scope: { role: 'staff', side, operation: rec.scenario, moment: gAt.state.time }, limit: KB_REF_LIMIT, chars: KB_REF_CHARS,
      doctrine: { side, triggers, query: queries.join(' '), moment: gAt.state.time } });
    return { refs: a.refs, rules: a.doctrine?.rules ?? [], ...(a.fallback ? { fallback: true } : {}) };
  } catch (e) {
    console.warn('справка штабу противника:', e);
    return undefined;
  }
}

/** Доктрина стороны уровней фронта и армии — Ставке (ОКХ): по поводу обращения; ошибка — без доктрины. */
async function stavkaKb(side: string, need: StavkaNeed): Promise<{ rules: DoctrineRule[]; fallback?: boolean } | undefined> {
  if (side !== 'su' && side !== 'de') return undefined;
  try {
    const a = await kbc.request({ queries: [], scope: { role: 'stavka', side, operation: rec.scenario, moment: g.state.time },
      doctrine: { side, triggers: [], query: need.reasons.join(' '), levels: ['front', 'army'], moment: g.state.time } });
    return { rules: a.doctrine?.rules ?? [], ...(a.fallback ? { fallback: true } : {}) };
  } catch (e) {
    console.warn('доктрина Ставке:', e);
    return undefined;
  }
}

const llmClient = () => new LlmClient({ url: absolute(llm.url), model: llm.model, thinking: llm.thinking, timeoutMs: 15 * 60_000, maxTokens: 16000 }, fetch.bind(globalThis));
/** Советник: своя модель и размышление, если выбраны в его панели. */
/** Штаб противника: своя модель, если выбрана в «Посреднике», иначе — как в «ИИ». */
const enemyClient = () => new LlmClient({ url: absolute(llm.url), model: llm.enemyModel || llm.model, thinking: llm.enemyThinking ?? llm.thinking, timeoutMs: 15 * 60_000, maxTokens: 16000 }, fetch.bind(globalThis));
const advisorClient = () => new LlmClient({ url: absolute(llm.url), model: llm.advModel || llm.model, thinking: llm.advThinking ?? llm.thinking, timeoutMs: 15 * 60_000, maxTokens: 16000 }, fetch.bind(globalThis));

/** Вопрос советнику: ответ потоком, предложенные приказы — с целью на карте, готовые к распоряжению. */
let adviseAbort: AbortController | null = null;
async function adviseReq(m: Extract<GameRequest, { kind: 'advise' }>) {
  const done = (result: AdviceView) => post({ kind: 'advice', id: m.id, result });
  if (!cfg.advisor) return done({ ok: false, error: 'для этого сценария советник не настроен', answer: '', basis: [], unknowns: [], followUps: [], suggestions: [] });
  const t0 = Date.now();
  const built = buildAdvice(ctx, g, history, cfg.advisor, { system: advisorSystemTpl, user: advisorUserTpl, profile: advisorProfile },
    { category: m.category, topic: m.topic, question: m.question, draft: m.draft, thread: m.thread, reference: m.reference,
      goal: `${end.victory.title}; поражение — численность ниже ${Math.round(end.defeat.strengthBelow * 100)} % исходной или ${end.defeat.deadlineText}` }, cfg.description);
  let buf = '', last = 0;
  if (busyWho()) post({ kind: 'advice-wait', id: m.id, text: `ждёт очереди: модель занята (${busyWho()})…` });
  adviseAbort?.abort();
  const abort = adviseAbort = new AbortController();
  const r = await exclusive('вопрос советнику', () => abort.signal.aborted ? Promise.resolve({ ok: false, error: 'остановлено', answer: '', basis: [], unknowns: [], suggestions: [], followUps: [], issues: [] }) : advise(advisorClient(), g, built, {
    signal: abort.signal,
    onAnswer: (d) => { buf += d; const now = Date.now(); if (now - last > 200) { post({ kind: 'advice-stream', id: m.id, text: buf }); buf = ''; last = now; } },
  }));
  if (adviseAbort === abort) adviseAbort = null;
  if (abort.signal.aborted) r.error = 'остановлено';
  if (buf) post({ kind: 'advice-stream', id: m.id, text: buf });
  const byId = new Map(g.state.formations.map((f) => [f.id, f]));
  const names = new Map([...ctx.scenario.formations.map((f) => [f.id, f.name] as const), ...g.state.formations.map((f) => [f.id, f.name] as const)]);
  done({
    ok: r.ok, error: r.error, answer: r.answer, followUps: r.followUps, seconds: Math.round((Date.now() - t0) / 1000),
    basis: r.basis, unknowns: r.unknowns, warning: r.warning, rewritten: r.rewritten,
    suggestions: r.suggestions.map((x) => ({
      formation: x.order?.formation ?? '', name: x.order ? names.get(x.order.formation)! : x.given.formation, task: x.given.task,
      target: x.order?.target ?? null, targetText: x.target ?? describeTarget(ctx, x.order?.target, names),
      at: x.order ? targetPoint(ctx, x.order.target, byId) : null, why: x.given.why, issue: x.issue, ok: !!x.order,
    })),
  });
}

let planAbort: AbortController | null = null;
const short = (n: string) => n.replace(/\s*\(.*?\)\s*/g, ' ').trim();

/** Варианты решения на ход: каждый вариант — как только модель его дописала; приказы и распоряжения сопоставлены с обстановкой. */
async function planReq(m: Extract<GameRequest, { kind: 'plan' }>) {
  const fail = (error: string) => post({ kind: 'plan-done', id: m.id, ok: false, error });
  if (!cfg.advisor) return fail('для этого сценария советник не настроен');
  const t0 = Date.now(), gAt = g, side = rec.human;
  const built = buildAdvice(ctx, g, history, cfg.advisor, { system: advisorSystemTpl, user: advisorUserTpl, profile: advisorProfile },
    { category: 'plan', topic: 'Решение › Варианты решения на ход', question: `Предложите ${m.count === 1 ? 'вариант' : `${m.count} варианта`} решения на этот ход: оценка, замысел противника, решение, риски, донесение, приказы войскам, распоряжения по тылу, переправам, резервам и полосам (разграничительные линии между армиями).`,
      draft: m.draft, thread: [], reference: m.reference,
      goal: `${end.victory.title}; поражение — численность ниже ${Math.round(end.defeat.strengthBelow * 100)} % исходной или ${end.defeat.deadlineText}` }, cfg.description);
  const st = gAt.state, lg = st.logistics?.[side];
  const sit: Situation = {
    messages: [], time: st.time, areas: built.parts.areas, allAreas: built.parts.allAreas, enemies: built.parts.enemies,
    formations: built.parts.formations.filter((f) => built.parts.own.find((u) => u.id === f.id)!.status !== 'destroyed'),
    staff: { side, bases: (lg?.bases ?? []).map((b) => ({ id: b.id, name: b.name })), reserves: st.formations.filter((f) => f.side === side && f.reserveFrom && !f.destroyed).map((f) => ({ id: f.id, name: f.name })) },
  };
  const byId = new Map(st.formations.map((f) => [f.id, f]));
  // названия — и штабов (на агентной модели армии и корпуса — не формирования состояния, но приказы им отдаются)
  const names = new Map([...ctx.scenario.formations.map((f) => [f.id, f.name] as const), ...st.formations.map((f) => [f.id, f.name] as const)]);
  const KIND = { base: 'база', priority: 'приоритет подвоза', bridge: 'переправа', demolish: 'подрыв моста', commit: 'ввод резерва', line: 'разграничительная линия' } as const;
  const view = (v: PlanVariantRaw): PlanVariantView => {
    const conv = planOrdersApplied(v.orders, sit);
    const staff = actionsToStaff(ctx, gAt, sit, v.actions);
    const acts: PlanActView[] = staff.applied.map((x, i) => {
      const a = x.action, gv = x.given;
      const given = `${KIND[gv.kind] ?? gv.kind}${gv.subject ? `: ${gv.subject}` : ''}${gv.area ? ` — ${gv.area}` : ''}${gv.formations?.length ? ` — ${gv.formations.join(', ')}` : ''}`;
      if (!a) return { key: `x:${i}`, action: null, label: given, text: x.text, given, ok: false };
      if (a.kind === 'base') { const b = lg?.bases.find((y) => y.id === a.base); return { key: `base:${a.base}`, action: a, label: `База «${b?.name ?? a.base}»`, text: x.text, at: a.to, from: b?.at, given, ok: true }; }
      if (a.kind === 'priority') return { key: 'priority', action: a, label: `Приоритет подвоза${a.formations.length ? `: ${a.formations.map((f) => short(names.get(f) ?? f)).join(', ')}` : ''}`, text: x.text, given, ok: true };
      if (a.kind === 'bridge') return { key: `bridge:plan${i}`, action: a, label: 'Переправа', text: x.text, at: a.at, given, ok: true };
      if (a.kind === 'demolish') return { key: `demolish:plan${i}`, action: a, label: 'Подрыв моста', text: x.text, at: a.at, given, ok: true };
      if (a.kind === 'boundary' || a.kind === 'directive') return { key: `boundary:${a.a}|${a.b}`, action: a, label: 'Разграничительная линия', text: x.text, at: a.line[0], given, ok: true };
      const nm = short(names.get(a.formation) ?? a.formation), grp = gv.subject && short(gv.subject) !== nm ? `${short(gv.subject)}: ` : '';
      return { key: `commit:${a.formation}`, action: a, label: `${grp}${nm}`, text: x.text, at: a.at, given, ok: true };
    });
    return {
      title: v.title, idea: v.idea,
      decision: { assessment: v.assessment, enemyIntent: v.enemyIntent, intent: v.intent, risks: v.risks, report: v.report },
      // номер приказа в варианте — по исходному приказу (приказы «всем» в сопоставлении идут последними)
      orders: conv.applied.map((x) => conv.given.indexOf(x.given)).map((i, j) => { const x = conv.applied[j]; return {
        formation: x.order?.formation ?? '', name: x.order ? names.get(x.order.formation)! : v.orders[i].formation, task: v.orders[i].task,
        target: x.order?.target ?? null, targetText: x.target ?? describeTarget(ctx, x.order?.target, names),
        at: x.order ? targetPoint(ctx, x.order.target, byId) : null, why: v.orders[i].why, ok: !!x.order,
        // почему исправление по подсказке отклонено — к замечанию приказа
        issue: [x.issue, ...(v.fix?.notes ?? []).filter((nt) => nt.n === i + 1).map((nt) => nt.text)].filter(Boolean).join('; ') || undefined,
      }; }),
      acts,
      ...(v.fix ? { fix: v.fix } : {}),
    };
  };
  planAbort?.abort();
  const abort = planAbort = new AbortController();
  if (busyWho()) post({ kind: 'plan-progress', id: m.id, text: `ждёт очереди: модель занята (${busyWho()})…` });
  let last = 0;
  const r = await exclusive('варианты решения', () => {
    post({ kind: 'plan-progress', id: m.id, text: 'советник готовит варианты…' });
    return planVariants(advisorClient(), gAt, built, m.count, {
      thinking: llm.advThinking ?? llm.thinking, signal: abort.signal,
      onVariant: (v, index) => post({ kind: 'plan-variant', id: m.id, index, variant: view(v) }),
      // приказы вариантов, которых не исполнить, — одна общая просьба исправить их по подсказке; затем исправленные варианты заново
      sit, onRepair: (idx) => post({ kind: 'plan-progress', id: m.id, text: `исправляет приказы ${idx.length === 1 ? `варианта ${idx[0] + 1}` : `вариантов ${idx.map((i) => i + 1).join(', ')}`} по подсказке…` }),
      onProgress: (p) => {
        const now = Date.now();
        if (now - last < 300) return;
        last = now;
        post({ kind: 'plan-progress', id: m.id, text: p.content ? `пишет варианты… ${p.content.toLocaleString('ru')} знаков` : `размышляет… ${p.tail.replace(/\s+/g, ' ').slice(-160)}` });
      },
    });
  });
  if (planAbort === abort) planAbort = null;
  post({ kind: 'plan-done', id: m.id, ok: r.ok, error: abort.signal.aborted ? 'остановлено' : r.error, warning: r.warning, model: r.model, seconds: Math.round((Date.now() - t0) / 1000) });
}

const absolute = (u: string) => (/^https?:/.test(u) ? u : new URL(u, self.location.origin).href).replace(/\/+$/, '');
const status = (s: AiStatus) => post({ kind: 'ai', status: s });

async function advance() {
  if (busy || !queued || isOver()) return;
  releaseAi(); // ход отдан раньше, чем посредник договорил, — штабу противника решать сейчас
  busy = true;
  try {
    let t: AiTurn | null = null;
    let kbFallback = false;
    if (ai && enemy === 'llm') {
      post({ kind: 'progress', text: 'штаб противника заканчивает решение…' });
      const cur = ai;
      t = await cur.promise;
      if (cur.kbFallback) kbFallback = true;
      if (!t) return; // решение отменено (смена настроек) — ход ждёт нового
      if (!t.ok && !skipAi) { post({ kind: 'blocked', error: t.error ?? 'модель не дала решения' }); return; }
    }
    const humanOrders = queued.orders.map((o) => ({ ...o, issuedAt: g.state.time, source: 'human' as const }));
    const actions = [...queued.actions.map((a) => ({ ...a, issuedAt: g.state.time })), ...(t?.ok ? t.staffActions ?? [] : [])];
    const aiOrders = t?.ok ? t.orders : [];
    const orders = [...humanOrders, ...aiOrders];
    // посредник: нюансы к ожидаемым боям (по справкам из базы знаний); ошибка модели — ход без поправок
    let ump: Awaited<ReturnType<typeof umpireTurn>> | null = null;
    if (llm.umpire && !agents) {
      post({ kind: 'progress', text: 'посредник оценивает ожидаемые бои…' });
      const refsFor = umpireRefs(kbc, rec.scenario, () => { kbFallback = true; });
      ump = await exclusive('посредник', () => umpireTurn(llmClient(), ctx, g.state, refsFor, { system: umpireSystemTpl, user: umpireUserTpl }, { thinking: 'off' }));
    }
    // Ставка: разграничительные линии между фронтами — если есть повод (обстановка разошлась с историей, войска в
    // полосе соседа, ходатайство); директивы — распоряжения хода, ответ — в журнал
    const stavka: (StavkaResult & { side: string })[] = [];
    if (llm.stavka !== false && (enemy === 'llm' || (llm.umpire && !agents))) {
      for (const side of [rec.human, rec.ai]) {
        const need = stavkaNeed(ctx, g, side, side === rec.human ? queued.decision?.request ?? '' : '');
        if (!need) continue;
        const top = commandTerms(ctx, side).top;
        post({ kind: 'progress', text: `${top} — разграничительные линии…` });
        const kbIn = await stavkaKb(side, need);
        if (kbIn?.fallback) kbFallback = true;
        const r = await exclusive(top, () => stavkaTurn(llmClient(), ctx, g, side, need, kbIn ? { kb: { rules: kbIn.rules } } : {}));
        stavka.push({ ...r, side });
        actions.push(...r.actions);
      }
    }
    rec.turns.push({ time: g.state.time, orders, actions, human: queued.decision, ...(queued.command.length ? { command: queued.command } : {}), ...(stavka.length ? { stavka } : {}), ...(t ? { ai: slim(t) } : {}),
      ...(ump?.mods.length ? { umpire: ump.mods } : {}),
      ...(ump ? { umpireNote: { ok: ump.ok, error: ump.error, assessment: ump.assessment, issues: ump.issues, proposed: ump.proposed, engagements: ump.engagements, refs: ump.refs.map((r) => ({ id: r.id, title: r.title })), seconds: ump.seconds,
        names: Object.fromEntries(ump.mods.flatMap((m) => m.formations).map((id) => [id, g.state.formations.find((f) => f.id === id)?.name ?? id])) } } : {}) });
    post({ kind: 'progress', text: 'расчёт хода…' });
    const before = g.state;
    if (agents) {
      post({ kind: 'progress', text: `агентная модель: ход ${agents.turnHours} ч…` });
      const r = await agentTurn(orders, actions, queued.command);
      journal.push(day(before.time, orders, before, r.results.filter((x) => x.action.side === rec.human), queued.decision, stavka.filter((x) => x.side === rec.human), r.events));
    } else {
      const r = playTurn(ctx, g, orders, actions, ump?.mods ?? []);
      g = r;
      journal.push(day(before.time, orders, before, r.results, queued.decision, stavka.filter((x) => x.side === rec.human)));
    }
    if (kbFallback) journal[journal.length - 1].events.push(KB_FALLBACK_NOTE);
    outcome = gameOutcome(ctx, history, g, end, rec.human, baseStrength);
    queued = null;
    postView();
    post({ kind: 'record', record: rec });
    holdAi(); // штаб противника — после доклада посредника (umpire-done) или через UMPIRE_HOLD_MS
  } finally {
    busy = false;
  }
}

/* ───────────── разбор операции ───────────── */

/** Данные игры для разбора: ходы (решения, приказы, распоряжения, события, противник, посредник), силы, события. */
function reviewInput(): ReviewInput {
  const s = g.state, human = rec.human;
  const sideName = (id: string) => ctx.scenario.sides.find((x) => x.id === id)!.name;
  const at0 = g.snapshots.find((x) => x.time >= rec.takeover) ?? g.snapshots[0];
  const now = g.snapshots[g.snapshots.length - 1];
  const forceRows = s.formations.filter((f) => (f.echelon === 'army' || f.echelon === 'corps') && at0.units.some((u) => u.id === f.id))
    .map((f) => { const a = at0.units.find((u) => u.id === f.id)!, b = now.units.find((u) => u.id === f.id);
      return { side: f.side === human ? 'own' as const : 'enemy' as const, echelon: f.echelon, name: f.name, start: a.personnel, now: b?.personnel ?? 0, tanksStart: a.tanks, tanksNow: b?.tanks ?? 0, cutOff: !!b?.cutOff, destroyed: !!b?.destroyed || f.destroyed }; });
  // у агентной модели десятки корпусов — армии идут первыми, чтобы корпуса их не вытеснили
  const forces = topForces(forceRows, 48).map(({ echelon: _e, ...x }) => x);
  const goals = checkEvents(ctx, { final: s, snapshots: g.snapshots }, history).map((r) => ({ title: r.title, historical: r.historical, simulated: r.simulated, days: r.days }));
  return {
    scenario: ctx.scenario.name, side: sideName(human), enemy: sideName(rec.ai), takeover: rec.takeover, now: s.time,
    outcome: outcome ? `${outcome.result === 'victory' ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ'} — ${outcome.text}` : 'игра не окончена',
    victory: end.victory.title, strength: { start: 1, now: baseStrength ? sideStrength(s, human) / baseStrength : 1 }, goals, forces,
    turns: rec.turns.map((t, i) => {
      const j = journal[i];
      const ai = t.ai as AiTurn | undefined;
      return {
        time: t.time, decision: t.human as ReviewInput['turns'][number]['decision'],
        orders: j?.orders ?? [], actions: j?.actions ?? [], events: j?.events ?? [],
        ...(ai?.decision ? { enemy: { intent: ai.decision.intent, orders: ai.applied.filter((a) => a.order).map((a) => `${a.formation ?? a.given.formation}: ${TASK_RU[a.given.task as keyof typeof TASK_RU] ?? a.given.task} — ${a.target ?? a.given.area}`) } } : {}),
        ...(t.umpire?.length ? { umpire: t.umpire.map((m) => `${m.reason} (×${m.mult})`) } : {}),
      };
    }),
  };
}

let reviewAbort: AbortController | null = null;
const reviewClient = () => new LlmClient({ url: absolute(llm.url), model: llm.revModel || llm.model, thinking: llm.revThinking ?? llm.thinking, timeoutMs: 20 * 60_000, maxTokens: 16000 }, fetch.bind(globalThis));

/** Раздел разбора: модель пишет по сводке игры; текст — потоком; запросы — в общей очереди к модели. */
async function reviewSection(m: Extract<GameRequest, { kind: 'review-section' }>) {
  const sec = REVIEW_SECTIONS.find((x) => x.id === m.section);
  if (!sec) return post({ kind: 'review-done', id: m.id, ok: false, text: '', error: `нет раздела ${m.section}` });
  reviewAbort ??= new AbortController();
  const signal = reviewAbort.signal;
  const t0 = Date.now();
  const digest = reviewDigest(reviewInput());
  if (busyWho()) post({ kind: 'review-wait', id: m.id, text: `ждёт очереди: модель занята (${busyWho()})…` });
  let buf = '', last = 0, rbuf = '', rlast = 0;
  try {
    const r = await exclusive('разбор операции', () => reviewClient().chat({
      messages: reviewMessages(sec, digest, { scenario: ctx.scenario.name, side: ctx.scenario.sides.find((x) => x.id === rec.human)!.name }, m.done), signal,
      onDelta: (k, t) => { if (k !== 'content') { rbuf += t; const now = Date.now(); if (now - rlast > 300) { rlast = now; post({ kind: 'review-think', id: m.id, text: rbuf }); rbuf = ''; } return; } buf += t; const now = Date.now(); if (now - last > 200) { post({ kind: 'review-stream', id: m.id, text: buf }); buf = ''; last = now; } },
    }));
    if (rbuf) post({ kind: 'review-think', id: m.id, text: rbuf });
    if (buf) post({ kind: 'review-stream', id: m.id, text: buf });
    post({ kind: 'review-done', id: m.id, ok: true, text: r.content, model: r.model, seconds: Math.round((Date.now() - t0) / 1000) });
  } catch (e) {
    post({ kind: 'review-done', id: m.id, ok: false, text: '', error: signal.aborted ? 'остановлено' : (e as Error).message });
    if (signal.aborted) reviewAbort = null;
  }
}

/**
 * Справка из базы знаний: просит окно (слой пользователя, закрепления, смысловой поиск), ждёт до 8 с; иначе — по
 * встроенному сиду (без слоя пользователя).
 */
let seedEntries: Promise<Entry[]> | null = null;
const seedKb = () => (seedEntries ??= import('../../../../packages/knowledge/data/seed.json').then((m) => (m.default as unknown as { entries: Entry[] }).entries));
const kbc = kbRefClient(post, async (req) => seedAnswer(await seedKb(), req));

/** Решение модели для записи игры: без длинного размышления. */
const slim = (t: AiTurn): AiTurn => ({ ...t, reasoningTail: t.reasoningTail?.slice(-1500) });

/** Туман войны: противник виден, пока он в пределах разведки наших войск (на момент снимка). */
function fog() {
  const km = detectKm(ctx);
  const sideOf = new Map(g.state.formations.map((f) => [f.id, f.side]));
  const cache = new Map<string, Set<string>>();
  return (id: string, sn: Snapshot) => {
    let set = cache.get(sn.time);
    if (!set) {
      const units = sn.units.filter((u) => !u.destroyed);
      set = detected(ctx.theatre, units.filter((u) => sideOf.get(u.id) === rec.human), units.filter((u) => sideOf.get(u.id) !== rec.human), km);
      cache.set(sn.time, set);
    }
    return sideOf.get(id) === rec.human || set.has(id);
  };
}

function postView() {
  const s = g.state;
  const human = rec.human;
  const sideName = (id: string) => ctx.scenario.sides.find((x) => x.id === id)!.name;
  const run = { final: s, snapshots: g.snapshots };
  const doc = runToDocument({ ...ctx, scenario: withBoundaries(ctx.scenario, g.state) }, run, history, { name: `Игра: ${ctx.scenario.name} (с ${ddmm(rec.takeover)})`, ownSide: human, visible: reveal ? undefined : fog(), ...(agents ? { frontCombine: 'max' as const } : {}) });
  for (const l of doc.layers) if (l.id.startsWith('hist-')) l.visible = false;
  // реки театра — для выбора мест переправ (большие — толще)
  doc.layers.unshift({ id: 'rivers', name: 'Театр: реки', role: 'base', visible: true, locked: true, opacity: 0.85 });
  for (const rv of ctx.theatre.data.rivers) {
    if (rv.line.length < 2) continue;
    const f = createFeature('line', 'inf.river', { points: rv.line, layerId: 'rivers' }, rv.major ? 1.3 : 0.7);
    f.name = rv.name;
    doc.features.unshift(f);
  }
  // тыл: базы снабжения (действующие и переносимые)
  const lg = s.logistics?.[human];
  doc.layers.push({ id: 'logistics', name: 'Тыл: базы снабжения', role: 'custom', visible: true, locked: true, opacity: 1 });
  for (const b of lg?.bases ?? []) {
    const f = createFeature('symbol', 'rkka.supplyStation', { at: b.at, layerId: 'logistics' }, 0.9, 'own') as SymbolFeature;
    f.name = `База снабжения: ${b.name}${b.activeFrom && b.activeFrom > s.time ? ` (переносится, заработает ${ddmm(b.activeFrom)})` : ''}`;
    f.time = { from: s.time, to: null };
    doc.features.push(f);
  }
  const goals = checkEvents(ctx, run, history).map((r) => {
    const ev = history.events?.find((x) => x.id === r.id);
    const place = ev && 'place' in ev ? ctx.theatre.area(ev.place)?.center ?? null : null;
    return { title: r.title, historical: r.historical, simulated: r.simulated, days: r.days, at: r.at, place };
  });
  const prof = ctx.profiles[ctx.scenario.sides.find((x) => x.id === human)!.profile];
  const own = agents ? (() => { const d = unitReports(ctx, s, human, g.prev); return [...hqReports(ctx, d, human), ...d]; })() : unitReports(ctx, s, human, g.prev);
  const view: TurnView = {
    engine: agents ? 'agents' : 'army',
    scenario: ctx.scenario.id, scenarioName: ctx.scenario.name, rules: ctx.rules.id, seed: rec.seed,
    start: ctx.scenario.start, end: ctx.scenario.end, takeover: rec.takeover, time: s.time, turnHours: ctx.scenario.turnHours,
    turn: rec.turns.length + 1, over: isOver(), outcome, victory: end.victory.title, deadline: end.defeat.deadline, strength: baseStrength ? sideStrength(s, human) / baseStrength : 1, strengthBelow: end.defeat.strengthBelow,
    human: { id: human, name: sideName(human) }, ai: { id: rec.ai, name: sideName(rec.ai) },
    // группы докладов — объединения верхнего уровня (в агентной модели штабы всех уровней без типа — берём фронты)
    groups: ctx.scenario.formations.filter((f) => f.side === human && !f.type && (!agents || f.echelon === 'front')).map((f) => ({ id: f.id, name: f.name })),
    terms: commandTerms(ctx, human),
    own,
    intel: intelReport(ctx, s, human, g.prev),
    events: journal.length ? journal[journal.length - 1].events : [],
    ...turnMapView(),
    places: places(ctx.theatre).map((p) => ({ id: p.id, title: p.title, at: p.at })),
    delays: prof.orderDelayHours as Record<string, number>,
    detectKm: Math.round(detectKm(ctx)),
    goals, journal, doc,
    ...logisticsView(),
    ...sectorsView(),
    reserveGroups: reserveGroupsView(own),
    lastDecision: (([...rec.turns].reverse().find((t) => t.human)?.human) as HumanDecision | undefined) ?? null,
    ...(agents && agentTrace ? { command: commandView(agentTrace, human) ?? undefined } : {}),
  };
  post({ kind: 'view', view });
}

/** Разбор хода на карте: бои хода с местом и зоны влияния сторон на конец и начало хода (с туманом войны, как карта). */
function turnMapView(): Pick<TurnView, 'battles' | 'zones' | 'zonesPrev'> {
  const s = g.state, prev = g.prev, human = rec.human;
  const battles = prev ? turnBattles(ctx, s, human, prev) : [];
  try {
    return {
      battles,
      zones: sideZones(ctx, s, human, { reveal, contested: battles.map((b) => b.at) }),
      zonesPrev: prev && rec.turns.length ? sideZones(ctx, prev, human, { reveal }) : null,
    };
  } catch { return { battles, zones: null, zonesPrev: null }; } // зоны — картинка: без неё игра идёт
}

/** Резервы и прибывающие войска стороны человека — по армиям (в агентной модели резерв — дивизии армии, вводятся вместе). */
function reserveGroupsView(own: TurnView['own']): TurnView['reserveGroups'] {
  const armyOf = groupOf(ctx.scenario, 'army'), frontOf = groupOf(ctx.scenario, 'front');
  const name = (id: string) => ctx.scenario.formations.find((f) => f.id === id)?.name ?? id;
  const out = new Map<string, TurnView['reserveGroups'][number]>();
  for (const u of own) {
    if (u.status !== 'reserve' && u.status !== 'arriving') continue;
    const a = armyOf.get(u.id) ?? u.id, k = `${u.status}:${a}`;
    const fr = frontOf.get(u.id);
    if (!out.has(k)) out.set(k, { id: a, name: name(a), status: u.status, front: fr && fr !== a ? name(fr) : null, members: [] });
    out.get(k)!.members.push(u.id);
  }
  return [...out.values()];
}

/** Полосы стороны человека: словами (вкладка «Приказы») и действующие линии с объединениями формирований — для проверки цели приказа. */
function sectorsView(): Pick<TurnView, 'sectors' | 'boundaries' | 'groupOf' | 'armies'> {
  const s = g.state, human = rec.human;
  const nm = (id: string) => shortName(s.formations.find((f) => f.id === id)?.name ?? ctx.scenario.formations.find((f) => f.id === id)?.name ?? id);
  const units = s.formations.filter((f) => onMap(f, s.time)).map((f) => ({ id: f.id, side: f.side, at: f.position }));
  const groups = groupOf(ctx.scenario, 'front');
  const scen = withBoundaries(ctx.scenario, s);
  return {
    sectors: sectorText(ctx.theatre, scen, units, human, s.time, nm),
    boundaries: activeBoundaries(scen, s.time, human).map((b) => ({ right: b.right, left: b.left, rightName: nm(b.right), leftName: nm(b.left), title: b.title, line: b.line })),
    groupOf: Object.fromEntries(s.formations.filter((f) => f.side === human).map((f) => [f.id, groups.get(f.id) ?? f.id])),
    // армии стороны с живыми войсками: у Красной армии армия — сама действующее объединение, у вермахта — штаб над корпусами
    armies: (() => {
      const armyOf = groupOf(ctx.scenario, 'army');
      return ctx.scenario.formations.filter((f) => f.side === human && f.echelon === 'army' && s.formations.some((u) => !u.destroyed && onMap(u, s.time) && (armyOf.get(u.id) ?? u.id) === f.id))
        .map((f) => {
          // середина войск армии (по численности) — для подсказки линии между соседями
          const l = s.formations.filter((u) => !u.destroyed && onMap(u, s.time) && (armyOf.get(u.id) ?? u.id) === f.id);
          const P = l.reduce((x, u) => x + u.personnel, 0) || 1;
          const at: LngLat = [l.reduce((x, u) => x + u.position[0] * u.personnel, 0) / P, l.reduce((x, u) => x + u.position[1] * u.personnel, 0) / P];
          return { id: f.id, name: f.name, group: groups.get(f.id) ?? f.id, at };
        });
    })(),
  };
}

/** Тыл и переправы стороны человека — для вкладки «Приказы». */
function logisticsView() {
  const s = g.state, human = rec.human, T = ctx.theatre;
  const lg = s.logistics?.[human];
  const k = ctx.scenario.sides.findIndex((x) => x.id === human);
  const bases = (lg?.bases ?? []).map((b) => ({
    id: b.id, name: b.name, at: b.at, activeFrom: b.activeFrom,
    state: (b.activeFrom && b.activeFrom > s.time ? 'moving' : b.moved && s.territory && s.territory[T.indexOf(b.at)] !== k ? 'idle' : 'active') as 'active' | 'moving' | 'idle',
  }));
  const sh = supplyHoursOf(ctx, s, human);
  const supplyHours: Record<string, number | null> = {};
  for (const [id, h] of sh.hours) supplyHours[id] = Number.isFinite(h) ? Math.round(h) : null;
  const n = s.formations.filter((f) => f.side === human && onMap(f, s.time)).length;
  const prof = ctx.profiles[ctx.scenario.sides.find((x) => x.id === human)!.profile];
  const bridges = T.data.bridges.filter((b) => b.side === human).map((b) => ({
    id: b.id, name: b.name ?? describePlace(T, b.at), at: b.at, openFrom: b.openFrom ?? null, building: !!b.openFrom && b.openFrom > s.time,
  }));
  return { bases, priority: lg?.priority ?? [], priorityMax: Math.max(1, Math.ceil(n / 3)), supplyHours, rangeHours: sh.rangeHours, bridges, parks: prof.engineering?.parks ?? 3 };
}
