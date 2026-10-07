/**
 * Ход симуляции. Порядок внутри хода:
 *  1. приказы, дошедшие до исполнителей (с учётом задержки доведения);
 *  2. бои — наступающие в соприкосновении с противником: соотношение сил с
 *     поправками и случайным разбросом → продвижение и потери по таблицам;
 *  3. движение остальных по маршрутам (не входя в соприкосновение без приказа
 *     на наступление);
 *  4. снабжение, усталость, подготовка обороны, потеря боеспособности.
 * Каждое изменение записывается в журнал с причиной. Состояние не изменяется
 * на месте: ход возвращает новое.
 */
import type { LngLat } from '@def-ops/core';
import { createRng, type Rng } from './rng';
import { dist, type XY } from './geo';
import { interp, power } from './rules';
import type { Theatre } from './theatre';
import type { CombatFactor, Formation, JournalEntry, Order, Posture, Rules, Scenario, SideProfile, SimState, Task } from './types';

export interface SimContext {
  scenario: Scenario;
  theatre: Theatre;
  /** Профили сторон по id профиля. */
  profiles: Record<string, SideProfile>;
  rules: Rules;
}

const HOUR = 3600_000;
/** Темп, км/сутки, начиная с которого оборона считается прорванной. */
const BREAKTHROUGH_KM = 10;
export const addHours = (iso: string, h: number) => new Date(Date.parse(iso + (iso.length <= 16 ? ':00Z' : iso.endsWith('Z') ? '' : 'Z')) + h * HOUR).toISOString().slice(0, 16);
const t2ms = (iso: string) => Date.parse(iso + (iso.length <= 16 ? ':00Z' : iso.endsWith('Z') ? '' : 'Z'));

const POSTURE: Record<Task, Posture> = {
  attack: 'attack', counterattack: 'attack', breakout: 'attack', relieve: 'attack',
  defend: 'defend', hold: 'defend', delay: 'defend', withdraw: 'withdraw', regroup: 'march', reserve: 'reserve',
};

export function profileOf(ctx: SimContext, side: string): SideProfile {
  const s = ctx.scenario.sides.find((x) => x.id === side);
  const p = s && ctx.profiles[s.profile];
  if (!p) throw new Error(`нет профиля для стороны ${side}`);
  return p;
}

/** Начальное состояние: действующие формирования — те, у кого есть положение и тип. */
export function createState(ctx: SimContext, seed = 1): SimState {
  const formations: Formation[] = ctx.scenario.formations.filter((f) => f.position && f.type).map((f) => ({
    id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent: f.parent ?? null, type: f.type!, position: f.position!,
    personnel: f.personnel ?? 0, tanks: f.tanks ?? 0, guns: f.guns ?? 0,
    initial: { personnel: f.personnel ?? 0, tanks: f.tanks ?? 0, guns: f.guns ?? 0 },
    ammo: f.ammo ?? 2, fuel: f.fuel ?? 2, fatigue: 0, posture: f.posture ?? 'defend', dugInHours: f.posture === 'defend' ? 48 : 0,
    order: null, route: null, destroyed: false,
  }));
  return { scenario: ctx.scenario.id, time: ctx.scenario.start, turn: 0, formations, pending: [...ctx.scenario.orders], rngState: seed >>> 0, journal: [] };
}

/** Принять приказ в любой момент (от эксперта, модели или сценария): исполнение — после задержки доведения. */
export function issueOrder(state: SimState, order: Order): SimState {
  return { ...state, pending: [...state.pending, order] };
}

export function targetPoint(ctx: SimContext, t: Order['target']): LngLat | null {
  if (!t) return null;
  if (Array.isArray(t)) return t;
  return ctx.theatre.area(t)?.center ?? null;
}

