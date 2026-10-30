/**
 * Игра на агентной модели в фоновом потоке игры: ход считает ядро (команды game_start / game_turn настольного
 * приложения), а штаб, доклады, разведка, советник и штаб противника на модели работают с его состоянием в виде
 * состояния этой модели (agentsToRun, agentsStateAt): дивизии — действующие соединения, штабы — подчинение.
 */
import {
  activeBoundaries, addHours, detected, detectKm, hqReports, agentKindOf, agentsStateAt, agentsToRun, groupOf, NOT_COMMITTED, onMap, sectorMap, supplyHoursOf, targetPoint, withBoundaries,
  type AgentOrderKind, type AgentTrace, type CommandOp, type GameMode, type GameState, type Order, type SimContext, type SimState, type Snapshot,
} from '@def-ops/sim';
import type { LngLat } from '@def-ops/core';

export { hqReports };

/**
 * Туман войны игры: дивизия видна, если она своя или противник в пределах разведки своих войск на момент снимка.
 * id — те же, что у хода ядра (формирования игры — дивизии хода ядра, agentGame), так что разбор хода (turnEvents)
 * спрашивает по ним же. Обнаруженные — по снимку, с кэшем по времени снимка.
 */
export function fogOf(ctx: SimContext, formations: { id: string; side: string }[], human: string): (id: string, sn: Snapshot) => boolean {
  const km = detectKm(ctx);
  const sideOf = new Map(formations.map((f) => [f.id, f.side]));
  const cache = new Map<string, Set<string>>();
  return (id, sn) => {
    let set = cache.get(sn.time);
    if (!set) {
      const units = sn.units.filter((u) => !u.destroyed);
      set = detected(ctx.theatre, units.filter((u) => sideOf.get(u.id) === human), units.filter((u) => sideOf.get(u.id) !== human), km);
      cache.set(sn.time, set);
    }
    return sideOf.get(id) === human || set.has(id);
  };
}

/** Состояние управления стороны игрока в ходе ядра (Game::trace, раздел command). */
export interface TraceCommand {
  mode: GameMode;
  hqs: { id: string; control: Control; led: boolean }[];
  led: string[];
  requests: { hq: string; division: string; tick: number; answer: boolean | null }[];
  /** Запросы на отход штабов противника и ответы на них (answeredAt — час ответа) — для журнала посредника. */
  enemyRequests?: { hq: string; division: string; tick: number; answer: boolean | null; answeredAt?: number }[];
  /** Директивы верховного командования противника (по истории; одна директива нескольким получателям — строками). */
  enemyHistorical?: { id: string; at: number; from?: string; to: string; task: string; form: 'order' | 'instruction'; note: string }[];
  historical: { id: string; at: number; to: string; task: string; form: 'order' | 'instruction'; note: string; issued: boolean }[];
  /** Ходатайства фронтов своей стороны о разграничительных линиях и ответы на них (command/petition.rs). */
  petitions?: { from: string; neighbour: string; tick: number; accepted: boolean; why: string }[];
}
/** Ход ядра с началом игры и итогом приказов (game_start / game_turn). */
export type AgentGameTrace = AgentTrace & { control?: string; command?: TraceCommand; game: { takeover: number; turn: number; digest: string; hour: number; over: boolean; applied?: { hq: string; divisions?: number; error?: string }[]; reserves?: { id: string; from: number }[]; staffErrors?: string[]; commandErrors?: string[]; commandResults?: (string | null)[] } };

