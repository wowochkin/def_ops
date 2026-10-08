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
import type { CombatFactor, Formation, JournalEntry, Order, Posture, Rules, Scenario, SideProfile, SimState, Target, Task } from './types';
import { claimTerritory, controlMap, initialTerritory, supplyField } from './control';

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

/** Формирование на театре в момент time: не уничтожено и уже введено. */
export const onMap = (f: Formation, time: string) => !f.destroyed && (!f.enterAt || f.enterAt <= time);

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
    order: null, route: null, destroyed: false, enterAt: f.enterAt ?? null,
  }));
  return { scenario: ctx.scenario.id, time: ctx.scenario.start, turn: 0, formations, pending: [...ctx.scenario.orders], rngState: seed >>> 0, journal: [] };
}

/** Принять приказ в любой момент (от эксперта, модели или сценария): исполнение — после задержки доведения. */
export function issueOrder(state: SimState, order: Order): SimState {
  return { ...state, pending: [...state.pending, order] };
}

/** Точка цели: координаты, центр района или текущее положение формирования (если оно на карте). */
export function targetPoint(ctx: SimContext, t: Target | undefined, units?: Map<string, Formation>): LngLat | null {
  if (!t) return null;
  if (Array.isArray(t)) return t;
  if (typeof t === 'object') { const u = units?.get(t.formation); return u && !u.destroyed ? u.position : null; }
  return ctx.theatre.area(t)?.center ?? null;
}

/**
 * Источники снабжения стороны — точки (районы — их центры). Тыл под управлением штаба (logistics) —
 * его базы: перенесённая база действует с activeFrom и только на своей территории.
 */
export function supplySources(ctx: SimContext, side: string, time: string, logistics?: SimState['logistics'], territory?: ArrayLike<number> | null): LngLat[] {
  const lg = logistics?.[side];
  if (lg) {
    const k = ctx.scenario.sides.findIndex((x) => x.id === side);
    return lg.bases.filter((b) => (!b.activeFrom || b.activeFrom <= time) && (!b.moved || !territory || territory[ctx.theatre.indexOf(b.at)] === k)).map((b) => b.at);
  }
  const sp = ctx.scenario.supply?.[side];
  const all = [...(sp?.sources ?? []), ...(sp?.phases ?? []).filter((p) => p.from <= time && (!p.until || time < p.until)).flatMap((p) => p.sources)];
  return all.map((x) => (Array.isArray(x) ? x : ctx.theatre.area(x)?.center ?? null)).filter((x): x is LngLat => !!x);
}

