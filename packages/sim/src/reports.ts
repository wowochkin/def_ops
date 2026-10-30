/**
 * Штабные сведения из состояния переигровки — то, что штаб стороны знает к утру:
 *  - доклады своих формирований: где, что делает, итог суток, состояние и снабжение;
 *  - разведсводка: противник в пределах разведки своих войск (туман войны), с
 *    округлённой оценкой сил;
 *  - описание места через ближайший именованный пункт театра («8 км к СВ от Зелова»).
 * Одни и те же сведения идут в доклады человеку и в обстановку для модели.
 */
import type { LngLat } from '@def-ops/core';
import { commandTerms } from './command';
import { dist } from './geo';
import { onMap, profileOf, targetPoint, type SimContext } from './step';
import PLACES_RU from '../data/places-ru.json';
import { establishmentOf } from './establishment';
import type { Theatre } from './theatre';
import type { Echelon, Formation, JournalEntry, SimState, Target, Task } from './types';

export const TASK_RU: Record<Task, string> = {
  defend: 'оборонять', hold: 'удерживать любой ценой', delay: 'сдерживать', withdraw: 'отходить', counterattack: 'контратаковать',
  attack: 'наступать', breakout: 'прорываться', regroup: 'перегруппироваться', reserve: 'в резерв', relieve: 'деблокировать',
};
export const POSTURE_RU: Record<string, string> = { attack: 'наступает', defend: 'обороняется', march: 'на марше', withdraw: 'отходит', reserve: 'в резерве' };
const OUTCOME_RU = { breakthrough: 'прорыв', advance: 'продвижение', held: 'оборона удержана', repelled: 'атака отбита' } as const;

/** Исходное написание пункта: «BadFreienwalde» → «Bad Freienwalde», «B_Reichstag» → «Reichstag». */
export function areaOriginal(name: string): string {
  return name.replace(/^B_/, '').replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2');
}

/**
 * Название пункта для людей и модели: по-русски, исходное — в скобках: «Зелов (Seelow)», «Берлин, Рейхстаг
 * (Reichstag)». Русские названия — data/places-ru.json; нет перевода — исходное (с «Берлин-» для объектов города).
 * Приказы модели узнают пункт по любому из двух названий.
 */
export function areaTitle(name: string): string {
  if (/[^\x00-\x7f]/.test(name) && !(name in PLACES_RU)) return name;
  const ru = (PLACES_RU as Record<string, string>)[name];
  const orig = areaOriginal(name);
  if (ru && ru !== orig) return `${ru} (${orig})`;
  return name.startsWith('B_') ? `Берлин-${orig}` : orig;
}

const RUMB = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
/** Направление от a на b по восьми румбам (на плоскости театра: ось y — на север). */
export function rumb(T: Theatre, a: LngLat, b: LngLat): string {
  const p = T.proj.toXY(a), q = T.proj.toXY(b);
  const ang = (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180) / Math.PI;
  return RUMB[((Math.round(ang / 45) % 8) + 8) % 8];
}

const centers = new WeakMap<Theatre, { id: string; title: string; at: LngLat }[]>();
/** Именованные пункты театра с центрами (кэш на театр). */
export function places(T: Theatre) {
  let l = centers.get(T);
  if (!l) {
    l = T.data.areas.map((a) => ({ id: a.id, title: areaTitle(a.name), at: T.area(a.id)!.center }));
    centers.set(T, l);
  }
  return l;
}

/** «у Зелова» / «8 км к СВ от Зелова». */
export function describePlace(T: Theatre, at: LngLat): string {
  let best: { title: string; at: LngLat } | null = null, bd = Infinity;
  const p = T.proj.toXY(at);
  for (const a of places(T)) {
    const d = dist(p, T.proj.toXY(a.at));
    if (d < bd) { bd = d; best = a; }
  }
  if (!best) return `${at[1].toFixed(2)}° с.ш., ${at[0].toFixed(2)}° в.д.`;
  const near = Math.max(1.5, T.cellKm * 3);
  if (bd <= near) return `у ${best.title}`;
  return `${bd < 10 ? bd.toFixed(1).replace('.', ',') : Math.round(bd)} км к ${rumb(T, best.at, at)} от ${best.title}`;
}

/** Цель приказа словами: пункт, точка или формирование. */
export function describeTarget(ctx: SimContext, t: Target | undefined, names: Map<string, string>): string {
  if (!t) return 'на месте';
  if (Array.isArray(t)) return describePlace(ctx.theatre, t);
  if (typeof t === 'object') return `против: ${names.get(t.formation) ?? t.formation}`;
  const a = ctx.theatre.area(t);
  return a ? areaTitle(a.name) : t;
}

