/**
 * Игра в фоновом потоке браузера. С момента передачи командования советской
 * стороной командует человек, немецкой — штаб на модели (LM Studio). Обе стороны
 * решают одновременно, по одной и той же обстановке на утро хода: как только ход
 * посчитан, модели уходит её обстановка, а человек тем временем читает доклады и
 * пишет приказы. «Провести ход» — дождаться решения модели, отдать приказы обеих
 * сторон и посчитать ход арбитром.
 */
import {
  checkEvents, contextFrom, dayEvents, describeTarget, detected, detectKm, gameOver, intelReport, places, playTurn,
  runToDocument, startGame, TASK_RU, unitReports, type GameRecord, type GameState, type History, type Order, type SimContext, type Snapshot,
} from '@def-ops/sim';
import { buildSituation, decideTurn, type AiTurn, type LiveConfig } from '@def-ops/staff-service/live';
import { LlmClient } from '@def-ops/staff-service/llm';
import systemTpl from '../../../../services/staff/prompts/staff.system.md?raw';
import liveTpl from '../../../../services/staff/prompts/staff.live.md?raw';
import type { AiStatus, EnemyMode, GameRequest, GameResponse, JournalDay, LlmSettings, TurnView } from './game-protocol';

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
let cfg: LiveConfig;
let profileMd = '';
let llm: LlmSettings;
let enemy: EnemyMode = 'llm';
let reveal = false;
let journal: JournalDay[] = [];
/** Решение модели на текущий ход. */
let ai: { time: string; promise: Promise<AiTurn | null>; abort: AbortController; result?: AiTurn | null } | null = null;
let skipAi = false;
/** Приказы человека, ждущие решения модели. */
let queued: Order[] | null = null;
let busy = false;

