/**
 * Игра в фоновом потоке браузера. С момента передачи командования советской
 * стороной командует человек, немецкой — штаб на модели (LM Studio). Обе стороны
 * решают одновременно, по одной и той же обстановке на утро хода: как только ход
 * посчитан, модели уходит её обстановка, а человек тем временем читает доклады и
 * пишет приказы. «Провести ход» — дождаться решения модели, отдать приказы обеих
 * сторон и посчитать ход арбитром.
 */
import { createFeature, type SymbolFeature } from '@def-ops/core';
import {
  checkAction, checkEvents, contextFrom, dayEvents, describePlace, describeTarget, detected, detectKm, gameOutcome, intelReport, sideStrength, onMap, places, playTurn,
  runToDocument, startGame, supplyHoursOf, targetPoint, TASK_RU, unitReports, type GameRecord, type GameState, type History, type Order, type SimContext, type Snapshot, type StaffAction, type GameEnd, type GameOutcome,
} from '@def-ops/sim';
import catalogFile from '../../../../packages/sim/data/scenarios/catalog.json';
import { actionsToStaff, advise, buildAdvice, buildSituation, decideTurn, decisionToOrders, planVariants, type PlanVariantRaw, type Situation, umpireTurn, REVIEW_SECTIONS, reviewDigest, reviewMessages, type ReviewInput, type AdvisorConfig, type AiTurn, type LiveConfig, type UmpireRef } from '@def-ops/staff-service/live';
import { category, gather, Index, type Entry } from '@def-ops/knowledge';
import umpireSystemTpl from '../../../../services/staff/prompts/umpire.system.md?raw';
import umpireUserTpl from '../../../../services/staff/prompts/umpire.user.md?raw';
import { LlmClient } from '@def-ops/staff-service/llm';
import systemTpl from '../../../../services/staff/prompts/staff.system.md?raw';
import liveTpl from '../../../../services/staff/prompts/staff.live.md?raw';
import advisorSystemTpl from '../../../../services/staff/prompts/advisor.system.md?raw';
import advisorUserTpl from '../../../../services/staff/prompts/advisor.user.md?raw';
import type { AdviceView, PlanActView, PlanVariantView, AiStatus, EnemyMode, GameRequest, GameResponse, HumanDecision, JournalDay, LlmSettings, TurnView } from './game-protocol';

const files = import.meta.glob('../../../../packages/sim/data/{scenarios,theatres,profiles,rules}/*.json', { import: 'default' });
const profilesMd = import.meta.glob('../../../../services/staff/profiles/*.md', { query: '?raw', import: 'default' });
const liveCfg = import.meta.glob('../../../../services/staff/live/*.json', { import: 'default' });
const get = async (kind: string, file: string) => {
  const load = files[`../../../../packages/sim/data/${kind}/${file}`];
  if (!load) throw new Error(`нет файла данных ${kind}/${file}`);
  return load();
};

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
let ai: { time: string; promise: Promise<AiTurn | null>; abort: AbortController; result?: AiTurn | null } | null = null;
let skipAi = false;
/** Приказы, распоряжения и решение человека, ждущие решения модели. */
let queued: { orders: Order[]; actions: StaffAction[]; decision: HumanDecision } | null = null;
let busy = false;
/** Условия окончания игры и численность стороны человека при передаче командования. */
let end: GameEnd;
let baseStrength = 0;
let outcome: GameOutcome | null = null;
const isOver = () => !!outcome;

