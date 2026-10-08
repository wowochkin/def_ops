/**
 * Распоряжения штаба помимо приказов войскам — для стороны, которой командует
 * человек: перенос баз снабжения, приоритет подвоза, наводка переправ, ввод
 * резервов Ставки. До передачи командования всё это шло по историческому графику
 * сценария; после неё будущие исторические наводки и прибытия снимаются, тыл
 * переходит под управление штаба (SimState.logistics).
 *
 * Распоряжение проверяется (checkAction) и исполняется (applyActions) в начале хода,
 * вместе с приказами. Переправы добавляются в театр — поэтому игра повторяется по
 * записи только на новом контексте (как и делает replayGame).
 */
import type { LngLat } from '@def-ops/core';
import { dist } from './geo';
import { areaTitle, describePlace } from './reports';
import { addHours, onMap, profileOf, supplySources, type SimContext } from './step';
import type { Logistics, SimState, StaffAction } from './types';

/** Время «никогда» для резерва, ещё не введённого в сражение. */
export const NOT_COMMITTED = '9999-01-01T00:00';
const ENGINEERING = { bridgeHoursMajor: 24, bridgeHoursMinor: 12, parks: 3 };
const maxH = (a: string, b: string) => (a > b ? a : b);

export interface ActionCheck { ok: boolean; text: string; eta?: string; at?: LngLat; /** мост для подрыва */ bridge?: string }

/** Передача командования человеку: будущие наводки его стороны сняты, резервы — к вводу по его решению, тыл — под его управлением. */
export function prepareTakeover(ctx: SimContext, state: SimState, side: string): SimState {
  const T = ctx.theatre;
  T.dropBridges((b) => b.side === side && !!b.openFrom && b.openFrom > state.time);
  const formations = state.formations.map((f) => (f.side === side && f.enterAt && f.enterAt > state.time && !f.destroyed
    ? { ...f, reserveFrom: f.enterAt, enterAt: NOT_COMMITTED } : f));
  const names = new Map<string, string>();
  const sp = ctx.scenario.supply?.[side];
  for (const x of [...(sp?.sources ?? []), ...(sp?.phases ?? []).flatMap((p) => p.sources)]) {
    if (typeof x === 'string') { const a = T.area(x); if (a) names.set(a.center.join(','), areaTitle(a.name)); }
  }
  const bases = supplySources(ctx, side, state.time).map((at, k) => ({ id: `base${k + 1}`, name: names.get(at.join(',')) ?? describePlace(T, at).replace(/^у /, ''), at, activeFrom: null }));
  const logistics: Record<string, Logistics> = { ...(state.logistics ?? {}), [side]: { bases, priority: [] } };
  return { ...state, formations, logistics };
}

const own = (ctx: SimContext, state: SimState, side: string, at: LngLat) => {
  const i = ctx.theatre.indexOf(at);
  return i >= 0 && !!state.territory && state.territory[i] === ctx.scenario.sides.findIndex((x) => x.id === side);
};