/** Кто решает за штаб: сценарий (гибрид), штаб-агент, игрок. */
export type Control = 'script' | 'agent' | 'player';
/** Состояние управления для интерфейса: с именами и временем. */
export interface CommandView {
  mode: GameMode;
  hqs: Record<string, { control: Control; led: boolean; name: string; echelon: string; parent: string | null }>;
  /** Дивизии, которые ведёт Ставка (приказ через голову). */
  led: string[];
  requests: { hq: string; hqName: string; division: string; divisionName: string; time: string; answer: boolean | null }[];
  /** due — час директивы уже наступил (подаётся сразу, при передаче командования — уже доведённой). */
  historical: { id: string; time: string; to: string; toName: string; task: string; form: 'order' | 'instruction'; note: string; issued: boolean; due: boolean }[];
  documents: { time: string; hq: string; hqName: string; kind: string; to: string[]; text: string; rule: string | null }[];
  /** Ходатайства о разграничительных линиях своей стороны: сосед, время, принято ли и почему. */
  petitions: { from: string; neighbour: string; neighbourName: string; time: string; accepted: boolean; why: string }[];
  /** Противник: штабы (подчинённость) и штаб каждой дивизии — для разведки по ступеням (что видно — решает разведсводка). */
  enemy: { hqs: Record<string, { name: string; echelon: string; parent: string | null }>; divisions: Record<string, string> };
}
const dm = (t: string) => `${t.slice(8, 10)}.${t.slice(5, 7)} ${t.slice(11, 16)}`;
/** Документов в журнале — последних. */
const DOCS = 200;
/** Состояние управления из хода ядра (null — ядро его не отдаёт, игра «как сейчас» до этапа командования). */
export function commandView(t: AgentGameTrace, side: string): CommandView | null {
  const c = t.command;
  if (!c) return null;
  const hq = new Map(t.hqs.map((h) => [h.id, h]));
  const name = new Map([...t.hqs.map((h) => [h.id, h.name] as const), ...t.divisions.map((d) => [d.id, d.name] as const)]);
  const at = (tick: number) => dm(addHours(t.start, tick));
  return {
    mode: c.mode,
    hqs: Object.fromEntries(c.hqs.map((h) => [h.id, { control: h.control, led: h.led, name: name.get(h.id) ?? h.id, echelon: hq.get(h.id)?.echelon ?? '', parent: hq.get(h.id)?.parent ?? null }])),
    led: c.led,
    requests: c.requests.map((r) => ({ hq: r.hq, hqName: name.get(r.hq) ?? r.hq, division: r.division, divisionName: name.get(r.division) ?? r.division, time: at(r.tick), answer: r.answer })),
    // одна директива нескольким получателям (фронтам) — одной строкой
    historical: [...c.historical.reduce((m, h) => m.set(h.id, [...(m.get(h.id) ?? []), h]), new Map<string, TraceCommand['historical']>()).values()].map((hs) => {
      const h = hs[0];
      return { id: h.id, time: at(h.at), to: h.to, toName: hs.map((x) => name.get(x.to) ?? x.to).join(', '), task: h.task, form: h.form, note: h.note, issued: h.issued, due: h.at <= t.game.hour };
    }),
    petitions: (c.petitions ?? []).filter((p) => hq.get(p.from)?.side === side)
      .map((p) => ({ from: p.from, neighbour: p.neighbour, neighbourName: name.get(p.neighbour) ?? p.neighbour, time: at(p.tick), accepted: p.accepted, why: p.why })),
    enemy: {
      hqs: Object.fromEntries(t.hqs.filter((h) => h.side !== side).map((h) => [h.id, { name: h.name, echelon: h.echelon, parent: h.parent }])),
      divisions: Object.fromEntries(t.divisions.filter((d) => d.side !== side).map((d) => [d.id, d.hq])),
    },
    documents: (t.documents ?? []).filter((d) => hq.get(d.hq)?.side === side).slice(-DOCS)
      .map((d) => ({ time: dm(d.time), hq: d.hq, hqName: name.get(d.hq) ?? d.hq, kind: d.kind, to: d.to, text: d.text, rule: d.rule })),
  };
}

/** Вид документа штаба словами. */
export const DOC_KIND_RU: Record<string, string> = { directive: 'директива', order: 'боевой приказ', instruction: 'распоряжение', notice: 'извещение', report: 'донесение' };
const INTENT_RU = { history: 'по истории', shifted: 'замысел сдвинут', own: 'решает сам' } as const;