export function step(prev: SimState, ctx: SimContext): SimState {
  const dt = ctx.scenario.turnHours;
  const now = prev.time;
  const end = addHours(now, dt);
  const rng = createRng(prev.rngState);
  const T = ctx.theatre, R = ctx.rules;
  const fs: Formation[] = prev.formations.map((f) => ({ ...f, position: [...f.position] as LngLat }));
  const byId = new Map(fs.map((f) => [f.id, f]));
  const journal: JournalEntry[] = [];
  const xy = (f: Formation): XY => T.proj.toXY(f.position);
  const active = () => fs.filter((f) => !f.destroyed);

  // 1. приказы, дошедшие до исполнителя к концу хода
  const pending: Order[] = [];
  for (const o of [...prev.pending].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))) {
    const f = byId.get(o.formation);
    if (!f || f.destroyed) continue;
    const delay = profileOf(ctx, f.side).orderDelayHours[f.echelon] ?? 0;
    if (t2ms(addHours(o.issuedAt, delay)) <= t2ms(end)) {
      f.order = o;
      f.posture = POSTURE[o.task];
      f.route = null;
      journal.push({ kind: 'order', time: now, formation: f.id, order: o, effective: true });
    } else pending.push(o);
  }

  const enemiesNear = (f: Formation, km: number) => active().filter((e) => e.side !== f.side && dist(xy(f), xy(e)) <= km);
  const moved = new Set<string>();

  // 2. бои: наступающие в соприкосновении; общие обороняющиеся объединяют наступающих в одно сражение
  const attackers = active().filter((f) => f.posture === 'attack' && enemiesNear(f, R.contactKm).length);
  const groups: { att: Formation[]; def: Formation[] }[] = [];
  for (const a of attackers) {
    const defs = enemiesNear(a, R.contactKm);
    const g = groups.find((x) => x.def.some((d) => defs.includes(d)));
    if (g) { g.att.push(a); for (const d of defs) if (!g.def.includes(d)) g.def.push(d); }
    else groups.push({ att: [a], def: defs });
  }
  for (const g of groups) resolveCombat(g.att, g.def, ctx, rng, now, dt, journal, moved);

  // 3. движение вне боя
  for (const f of active()) {
    if (moved.has(f.id) || !f.order) continue;
    const to = targetPoint(ctx, f.order.target);
    if (!to) continue;
    const prof = profileOf(ctx, f.side);
    const type = prof.unitTypes[f.type];
    const mob = type?.mobility === 'foot' || f.fuel > 0 ? type?.mobility ?? 'foot' : 'foot';
    if (dist(xy(f), T.proj.toXY(to)) < 0.5) { if (f.posture === 'march' || f.posture === 'withdraw') f.posture = 'defend'; continue; }
    const r = T.advance(f.position, to, mob, prof, R, now, dt);
    if (!r) continue;
    let pos = r.position;
    // без приказа на наступление в соприкосновение не входить: остановиться на рубеже соприкосновения
    if (f.posture !== 'attack') {
      const stop = stopShortOfEnemy(f, pos, active(), T, R.contactKm);
      if (stop) pos = stop;
    }
    const km = dist(xy(f), T.proj.toXY(pos));
    if (km > 0.05) {
      journal.push({ kind: 'move', time: now, formation: f.id, from: f.position, to: pos, km: +km.toFixed(1) });
      f.position = pos;
      moved.add(f.id);
      f.route = r.path;
    }
    if (r.arrived && (f.posture === 'march' || f.posture === 'withdraw' || f.posture === 'reserve')) f.posture = f.posture === 'reserve' ? 'reserve' : 'defend';
  }

  // 4. снабжение, усталость, оборона, потеря боеспособности
  const inCombat = new Set(groups.flatMap((g) => [...g.att, ...g.def].map((f) => f.id)));
  for (const f of active()) {
    const prof = profileOf(ctx, f.side);
    const posture: Posture = moved.has(f.id) && !inCombat.has(f.id) ? 'march' : f.posture;
    const c = prof.consumption[posture];
    const was = { ammo: f.ammo, fuel: f.fuel };
    f.ammo = Math.max(0, f.ammo - c.ammo * (dt / 24) * (inCombat.has(f.id) ? 1 : 0.3));
    f.fuel = Math.max(0, f.fuel - c.fuel * (dt / 24));
    if (was.ammo >= 0.5 && f.ammo < 0.5) journal.push({ kind: 'supply', time: now, formation: f.id, what: 'ammo', left: +f.ammo.toFixed(2) });
    if (was.fuel > 0 && f.fuel <= 0) journal.push({ kind: 'supply', time: now, formation: f.id, what: 'fuel', left: 0 });
    const gain = inCombat.has(f.id) ? R.fatigueGain.combat : moved.has(f.id) ? R.fatigueGain.march : -R.fatigueGain.rest;
    f.fatigue = Math.min(1, Math.max(0, f.fatigue + gain * (dt / 24)));
    f.dugInHours = f.posture === 'defend' && !moved.has(f.id) ? f.dugInHours + dt : 0;
    if (f.initial.personnel > 0 && f.personnel < 0.15 * f.initial.personnel) {
      f.destroyed = true;
      journal.push({ kind: 'destroyed', time: now, formation: f.id });
    }
  }

  return { ...prev, time: end, turn: prev.turn + 1, formations: fs, pending, rngState: rng.state(), journal: [...prev.journal, ...journal] };
}

/** Остановиться, не доходя до противника ближе расстояния соприкосновения. */
function stopShortOfEnemy(f: Formation, to: LngLat, all: Formation[], T: Theatre, contactKm: number): LngLat | null {
  const a = T.proj.toXY(f.position), b = T.proj.toXY(to);
  const enemies = all.filter((e) => e.side !== f.side).map((e) => T.proj.toXY(e.position));
  if (!enemies.some((e) => dist(b, e) < contactKm)) return null;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    const p: XY = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
    if (enemies.some((e) => dist(p, e) < contactKm)) hi = m; else lo = m;
  }
  return T.proj.toLL([a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo]);
}

function applyLoss(f: Formation, frac: number) {
  const k = Math.max(0, 1 - frac);
  f.personnel = Math.round(f.personnel * k);
  f.tanks = Math.round(f.tanks * (1 - Math.min(1, frac * 1.3)));
  f.guns = Math.round(f.guns * (1 - Math.min(1, frac * 0.8)));
}