const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`;

self.onmessage = async (e: MessageEvent<GameRequest>) => {
  const m = e.data;
  try {
    if (m.kind === 'start') await start(m.start, m.record, m.llm, m.enemy);
    else if (m.kind === 'turn') { queued = { orders: m.orders, actions: m.actions, decision: m.decision }; await advance(); }
    else if (m.kind === 'check') post({ kind: 'check', id: m.id, result: checkAction(ctx, g.state, { ...m.action, issuedAt: g.state.time }, m.pendingBridges) });
    else if (m.kind === 'settings') {
      const was = enemy;
      llm = m.llm; enemy = m.enemy;
      if (was !== enemy) startAi();
    } else if (m.kind === 'review-section') void reviewSection(m);
    else if (m.kind === 'review-stop') reviewAbort?.abort();
    else if (m.kind === 'retry-ai') { startAi(); if (queued) await advance(); }
    else if (m.kind === 'skip-ai') { skipAi = true; if (queued) await advance(); }
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

async function start(s: { scenario: string; rules: string; seed: number; takeover: string }, record: GameRecord | undefined, l: LlmSettings, en: EnemyMode) {
  llm = l; enemy = en;
  post({ kind: 'progress', text: 'загрузка данных…' });
  ({ ctx, history } = await contextFrom(get as never, s.scenario, s.rules));
  const cfgLoad = liveCfg[`../../../../services/staff/live/${s.scenario}.json`];
  if (!cfgLoad) throw new Error(`для сценария ${s.scenario} нет настроек штаба модели (services/staff/live/${s.scenario}.json)`);
  cfg = (await cfgLoad()) as LiveConfig;
  profileMd = (await profilesMd[`../../../../services/staff/profiles/${cfg.profile}.md`]?.()) as string ?? '';
  const human = ctx.scenario.sides.find((x) => x.id !== cfg.side)!.id;
  advisorProfile = cfg.advisor ? ((await profilesMd[`../../../../services/staff/profiles/${cfg.advisor.profile}.md`]?.()) as string ?? '') : '';
  post({ kind: 'progress', text: 'расчёт до передачи командования…' });
  // штаб модели ведёт и тыл, переправы, резервы своей стороны, если противник — модель (решается при передаче командования)
  const aiStaff = record ? !!record.aiStaff : en === 'llm';
  g = startGame(ctx, s.seed, s.takeover, human, aiStaff ? cfg.side : undefined);
  end = ((catalogFile as unknown as { scenarios: { id: string; game: GameEnd }[] }).scenarios.find((x) => x.id === s.scenario)?.game) ?? { victory: { event: '', title: '' }, defeat: { strengthBelow: 0, deadline: ctx.scenario.end, deadlineText: 'время операции вышло' } };
  baseStrength = sideStrength(g.state, human);
  outcome = null;
  rec = record ?? { version: 1, scenario: s.scenario, rules: ctx.rules.id, seed: s.seed, takeover: g.state.time, human, ai: cfg.side, aiStaff, turns: [] };
  journal = [];
  for (const [k, t] of rec.turns.entries()) {
    if (outcome) break;
    post({ kind: 'progress', text: `восстановление игры: ход ${k + 1} из ${rec.turns.length}…` });
    if (t.time !== g.state.time) throw new Error(`запись игры не сходится с расчётом (${t.time} ≠ ${g.state.time})`);
    const before = g.state;
    const r = playTurn(ctx, g, t.orders, t.actions ?? [], t.umpire ?? []);
    g = r;
    journal.push(day(before.time, t.orders, before, r.results, t.human as HumanDecision | undefined));
    outcome = gameOutcome(ctx, history, g, end, rec.human, baseStrength);
  }
  postView();
  post({ kind: 'record', record: rec });
  startAi();
}

/** Запись журнала за ход: наши приказы словами и донесения. */
function day(time: string, orders: Order[], before: GameState['state'], results: { action: StaffAction; ok: boolean; text: string }[], decision?: HumanDecision): JournalDay {
  const names = new Map(before.formations.map((f) => [f.id, f.name]));
  const bases = new Map((before.logistics?.[rec.human]?.bases ?? []).map((b) => [b.id, b.name]));
  const what = (a: StaffAction) => a.kind === 'base' ? `Тыл: база «${bases.get(a.base) ?? a.base}» — перенести ${describePlace(ctx.theatre, a.to)}`
    : a.kind === 'priority' ? `Тыл: приоритет подвоза — ${a.formations.length ? a.formations.map((x) => names.get(x)).join(', ') : 'снят'}`
    : a.kind === 'bridge' ? `Инженерные: навести переправу ${describePlace(ctx.theatre, a.at)}`
    : a.kind === 'demolish' ? `Инженерные: подорвать мост ${describePlace(ctx.theatre, a.at)}`
    : `Резерв Ставки: ввести ${names.get(a.formation)} — район ${describePlace(ctx.theatre, a.at)}`;
  return {
    time,
    orders: orders.filter((o) => o.source === 'human').map((o) => `${names.get(o.formation)}: ${TASK_RU[o.task]} — ${describeTarget(ctx, o.target, names)}${o.note ? `. ${o.note}` : ''}`),
    actions: results.filter((r) => r.action.side === rec.human).map((r) => `${what(r.action)}${r.ok ? ` — ${r.text}` : ` — НЕ ИСПОЛНЕНО: ${r.text}`}`),
    decision,
    events: dayEvents(ctx, g.state, rec.human, before),
  };
}

/**
 * Запросы к модели — по очереди: локальный сервер (особенно MLX) параллельные запросы к одной модели часто не
 * держит (ошибка 500). Штаб противника, советник и посредник ждут друг друга; busy — кто сейчас у модели.
 */
let llmQueue: Promise<unknown> = Promise.resolve();
let llmBusy: string | null = null;
function exclusive<T>(who: string, f: () => Promise<T>): Promise<T> {
  const run = async () => { llmBusy = who; try { return await f(); } finally { llmBusy = null; } };
  const r = llmQueue.then(run, run);
  llmQueue = r.catch(() => undefined);
  return r;
}

function startAi() {
  ai?.abort.abort();
  ai = null;
  skipAi = false;
  if (!g || isOver()) return;
  if (enemy === 'passive') { status({ state: 'off' }); return; }
  const time = g.state.time;
  const prevAi = [...rec.turns].reverse().find((t) => (t.ai as AiTurn | undefined)?.decision);
  const previous = prevAi ? { time: prevAi.time, intent: (prevAi.ai as AiTurn).decision!.intent } : null;
  const sit = buildSituation(ctx, g, cfg, { system: systemTpl, user: liveTpl, profile: profileMd }, previous, !!rec.aiStaff);
  const gAt = g;
  const abort = new AbortController();
  const client = llmClient();
  status({ state: 'thinking', time, since: Date.now() });
  post({ kind: 'ai-stream', text: '', reset: true });
  let buf = '', last = 0;
  const promise = exclusive('решение штаба противника', () => decideTurn(client, sit, {
    signal: abort.signal,
    onDelta: (_k, t) => {
      buf += t;
      const now = Date.now();
      if (now - last > 250) { post({ kind: 'ai-stream', text: buf }); buf = ''; last = now; }
    },
  })).then((t) => {
    if (abort.signal.aborted) return null;
    if (buf) post({ kind: 'ai-stream', text: buf });
    if (t.ok && t.decision) {
      const conv = actionsToStaff(ctx, gAt, sit, t.decision.actions ?? []);
      t.staff = conv.applied;
      t.staffActions = conv.actions;
    }
    status(t.ok ? { state: 'done', time, turn: t } : { state: 'error', time, error: t.error ?? 'нет решения', turn: t });
    if (ai) ai.result = t;
    return t;
  });
  ai = { time, promise, abort };
}

const llmClient = () => new LlmClient({ url: absolute(llm.url), model: llm.model, thinking: llm.thinking, timeoutMs: 15 * 60_000, maxTokens: 16000 }, fetch.bind(globalThis));
/** Советник: своя модель и размышление, если выбраны в его панели. */
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
  if (llmBusy) post({ kind: 'advice-wait', id: m.id, text: `ждёт очереди: модель занята (${llmBusy})…` });
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
  const names = new Map(g.state.formations.map((f) => [f.id, f.name]));
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
    { category: 'plan', topic: 'Решение › Варианты решения на ход', question: `Предложите ${m.count === 1 ? 'вариант' : `${m.count} варианта`} решения на этот ход: оценка, замысел противника, решение, риски, донесение, приказы войскам, распоряжения по тылу, переправам и резервам.`,
      draft: m.draft, thread: [], reference: m.reference,
      goal: `${end.victory.title}; поражение — численность ниже ${Math.round(end.defeat.strengthBelow * 100)} % исходной или ${end.defeat.deadlineText}` }, cfg.description);
  const st = gAt.state, lg = st.logistics?.[side];
  const sit: Situation = {
    messages: [], time: st.time, areas: built.parts.areas, allAreas: built.parts.allAreas, enemies: built.parts.enemies,
    formations: built.parts.formations.filter((f) => built.parts.own.find((u) => u.id === f.id)!.status !== 'destroyed'),
    staff: { side, bases: (lg?.bases ?? []).map((b) => ({ id: b.id, name: b.name })), reserves: st.formations.filter((f) => f.side === side && f.reserveFrom && !f.destroyed).map((f) => ({ id: f.id, name: f.name })) },
  };
  const byId = new Map(st.formations.map((f) => [f.id, f]));
  const names = new Map(st.formations.map((f) => [f.id, f.name]));
  const KIND = { base: 'база', priority: 'приоритет подвоза', bridge: 'переправа', demolish: 'подрыв моста', commit: 'ввод резерва' } as const;
  const view = (v: PlanVariantRaw): PlanVariantView => {
    const conv = decisionToOrders({ orders: v.orders.map((x) => ({ formation: x.formation, task: x.task, area: x.area, toArea: x.toArea, deadline: '', details: x.why })) }, sit, 'human');
    const staff = actionsToStaff(ctx, gAt, sit, v.actions);
    const acts: PlanActView[] = staff.applied.map((x, i) => {
      const a = x.action, gv = x.given;
      const given = `${KIND[gv.kind] ?? gv.kind}${gv.subject ? `: ${gv.subject}` : ''}${gv.area ? ` — ${gv.area}` : ''}${gv.formations?.length ? ` — ${gv.formations.join(', ')}` : ''}`;
      if (!a) return { key: `x:${i}`, action: null, label: given, text: x.text, given, ok: false };
      if (a.kind === 'base') { const b = lg?.bases.find((y) => y.id === a.base); return { key: `base:${a.base}`, action: a, label: `База «${b?.name ?? a.base}»`, text: x.text, at: a.to, from: b?.at, given, ok: true }; }
      if (a.kind === 'priority') return { key: 'priority', action: a, label: `Приоритет подвоза${a.formations.length ? `: ${a.formations.map((f) => short(names.get(f) ?? f)).join(', ')}` : ''}`, text: x.text, given, ok: true };
      if (a.kind === 'bridge') return { key: `bridge:plan${i}`, action: a, label: 'Переправа', text: x.text, at: a.at, given, ok: true };
      if (a.kind === 'demolish') return { key: `demolish:plan${i}`, action: a, label: 'Подрыв моста', text: x.text, at: a.at, given, ok: true };
      return { key: `commit:${a.formation}`, action: a, label: short(names.get(a.formation) ?? a.formation), text: x.text, at: a.at, given, ok: true };
    });
    return {
      title: v.title, idea: v.idea,
      decision: { assessment: v.assessment, enemyIntent: v.enemyIntent, intent: v.intent, risks: v.risks, report: v.report },
      orders: conv.applied.map((x, i) => ({
        formation: x.order?.formation ?? '', name: x.order ? names.get(x.order.formation)! : v.orders[i].formation, task: v.orders[i].task,
        target: x.order?.target ?? null, targetText: x.target ?? describeTarget(ctx, x.order?.target, names),
        at: x.order ? targetPoint(ctx, x.order.target, byId) : null, why: v.orders[i].why, issue: x.issue, ok: !!x.order,
      })),
      acts,
    };
  };
  planAbort?.abort();
  const abort = planAbort = new AbortController();
  if (llmBusy) post({ kind: 'plan-progress', id: m.id, text: `ждёт очереди: модель занята (${llmBusy})…` });
  let last = 0;
  const r = await exclusive('варианты решения', () => {
    post({ kind: 'plan-progress', id: m.id, text: 'советник готовит варианты…' });
    return planVariants(advisorClient(), gAt, built, m.count, {
      thinking: llm.advThinking ?? llm.thinking, signal: abort.signal,
      onVariant: (v, index) => post({ kind: 'plan-variant', id: m.id, index, variant: view(v) }),
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
  busy = true;
  try {
    let t: AiTurn | null = null;
    if (ai && enemy === 'llm') {
      post({ kind: 'progress', text: 'штаб противника заканчивает решение…' });
      t = await ai.promise;
      if (!t) return; // решение отменено (смена настроек) — ход ждёт нового
      if (!t.ok && !skipAi) { post({ kind: 'blocked', error: t.error ?? 'модель не дала решения' }); return; }
    }
    const humanOrders = queued.orders.map((o) => ({ ...o, issuedAt: g.state.time, source: 'human' as const }));
    const actions = [...queued.actions.map((a) => ({ ...a, issuedAt: g.state.time })), ...(t?.ok ? t.staffActions ?? [] : [])];
    const aiOrders = t?.ok ? t.orders : [];
    const orders = [...humanOrders, ...aiOrders];
    // посредник: нюансы к ожидаемым боям (по справкам из базы знаний); ошибка модели — ход без поправок
    let ump: Awaited<ReturnType<typeof umpireTurn>> | null = null;
    if (llm.umpire) {
      post({ kind: 'progress', text: 'посредник оценивает ожидаемые бои…' });
      ump = await exclusive('посредник', () => umpireTurn(llmClient(), ctx, g.state, umpireRefs, { system: umpireSystemTpl, user: umpireUserTpl }, { thinking: 'off' }));
    }
    rec.turns.push({ time: g.state.time, orders, actions, human: queued.decision, ...(t ? { ai: slim(t) } : {}),
      ...(ump?.mods.length ? { umpire: ump.mods } : {}),
      ...(ump ? { umpireNote: { ok: ump.ok, error: ump.error, assessment: ump.assessment, issues: ump.issues, proposed: ump.proposed, engagements: ump.engagements, refs: ump.refs.map((r) => ({ id: r.id, title: r.title })), seconds: ump.seconds,
        names: Object.fromEntries(ump.mods.flatMap((m) => m.formations).map((id) => [id, g.state.formations.find((f) => f.id === id)?.name ?? id])) } } : {}) });
    post({ kind: 'progress', text: 'расчёт хода…' });
    const before = g.state;
    const r = playTurn(ctx, g, orders, actions, ump?.mods ?? []);
    g = r;
    journal.push(day(before.time, orders, before, r.results, queued.decision));
    outcome = gameOutcome(ctx, history, g, end, rec.human, baseStrength);
    queued = null;
    postView();
    post({ kind: 'record', record: rec });
    startAi();
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
  const forces = s.formations.filter((f) => (f.echelon === 'army' || f.echelon === 'corps') && at0.units.some((u) => u.id === f.id))
    .map((f) => { const a = at0.units.find((u) => u.id === f.id)!, b = now.units.find((u) => u.id === f.id);
      return { side: f.side === human ? 'own' : 'enemy', name: f.name, start: a.personnel, now: b?.personnel ?? 0, tanksStart: a.tanks, tanksNow: b?.tanks ?? 0, cutOff: !!b?.cutOff, destroyed: !!b?.destroyed || f.destroyed }; })
    .sort((a, b) => (a.side === b.side ? b.start - a.start : a.side === 'own' ? -1 : 1)).slice(0, 48);
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
  if (llmBusy) post({ kind: 'review-wait', id: m.id, text: `ждёт очереди: модель занята (${llmBusy})…` });
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

/** Справки посреднику: начальное наполнение базы знаний (доктрина, нормативы, техника — без хода боёв). */
let kbIndex: Promise<{ index: Index; byId: Map<string, Entry> }> | null = null;
async function umpireRefs(queries: string[]): Promise<UmpireRef[]> {
  kbIndex ??= import('../../../../packages/knowledge/data/seed.json').then((m) => {
    const entries = (m.default as unknown as { entries: Entry[] }).entries;
    return { index: new Index(entries), byId: new Map(entries.map((e) => [e.id, e])) };
  });
  const { index, byId } = await kbIndex;
  const out = new Map<string, UmpireRef>();
  for (const q of queries) for (const s of gather(index, byId, q, { limit: 3, pool: 400, filter: (e) => !!e && e.group !== 'model' && e.category !== 'sources' && !!category(e.category)?.gameSafe }))
    if (!out.has(s.ref)) out.set(s.ref, { id: s.ref, title: s.title, text: s.text.slice(0, 900) });
  return [...out.values()];
}

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
  const doc = runToDocument(ctx, run, history, { name: `Игра: ${ctx.scenario.name} (с ${ddmm(rec.takeover)})`, ownSide: human, visible: reveal ? undefined : fog() });
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
  const view: TurnView = {
    scenario: ctx.scenario.id, scenarioName: ctx.scenario.name, rules: ctx.rules.id, seed: rec.seed,
    start: ctx.scenario.start, end: ctx.scenario.end, takeover: rec.takeover, time: s.time, turnHours: ctx.scenario.turnHours,
    turn: rec.turns.length + 1, over: isOver(), outcome, victory: end.victory.title, deadline: end.defeat.deadline, strength: baseStrength ? sideStrength(s, human) / baseStrength : 1, strengthBelow: end.defeat.strengthBelow,
    human: { id: human, name: sideName(human) }, ai: { id: rec.ai, name: sideName(rec.ai) },
    groups: ctx.scenario.formations.filter((f) => f.side === human && !f.type).map((f) => ({ id: f.id, name: f.name })),
    own: unitReports(ctx, s, human, g.prev),
    intel: intelReport(ctx, s, human, g.prev),
    events: journal.length ? journal[journal.length - 1].events : [],
    places: places(ctx.theatre).map((p) => ({ id: p.id, title: p.title, at: p.at })),
    delays: prof.orderDelayHours as Record<string, number>,
    detectKm: Math.round(detectKm(ctx)),
    goals, journal, doc,
    ...logisticsView(),
    lastDecision: (([...rec.turns].reverse().find((t) => t.human)?.human) as HumanDecision | undefined) ?? null,
  };
  post({ kind: 'view', view });
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