/** Действие противника за ход (журнал посредника; игроку — то, что видит разведка). */
export interface EnemyEntry {
  tick: number; time: string; hq: string;
  /** Кто действовал: штаб, командующий, дивизия. */
  who: string;
  /** order — приказ, полученный дивизиями (из их журнала); decision — и директивы верховного командования. */
  kind: 'document' | 'decision' | 'withdraw' | 'request' | 'answer' | 'intent' | 'order';
  text: string;
  /** Дивизии, к которым запись относится (у штаба — его поддерево): по ним — видно ли разведке. */
  divisions: string[];
  /** Задача приказа словами и имена получателей (kind order) — для текста игроку по видимым получателям. */
  task?: string;
  names?: Record<string, string>;
}

/**
 * Действия сторон, кроме side, за часы (from, to]: документы штабов, решения командующих, смены «по истории /
 * сдвинут / сам», запросы на отход и ответы, отходы дивизий — по времени.
 */
export function enemyLog(t: AgentGameTrace, side: string, from: number, to: number): EnemyEntry[] {
  const hq = new Map(t.hqs.map((h) => [h.id, h]));
  const name = new Map([...t.hqs.map((h) => [h.id, h.name] as const), ...t.divisions.map((d) => [d.id, d.name] as const)]);
  const nm = (id: string) => name.get(id) ?? id;
  const enemyHq = (id: string) => { const h = hq.get(id); return h ? h.side !== side : !id.startsWith(`${side}_`); };
  // поддерево штаба: дивизии, чья цепочка штабов проходит через него
  const under = new Map<string, string[]>();
  for (const d of t.divisions) {
    if (d.side === side) continue;
    const seen = new Set<string>();
    for (let h: string | null = d.hq; h && !seen.has(h); h = hq.get(h)?.parent ?? null) { seen.add(h); under.set(h, [...(under.get(h) ?? []), d.id]); }
  }
  const sub = (id: string) => under.get(id) ?? [];
  const at = (tick: number) => addHours(t.start, tick);
  const inTurn = (tick: number) => tick > from && tick <= to;
  const out: EnemyEntry[] = [];
  for (const d of t.documents ?? []) {
    if (!inTurn(d.tick) || !enemyHq(d.hq)) continue;
    out.push({ tick: d.tick, time: d.time, hq: d.hq, who: nm(d.hq), kind: 'document', text: `${dm(d.time)} ${nm(d.hq)} · ${DOC_KIND_RU[d.kind] ?? d.kind}: ${d.text}`, divisions: sub(d.hq) });
  }
  // приказы, полученные дивизиями (из их журнала «получен приказ»; у штабов по истории других следов нет) — наблюдаемое
  // игроку по видимым получателям; один приказ нескольким дивизиям — одной записью
  const idByName = new Map(t.hqs.map((h) => [h.name, h.id]));
  const divOf = new Map(t.divisions.map((d) => [d.id, d]));
  const got = new Map<string, EnemyEntry>();
  for (const e of t.journal) {
    const d = e.agent ? divOf.get(e.agent) : undefined;
    const m = d && d.side !== side && inTurn(e.tick) ? /^получен приказ «(.+?)» от штаба «(.+?)»:\s*(.*)$/.exec(e.text) : null;
    if (!d || !m) continue;
    const issuer = idByName.get(m[2]) ?? d.hq;
    if (!enemyHq(issuer)) continue;
    const note = m[3].replace(/\s*\[[^\]]*@[^\]]*\]\s*$/, '');
    const key = `${e.tick}|${issuer}|${m[1]}|${note}`;
    const x = got.get(key) ?? { tick: e.tick, time: e.time, hq: issuer, who: m[2], kind: 'order' as const, text: '', divisions: [], task: m[1] };
    x.divisions.push(d.id);
    x.names = { ...x.names, [d.id]: d.name };
    x.text = `${dm(e.time)} ${m[2]} · приказ «${m[1]}» — ${x.divisions.map(nm).join(', ')}${note ? `: ${note}` : ''}`;
    got.set(key, x);
  }
  out.push(...got.values());
  // директивы верховного командования противника — в свой час; несколько получателей — одной записью
  const TASK: Record<string, string> = { attack: 'наступать', defend: 'оборонять', delay: 'сдерживать', withdraw: 'отходить', move: 'выдвинуться', reserve: 'в резерв' };
  const subOf = (id: string) => (hq.has(id) ? sub(id) : t.divisions.some((d) => d.id === id && d.side !== side) ? [id] : []);
  const hist = new Map<string, NonNullable<TraceCommand['enemyHistorical']>>();
  for (const h of t.command?.enemyHistorical ?? []) if (inTurn(h.at)) hist.set(`${h.id}|${h.at}`, [...(hist.get(`${h.id}|${h.at}`) ?? []), h]);
  for (const hs of hist.values()) {
    const h = hs[0], src = h.from ?? [...hq.values()].find((x) => x.side !== side && x.echelon === 'high_command')?.id ?? h.to;
    const time = at(h.at);
    out.push({ tick: h.at, time, hq: src, who: nm(src), kind: 'decision', divisions: [...new Set(hs.flatMap((x) => subOf(x.to)))],
      text: `${dm(time)} ${nm(src)} · ${h.form === 'instruction' ? 'распоряжение' : 'директива'} ${h.id} — ${hs.map((x) => nm(x.to)).join(', ')}: ${TASK[h.task] ?? h.task}${h.note ? ` — ${h.note}` : ''}` });
  }
  for (const c of t.commanders ?? []) {
    if (!enemyHq(c.hq)) continue;
    for (const x of c.decisions) {
      if (!inTurn(x.tick)) continue;
      const time = at(x.tick);
      out.push({ tick: x.tick, time, hq: c.hq, who: c.name, kind: 'decision', text: `${dm(time)} ${c.name}: ${x.options[x.chosen]?.label ?? '—'} — ${x.why}`, divisions: sub(c.hq) });
    }
  }
  for (const h of t.intent ?? []) {
    if (!enemyHq(h.hq)) continue;
    for (const x of h.changes) {
      if (!inTurn(x.tick)) continue;
      const time = at(x.tick);
      out.push({ tick: x.tick, time, hq: h.hq, who: nm(h.hq), kind: 'intent', text: `${dm(time)} ${nm(h.hq)}: ${INTENT_RU[x.status] ?? x.status}${x.reason ? ` — ${x.reason}` : ''}`, divisions: sub(h.hq) });
    }
  }
  const reqs = (t.command?.enemyRequests ?? []).filter((r) => enemyHq(r.hq));
  for (const r of reqs) {
    if (!inTurn(r.tick)) continue;
    const time = at(r.tick);
    out.push({ tick: r.tick, time, hq: r.hq, who: nm(r.hq), kind: 'request', text: `${dm(time)} ${nm(r.hq)}: запрос на отход ${nm(r.division)}`, divisions: [r.division] });
  }
  for (const r of reqs) {
    const tick = r.answeredAt ?? r.tick;
    if (r.answer == null || !inTurn(tick)) continue;
    const time = at(tick), up = hq.get(r.hq)?.parent ?? r.hq;
    out.push({ tick, time, hq: r.hq, who: nm(up), kind: 'answer', text: `${dm(time)} ${nm(up)}: ${nm(r.division)} — ${r.answer ? 'отход разрешён' : 'в отходе отказано'}`, divisions: [r.division] });
  }
  const div = new Map(t.divisions.map((d) => [d.id, d]));
  for (const e of t.journal) {
    const d = e.agent ? div.get(e.agent) : undefined;
    if (!d || d.side === side || !inTurn(e.tick) || !/→ отступление/.test(e.text)) continue;
    out.push({ tick: e.tick, time: e.time, hq: d.hq, who: d.name, kind: 'withdraw', text: `${dm(e.time)} ${d.name}: ${e.text.replace(/:?\s*\[[^\]]*@[^\]]*\]\s*$/, '')}`, divisions: [d.id] });
  }
  return out.sort((a, b) => a.tick - b.tick);
}