function resolveCombat(att: Formation[], def: Formation[], ctx: SimContext, rng: Rng, now: string, dt: number, journal: JournalEntry[], moved: Set<string>) {
  const T = ctx.theatre, R = ctx.rules;
  const A = att.reduce((s, f) => s + power(f, profileOf(ctx, f.side), R).total, 0);
  const dParts = def.map((f) => {
    const p = power(f, profileOf(ctx, f.side), R).total;
    const terrain = R.defense.terrain[T.terrainAt(f.position)] ?? 1;
    const prepared = f.posture === 'defend' && f.dugInHours >= R.defense.prepareHours ? R.defense.prepared : 1;
    const fort = 1 + R.defense.fortificationPerLevel * T.fortificationAt(f.position);
    return { f, p, terrain, prepared, fort, total: p * terrain * prepared * fort };
  });
  const D = dParts.reduce((s, x) => s + x.total, 0);
  if (D <= 0 || A <= 0) return;
  const avg = (k: 'terrain' | 'prepared' | 'fort') => dParts.reduce((s, x) => s + x[k] * x.p, 0) / Math.max(1e-9, dParts.reduce((s, x) => s + x.p, 0));
  const noise = Math.exp(R.noise * rng.normal());
  const ratio = (A / D) * noise;
  const day = dt / 24;
  const advancePerDay = interp(R.advance, ratio);
  // «удерживать любой ценой»: обороняющиеся не отходят и несут повышенные потери;
  // наступающие продвигаются, только если оборона прорвана (обходят узел сопротивления)
  const holding = def.every((f) => f.order?.task === 'hold');
  const breakthrough = advancePerDay >= BREAKTHROUGH_KM;
  const advanceKm = holding && !breakthrough ? 0 : advancePerDay * day;
  const attackerLoss = interp(R.attackerLoss, ratio) * day;
  const defenderLoss = interp(R.defenderLoss, ratio) * day * (holding && advancePerDay > 0 ? 1.5 : 1);
  const factors: CombatFactor[] = [
    { name: 'сила наступающих', value: +A.toFixed(1) },
    { name: 'сила обороняющихся (без поправок)', value: +dParts.reduce((s, x) => s + x.p, 0).toFixed(1) },
    { name: 'местность', value: +avg('terrain').toFixed(2) },
    { name: 'подготовленная оборона', value: +avg('prepared').toFixed(2) },
    { name: 'укрепления', value: +avg('fort').toFixed(2) },
    { name: 'случайность (разброс)', value: +noise.toFixed(2) },
  ];
  for (const f of att) applyLoss(f, attackerLoss);
  for (const f of def) applyLoss(f, defenderLoss);

  // продвижение: наступающие — к своим целям, обороняющиеся отходят от центра наступающих
  if (advanceKm > 0.05) {
    const ca = centerXY(att.map((f) => T.proj.toXY(f.position)));
    for (const f of att) {
      const to = targetPoint(ctx, f.order?.target);
      const p = T.proj.toXY(f.position);
      const goal = to ? T.proj.toXY(to) : null;
      if (!goal) continue;
      const d = dist(p, goal);
      const k = d > 0 ? Math.min(1, advanceKm / d) : 0;
      const np = T.proj.toLL([p[0] + (goal[0] - p[0]) * k, p[1] + (goal[1] - p[1]) * k]);
      journal.push({ kind: 'move', time: now, formation: f.id, from: f.position, to: np, km: +(d * k).toFixed(1) });
      f.position = np;
      moved.add(f.id);
    }
    for (const f of def) {
      if (f.order?.task === 'hold') continue;
      const p = T.proj.toXY(f.position);
      const v: XY = [p[0] - ca[0], p[1] - ca[1]];
      const n = Math.hypot(v[0], v[1]) || 1;
      const np = T.proj.toLL([p[0] + (v[0] / n) * advanceKm, p[1] + (v[1] / n) * advanceKm]);
      journal.push({ kind: 'move', time: now, formation: f.id, from: f.position, to: np, km: +advanceKm.toFixed(1) });
      f.position = np;
      f.dugInHours = 0;
      moved.add(f.id);
    }
  }
  for (const f of att) moved.add(f.id);
  const outcome = breakthrough ? 'breakthrough' : advanceKm > 0.5 ? 'advance' : ratio < 1 ? 'repelled' : 'held';
  journal.push({
    kind: 'combat', time: now, attackers: att.map((f) => f.id), defenders: def.map((f) => f.id),
    at: T.proj.toLL(centerXY([...att, ...def].map((f) => T.proj.toXY(f.position)))),
    ratio: +ratio.toFixed(2), factors, noise: +noise.toFixed(2), advanceKm: +advanceKm.toFixed(1),
    attackerLoss: +attackerLoss.toFixed(3), defenderLoss: +defenderLoss.toFixed(3), outcome,
  });
}

function centerXY(ps: XY[]): XY {
  return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
}