const ddmm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`;

self.onmessage = async (e: MessageEvent<GameRequest>) => {
  const m = e.data;
  try {
    if (m.kind === 'start') await start(m.start, m.record, m.llm, m.enemy);
    else if (m.kind === 'turn') { queued = m.orders; await advance(); }
    else if (m.kind === 'settings') {
      const was = enemy;
      llm = m.llm; enemy = m.enemy;
      if (was !== enemy) startAi();
    } else if (m.kind === 'retry-ai') { startAi(); if (queued) await advance(); }
    else if (m.kind === 'skip-ai') { skipAi = true; if (queued) await advance(); }
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
  post({ kind: 'progress', text: 'расчёт до передачи командования…' });
  g = startGame(ctx, s.seed, s.takeover);
  rec = record ?? { version: 1, scenario: s.scenario, rules: ctx.rules.id, seed: s.seed, takeover: g.state.time, human, ai: cfg.side, turns: [] };
  journal = [];
  for (const [k, t] of rec.turns.entries()) {
    if (gameOver(ctx, g)) break;
    post({ kind: 'progress', text: `восстановление игры: ход ${k + 1} из ${rec.turns.length}…` });
    if (t.time !== g.state.time) throw new Error(`запись игры не сходится с расчётом (${t.time} ≠ ${g.state.time})`);
    const before = g.state;
    g = playTurn(ctx, g, t.orders);
    journal.push(day(before.time, t.orders, before));
  }
  postView();
  post({ kind: 'record', record: rec });
  startAi();
}

/** Запись журнала за ход: наши приказы словами и донесения. */
function day(time: string, orders: Order[], before: GameState['state']): JournalDay {
  const names = new Map(before.formations.map((f) => [f.id, f.name]));
  return {
    time,
    orders: orders.filter((o) => o.source === 'human').map((o) => `${names.get(o.formation)}: ${TASK_RU[o.task]} — ${describeTarget(ctx, o.target, names)}${o.note ? `. ${o.note}` : ''}`),
    events: dayEvents(ctx, g.state, rec.human, before),
  };
}

function startAi() {
  ai?.abort.abort();
  ai = null;
  skipAi = false;
  if (!g || gameOver(ctx, g)) return;
  if (enemy === 'passive') { status({ state: 'off' }); return; }
  const time = g.state.time;
  const prevAi = [...rec.turns].reverse().find((t) => (t.ai as AiTurn | undefined)?.decision);
  const previous = prevAi ? { time: prevAi.time, intent: (prevAi.ai as AiTurn).decision!.intent } : null;
  const sit = buildSituation(ctx, g, cfg, { system: systemTpl, user: liveTpl, profile: profileMd }, previous);
  const abort = new AbortController();
  const client = new LlmClient({ url: absolute(llm.url), model: llm.model, thinking: llm.thinking, timeoutMs: 15 * 60_000, maxTokens: 16000 }, fetch.bind(globalThis));
  status({ state: 'thinking', time, since: Date.now() });
  post({ kind: 'ai-stream', text: '', reset: true });
  let buf = '', last = 0;
  const promise = decideTurn(client, sit, {
    signal: abort.signal,
    onDelta: (_k, t) => {
      buf += t;
      const now = Date.now();
      if (now - last > 250) { post({ kind: 'ai-stream', text: buf }); buf = ''; last = now; }
    },
  }).then((t) => {
    if (abort.signal.aborted) return null;
    if (buf) post({ kind: 'ai-stream', text: buf });
    status(t.ok ? { state: 'done', time, turn: t } : { state: 'error', time, error: t.error ?? 'нет решения', turn: t });
    if (ai) ai.result = t;
    return t;
  });
  ai = { time, promise, abort };
}

const absolute = (u: string) => (/^https?:/.test(u) ? u : new URL(u, self.location.origin).href).replace(/\/+$/, '');
const status = (s: AiStatus) => post({ kind: 'ai', status: s });

async function advance() {
  if (busy || !queued || gameOver(ctx, g)) return;
  busy = true;
  try {
    let t: AiTurn | null = null;
    if (ai && enemy === 'llm') {
      post({ kind: 'progress', text: 'штаб противника заканчивает решение…' });
      t = await ai.promise;
      if (!t) return; // решение отменено (смена настроек) — ход ждёт нового
      if (!t.ok && !skipAi) { post({ kind: 'blocked', error: t.error ?? 'модель не дала решения' }); return; }
    }
    const humanOrders = queued.map((o) => ({ ...o, issuedAt: g.state.time, source: 'human' as const }));
    const aiOrders = t?.ok ? t.orders : [];
    const orders = [...humanOrders, ...aiOrders];
    rec.turns.push({ time: g.state.time, orders, ...(t ? { ai: slim(t) } : {}) });
    post({ kind: 'progress', text: 'расчёт хода…' });
    const before = g.state;
    g = playTurn(ctx, g, orders);
    journal.push(day(before.time, orders, before));
    queued = null;
    postView();
    post({ kind: 'record', record: rec });
    startAi();
  } finally {
    busy = false;
  }
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
  const goals = checkEvents(ctx, run, history).map((r) => {
    const ev = history.events?.find((x) => x.id === r.id);
    const place = ev && 'place' in ev ? ctx.theatre.area(ev.place)?.center ?? null : null;
    return { title: r.title, historical: r.historical, simulated: r.simulated, days: r.days, at: r.at, place };
  });
  const prof = ctx.profiles[ctx.scenario.sides.find((x) => x.id === human)!.profile];
  const turnsTotal = Math.round((Date.parse(ctx.scenario.end + ':00Z') - Date.parse(rec.takeover + ':00Z')) / 3600_000 / ctx.scenario.turnHours);
  const view: TurnView = {
    scenario: ctx.scenario.id, scenarioName: ctx.scenario.name, rules: ctx.rules.id, seed: rec.seed,
    start: ctx.scenario.start, end: ctx.scenario.end, takeover: rec.takeover, time: s.time, turnHours: ctx.scenario.turnHours,
    turn: rec.turns.length + 1, turns: turnsTotal, over: gameOver(ctx, g),
    human: { id: human, name: sideName(human) }, ai: { id: rec.ai, name: sideName(rec.ai) },
    groups: ctx.scenario.formations.filter((f) => f.side === human && !f.type).map((f) => ({ id: f.id, name: f.name })),
    own: unitReports(ctx, s, human, g.prev),
    intel: intelReport(ctx, s, human, g.prev),
    events: journal.length ? journal[journal.length - 1].events : [],
    places: places(ctx.theatre).map((p) => ({ id: p.id, title: p.title, at: p.at })),
    delays: prof.orderDelayHours as Record<string, number>,
    detectKm: Math.round(detectKm(ctx)),
    goals, journal, doc,
  };
  post({ kind: 'view', view });
}