/** Дальность разведки, км: войска видят противника на этом расстоянии (тактическая и войсковая разведка, авиация). */
export const detectKm = (ctx: SimContext) => Math.max(ctx.rules.contactKm * 4, ctx.theatre.cellKm * 8);

/** Противник, обнаруженный разведкой стороны: в пределах detectKm от любого её формирования на карте. */
export function detected<U extends { id: string; at: LngLat; destroyed?: boolean }>(T: Theatre, own: U[], enemy: U[], km: number): Set<string> {
  const ps = own.filter((u) => !u.destroyed).map((u) => T.proj.toXY(u.at));
  const out = new Set<string>();
  for (const e of enemy) {
    if (e.destroyed) continue;
    const q = T.proj.toXY(e.at);
    if (ps.some((p) => dist(p, q) <= km)) out.add(e.id);
  }
  return out;
}

export interface CombatNote { against: string[]; role: 'attack' | 'defend'; outcome: string; ratio: number; advanceKm: number; lossPct: number; at: string }

export interface UnitReport {
  id: string;
  name: string;
  parent: string | null;
  echelon: Echelon;
  /** На театре и не уничтожено; arrives — прибывает позже (дата). */
  status: 'active' | 'destroyed' | 'arriving' | 'reserve';
  arrives?: string;
  /** Резерв Ставки: с какого момента может быть введён. */
  reserveFrom?: string;
  at: LngLat;
  place: string;
  posture: string;
  task: string | null;
  target: string | null;
  /** Источник действующего приказа: сценарий (история), эксперт, модель. */
  orderSource: string | null;
  personnel: number;
  tanks: number;
  guns: number;
  /** Укомплектованность от начала операции: доля численности на начало операции (первый кадр хода). */
  strength: number;
  /**
   * Укомплектованность от штата: доля штатной численности по виду соединения (establishment.json); у штаба — люди
   * соединений со штатом / сумма их штатов; штата нет — null.
   */
  manning: number | null;
  /** Сумма штатов, от которой считается manning (для сводок по группе); штата нет — null. */
  establishment: number | null;
  ammo: number;
  fuel: number;
  fatigue: number;
  cutOff: boolean;
  /** Продвижение за последний ход, км. */
  movedKm: number;
  combats: CombatNote[];
  /** Приказы, ещё не дошедшие до исполнителя. */
  pending: { task: string; target: string; issuedAt: string }[];
}

export interface IntelReport {
  id: string;
  name: string;
  at: LngLat;
  place: string;
  posture: string;
  /** Оценка сил, словами (округлённо). */
  estimate: string;
  /** Ближайшее своё формирование и расстояние до него, км. */
  nearest: { name: string; km: number } | null;
  /** Новое (вчера не было в разведсводке). */
  fresh: boolean;
}

/** Округлённо, как в разведсводке: 1 значащая цифра (до 10 — до единиц). */
function rough(n: number): string {
  if (n < 10) return String(Math.round(n));
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  return (Math.round(n / p) * p).toLocaleString('ru');
}

export function estimate(f: Pick<Formation, 'personnel' | 'tanks' | 'guns'>): string {
  const parts = [`до ${rough(f.personnel / 1000)} тыс. чел.`];
  if (f.tanks >= 5) parts.push(`около ${rough(f.tanks)} танков и САУ`);
  if (f.guns >= 50) parts.push(`около ${rough(f.guns)} орудий и минометов`);
  return parts.join(', ');
}

/** Бои за ход, в которых участвовало формирование. */
function combatsOf(id: string, journal: JournalEntry[], names: Map<string, string>): CombatNote[] {
  const out: CombatNote[] = [];
  for (const j of journal) {
    if (j.kind !== 'combat') continue;
    const att = j.attackers.includes(id), def = j.defenders.includes(id);
    if (!att && !def) continue;
    out.push({
      against: (att ? j.defenders : j.attackers).map((x) => names.get(x) ?? x), role: att ? 'attack' : 'defend',
      outcome: OUTCOME_RU[j.outcome], ratio: j.ratio, advanceKm: j.advanceKm, lossPct: Math.round((att ? j.attackerLoss : j.defenderLoss) * 100), at: j.time,
    });
  }
  return out;
}

const manningOf = (personnel: number, e: number | undefined): Pick<UnitReport, 'manning' | 'establishment'> =>
  e ? { manning: personnel / e, establishment: e } : { manning: null, establishment: null };