/** Проверить распоряжение: исполнимо ли, когда вступит в силу. pendingBridges — сколько переправ уже наводится в этом же распоряжении. */
export function checkAction(ctx: SimContext, state: SimState, a: StaffAction, pendingBridges = 0): ActionCheck {
  const T = ctx.theatre, t = state.time;
  if (a.kind === 'base') {
    const b = state.logistics?.[a.side]?.bases.find((x) => x.id === a.base);
    if (!b) return { ok: false, text: 'нет такой базы снабжения' };
    if (!own(ctx, state, a.side, a.to)) return { ok: false, text: 'новое место базы — не на своей территории' };
    const ps = profileOf(ctx, a.side).supply;
    const km = dist(T.proj.toXY(b.at), T.proj.toXY(a.to));
    const h = (ps?.baseSetupHours ?? 24) + (km / (ps?.baseMoveKmPerDay ?? 60)) * 24;
    const eta = addHours(t, Math.round(h));
    return { ok: true, text: `перенос ${Math.round(km)} км; на время переноса база не действует; заработает ≈ ${eta.slice(8, 10)}.${eta.slice(5, 7)} ${eta.slice(11, 16)}`, eta };
  }
  if (a.kind === 'priority') {
    const n = state.formations.filter((f) => f.side === a.side && onMap(f, t)).length;
    const lim = Math.max(1, Math.ceil(n / 3));
    if (a.formations.length > lim) return { ok: false, text: `приоритет — не более чем трети объединений (${lim})` };
    return { ok: true, text: a.formations.length ? `приоритетным — подвоз ×1,5, остальным — ×0,75` : 'подвоз поровну' };
  }
  if (a.kind === 'bridge') {
    const eng = profileOf(ctx, a.side).engineering ?? ENGINEERING;
    const r = T.nearestRiver(a.at, Math.max(2, T.cellKm * 1.5));
    if (!r) return { ok: false, text: 'здесь нет реки — переправа не нужна' };
    if (T.bridgeOpen(r.i, t)) return { ok: false, text: 'здесь уже есть действующая переправа' };
    const building = T.data.bridges.filter((b) => b.side === a.side && b.openFrom && b.openFrom > t).length + pendingBridges;
    if (building >= eng.parks) return { ok: false, text: `все понтонные парки заняты (одновременно — ${eng.parks})` };
    const reachKm = Math.max(10, ctx.rules.contactKm * 2);
    const near = state.formations.some((f) => f.side === a.side && onMap(f, t) && dist(T.proj.toXY(f.position), T.proj.toXY(r.at)) <= reachKm);
    if (!near) return { ok: false, text: `рядом (до ${reachKm} км) нет наших войск — некому прикрыть наводку` };
    const eta = addHours(t, r.major ? eng.bridgeHoursMajor : eng.bridgeHoursMinor);
    return { ok: true, at: r.at, eta, text: `${r.major ? 'большая' : 'малая'} река; переправа будет готова ≈ ${eta.slice(8, 10)}.${eta.slice(5, 7)} ${eta.slice(11, 16)}` };
  }
  if (a.kind === 'demolish') {
    const P = T.proj.toXY(a.at);
    const open = T.data.bridges.filter((b) => (!b.openFrom || b.openFrom <= t) && (!b.destroyedAt || b.destroyedAt > t))
      .map((b) => ({ b, d: dist(T.proj.toXY(b.at), P) })).filter((x) => x.d <= Math.max(3, T.cellKm * 2)).sort((x, y) => x.d - y.d)[0];
    if (!open) return { ok: false, text: 'рядом нет действующего моста или переправы' };
    if (!own(ctx, state, a.side, open.b.at)) return { ok: false, text: 'мост не на нашей территории — подорвать некому' };
    const eta = addHours(t, 2);
    return { ok: true, at: open.b.at, eta, text: `${open.b.name ?? 'мост'} будет подорван ≈ ${eta.slice(8, 10)}.${eta.slice(5, 7)} ${eta.slice(11, 16)}`, bridge: open.b.id };
  }
  const f = state.formations.find((x) => x.id === a.formation);
  if (!f || f.side !== a.side || !f.reserveFrom) return { ok: false, text: 'это не резерв, ожидающий ввода' };
  if (!own(ctx, state, a.side, a.at)) return { ok: false, text: 'район сосредоточения — не на своей территории' };
  const eta = maxH(f.reserveFrom, addHours(t, 24));
  return { ok: true, eta, text: `сосредоточится в районе ≈ ${eta.slice(8, 10)}.${eta.slice(5, 7)} ${eta.slice(11, 16)}${f.reserveFrom > addHours(t, 24) ? ' (раньше резерв не готов)' : ''}` };
}

/** Исполнить распоряжения в начале хода; неисполнимые — с причиной. */
export function applyActions(ctx: SimContext, state: SimState, actions: StaffAction[]): { state: SimState; results: { action: StaffAction; ok: boolean; text: string }[] } {
  let s: SimState = { ...state, formations: [...state.formations], logistics: state.logistics ? { ...state.logistics } : undefined };
  const results: { action: StaffAction; ok: boolean; text: string }[] = [];
  let bridges = 0;
  for (const a of actions) {
    const c = checkAction(ctx, s, a, 0);
    results.push({ action: a, ok: c.ok, text: c.text });
    if (!c.ok) continue;
    if (a.kind === 'base') {
      const lg = s.logistics![a.side];
      s.logistics![a.side] = { ...lg, bases: lg.bases.map((b) => (b.id === a.base ? { ...b, at: a.to, name: a.toName ?? describePlace(ctx.theatre, a.to).replace(/^у /, ''), activeFrom: c.eta!, moved: true } : b)) };
    } else if (a.kind === 'priority') {
      const lg = s.logistics?.[a.side] ?? { bases: [], priority: [] };
      s.logistics = { ...(s.logistics ?? {}), [a.side]: { ...lg, priority: [...a.formations] } };
    } else if (a.kind === 'bridge') {
      bridges++;
      ctx.theatre.addBridge({ id: `u_${s.time}_${bridges}`, at: c.at!, name: `переправа ${describePlace(ctx.theatre, c.at!)}`, openFrom: c.eta!, side: a.side, kind: 'crossing' });
    } else if (a.kind === 'demolish') {
      ctx.theatre.destroyBridge(c.bridge!, c.eta!);
    } else {
      s.formations = s.formations.map((f) => (f.id === a.formation ? { ...f, position: a.at, enterAt: c.eta!, reserveFrom: undefined } : f));
    }
  }
  s = { ...s };
  return { state: s, results };
}