/** Контроль территории и время подвоза по сторонам на начало хода. */
export function supplyState(ctx: SimContext, units: Formation[], time: string, territory?: Int8Array | null, logistics?: SimState['logistics']) {
  const sides = ctx.scenario.sides.map((x) => x.id);
  // территория — по положению войск больше, чем по их силе (показатель 0,1): фронтовые части стоят на своей земле
  const control = controlMap(ctx.theatre, units, sides, (f) => power(f, profileOf(ctx, f.side), ctx.rules).total, 10, 0.1);
  const fields = new Map<string, Float64Array>();
  for (const side of sides) {
    const src = supplySources(ctx, side, time, logistics, territory);
    // зона влияния: наступающие и на марше — радиус соприкосновения; в обороне (кольцо окружения) — половина полосы
    const zoc = (f: Formation) => f.posture === 'attack' || f.posture === 'march' ? ctx.rules.contactKm
      : Math.max(ctx.rules.contactKm, (profileOf(ctx, f.side).unitTypes[f.type]?.frontageKm ?? 0) / 2);
    const terr = territory ? { owner: territory, side: sides.indexOf(side), ownZoneKm: ctx.rules.contactKm / 2 } : undefined;
    if (src.length) fields.set(side, supplyField(ctx.theatre, side, src, units, profileOf(ctx, side), ctx.rules, time, zoc, terr).hours);
  }
  return { control, fields };
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
  const active = () => fs.filter((f) => onMap(f, now));

  // 1. приказы, дошедшие до исполнителя к концу хода
  const pending: Order[] = [];
  for (const o of [...prev.pending].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))) {
    const f = byId.get(o.formation);
    if (!f || f.destroyed) continue;
    if (!onMap(f, end)) { pending.push(o); continue; } // ещё не прибыло — приказ ждёт
    const delay = profileOf(ctx, f.side).orderDelayHours[f.echelon] ?? 0;
    if (t2ms(addHours(o.issuedAt, delay)) <= t2ms(end)) {
      f.order = o;
      f.posture = POSTURE[o.task];
      f.route = null;
      journal.push({ kind: 'order', time: now, formation: f.id, order: o, effective: true });
    } else pending.push(o);
  }

  // территория (если ведётся): с прошлого хода или исходная — по ближайшим войскам и тылам сторон
  const sides = ctx.scenario.sides.map((x) => x.id);
  const sideIdx = (side: string) => sides.indexOf(side);
  const terr: Int8Array | null = !R.territory ? null : prev.territory ? Int8Array.from(prev.territory)
    : initialTerritory(T, [
      ...active().map((f) => ({ side: sideIdx(f.side), at: f.position })),
      ...sides.flatMap((sd) => supplySources(ctx, sd, now, prev.logistics).map((at) => ({ side: sideIdx(sd), at }))),
    ], sides);
  // по территории противника — медленнее (заслоны, разрушения, зачистка)
  const terrCost = (f: Formation, mob: string) => {
    const cap = R.territory?.enemyKmPerDay[mob as keyof NonNullable<Rules['territory']>['enemyKmPerDay']];
    if (!terr || !cap) return () => 0;
    const k = sideIdx(f.side), h = (T.cellKm * 24) / cap;
    return (i: number) => (terr[i] >= 0 && terr[i] !== k ? h : 0);
  };
  // контроль территории и подвоз — по положению на начало хода
  const sup = ctx.scenario.supply || prev.logistics ? supplyState(ctx, active(), now, terr, prev.logistics) : null;
  // подвоз к формированию — к тыловой части его полосы (hoursNear)
  const supplyHours = (f: Formation, at: LngLat = f.position) => {
    const fld = sup?.fields.get(f.side);
    return fld ? hoursNear(ctx, fld, at) : 0;
  };
  const range = (f: Formation) => profileOf(ctx, f.side).supply?.rangeHours ?? Infinity;
  const isCut = (f: Formation) => !!sup?.fields.get(f.side) && supplyHours(f) > range(f);

  // полоса обороны: обороняющийся связывает боем наступающих в пределах половины своей ширины полосы
  const reach = (e: Formation) => {
    if (e.posture === 'attack' || e.posture === 'march') return R.contactKm;
    const w = profileOf(ctx, e.side).unitTypes[e.type]?.frontageKm ?? 0;
    return Math.max(R.contactKm, w / 2);
  };
  // обход узлов обороны: подвижные соединения с целью дальше крепости не ввязываются в бой за неё
  const bypasses = (f: Formation, e: Formation) => {
    if (R.bypassStrongpoints === false || !profileOf(ctx, e.side).unitTypes[e.type]?.bypassable) return false;
    if ((profileOf(ctx, f.side).unitTypes[f.type]?.mobility ?? 'foot') === 'foot') return false;
    const to = f.order ? targetPoint(ctx, f.order.target, byId) : null;
    return !!to && dist(T.proj.toXY(to), xy(e)) > Math.max(R.contactKm, reach(e));
  };
  const enemiesNear = (f: Formation, km: number) => active().filter((e) => e.side !== f.side && !bypasses(f, e) && dist(xy(f), xy(e)) <= Math.max(km, reach(e)));
  // укреплённые полосы противника: задержка на клетку за уровень, пока полоса не прорвана
  const breached = new Set(prev.breached ?? []);
  const fortCost = (f: Formation) => (i: number) => {
    const lv = T.fort[i], owner = T.fortSide[i];
    return lv && owner && owner !== f.side && !breached.has(i) ? (R.fortCrossHours ?? 0) * lv : 0;
  };
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
  const env: CombatEnv = { byId, supplyHours, isCut };
  for (const g of groups) resolveCombat(g.att, g.def, ctx, rng, now, dt, journal, moved, env);

  // 3. движение вне боя
  for (const f of active()) {
    if (moved.has(f.id) || !f.order) continue;
    const to = targetPoint(ctx, f.order.target, byId);
    if (!to) continue;
    const prof = profileOf(ctx, f.side);
    const type = prof.unitTypes[f.type];
    const mob = type?.mobility === 'foot' || f.fuel > 0 ? type?.mobility ?? 'foot' : 'foot';
    if (dist(xy(f), T.proj.toXY(to)) < 0.5) { if (f.posture === 'march' || f.posture === 'withdraw') f.posture = 'defend'; continue; }
    const fc = fortCost(f), tc = terrCost(f, mob);
    const r = T.advance(f.position, to, mob, prof, R, now, dt, (i) => fc(i) + tc(i));
    if (!r) continue;
    let pos = r.position;
    // встреча с противником останавливает движение: наступающие — войдя в соприкосновение (бой — в следующий ход),
    // остальные — не доходя до него
    const stop = stopShortOfEnemy(f, pos, active().filter((e) => !bypasses(f, e)), T, (e) => (f.posture === 'attack' ? 0.8 : 1) * Math.max(R.contactKm, reach(e)), R.contactKm * 0.5);
    if (stop) pos = stop;
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
    // подвоз: по своей территории от источников стороны
    const ps = prof.supply;
    if (ps && sup?.fields.get(f.side)) {
      // окружение — когда подвоз не доходит дольше rules.encircleHours (по умолчанию 36 ч, т. е. два хода подряд):
      // разовый разрыв на стыке не считается котлом
      const blocked = isCut(f);
      f.cutHours = blocked ? (f.cutHours ?? 0) + dt : 0;
      const cut = f.cutHours >= (R.encircleHours ?? 36);
      if (cut !== !!f.cutOff) journal.push({ kind: 'encircled', time: now, formation: f.id, cut });
      f.cutOff = cut;
      if (!blocked) {
        // приоритет подвоза (тыл под управлением штаба): приоритетным — больше, остальным — меньше
        const pr = prev.logistics?.[f.side]?.priority ?? [];
        const k = pr.length ? (pr.includes(f.id) ? 1.5 : 0.75) : 1;
        f.ammo = Math.min(ps.maxAmmo, f.ammo + ps.ammoPerDay * k * (dt / 24));
        f.fuel = Math.min(ps.maxFuel, f.fuel + ps.fuelPerDay * k * (dt / 24));
      }
    }
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

  // территория: клетки на пути и вокруг положения формирований переходят к их стороне, если противник к ним не ближе
  if (terr && R.territory) {
    const before = new Map(prev.formations.map((f) => [f.id, f.position]));
    const live = active();
    const rk = R.territory.radiusKm;
    const enemyCloser = (side: number, p: XY, km: number) => live.some((e) => sideIdx(e.side) !== side && dist(xy(e), p) < km);
    // отходящие чужую землю не занимают (иначе отход сквозь тыл противника рвёт его коридоры подвоза)
    claimTerritory(T, terr, live.filter((f) => f.posture !== 'withdraw').map((f) => ({ side: sideIdx(f.side), from: before.get(f.id) ?? f.position, to: f.position })), enemyCloser, rk);
    // клетка, где стоит формирование, — его стороны (если там нет и противника)
    const at = new Map<number, Set<number>>();
    for (const f of live) { const i = T.indexOf(f.position); if (i >= 0) at.set(i, (at.get(i) ?? new Set()).add(sideIdx(f.side))); }
    for (const [i, ss] of at) if (ss.size === 1) terr[i] = [...ss][0];
  }

  // занятые клетки чужих укреплённых полос — прорваны
  for (const f of active()) {
    const i = T.indexOf(f.position);
    if (i >= 0 && T.fort[i] && T.fortSide[i] && T.fortSide[i] !== f.side) breached.add(i);
  }
  return { ...prev, time: end, turn: prev.turn + 1, formations: fs, pending, rngState: rng.state(), journal: [...prev.journal, ...journal], breached: [...breached], ...(terr ? { territory: Array.from(terr) } : {}) };
}