/** Что игрок может наблюдать сам: отходы и действия по приказу дивизий; документы, решения, смены замысла, запросы и ответы между штабами — только посреднику. */
const OBSERVABLE: ReadonlySet<EnemyEntry['kind']> = new Set(['withdraw', 'order']);

/** Запись видна игроку: наблюдаемая и хотя бы одна из её дивизий обнаружена разведкой. */
export const enemyVisible = (e: EnemyEntry, seen: ReadonlySet<string>): boolean => OBSERVABLE.has(e.kind) && e.divisions.some((d) => seen.has(d));

/**
 * Запись для журнала игрока: только о видимых дивизиях (приказ — по видимым получателям, без отдавшего штаба и
 * обоснования); null — игроку не видна.
 */
export function enemyPlayerText(e: EnemyEntry, seen: ReadonlySet<string>, names?: ReadonlyMap<string, string>): string | null {
  if (!enemyVisible(e, seen)) return null;
  if (e.kind === 'withdraw') return e.text;
  const vis = e.divisions.filter((d) => seen.has(d)).map((d) => names?.get(d) ?? e.names?.[d] ?? d);
  return `${dm(e.time)} ${vis.join(', ')}: переходит к задаче «${e.task ?? '—'}»`;
}

/** Команда управления словами (для журнала хода). */
/** hist — как назвать историческую директиву (срок и получатели); нет — по id. */
export function commandText(c: CommandOp, name: (id: string) => string, hist?: (id: string) => string | undefined): string {
  switch (c.op) {
    case 'take': return `взят под управление — ${name(c.hq)}`;
    case 'release': return `возвращён агенту, в замысел старшего — ${name(c.id)}`;
    case 'permit': return `${c.yes ? 'отход разрешён' : 'в отходе отказано'} — ${name(c.hq)}`;
    case 'historical': { const h = hist?.(c.id); return `подана историческая директива ${c.id}${h ? ` (${h})` : ''}`; }
    case 'directive': { const t = ({ attack: 'наступать', defend: 'оборонять', delay: 'сдерживать', withdraw: 'отходить', move: 'выдвинуться', reserve: 'в резерв' } as Record<string, string>)[c.directive.task] ?? c.directive.task;
      return `${c.directive.form === 'order' ? 'приказ' : 'распоряжение'} ${c.directive.from ? `от «${name(c.directive.from)}» ` : ''}— ${name(c.directive.to)}: ${t}`; }
    case 'petition': return `ходатайство о разграничительной линии с соседом — ${name(c.from)} / ${name(c.neighbour)}`;
  }
}