/**
 * Укомплектованность группы по людям, а не среднее долей (одно определение для докладов штабов, сводок и голоса).
 * От начала операции — сумма людей / сумма людей на начало (personnel / strength); от штата — люди соединений со
 * штатом / сумма их штатов (нет штата ни у кого — null). Считается по дивизиям: есть в списке дивизии — доклады штабов
 * не учитываются (их люди — те же дивизии), повторы по id — один раз. Список без дивизий (доклады объединений) —
 * по докладам: люди со штатом — manning × establishment; без establishment штат — personnel / manning.
 */
export function groupManning(l: (Pick<UnitReport, 'personnel' | 'strength' | 'manning'> & { id?: string; echelon?: string; establishment?: number | null })[]): { strength: number; manning: number | null; establishment: number | null } {
  const divs = l.some((u) => u.echelon === 'division') ? l.filter((u) => u.echelon === 'division') : l;
  const seen = new Set<string>();
  const list = divs.filter((u) => !u.id || (!seen.has(u.id) && !!seen.add(u.id)));
  let P = 0, P0 = 0, Ps = 0, E = 0;
  for (const u of list) {
    P += u.personnel;
    P0 += u.strength > 0 ? u.personnel / u.strength : 0;
    const e = u.establishment ?? (u.manning ? u.personnel / u.manning : 0);
    if (e > 0 && u.manning != null) { Ps += u.manning * e; E += e; }
  }
  const strength = P0 > 0 ? P / P0 : list.length ? list.reduce((s, u) => s + u.strength, 0) / list.length : 1;
  return { strength, manning: E > 0 ? Ps / E : null, establishment: E > 0 ? Math.round(E) : null };
}

/** Доклады формирований стороны на утро (state — после хода; prev — до него, для итога суток). */
export function unitReports(ctx: SimContext, state: SimState, side: string, prev?: SimState | null): UnitReport[] {
  const T = ctx.theatre;
  const names = new Map(state.formations.map((f) => [f.id, f.name]));
  const before = new Map((prev?.formations ?? []).map((f) => [f.id, f]));
  const last = prev ? state.journal.slice(prev.journal.length) : [];
  const byId = new Map(state.formations.map((f) => [f.id, f]));
  const est = new Map(ctx.scenario.formations.map((d) => [d.id, establishmentOf(d.side, d.staffKind)?.personnel]));
  return state.formations.filter((f) => f.side === side).map((f) => {
    const b = before.get(f.id);
    const status = f.destroyed ? 'destroyed' : onMap(f, state.time) ? 'active' : f.reserveFrom ? 'reserve' : 'arriving';
    const o = f.order;
    const tp = o ? targetPoint(ctx, o.target, byId) : null;
    return {
      id: f.id, name: f.name, parent: f.parent, echelon: f.echelon, status, ...(status === 'arriving' ? { arrives: f.enterAt! } : {}), ...(f.reserveFrom ? { reserveFrom: f.reserveFrom } : {}),
      at: f.position, place: describePlace(T, f.position), posture: POSTURE_RU[f.posture] ?? f.posture,
      task: o ? TASK_RU[o.task] : null, target: o ? (tp || o.target ? describeTarget(ctx, o.target, names) : 'на месте') : null, orderSource: o?.source ?? null,
      personnel: f.personnel, tanks: f.tanks, guns: f.guns,
      strength: f.initial.personnel ? f.personnel / f.initial.personnel : 1,
      ...manningOf(f.personnel, est.get(f.id)),
      ammo: f.ammo, fuel: f.fuel, fatigue: f.fatigue, cutOff: !!f.cutOff,
      movedKm: b ? +dist(T.proj.toXY(b.position), T.proj.toXY(f.position)).toFixed(1) : 0,
      combats: combatsOf(f.id, last, names),
      pending: state.pending.filter((p) => p.formation === f.id).map((p) => ({ task: TASK_RU[p.task], target: describeTarget(ctx, p.target, names), issuedAt: p.issuedAt })),
    } satisfies UnitReport;
  });
}