/**
 * Время подвоза до формирования, часов: к любой клетке его полосы в пределах половины дистанции боя —
 * армия и корпус занимают район в несколько км глубиной, подвоз приходит к их тыловой части,
 * а не к точке знака (иначе вплотную к узлу обороны противника знак «отрезан»).
 */
function hoursNear(ctx: SimContext, fld: Float64Array, at: LngLat): number {
  const T = ctx.theatre, supKm = Math.max(ctx.rules.contactKm / 2, 1);
  const i = T.indexOf(at);
  if (i < 0) return Infinity;
  const p0 = T.proj.toXY(at), c0 = i % T.cols, r0 = Math.floor(i / T.cols);
  const rc = Math.max(1, Math.ceil(supKm / T.cellKm) + 1);
  let best = Infinity;
  for (let r = r0 - rc; r <= r0 + rc; r++) for (let c = c0 - rc; c <= c0 + rc; c++) {
    if (!T.inside(c, r)) continue;
    const q = T.cellCenter(c, r);
    if (Math.hypot(q[0] - p0[0], q[1] - p0[1]) <= Math.max(supKm, T.cellKm * 1.5)) best = Math.min(best, fld[r * T.cols + c]);
  }
  return best;
}

/** Время подвоза до формирований стороны на начало хода, часов (Infinity — не доходит), и предел стороны. */
export function supplyHoursOf(ctx: SimContext, state: SimState, side: string): { hours: Map<string, number>; rangeHours: number } {
  const units = state.formations.filter((f) => onMap(f, state.time));
  const terr = state.territory ? Int8Array.from(state.territory) : null;
  const sup = supplyState(ctx, units, state.time, terr, state.logistics);
  const fld = sup.fields.get(side);
  const hours = new Map(units.filter((f) => f.side === side).map((f) => [f.id, fld ? hoursNear(ctx, fld, f.position) : 0]));
  return { hours, rangeHours: profileOf(ctx, side).supply?.rangeHours ?? Infinity };
}