/** Приказ ядру: штабу (всем его дивизиям) или дивизии; форма — в режимах штабов-агентов. */
export interface AgentOrder { hq: string; kind: AgentOrderKind; target: LngLat | null; note: string; form?: 'order' | 'instruction' }

/** Шаг снимков на карте, часов (расчёт — по часам). */
const STEP = 6;

/** Час хода ядра для момента. */
export const hourAt = (start: string, time: string) => Math.round((Date.parse(`${time.slice(0, 16)}:00Z`) - Date.parse(`${start.slice(0, 16)}:00Z`)) / 3600000);

/**
 * Контекст и состояние игры по ходу ядра: формирования — дивизии и штабы хода, ход — turnHours, конец сценария —
 * как у сценария игры (игра идёт до победы или поражения), состояние — на последний кадр, прежнее — ходом раньше.
 */
export function agentGame(base: SimContext, t: AgentTrace, turnHours: number): { ctx: SimContext; g: GameState; hour: number } {
  const { ctx: c, run } = agentsToRun(base, t, STEP);
  const ctx: SimContext = { ...c, scenario: { ...c.scenario, turnHours, end: base.scenario.end, boundaries: base.scenario.boundaries } };
  const hour = t.frames.length - 1;
  const state = agentsStateAt(ctx, t, hour);
  const prev = hour >= turnHours ? agentsStateAt(ctx, t, hour - turnHours) : null;
  return { ctx, g: { state, prev, snapshots: run.snapshots }, hour };
}

