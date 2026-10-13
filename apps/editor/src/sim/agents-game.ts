/**
 * Игра на агентной модели в фоновом потоке игры: ход считает ядро (команды game_start / game_turn настольного
 * приложения), а штаб, доклады, разведка, советник и штаб противника на модели работают с его состоянием в виде
 * состояния этой модели (agentsToRun, agentsStateAt): дивизии — действующие соединения, штабы — подчинение.
 */
import {
  addHours, agentKindOf, agentsStateAt, agentsToRun, describePlace, targetPoint,
  type AgentOrderKind, type AgentTrace, type GameState, type Order, type SimContext, type UnitReport,
} from '@def-ops/sim';
import type { LngLat } from '@def-ops/core';

/** Ход ядра с началом игры и итогом приказов (game_start / game_turn). */
export type AgentGameTrace = AgentTrace & { game: { takeover: number; hour: number; over: boolean; applied?: { hq: string; divisions?: number; error?: string }[] } };

/** Приказ ядру: штабу (всем его дивизиям) или дивизии. */
export interface AgentOrder { hq: string; kind: AgentOrderKind; target: LngLat | null; note: string }

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
    return { hq: o.formation, kind: agentKindOf(o.task), target, note: [o.source === 'human' ? 'приказ игрока' : o.source === 'llm' ? 'приказ штаба на модели' : '', o.note ?? ''].filter(Boolean).join(': ') };
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

/**
 * Доклады армий и корпусов стороны по докладам их дивизий: в агентной модели действуют дивизии, а приказы удобно
 * отдавать и объединениям (ядро разошлёт приказ всем их дивизиям). Место — центр тяжести, силы — сумма, запасы и
 * укомплектованность — средние по численности, положение и задача — у большинства людей.
 */
export function hqReports(ctx: SimContext, own: UnitReport[], side: string): UnitReport[] {
  const parent = new Map(ctx.scenario.formations.map((f) => [f.id, f.parent ?? null]));
  const under = (id: string, hq: string) => { for (let x: string | null | undefined = parent.get(id), n = 0; x && n < 8; x = parent.get(x), n++) if (x === hq) return true; return false; };
  const top = <K extends string>(l: UnitReport[], key: (u: UnitReport) => K | null) => {
    const m = new Map<K, number>();
    for (const u of l) { const k = key(u); if (k) m.set(k, (m.get(k) ?? 0) + u.personnel); }
    return [...m].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return ctx.scenario.formations.filter((f) => f.side === side && (f.echelon === 'army' || f.echelon === 'corps') && !f.type).map((h): UnitReport | null => {
    const l = own.filter((u) => u.status === 'active' && under(u.id, h.id));
    if (!l.length) return null;
    const P = l.reduce((s, u) => s + u.personnel, 0) || 1;
    const w = (k: (u: UnitReport) => number) => l.reduce((s, u) => s + k(u) * u.personnel, 0) / P;
    const at: LngLat = [w((u) => u.at[0]), w((u) => u.at[1])];
    const task = top(l, (u) => u.task);
    return {
      id: h.id, name: h.name, parent: h.parent ?? null, echelon: h.echelon, status: 'active', at, place: describePlace(ctx.theatre, at),
      posture: top(l, (u) => u.posture) ?? '', task, target: task ? top(l.filter((u) => u.task === task), (u) => u.target) : null,
      orderSource: top(l, (u) => u.orderSource), personnel: Math.round(P), tanks: l.reduce((s, u) => s + u.tanks, 0), guns: l.reduce((s, u) => s + u.guns, 0),
      strength: w((u) => u.strength), ammo: +w((u) => u.ammo).toFixed(2), fuel: +w((u) => u.fuel).toFixed(2), fatigue: +w((u) => u.fatigue).toFixed(2),
      cutOff: l.some((u) => u.cutOff), movedKm: +w((u) => u.movedKm).toFixed(1), combats: [], pending: [],
    };
  }).filter((x): x is UnitReport => !!x);
}
