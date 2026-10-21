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
import { describePlace } from './reports';
import { trailTo, type Theatre } from './theatre';
import type { CombatFactor, Formation, JournalEntry, Mobility, Order, Posture, Regime, Rules, Scenario, SideProfile, SimState, Target, Task, UmpireFactor, UmpireMod } from './types';
import { REGIME_RU, UMPIRE_FACTOR_RU, UMPIRE_FACTORS, UMPIRE_LIMITS } from './types';
import { claimTerritory, controlMap, initialTerritory, supplyField } from './control';
import { activeBoundaries, checkTriggers, effectiveBoundaries, groupOf, sectorMap, sectorPrefer, withBoundaries, type SectorMap } from './sectors';

export interface SimContext {
  scenario: Scenario;
  theatre: Theatre;
  /** Профили сторон по id профиля. */
  profiles: Record<string, SideProfile>;
  rules: Rules;
  /** Агентная модель: действуют дивизии, армии и корпуса — узлы подчинения (приказ им ядро доводит до всех их дивизий). */
  agentModel?: boolean;
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
  const defs = new Map(ctx.scenario.formations.map((f) => [f.id, f]));
  const formations: Formation[] = ctx.scenario.formations.filter((f) => (f.position || f.detachFrom) && f.type).map((f) => ({
    id: f.id, name: f.name, side: f.side, echelon: f.echelon, parent: f.parent ?? null, type: f.type!, position: f.position ?? defs.get(f.detachFrom!.formation)?.position ?? [0, 0],
    personnel: f.personnel ?? 0, tanks: f.tanks ?? 0, guns: f.guns ?? 0,
    initial: { personnel: f.personnel ?? 0, tanks: f.tanks ?? 0, guns: f.guns ?? 0 },
    ammo: f.ammo ?? 2, fuel: f.fuel ?? 2, fatigue: 0, posture: f.posture ?? 'defend', dugInHours: f.posture === 'defend' ? 48 : 0,
    order: null, route: null, destroyed: false, enterAt: f.enterAt ?? null, ...(f.detachFrom ? { detachFrom: f.detachFrom } : {}),
  }));
  return { scenario: ctx.scenario.id, time: ctx.scenario.start, turn: 0, formations, pending: [...ctx.scenario.orders], rngState: seed >>> 0, seed: seed >>> 0, journal: [] };
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
    const terr = territory ? { owner: territory, side: sides.indexOf(side), ownZoneKm: ctx.rules.contactKm / 2, holdKm: ctx.rules.territory?.supplyHoldKm ?? ctx.rules.contactKm } : undefined;
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

  // 0. выделение корпусов и отрядов: в момент enterAt — там, где стоит родитель, с долей его сил
  for (const f of fs) {
    const d = f.detachFrom;
    if (!d || !f.enterAt || f.enterAt > now) continue;
    const p = byId.get(d.formation);
    f.detachFrom = undefined;
    if (!p || p.destroyed) { f.destroyed = true; continue; }
    const take = (k: 'personnel' | 'tanks' | 'guns') => Math.min(p[k], d[k] ?? Math.round(p[k] * (d.share ?? 0)));
    const got = { personnel: take('personnel'), tanks: take('tanks'), guns: take('guns') };
    for (const k of ['personnel', 'tanks', 'guns'] as const) {
      const was = p[k];
      p[k] -= got[k]; f[k] = got[k]; f.initial[k] = got[k];
      if (was > 0) p.initial[k] = Math.round(p.initial[k] * (p[k] / was));
    }
    Object.assign(f, { position: [...p.position] as LngLat, ammo: p.ammo, fuel: p.fuel, fatigue: p.fatigue, posture: p.posture, dugInHours: 0 });
    journal.push({ kind: 'detached', time: now, formation: f.id, from: p.id, ...got });
  }

  // 0а. изменения по датам (пополнения, переподчинение) — после выделения: выделенному при вводе прибавляется к его доле
  const changesDone = applyChanges(ctx.scenario, fs, byId, now, prev.changesDone, journal);

  // 1. приказы, дошедшие до исполнителя к концу хода
  const pending: Order[] = [];
  // когда приказ дошёл до исполнителя в этом ходе (rules.orderPartialTurn)
  const reached = new Map<string, number>();
  for (const o of [...prev.pending].sort((a, b) => a.issuedAt.localeCompare(b.issuedAt))) {
    const f = byId.get(o.formation);
    if (!f || f.destroyed) continue;
    if (!onMap(f, end)) { pending.push(o); continue; } // ещё не прибыло — приказ ждёт
    const delay = profileOf(ctx, f.side).orderDelayHours[f.echelon] ?? 0;
    if (t2ms(addHours(o.issuedAt, delay)) <= t2ms(end)) {
      f.order = o;
      f.posture = POSTURE[o.task];
      f.route = null;
      delete f.followsParent;
      reached.set(f.id, t2ms(addHours(o.issuedAt, delay)));
      journal.push({ kind: 'order', time: now, formation: f.id, order: o, effective: true });
    } else pending.push(o);
  }