/**
 * Приказы игры → приказы ядру: задача → приказ агента (наступать, оборонять, держаться, отойти, выдвинуться), цель —
 * точка (пункт, район, соединение противника — его место сейчас); без цели — на месте.
 */
export function toAgentOrders(ctx: SimContext, g: GameState, orders: Order[]): AgentOrder[] {
  const byId = new Map(g.state.formations.map((f) => [f.id, f]));
  return orders.map((o) => {
    let target: LngLat | null = null;
    try { target = o.target != null ? targetPoint(ctx, o.target, byId) : null; } catch { target = null; }
    return { hq: o.formation, kind: agentKindOf(o.task), target, note: [o.source === 'human' ? 'приказ игрока' : o.source === 'llm' ? 'приказ штаба на модели' : '', o.note ?? ''].filter(Boolean).join(': '), ...(o.form ? { form: o.form } : {}) };
  });
}

/** Значимые записи журнала агентов (бой, отход, окружение, выход из строя, выполнение задачи, приказы). */
const NOTABLE = /окружен|небоеспособ|сведена|→ отступление|→ наступление: атака|задача выполнена|под артподготовкой|получен приказ|прорыв из окружения|остатки/;

/** Донесения за ход: по каждой дивизии стороны — последние значимые события (с часом), не больше max строк. */
export function agentEvents(t: AgentTrace, from: number, to: number, side: string, max = 60): string[] {
  const div = new Map(t.divisions.map((d) => [d.id, d]));
  const by = new Map<string, string[]>();
  for (const e of t.journal) {
    if (e.tick <= from || e.tick > to || !e.agent) continue;
    const d = div.get(e.agent);
    if (!d || d.side !== side || !NOTABLE.test(e.text)) continue;
    const text = e.text.replace(/:?\s*\[[^\]]*@[^\]]*\]\s*$/, '');
    by.set(d.id, [...(by.get(d.id) ?? []), `${e.time.slice(8, 10)}.${e.time.slice(5, 7)} ${e.time.slice(11, 16)} ${d.name}: ${text}`]);
  }
  // сначала тяжёлые (окружение, выход из строя, отступление), затем остальное
  const weight = (s: string) => (/окружен|небоеспособ|сведена/.test(s) ? 0 : /отступление|остатки/.test(s) ? 1 : /получен приказ/.test(s) ? 3 : 2);
  return [...by.values()].map((l) => l[l.length - 1]).sort((a, b) => weight(a) - weight(b) || a.localeCompare(b)).slice(0, max);
}

export const agentTime = (t: AgentTrace, hour: number) => addHours(t.start, hour);


/* ───────────── распоряжения штаба на агентной модели ───────────── */

/**
 * Штаб игрока между ходами: ход ядра каждый раз даёт новое состояние, а тыл (базы, приоритет), установленные линии,
 * директивы и введённые резервы ведёт штаб этой модели — они переносятся из хода в ход.
 */
export interface AgentStaff {
  logistics?: SimState['logistics'];
  boundaries?: SimState['boundaries'];
  directives?: SimState['directives'];
  /** Введённые резервы, ещё не вышедшие в район: район и срок. */
  committed: Record<string, { at: LngLat; eta: string }>;
}

/**
 * Сетка ядра — растр рельефа театра (terrainGrid: строки с севера, клетки по долготе и широте), у этой модели — свои
 * клетки cellKm. Для каждой клетки ядра — клетка этой модели (по центру); запоминается на театр.
 */
const CORE_MAP = new WeakMap<object, Int32Array>();
function coreToModel(T: SimContext['theatre']): Int32Array {
  let m = CORE_MAP.get(T);
  if (m) return m;
  const g = (T.data as { terrainGrid?: { cols: number; rows: number } }).terrainGrid;
  const [w, s, e, n] = T.data.bbox;
  const cols = g?.cols ?? 0, rows = g?.rows ?? 0;
  m = new Int32Array(cols * rows);
  for (let k = 0; k < m.length; k++) m[k] = T.indexOf([w + ((k % cols) + 0.5) / cols * (e - w), n - (Math.floor(k / cols) + 0.5) / rows * (n - s)]);
  CORE_MAP.set(T, m);
  return m;
}