/** Остановиться, не доходя до противника ближе расстояния соприкосновения. */
function stopShortOfEnemy(f: Formation, to: LngLat, all: Formation[], T: Theatre, radius: (e: Formation) => number, inner = 0): LngLat | null {
  const a = T.proj.toXY(f.position), b = T.proj.toXY(to);
  const enemies = all.filter((e) => e.side !== f.side).map((e) => ({ p: T.proj.toXY(e.position), r: radius(e) }));
  // уже в зоне противника — можно подходить до дистанции боя (inner), но не глубже: без боя сквозь противника не пройти
  const hit = (q: XY) => enemies.some((e) => { const d0 = dist(a, e.p), d = dist(q, e.p); return d < e.r && (d0 >= e.r * 0.999 || (d < inner && d < d0 - 0.05)); });
  if (!hit(b)) return null;
  let lo = 0, hi = 1;
  for (let i = 0; i < 20; i++) {
    const m = (lo + hi) / 2;
    const p: XY = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
    if (hit(p)) hi = m; else lo = m;
  }
  return T.proj.toLL([a[0] + (b[0] - a[0]) * lo, a[1] + (b[1] - a[1]) * lo]);
}

function applyLoss(f: Formation, frac: number) {
  const k = Math.max(0, 1 - frac);
  f.personnel = Math.round(f.personnel * k);
  f.tanks = Math.round(f.tanks * (1 - Math.min(1, frac * 1.3)));
  f.guns = Math.round(f.guns * (1 - Math.min(1, frac * 0.8)));
}

interface CombatEnv {
  byId: Map<string, Formation>;
  /** Часы подвоза к точке для формирования (Infinity — не доходит). */
  supplyHours: (f: Formation, at?: LngLat) => number;
  isCut: (f: Formation) => boolean;
}