/** Разведсводка стороны: обнаруженный противник (prev — для пометки «новое»). */
export function intelReport(ctx: SimContext, state: SimState, side: string, prev?: SimState | null): IntelReport[] {
  const T = ctx.theatre, km = detectKm(ctx);
  const pos = (s: SimState) => s.formations.filter((f) => onMap(f, s.time)).map((f) => ({ id: f.id, at: f.position, side: f.side, f }));
  const now = pos(state);
  const seen = detected(T, now.filter((u) => u.side === side), now.filter((u) => u.side !== side), km);
  const before = prev ? (() => { const p = pos(prev); return detected(T, p.filter((u) => u.side === side), p.filter((u) => u.side !== side), km); })() : null;
  const own = now.filter((u) => u.side === side);
  return now.filter((u) => seen.has(u.id)).map(({ f }) => {
    let nearest: IntelReport['nearest'] = null;
    for (const o of own) {
      const d = dist(T.proj.toXY(o.at), T.proj.toXY(f.position));
      if (!nearest || d < nearest.km) nearest = { name: o.f.name, km: +d.toFixed(1) };
    }
    return { id: f.id, name: f.name, at: f.position, place: describePlace(T, f.position), posture: POSTURE_RU[f.posture] ?? f.posture, estimate: estimate(f), nearest, fresh: !!before && !before.has(f.id) };
  }).sort((a, b) => (a.nearest?.km ?? 1e9) - (b.nearest?.km ?? 1e9));
}

/** Пункты театра вблизи войск стороны и обнаруженного противника (для приказов и обстановки модели). */
export function nearbyPlaces(ctx: SimContext, state: SimState, side: string, km: number, limit = 80) {
  const T = ctx.theatre;
  const live = state.formations.filter((f) => onMap(f, state.time));
  const seen = intelReport(ctx, state, side).map((x) => x.id);
  const pts = live.filter((f) => f.side === side || seen.includes(f.id)).map((f) => T.proj.toXY(f.position));
  return places(T).map((a) => {
    const q = T.proj.toXY(a.at);
    return { ...a, km: Math.min(...pts.map((p) => dist(p, q))) };
  }).filter((a) => a.km <= km).sort((a, b) => a.km - b.km).slice(0, limit);
}

const km1 = (x: number) => (x >= 10 ? String(Math.round(x)) : x.toFixed(1).replace('.', ','));

/** Сводка «за сутки» для стороны: бои, окружения, уничтоженные, дошедшие приказы (только свои — для чужих — без подробностей). */
export function dayEvents(ctx: SimContext, state: SimState, side: string, prev: SimState): string[] {
  const names = new Map(state.formations.map((f) => [f.id, f.name]));
  const sideOf = new Map(state.formations.map((f) => [f.id, f.side]));
  const out: string[] = [];
  for (const j of state.journal.slice(prev.journal.length)) {
    if (j.kind === 'combat') {
      const ours = sideOf.get(j.attackers[0]) === side;
      const a = j.attackers.map((x) => names.get(x)).join(', '), d = j.defenders.map((x) => names.get(x)).join(', ');
      out.push(ours
        ? `Наступление: ${a} против ${d} — ${OUTCOME_RU[j.outcome]}${j.advanceKm ? ` на ${km1(j.advanceKm)} км` : ''}; соотношение сил ${km1(j.ratio)}:1; потери ${Math.round(j.attackerLoss * 100)} %.`
        : `Атака противника: ${a} против ${d} — ${OUTCOME_RU[j.outcome]}${j.advanceKm ? `, противник продвинулся на ${km1(j.advanceKm)} км` : ''}; наши потери ${Math.round(j.defenderLoss * 100)} %.`);
    } else if (j.kind === 'encircled') {
      const ours = sideOf.get(j.formation) === side;
      if (ours) out.push(j.cut ? `${names.get(j.formation)} — ОТРЕЗАНО от подвоза (окружено).` : `${names.get(j.formation)} — подвоз восстановлен.`);
      else if (j.cut) out.push(`По данным разведки, ${names.get(j.formation)} отрезано от своих.`);
    } else if (j.kind === 'destroyed') {
      out.push(sideOf.get(j.formation) === side ? `${names.get(j.formation)} потеряло боеспособность.` : `${names.get(j.formation)} (противник) разгромлено.`);
    } else if (j.kind === 'capitulated') {
      out.push(sideOf.get(j.formation) === side ? `${names.get(j.formation)} — в окружении без боеприпасов, капитулировало (${j.personnel.toLocaleString('ru')} чел.).` : `${names.get(j.formation)} (противник) в котле капитулировало: около ${j.personnel.toLocaleString('ru')} пленных.`);
    } else if (j.kind === 'brokeOut') {
      out.push(sideOf.get(j.formation) === side ? `${names.get(j.formation)} прорвалось из окружения (${j.personnel.toLocaleString('ru')} чел.), тяжёлое вооружение брошено.` : `По данным разведки, ${names.get(j.formation)} прорвалось из котла.`);
    } else if (j.kind === 'detached' && sideOf.get(j.formation) === side) {
      out.push(`Из ${names.get(j.from)} выделено: ${names.get(j.formation)} (${j.personnel.toLocaleString('ru')} чел., ${j.tanks} танков, ${j.guns} орудий).`);
    } else if (j.kind === 'directive' && j.side === side) {
      const t = commandTerms(ctx, side);
      const who = j.issuedBy === 'player' ? 'распоряжение' : `${t.directive} ${t.topGen}`;
      out.push(`С ${j.from.slice(8, 10)}.${j.from.slice(5, 7)} ${j.from.slice(11, 16)} — разграничительная линия ${j.title.replace(/\s*\(.*\)$/, '')} (${who}).`);
    } else if (j.kind === 'supply' && sideOf.get(j.formation) === side) {
      out.push(j.what === 'ammo' ? `${names.get(j.formation)}: боеприпасы на исходе (${j.left} бк).` : j.what === 'stock' ? `${names.get(j.formation)}: склады крепости исчерпаны.` : `${names.get(j.formation)}: горючее кончилось.`);
    }
  }
  return out;
}