  // переправы, наведённые сапёрами в этом прогоне, — в расчёт путей и подвоза
  T.setDynamicCrossings(prev.crossings ?? []);
  const crossings = [...(prev.crossings ?? [])];

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
  // подвоз проверяется там, где формирование было на начало хода: поле подвоза построено на этот момент
  // (после движения наступающий уже на чужой земле, которая станет своей только в конце хода — иначе
  // каждая успешно наступающая армия «отрезана»)
  const startPos = new Map(fs.map((f) => [f.id, f.position]));
  const isCut = (f: Formation) => !!sup?.fields.get(f.side) && supplyHours(f, startPos.get(f.id) ?? f.position) > range(f);
  // окружено — пути подвоза нет совсем; путь есть, но длиннее предела — войска оторвались от тылов (подвоза нет, но
  // это не котёл: формирование не скованно и не окружено)
  const isEncircled = (f: Formation) => !!sup?.fields.get(f.side) && !Number.isFinite(supplyHours(f, startPos.get(f.id) ?? f.position));

  // полоса обороны: обороняющийся связывает боем наступающих в пределах половины своей ширины полосы
  const reach = (e: Formation) => {
    if (e.posture === 'attack' || e.posture === 'march') return R.contactKm;
    const w = profileOf(ctx, e.side).unitTypes[e.type]?.frontageKm ?? 0;
    return Math.max(R.contactKm, w / 2);
  };
  // цель движения: своя цель приказа; выполнив задачу наступления — цель наступления вышестоящего до нового приказа
  // (rules.followParentKm)
  const parentGoal = (f: Formation): LngLat | null => {
    const p = f.parent ? byId.get(f.parent) : undefined;
    return p && !p.destroyed && p.order?.task === 'attack' ? targetPoint(ctx, p.order.target, byId) : null;
  };
  const goalOf = (f: Formation): LngLat | null => {
    const to = f.order ? targetPoint(ctx, f.order.target, byId) : null;
    const FP = R.followParentKm ?? 0;
    if (!FP || f.order?.task !== 'attack') return to;
    if (!f.followsParent && to && dist(xy(f), T.proj.toXY(to)) <= FP) {
      const pt = parentGoal(f);
      if (pt && dist(xy(f), T.proj.toXY(pt)) > FP) f.followsParent = true;
    }
    return f.followsParent ? parentGoal(f) ?? to : to;
  };
  // обход узлов обороны: подвижные соединения с целью дальше крепости не ввязываются в бой за неё
  const bypasses = (f: Formation, e: Formation) => {
    if (R.bypassStrongpoints === false || !profileOf(ctx, e.side).unitTypes[e.type]?.bypassable) return false;
    if ((profileOf(ctx, f.side).unitTypes[f.type]?.mobility ?? 'foot') === 'foot') return false;
    const to = goalOf(f);
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
  // расстояние до ближайшего противника на начало хода (режим движения)
  const startEnemyKm = (f: Formation) => {
    const p = T.proj.toXY(startPos.get(f.id) ?? f.position);
    return prev.formations.reduce((m, e) => (e.side !== f.side && !e.destroyed && onMap(e, now) ? Math.min(m, dist(p, T.proj.toXY(e.position))) : m), Infinity);
  };
  // директивы в игре: линии с условием вступают по обстановке на начало хода
  const fresh = checkTriggers(T, ctx.scenario, { ...prev, formations: fs }, now, addHours);
  const directives = prev.directives && Object.keys(fresh).length ? { ...prev.directives, activated: { ...prev.directives.activated, ...fresh } } : prev.directives;
  const scen = withBoundaries(ctx.scenario, { directives, boundaries: prev.boundaries });
  // линии, вступающие в силу за этот ход, — в журнал
  for (const b of scen === ctx.scenario ? ctx.scenario.boundaries ?? [] : effectiveBoundaries(ctx.scenario, { directives, boundaries: prev.boundaries })) {
    if (b.from >= now && b.from < end) journal.push({ kind: 'directive', time: now, boundary: b.id, side: b.side, title: b.title, from: b.from, issuedBy: b.issuedBy ?? 'scenario' });
  }
  // полосы по директивам (разграничительные линии): путь — своей полосой; по положению на начало хода
  const secPrefer = sectorPreferences(ctx, scen, active(), now);
  const prefer = (f: Formation, mob: Mobility) => {
    const vc = varietyCost(ctx, prev.seed ?? 0, f, mob), sp = secPrefer(f);
    return vc && sp ? (i: number) => vc(i) * sp(i) : vc ?? sp ?? undefined;
  };

  // 2. бои: наступающие в соприкосновении; общие обороняющиеся объединяют наступающих в одно сражение
  const attackers = active().filter((f) => f.posture === 'attack' && enemiesNear(f, R.contactKm).length);
  const groups: { att: Formation[]; def: Formation[] }[] = [];
  for (const a of attackers) {
    const defs = enemiesNear(a, R.contactKm);
    const g = groups.find((x) => x.def.some((d) => defs.includes(d)));
    if (g) { g.att.push(a); for (const d of defs) if (!g.def.includes(d)) g.def.push(d); }
    else groups.push({ att: [a], def: defs });
  }
  // прорванная полоса не держит (rules.beltBreachKm): если рядом с обороняющимся полоса уже прорвана (клетку заняли
  // войска противника), укрепления ему не засчитываются — за прорванной главной полосой оборона на неподготовленных
  // рубежах, а не «вдоль фаса» той же полосы; прорыв одной полосы не снимает следующую
  const BB = R.beltBreachKm ?? 0, bbCells = Math.ceil(BB / T.cellKm);
  const fortAt = (at: LngLat) => {
    const i = T.indexOf(at);
    if (i < 0 || !T.fort[i]) return 0;
    if (BB > 0 && breached.size) {
      const c0 = i % T.cols, r0 = (i - c0) / T.cols;
      for (let dr = -bbCells; dr <= bbCells; dr++) for (let dc = -bbCells; dc <= bbCells; dc++) {
        if (!T.inside(c0 + dc, r0 + dr) || Math.hypot(dc, dr) * T.cellKm > BB) continue;
        const j = (r0 + dr) * T.cols + c0 + dc;
        if (breached.has(j) && T.fortLine[j] === T.fortLine[i]) return 0;
      }
    }
    return T.fort[i];
  };
  const env: CombatEnv = { byId, supplyHours, isCut, seed: prev.seed ?? 0, prefer, fortAt };
  for (const g of groups) resolveCombat(g.att, g.def, ctx, rng, now, dt, journal, moved, env, prev.umpire ?? []);

  // 3. движение вне боя
  for (const f of active()) {
    if (moved.has(f.id) || !f.order) continue;
    const to = goalOf(f);
    if (!to) continue;
    const prof = profileOf(ctx, f.side);
    const mob = mobilityOf(ctx, f);
    if (dist(xy(f), T.proj.toXY(to)) < 0.5) { if (f.posture === 'march' || f.posture === 'withdraw') f.posture = 'defend'; continue; }
    const fc = fortCost(f), tc = terrCost(f, mob);
    // приказ дошёл в этом ходе — движение только с момента доведения
    const hrs = R.orderPartialTurn && reached.has(f.id) ? Math.min(dt, Math.max(0, (t2ms(end) - Math.max(t2ms(now), reached.get(f.id)!)) / HOUR)) : dt;
    if (hrs <= 0) continue;
    // режим движения (rules.regimes): наступающие без соприкосновения — преследование (подвижные и пешие отдельно), если
    // противника рядом нет, иначе — выдвижение к противнику (охват, сближение); отходящие — отход, остальные — марш
    const clear = R.pursuitClearKm ?? R.contactKm * 2;
    const regime: Regime = f.posture === 'attack'
      ? (startEnemyKm(f) < clear ? 'approach' : mob === 'foot' ? 'pursuitFoot' : 'pursuitMobile')
      : f.posture === 'withdraw' ? 'withdraw' : 'march';
    const r = T.advance(f.position, to, mob, prof, R, now, hrs * (R.regimes?.[regime]?.speed ?? 1), (i) => fc(i) + tc(i), prefer(f, mob));
    if (!r) continue;
    let pos = r.position;
    // встреча с противником останавливает движение: наступающие — войдя в соприкосновение (бой — в следующий ход),
    // остальные — не доходя до него
    const stop = stopShortOfEnemy(f, pos, active().filter((e) => !bypasses(f, e)), T, (e) => (f.posture === 'attack' ? 0.8 : 1) * Math.max(R.contactKm, reach(e)), R.contactKm * 0.5);
    if (stop) pos = stop;
    const km = dist(xy(f), T.proj.toXY(pos));
    if (km > 0.05) {
      const trail = stop ? trailTo(T, r.trail, pos) : r.trail;
      journal.push({ kind: 'move', time: now, formation: f.id, from: f.position, to: pos, km: +km.toFixed(1), ...pathOf(trail), ...(R.regimes ? { regime } : {}) });
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
    // подвоз как пропускная способность: на марше подвижные части жгут горючее по пройденному пути
    const SF = R.supplyFlow;
    const marchKm = SF && posture === 'march' && prof.unitTypes[f.type]?.mobility !== 'foot'
      ? journal.reduce((a, j) => (j.kind === 'move' && j.formation === f.id ? a + j.km : a), 0) : -1;
    f.fuel = Math.max(0, f.fuel - (marchKm >= 0 ? (SF!.fuelPer100km ?? 1) * (marchKm / 100) : c.fuel * (dt / 24)));
    // подвоз: по своей территории от источников стороны
    const ps = prof.supply;
    if (ps && sup?.fields.get(f.side)) {
      // окружение — когда пути подвоза нет дольше rules.encircleHours (по умолчанию 36 ч, т. е. два хода подряд):
      // разовый разрыв на стыке не считается котлом; оторвавшиеся от тылов (путь длиннее предела) подвоза не
      // получают, но окружёнными не считаются
      const blocked = isCut(f);
      f.outOfSupply = blocked && !isEncircled(f) ? true : undefined;
      f.cutHours = isEncircled(f) ? (f.cutHours ?? 0) + dt : 0;
      const cut = f.cutHours >= (R.encircleHours ?? 36);
      if (cut !== !!f.cutOff) journal.push({ kind: 'encircled', time: now, formation: f.id, cut });
      // вырвались из котла приказом на прорыв — тяжёлое вооружение брошено (танки и орудия — rules.pocket.breakoutKeep)
      if (!cut && f.cutOff && f.order?.task === 'breakout') {
        const keep = R.pocket?.breakoutKeep ?? 0.3;
        f.tanks = Math.round(f.tanks * keep); f.guns = Math.round(f.guns * keep);
        journal.push({ kind: 'brokeOut', time: now, formation: f.id, personnel: Math.round(f.personnel) });
      }
      f.cutOff = cut;
      // запасы крепости: окружённый гарнизон получает подвоз со своих складов, пока они не кончились (сутки запаса;
      // в бою расходуются вдвое быстрее, чем в осаде без штурма)
      const stockDays = prof.unitTypes[f.type]?.stockDays ?? 0;
      if (stockDays > 0 && f.stock === undefined) f.stock = stockDays;
      const fromStock = cut && (f.stock ?? 0) > 0;
      if (fromStock) {
        f.stock = Math.max(0, f.stock! - (dt / 24) * (inCombat.has(f.id) ? 1 : 0.5));
        f.ammo = Math.min(ps.maxAmmo, f.ammo + ps.ammoPerDay * (dt / 24));
        f.fuel = Math.min(ps.maxFuel, f.fuel + ps.fuelPerDay * (dt / 24));
        if (f.stock === 0) journal.push({ kind: 'supply', time: now, formation: f.id, what: 'stock', left: 0 });
      }
      // капитуляция: окружено дольше rules.pocket.capitulateHours (у «держаться любой ценой» — вдвое дольше), складов
      // нет, боеприпасы на исходе (меньше ammoBelow бк) — котёл сдаётся
      const P = R.pocket ?? {};
      // «держаться любой ценой» и прорывающиеся (пробиваются к своим, а не сидят в кольце) — вдвое дольше
      const capH = (P.capitulateHours ?? 96) * (f.order?.task === 'hold' || f.order?.task === 'breakout' ? 2 : 1);
      if (cut && prof.capitulates !== false && !fromStock && (f.stock ?? 0) <= 0 && f.cutHours >= capH + (R.encircleHours ?? 36) && f.ammo < (P.ammoBelow ?? 0.25)) {
        f.destroyed = true;
        journal.push({ kind: 'capitulated', time: now, formation: f.id, personnel: Math.round(f.personnel) });
        continue;
      }
      if (!blocked) {
        // приоритет подвоза (тыл под управлением штаба): приоритетным — больше, остальным — меньше
        const pr = prev.logistics?.[f.side]?.priority ?? [];
        // пропускная способность: чем дальше база, тем меньше рейсов автотранспорта в сутки
        const h = SF ? supplyHours(f, startPos.get(f.id) ?? f.position) : 0;
        const flow = SF && h > (SF.fullHours ?? 12) ? (SF.fullHours ?? 12) / h : 1;
        const k = (pr.length ? (pr.includes(f.id) ? 1.5 : 0.75) : 1) * flow;
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
    // закрепление земли за своим фронтом: клетка противника переходит к стороне, если там перевес влияния её войск
    // (карта контроля), войск противника нет ближе consolidateKm, а своя земля — по крайней мере с трёх сторон из
    // четырёх в пределах consolidateReachKm (клетка в тылу своего фронта, а не перед ним). Так полосы между
    // коридорами наступающих армий становятся своими; обойдённые узлы противника, где его войска есть, остаются его
    // островами — это и есть котлы.
    const consKm = R.territory.consolidateKm ?? R.contactKm * 1.5;
    if (consKm > 0) {
      const reachCells = Math.max(1, Math.round((R.territory.consolidateReachKm ?? 24) / T.cellKm));
      const ctl = controlMap(T, live, sides, (f) => power(f, profileOf(ctx, f.side), ctx.rules).total, 10, 0.1);
      const bySide = sides.map((_, k) => live.filter((f) => sideIdx(f.side) === k).map((f) => xy(f)));
      for (let pass = 0; pass < 3; pass++) {
        const flips: [number, number][] = [];
        for (let i = 0; i < terr.length; i++) {
          const o = terr[i], c = ctl.owner[i];
          if (o < 0 || c < 0 || c === o) continue;
          const c0 = i % T.cols, r0 = (i - c0) / T.cols;
          let sidesOwn = 0;
          for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            for (let k = 1; k <= reachCells; k++) {
              const cc = c0 + dc * k, rr = r0 + dr * k;
              if (!T.inside(cc, rr)) break;
              if (terr[rr * T.cols + cc] === c) { sidesOwn++; break; }
            }
          }
          if (sidesOwn < 3) continue;
          const p = T.cellCenter(c0, r0);
          if (bySide[o].some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < consKm)) continue;
          flips.push([i, c]);
        }
        if (!flips.length) break;
        for (const [i, c] of flips) terr[i] = c;
      }
    }
  }

  // занятые клетки чужих укреплённых полос — прорваны
  for (const f of active()) {
    const i = T.indexOf(f.position);
    if (i >= 0 && T.fort[i] && T.fortSide[i] && T.fortSide[i] !== f.side) breached.add(i);
  }
  // сапёры без штаба: где сторона держит оба берега большой реки без моста, её войска рядом, а противника нет —
  // наводится переправа (открыта через engineers.hours). Где тылом управляет штаб (игра), переправы — его распоряжения.
  const EN = R.engineers;
  if (EN !== false && terr) {
    const hours = EN?.hours ?? 24, per = EN?.perTurn ?? 2, nearKm = EN?.nearKm ?? 12, spacing = EN?.spacingKm ?? 15;
    const live = active();
    for (const side of sides) {
      if (prev.logistics?.[side]) continue;
      const k = sideIdx(side);
      const own = live.filter((f) => f.side === side).map((f) => xy(f)), enemy = live.filter((f) => f.side !== side).map((f) => xy(f));
      const mine = crossings.filter((c) => c.side === side).map((c) => T.proj.toXY(c.at));
      const cand: { i: number; p: XY; d: number }[] = [];
      for (let i = 0; i < terr.length; i++) {
        if (T.river[i] !== 2 || T.bridgeOpen(i, end)) continue;
        const c = i % T.cols, r = (i - c) / T.cols;
        const ownAt = (cc: number, rr: number) => T.inside(cc, rr) && terr[rr * T.cols + cc] === k && T.river[rr * T.cols + cc] !== 2;
        // оба берега — свои: напротив друг друга через реку (по горизонтали, вертикали или диагонали, на 2 клетки)
        if (![[2, 0], [0, 2], [2, 2], [2, -2]].some(([dc, dr]) => ownAt(c + dc, r + dr) && ownAt(c - dc, r - dr))) continue;
        const p = T.cellCenter(c, r);
        const d = own.reduce((m, q) => Math.min(m, Math.hypot(q[0] - p[0], q[1] - p[1])), Infinity);
        if (d > nearKm || enemy.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < R.contactKm)) continue;
        if (mine.some((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < spacing)) continue;
        cand.push({ i, p, d });
      }
      cand.sort((a, b) => a.d - b.d);
      let n = 0;
      for (const c of cand) {
        if (n >= per) break;
        if (mine.some((q) => Math.hypot(q[0] - c.p[0], q[1] - c.p[1]) < spacing)) continue;
        const at = T.proj.toLL(c.p);
        crossings.push({ id: `x_${side}_${end}_${n}`, side, at, openFrom: addHours(end, hours), name: `переправа сапёров ${describePlace(T, at)}` });
        mine.push(c.p);
        n++;
      }
    }
  }

  const { umpire: _used, ...rest } = prev;
  return { ...rest, ...(directives ? { directives } : {}), time: end, turn: prev.turn + 1, formations: fs, pending, rngState: rng.state(), journal: [...prev.journal, ...journal], journalFrom: prev.journal.length, breached: [...breached], ...(terr ? { territory: Array.from(terr) } : {}), ...(crossings.length ? { crossings } : {}), ...(changesDone ? { changesDone } : {}) };
}

/**
 * Изменения по датам (Scenario.changes): исполняются в первом ходе, начало которого не раньше at, один раз (индексы
 * исполненных — в состоянии). Пополнение — к текущим силам и к начальным (укомплектованность); ещё не введённому
 * формированию — откладывается до ввода. Переподчинение — только существующему штабу, не себе и не своему потомку;
 * иначе — запись change-skipped с причиной. Возвращает индексы исполненных (undefined — изменений нет).
 */
function applyChanges(scen: Scenario, fs: Formation[], byId: Map<string, Formation>, now: string, done0: number[] | undefined, journal: JournalEntry[]): number[] | undefined {
  const list = scen.changes;
  if (!list?.length) return done0;
  const done = new Set(done0 ?? []);
  // подчинённость: штабы без положения (фронты) — из сценария, действующие формирования — из состояния
  const parentOf = new Map<string, string | null>(scen.formations.map((f) => [f.id, f.parent ?? null]));
  for (const f of fs) parentOf.set(f.id, f.parent);
  const skip = (i: number, formation: string, reason: string) => { done.add(i); journal.push({ kind: 'change-skipped', time: now, formation, change: i, reason }); };
  list.forEach((c, i) => {
    if (done.has(i) || c.at > now) return;
    const f = byId.get(c.formation);
    if (c.kind === 'reinforce') {
      if (!f) return skip(i, c.formation, `нет действующего формирования ${c.formation}`);
      if (f.destroyed) return skip(i, c.formation, 'формирование уже разгромлено — пополнять нечего');
      if (!onMap(f, now) || f.detachFrom) return; // ещё не введено — пополнение при вводе
      const got = { personnel: c.personnel ?? 0, tanks: c.tanks ?? 0, guns: c.guns ?? 0 };
      for (const k of ['personnel', 'tanks', 'guns'] as const) { f[k] += got[k]; f.initial[k] += got[k]; }
      done.add(i);
      journal.push({ kind: 'reinforced', time: now, formation: f.id, ...got });
      return;
    }
    if (c.parent === c.formation) return skip(i, c.formation, 'переподчинение самому себе');
    if (!parentOf.has(c.parent)) return skip(i, c.formation, `нет штаба ${c.parent} среди формирований сценария`);
    for (let p: string | null | undefined = c.parent, n = 0; p && n < 64; p = parentOf.get(p), n++) {
      if (p === c.formation) return skip(i, c.formation, `${c.parent} — в подчинении самого ${c.formation}: переподчинение образовало бы цикл`);
    }
    if (!f) return skip(i, c.formation, `нет действующего формирования ${c.formation}`);
    const from = f.parent;
    f.parent = c.parent;
    parentOf.set(f.id, c.parent);
    done.add(i);
    journal.push({ kind: 'resubordinated', time: now, formation: f.id, from, to: c.parent });
  });
  return [...done].sort((a, b) => a - b);
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
  /** seed прогона — для разброса путей. */
  seed: number;
  /** Выбор пути: разброс путей и полосы по директивам. */
  prefer: (f: Formation, mob: Mobility) => ((i: number) => number) | undefined;
  /** Уровень укреплённости там, где стоит обороняющийся, с учётом прорыва полосы (rules.beltBreachKm). */
  fortAt: (at: LngLat) => number;
}

function resolveCombat(att: Formation[], def: Formation[], ctx: SimContext, rng: Rng, now: string, dt: number, journal: JournalEntry[], moved: Set<string>, env: CombatEnv, umpire: UmpireMod[]) {
  const T = ctx.theatre, R = ctx.rules;
  // поправки посредника: к бою, где участвует любое из названных формирований; одна на множитель (самая сильная)
  const ids = new Set([...att, ...def].map((f) => f.id));
  const mods = umpire.filter((m) => m.formations.some((id) => ids.has(id)));
  const um = (k: UmpireFactor) => {
    const ms = mods.filter((m) => m.factor === k);
    if (!ms.length) return 1;
    const m = ms.reduce((a, b) => (Math.abs(Math.log(b.mult)) > Math.abs(Math.log(a.mult)) ? b : a));
    return Math.min(UMPIRE_LIMITS[1], Math.max(UMPIRE_LIMITS[0], m.mult));
  };
  const A = att.reduce((s, f) => s + power(f, profileOf(ctx, f.side), R).total, 0) * um('attack');
  // превышение: средняя высота наступающих (по силе) против высоты каждого обороняющегося
  const HA = R.heightAdvantage;
  const hs = HA ? att.map((f) => ({ h: T.heightAt(f.position), w: power(f, profileOf(ctx, f.side), R).total })).filter((x) => x.h != null) : [];
  const hAtt = hs.length ? hs.reduce((s, x) => s + x.h! * x.w, 0) / Math.max(1e-9, hs.reduce((s, x) => s + x.w, 0)) : null;
  const dParts = def.map((f) => {
    const p = power(f, profileOf(ctx, f.side), R).total;
    const terrain = R.defense.terrain[T.terrainAt(f.position)] ?? 1;
    const prepared = f.posture === 'defend' && f.dugInHours >= R.defense.prepareHours ? R.defense.prepared : 1;
    const fort = 1 + R.defense.fortificationPerLevel * env.fortAt(f.position);
    const hd = HA && hAtt != null ? T.heightAt(f.position) : null;
    const height = HA && hd != null ? 1 + Math.max(-HA.max, Math.min(HA.max, ((hd - hAtt!) / HA.perM) * HA.bonus)) : 1;
    return { f, p, terrain, prepared, fort, height, total: p * terrain * prepared * fort * height };
  });
  const D = dParts.reduce((s, x) => s + x.total, 0) * um('defense');
  if (D <= 0 || A <= 0) return;
  const avg = (k: 'terrain' | 'prepared' | 'fort' | 'height') => dParts.reduce((s, x) => s + x[k] * x.p, 0) / Math.max(1e-9, dParts.reduce((s, x) => s + x.p, 0));
  const noise = Math.exp(R.noise * rng.normal());
  const ratio = (A / D) * noise;
  const day = dt / 24;
  // темп — по таблице от соотношения сил, с поправкой на местность обороняющихся (город — кварталами)
  const at = def.reduce((m, f) => Math.min(m, R.advanceTerrain?.[T.terrainAt(f.position)] ?? 1), 1);
  // укреплённая полоса: темп не выше предельного для её уровня («прогрызание» обороны)
  const fortLv = def.reduce((m, f) => Math.max(m, env.fortAt(f.position)), 0);
  const cap = fortLv && R.fortAdvanceKm ? R.fortAdvanceKm[Math.min(fortLv, R.fortAdvanceKm.length - 1)] ?? Infinity : Infinity;
  const streetFight = def.every((f) => T.terrainAt(f.position) === 'urban');
  const regime = combatRegime(att, def, T, streetFight, fortLv);
  const RG = R.regimes?.[regime] ?? {};
  const freePace = interp(R.advance, ratio) * at * (RG.advance ?? 1);
  const advancePerDay = Math.min(freePace, cap) * um('pace');
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
  const advanceKm = holding && !breakthrough && !yields && !streetFight ? 0 : advancePerDay * day;
  const attackerLoss = interp(R.attackerLoss, ratio) * day * um('attackerLoss') * (RG.attackerLoss ?? 1);
  const defenderLoss = interp(R.defenderLoss, ratio) * day * (holding && advancePerDay > 0 ? 1.5 : 1) * um('defenderLoss') * (RG.defenderLoss ?? 1);
  const factors: CombatFactor[] = [
    { name: 'сила наступающих', value: +A.toFixed(1) },
    { name: 'сила обороняющихся (без поправок)', value: +dParts.reduce((s, x) => s + x.p, 0).toFixed(1) },
    { name: 'местность', value: +avg('terrain').toFixed(2) },
    { name: 'подготовленная оборона', value: +avg('prepared').toFixed(2) },
    { name: 'укрепления', value: +avg('fort').toFixed(2) },
    ...(HA && avg('height') !== 1 ? [{ name: 'превышение (высоты местности)', value: +avg('height').toFixed(2) }] : []),
    { name: 'случайность (разброс)', value: +noise.toFixed(2) },
    ...(at < 1 ? [{ name: 'темп по местности', value: +at.toFixed(2) }] : []),
    ...(R.regimes && (RG.advance ?? 1) !== 1 ? [{ name: `темп: ${REGIME_RU[regime]}`, value: RG.advance! }] : []),
    ...(Number.isFinite(cap) ? [{ name: 'предел темпа в укреплённой полосе, км/сут', value: cap }] : []),
    ...UMPIRE_FACTORS.filter((k) => um(k) !== 1).map((k) => ({ name: `посредник: ${UMPIRE_FACTOR_RU[k]} — ${mods.filter((m) => m.factor === k).map((m) => m.reason).join('; ')}`, value: +um(k).toFixed(2) })),
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
      // продвижение — путём, которым шли бы войска (по дорогам и улицам, через мосты), а не напрямик через кварталы
      const w = d > 0.05 ? T.walk(f.position, to!, Math.min(advanceKm, d * 1.6), mobilityOf(ctx, f), profileOf(ctx, f.side), ctx.rules, now, env.prefer(f, mobilityOf(ctx, f))) : null;
      const k = d > 0 ? Math.min(1, advanceKm / d) : 0;
      const np = w ? w.position : T.proj.toLL([p[0] + (goal[0] - p[0]) * k, p[1] + (goal[1] - p[1]) * k]);
      journal.push({ kind: 'move', time: now, formation: f.id, from: f.position, to: np, km: +(w ? w.km : d * k).toFixed(1), ...(w ? pathOf(w.trail) : {}) });
      f.position = np;
      moved.add(f.id);
    }
    for (const f of def) {
      if (pinned(f) && !yields) continue;
      const p = T.proj.toXY(f.position);
      const aim = retreatPoint(f, p, ca, advanceKm, T, env);
      // отход — тоже путём (улицами, через мосты); пути нет — напрямик
      const w = T.walk(f.position, aim, advanceKm, mobilityOf(ctx, f), profileOf(ctx, f.side), ctx.rules, now, env.prefer(f, mobilityOf(ctx, f)));
      const np = w ? w.position : aim;
      journal.push({ kind: 'move', time: now, formation: f.id, from: f.position, to: np, km: +(w ? w.km : advanceKm).toFixed(1), ...(w ? pathOf(w.trail) : {}) });
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
    attackerLoss: +attackerLoss.toFixed(3), defenderLoss: +defenderLoss.toFixed(3), outcome, ...(R.regimes ? { regime } : {}),
  });
}

/**
 * Режим боя (rules.regimes): котёл — окружённые обороняются или прорываются; застройка — вся оборона в городе;
 * укреплённая полоса; переправа — между наступающими и обороняющимися большая река; лес и болото — там бо́льшая
 * часть обороны; иначе — открытая местность.
 */
export function combatRegime(att: Formation[], def: Formation[], T: Theatre, streetFight: boolean, fortLv: number): Regime {
  if (def.some((f) => f.cutOff) || att.some((f) => f.cutOff || f.order?.task === 'breakout')) return 'pocket';
  if (streetFight) return 'urban';
  if (fortLv) return 'belt';
  const a = centerXY(att.map((f) => T.proj.toXY(f.position)));
  const crosses = def.some((f) => {
    const d = T.proj.toXY(f.position), n = Math.max(2, Math.ceil(dist(a, d) / (T.cellKm / 2)));
    for (let k = 1; k < n; k++) {
      const i = T.indexOf(T.proj.toLL([a[0] + ((d[0] - a[0]) * k) / n, a[1] + ((d[1] - a[1]) * k) / n]));
      if (i >= 0 && T.river[i] === 2) return true;
    }
    return false;
  });
  if (crosses) return 'river';
  const wooded = def.filter((f) => ['forest', 'marsh'].includes(T.terrainAt(f.position))).length;
  return wooded * 2 > def.length ? 'forest' : 'open';
}

/** Целое из строки (для шума путей). */
function hashStr(x: string): number { let h = 2166136261; for (let i = 0; i < x.length; i++) { h ^= x.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function hash3(a: number, b: number, c: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x632be59b, 0xc2b2ae35) ^ c;
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/**
 * Разброс выбора пути: время клетки при выборе пути умножается на плавный шум (районы в несколько км).
 * Шум свой у формирования и приказа и постоянный на прогон: путь не дёргается от хода к ходу, а разный seed даёт
 * разные пути — дорогой, лесом, полем напрямик.
 */
function varietyCost(ctx: SimContext, seed: number, f: Formation, mob: Mobility): ((i: number) => number) | null {
  void mob;
  const v = ctx.rules.routeVariety ?? 0;
  if (v <= 0) return null;
  const T = ctx.theatre;
  const bs = Math.max(2, Math.round(Math.min(4, T.cellKm * 8) / T.cellKm)); // район шума: 2–4 км
  const key = hashStr(`${f.id}|${f.order?.id ?? ''}`) ^ seed;
  const at = (x: number, y: number) => hash3(x, y, key);
  // множитель «как кажется выгодным» 1…1+2v: только выбор пути, время движения — по местности
  return (i: number) => {
    const c = i % T.cols, r = Math.floor(i / T.cols), gx = c / bs, gy = r / bs, x0 = Math.floor(gx), y0 = Math.floor(gy), tx = gx - x0, ty = gy - y0;
    const n = (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) + (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty;
    return 1 + 2 * v * n;
  };
}

/**
 * Полосы сторон по действующим линиям: множитель выбора пути для формирования (null — линий нет). Линии между
 * фронтами делят полосы фронтов, линии между армиями (распоряжения игрока) — полосы армий; множители перемножаются.
 */
function sectorPreferences(ctx: SimContext, scen: Scenario, units: Formation[], now: string): (f: Formation) => ((i: number) => number) | null {
  const k = ctx.rules.sectors?.foreign ?? 0;
  const act = activeBoundaries(scen, now);
  if (k <= 0 || !act.length) return () => null;
  const levels = (['front', 'army'] as const).filter((lv) => act.some((b) => b.kind === lv));
  const groups = Object.fromEntries(levels.map((lv) => { const key = `${lv}`; const c = groupCache.get(ctx.scenario) ?? {}; c[key] ??= groupOf(ctx.scenario, lv); groupCache.set(ctx.scenario, c); return [lv, c[key]]; })) as Record<'front' | 'army', Map<string, string>>;
  const pts = units.map((u) => ({ id: u.id, side: u.side, at: u.position }));
  const fns = new Map<string, ((i: number) => number) | null>();
  const maps = new Map<string, SectorMap | null>();
  return (f) => {
    const parts: ((i: number) => number)[] = [];
    for (const lv of levels) {
      const g = groups[lv].get(f.id) ?? f.id;
      const key = `${lv}|${f.side}|${g}`;
      if (!fns.has(key)) {
        const mk = `${lv}|${f.side}`;
        if (!maps.has(mk)) maps.set(mk, act.some((b) => b.kind === lv && b.side === f.side) ? sectorMap(ctx.theatre, { ...scen, boundaries: act.filter((b) => b.kind === lv) }, pts, f.side, now, { level: lv, groups: groups[lv] }) : null);
        const m = maps.get(mk);
        fns.set(key, m ? sectorPrefer(ctx.theatre, m, g, k) : null);
      }
      const fn = fns.get(key);
      if (fn) parts.push(fn);
    }
    return !parts.length ? null : parts.length === 1 ? parts[0] : (i: number) => parts.reduce((a, p) => a * p(i), 1);
  };
}
const groupCache = new WeakMap<object, Record<string, Map<string, string>>>();

/** Подвижность формирования сейчас: техника без горючего идёт пешком. */
function mobilityOf(ctx: SimContext, f: Formation) {
  const type = profileOf(ctx, f.side).unitTypes[f.type];
  return type?.mobility === 'foot' || f.fuel > 0 ? type?.mobility ?? 'foot' : 'foot';
}
/** Пройденный путь для журнала (если он не прямой), координаты — до 5 знаков. */
const pathOf = (t: LngLat[]) => (t.length > 2 ? { path: t.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)] as LngLat) } : {});

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