function resolveCombat(att: Formation[], def: Formation[], ctx: SimContext, rng: Rng, now: string, dt: number, journal: JournalEntry[], moved: Set<string>, env: CombatEnv) {
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
  // темп — по таблице от соотношения сил, с поправкой на местность обороняющихся (город — кварталами)
  const at = def.reduce((m, f) => Math.min(m, R.advanceTerrain?.[T.terrainAt(f.position)] ?? 1), 1);
  // укреплённая полоса: темп не выше предельного для её уровня («прогрызание» обороны)
  const fortLv = def.reduce((m, f) => Math.max(m, T.fortificationAt(f.position)), 0);
  const cap = fortLv && R.fortAdvanceKm ? R.fortAdvanceKm[Math.min(fortLv, R.fortAdvanceKm.length - 1)] ?? Infinity : Infinity;
  const freePace = interp(R.advance, ratio) * at;
  const advancePerDay = Math.min(freePace, cap);
  // «удерживать любой ценой»: обороняющиеся не отходят и несут повышенные потери;
  // наступающие продвигаются, только если оборона прорвана (обходят узел сопротивления)
  // окружённые не могут отойти: держатся на месте с повышенными потерями
  const pinned = (f: Formation) => f.order?.task === 'hold' || !!f.cutOff;
  const holding = def.every(pinned);
  // прорыв — по темпу без предела полосы: предел ограничивает скорость «прогрызания», но не исключает прорыв
  const breakthrough = freePace >= BREAKTHROUGH_KM;
  // городской бой (rules.holdGivesGround): «держаться» — не отходить по своей воле, но квартал за кварталом уступать
  const yields = !!R.holdGivesGround;
  // уличный бой: оборона в застройке «держится», но наступающие берут квартал за кварталом (с городским темпом),
  // а не стоят перед узлом, пока он не рухнет целиком
  const streetFight = def.every((f) => T.terrainAt(f.position) === 'urban');
  const advanceKm = holding && !breakthrough && !yields && !streetFight ? 0 : advancePerDay * day;
  const attackerLoss = interp(R.attackerLoss, ratio) * day;
  const defenderLoss = interp(R.defenderLoss, ratio) * day * (holding && advancePerDay > 0 ? 1.5 : 1);
  const factors: CombatFactor[] = [
    { name: 'сила наступающих', value: +A.toFixed(1) },
    { name: 'сила обороняющихся (без поправок)', value: +dParts.reduce((s, x) => s + x.p, 0).toFixed(1) },
    { name: 'местность', value: +avg('terrain').toFixed(2) },
    { name: 'подготовленная оборона', value: +avg('prepared').toFixed(2) },
    { name: 'укрепления', value: +avg('fort').toFixed(2) },
    { name: 'случайность (разброс)', value: +noise.toFixed(2) },
    ...(at < 1 ? [{ name: 'темп по местности', value: +at.toFixed(2) }] : []),
    ...(Number.isFinite(cap) ? [{ name: 'предел темпа в укреплённой полосе, км/сут', value: cap }] : []),
  ];
  for (const f of att) applyLoss(f, attackerLoss);
  for (const f of def) applyLoss(f, defenderLoss);

  // продвижение: наступающие — к своим целям, обороняющиеся отходят от центра наступающих
  if (advanceKm > 0.05) {
    const ca = centerXY(att.map((f) => T.proj.toXY(f.position)));
    for (const f of att) {
      const to = targetPoint(ctx, f.order?.target, env.byId);
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
      if (pinned(f) && !yields) continue;
      const p = T.proj.toXY(f.position);
      const np = retreatPoint(f, p, ca, advanceKm, T, env);
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

/**
 * Куда отходит обороняющийся: из 16 направлений — то, где подвоз ближе (к своим
 * тылам), при равенстве — прочь от наступающих.
 */
function retreatPoint(f: Formation, p: XY, attackersCenter: XY, km: number, T: Theatre, env: CombatEnv): LngLat {
  const away: XY = [p[0] - attackersCenter[0], p[1] - attackersCenter[1]];
  const an = Math.hypot(away[0], away[1]) || 1;
  let best: LngLat | null = null, bestScore = Infinity;
  for (let k = 0; k < 16; k++) {
    const a = (Math.PI * 2 * k) / 16;
    const q: XY = [p[0] + Math.cos(a) * km, p[1] + Math.sin(a) * km];
    const ll = T.proj.toLL(q);
    const h = env.supplyHours(f, ll);
    if (!Number.isFinite(h) || T.terrainAt(ll) === 'water') continue;
    const awayDot = (Math.cos(a) * away[0] + Math.sin(a) * away[1]) / an; // 1 — прямо от противника
    const score = h - awayDot * 6; // 6 ч подвоза ≈ выигрыш отхода прямо от противника
    if (score < bestScore) { bestScore = score; best = ll; }
  }
  return best ?? T.proj.toLL([p[0] + (away[0] / an) * km, p[1] + (away[1] / an) * km]);
}

function centerXY(ps: XY[]): XY {
  return [ps.reduce((s, p) => s + p[0], 0) / ps.length, ps.reduce((s, p) => s + p[1], 0) / ps.length];
}