/** Территория сторон ядра (код клетки: 0 — ничья, 1 — первая сторона, 2 — вторая) на клетках этой модели — большинством. */
export function territoryFromCore(T: SimContext['theatre'], control: string): number[] | null {
  const map = coreToModel(T);
  if (map.length !== control.length) return null;
  const votes = new Int32Array(T.cols * T.rows * 3);
  for (let k = 0; k < map.length; k++) { const i = map[k]; if (i >= 0) votes[i * 3 + (control.charCodeAt(k) - 48)]++; }
  const out = new Array<number>(T.cols * T.rows);
  for (let i = 0; i < out.length; i++) {
    const [z, a, b] = [votes[i * 3], votes[i * 3 + 1], votes[i * 3 + 2]];
    out[i] = a === 0 && b === 0 ? -1 : a >= b ? (a >= z ? 0 : -1) : (b >= z ? 1 : -1);
  }
  return out;
}

/** Распоряжения ядру на ход (StaffIn ядра). */
export interface AgentStaffIn {
  supply: [string, number][];
  bridges: { at: LngLat; from: number }[];
  demolish: { bridge: string; from: number }[];
  commit: { division: string; at: LngLat; from: number }[];
  /** Полосы на клетках ядра: codes — метка объединения клетки знаком ('0' + метка, '.' — вне полос). */
  sectors: { step: number; cols: number; label: number[]; codes: string; groups: [string, number][]; foreign: number }[];
}

/**
 * Состояние хода ядра с тем, что ведёт штаб: территория сторон (для путей подвоза от баз), тыл, линии, директивы;
 * резервы игрока — ждут ввода (reserveFrom) или идут в район (введены, срок — enterAt).
 */
export function withStaff(ctx: SimContext, t: AgentGameTrace & { control?: string }, state: SimState, st: AgentStaff, human: string): SimState {
  const T = ctx.theatre;
  const terr = (t.control && territoryFromCore(T, t.control)) ?? state.territory;
  const reserves = new Map((t.game.reserves ?? []).map((r) => [r.id, addHours(t.start, r.from)]));
  const formations = state.formations.map((f) => {
    if (f.side !== human) return f;
    const r = reserves.get(f.id);
    if (r) return { ...f, reserveFrom: r, enterAt: NOT_COMMITTED };
    const c = st.committed[f.id];
    if (c && c.eta > state.time) return { ...f, enterAt: c.eta, position: c.at, reserveFrom: undefined };
    return f;
  });
  return { ...state, formations, ...(terr ? { territory: terr } : {}), ...(st.logistics ? { logistics: st.logistics } : {}), ...(st.boundaries ? { boundaries: st.boundaries } : {}), ...(st.directives ? { directives: st.directives } : {}) };
}

/** Переправы театра стороны: что есть и когда действует (до распоряжений хода — для сравнения). */
export const bridgesOf = (ctx: SimContext) => new Map(ctx.theatre.data.bridges.map((b) => [b.id, { openFrom: b.openFrom ?? null, destroyedAt: b.destroyedAt ?? null }]));

/**
 * Распоряжения хода → ядру. after — состояние после распоряжений (applyActions этой модели: проверка и исполнение),
 * before — до них; переправы — по изменениям театра (наведённые — новые, подорванные — с новым сроком подрыва,
 * снятые при передаче командования — с часа 0). Подвоз — по базам и приоритету: время подвоза до дивизии больше
 * предела — подвоза нет, приоритетным ×1,5, остальным ×0,75, база дальше supplyFlow.fullHours — меньше. Полосы — по
 * действующим линиям сторон (фронты и армии), как выбор пути в этой модели.
 */