/** Бой за ход для разбора на карте: где, кто с кем (названия — бой есть соприкосновение), исход, наши потери. */
export interface TurnBattle {
  time: string;
  at: LngLat;
  /** Место словами («у Зелова», «8 км к СВ от Зелова»). */
  place: string;
  /** attack — наступали свои, defend — атаковал противник. */
  role: 'attack' | 'defend';
  own: { id: string; name: string }[];
  enemy: { id: string; name: string }[];
  outcome: 'breakthrough' | 'advance' | 'held' | 'repelled';
  outcomeText: string;
  /** Продвижение наступающих, км. */
  advanceKm: number;
  /** Наши потери в бою, % численности участвовавших. */
  ownLossPct: number;
  /** Соотношение сил наступающих к обороняющимся. */
  ratio: number;
}

/** Бои за ход (после prev) стороны side: место и участники из журнала расчёта. */
export function turnBattles(ctx: SimContext, state: SimState, side: string, prev: SimState): TurnBattle[] {
  const byId = new Map(state.formations.map((f) => [f.id, f]));
  const who = (ids: string[]) => ids.map((id) => ({ id, name: byId.get(id)?.name ?? id }));
  const out: TurnBattle[] = [];
  for (const j of state.journal.slice(prev.journal.length)) {
    if (j.kind !== 'combat') continue;
    const ours = byId.get(j.attackers[0])?.side === side;
    out.push({
      time: j.time, at: j.at, place: describePlace(ctx.theatre, j.at), role: ours ? 'attack' : 'defend',
      own: who(ours ? j.attackers : j.defenders), enemy: who(ours ? j.defenders : j.attackers),
      outcome: j.outcome, outcomeText: OUTCOME_RU[j.outcome], advanceKm: +j.advanceKm.toFixed(1),
      ownLossPct: Math.round((ours ? j.attackerLoss : j.defenderLoss) * 1000) / 10, ratio: +j.ratio.toFixed(1),
    });
  }
  return out;
}

/** Задержка доведения приказа до формирования, часов (по ступени). */
export function orderDelay(ctx: SimContext, f: Pick<Formation, 'side' | 'echelon'>): number {
  return profileOf(ctx, f.side).orderDelayHours[f.echelon as keyof ReturnType<typeof profileOf>['orderDelayHours']] ?? 0;
}

/**
 * Доклады армий и корпусов стороны по докладам их дивизий: в агентной модели действуют дивизии, а приказы удобно
 * отдавать и объединениям (ядро разошлёт приказ всем их дивизиям). Место — центр тяжести, силы — сумма, запасы —
 * средние по численности, укомплектованность — по людям (groupManning), положение и задача — у большинства людей.
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
    const g = groupManning(l);
    return {
      id: h.id, name: h.name, parent: h.parent ?? null, echelon: h.echelon, status: 'active', at, place: describePlace(ctx.theatre, at),
      posture: top(l, (u) => u.posture) ?? '', task, target: task ? top(l.filter((u) => u.task === task), (u) => u.target) : null,
      orderSource: top(l, (u) => u.orderSource), personnel: Math.round(P), tanks: l.reduce((s, u) => s + u.tanks, 0), guns: l.reduce((s, u) => s + u.guns, 0),
      strength: g.strength, manning: g.manning, establishment: g.establishment, ammo: +w((u) => u.ammo).toFixed(2), fuel: +w((u) => u.fuel).toFixed(2), fatigue: +w((u) => u.fatigue).toFixed(2),
      cutOff: l.some((u) => u.cutOff), movedKm: +w((u) => u.movedKm).toFixed(1), combats: [], pending: [],
    };
  }).filter((x): x is UnitReport => !!x);
}