export function staffEffects(ctx: SimContext, start: string, before: SimState, after: SimState, bridgesBefore: ReturnType<typeof bridgesOf>, human: string): AgentStaffIn {
  const hour = (t: string | null | undefined) => (t ? Math.max(0, hourAt(start, t)) : 0);
  const now = bridgesOf(ctx);
  const bridges = ctx.theatre.data.bridges.filter((b) => !bridgesBefore.has(b.id) && b.side === human && b.openFrom).map((b) => ({ at: b.at, from: hour(b.openFrom) }));
  const demolish = [
    ...[...bridgesBefore].filter(([id]) => !now.has(id)).map(([id]) => ({ bridge: id, from: 0 })),
    ...[...now].filter(([id, b]) => bridgesBefore.has(id) && b.destroyedAt && b.destroyedAt !== bridgesBefore.get(id)!.destroyedAt).map(([id, b]) => ({ bridge: id, from: hour(b.destroyedAt) })),
  ];
  const was = new Map(before.formations.map((f) => [f.id, f]));
  const commit = after.formations.filter((f) => f.side === human && was.get(f.id)?.reserveFrom && !f.reserveFrom && f.enterAt && f.enterAt !== NOT_COMMITTED)
    .map((f) => ({ division: f.id, at: f.position, from: hour(f.enterAt) }));
  // подвоз
  const supply: [string, number][] = [];
  const lg = after.logistics?.[human];
  if (lg) {
    const { hours, rangeHours } = supplyHoursOf(ctx, after, human);
    const pr = new Set(lg.priority ?? []);
    const full = ctx.rules.supplyFlow?.fullHours ?? 12;
    // приоритет штаба (фронта, армии, корпуса) — и всем его дивизиям: пункт управления даёт его подчинённым, а подвоз — по дивизиям
    const parent = new Map(ctx.scenario.formations.map((f) => [f.id, f.parent ?? null]));
    const prior = (id: string) => { for (let x: string | null = id, n = 0; x && n < 8; x = parent.get(x) ?? null, n++) if (pr.has(x)) return true; return false; };
    for (const [id, h] of hours) {
      if (!Number.isFinite(h)) continue; // пути нет — окружение ведёт ядро
      const k = h > rangeHours ? 0 : (pr.size ? (prior(id) ? 1.5 : 0.75) : 1) * (ctx.rules.supplyFlow && h > full ? full / h : 1);
      supply.push([id, +k.toFixed(3)]);
    }
  }
  // полосы
  const sectors: AgentStaffIn['sectors'] = [];
  const foreign = ctx.rules.sectors?.foreign ?? 0;
  const scen = withBoundaries(ctx.scenario, after);
  const act = activeBoundaries(scen, after.time).filter((b) => b.side === human);
  if (foreign > 0 && act.length) {
    const units = after.formations.filter((f) => onMap(f, after.time)).map((f) => ({ id: f.id, side: f.side, at: f.position }));
    for (const lv of ['front', 'army'] as const) {
      const lines = act.filter((b) => b.kind === lv);
      if (!lines.length) continue;
      const groups = groupOf(ctx.scenario, lv);
      const m = sectorMap(ctx.theatre, { ...scen, boundaries: lines }, units, human, after.time, { level: lv, groups });
      // метка на каждую клетку ядра: клетка этой модели → клетка сетки полос (как sectorPrefer)
      const map = coreToModel(ctx.theatre);
      let codes = '';
      for (let k = 0; k < map.length; k++) {
        const i = map[k];
        const kk = i < 0 ? -1 : Math.floor(Math.floor(i / ctx.theatre.cols) / m.step) * m.cols + Math.floor((i % ctx.theatre.cols) / m.step);
        const l = kk >= 0 && m.hist[kk] ? m.label[kk] : -1;
        codes += l >= 0 && l < 75 ? String.fromCharCode(48 + l) : '.';
      }
      const gs: [string, number][] = after.formations.filter((f) => f.side === human).map((f) => [f.id, m.groups.indexOf(groups.get(f.id) ?? f.id)] as [string, number]).filter(([, g]) => g >= 0);
      sectors.push({ step: 1, cols: (ctx.theatre.data as { terrainGrid?: { cols: number } }).terrainGrid?.cols ?? 0, label: [], codes, groups: gs, foreign });
    }
  }
  return { supply, bridges, demolish, commit, sectors };
}
