/**
 * Распоряжения штаба по уровню пункта управления (агентная модель): тыл, переправы, резервы, полосы — что штаб этой
 * ступени видит и чем распоряжается. Фронтовой и армейский тыл, понтонные парки — у фронта и армии; Ставка видит всё и
 * распределяет подвоз между фронтами; корпус и дивизия видят подвоз своих войск и переправы рядом. Без React.
 */
import type { StaffAction, UnitReport } from '@def-ops/sim';
import type { LngLat } from '@def-ops/core';
import type { BaseView, BridgeView, TurnView } from './sim/game-protocol';
import type { LevelId } from './map-level-scale';
import { recipients } from './command-post';
import { divisionsUnder, postReports, postReserves } from './post-views';
import type { OrdersSub } from './voice/actions/staff';

export interface StaffScope {
  level: LevelId;
  issuer: string;
  /** Чей пункт словами: «Ставки», «штаба 1-го Белорусского фронта». */
  whose: string;
  /** Базы снабжения: переносить (фронт, армия), только видеть (Ставка), не показывать — только подвоз своих (корпус). */
  bases: 'move' | 'view' | 'none';
  /** Приоритет подвоза между подчинёнными (Ставка — фронты, фронт — армии, армия — корпуса). */
  priority: boolean;
  /** Переправы: наводить своими (приданными) понтонными парками — фронт, армия, корпус; только видеть — Ставка. */
  bridges: 'build' | 'view';
  /** Придавать понтонные парки подчинённым: Ставка — фронтам, фронт — армиям, армия — корпусам. */
  allotParks: boolean;
  /** Полосы: линии фронтов (Ставка — директивой), линии армий фронта (фронт), своя полоса (армия и ниже). */
  bounds: 'fronts' | 'armies' | 'own';
}

/** Советский танковый или механизированный корпус (свой тыл); немецкий корпус звеном снабжения не был. */
export const mobileCorps = (v: TurnView, id: string) => (v.terms?.top ?? 'Ставка') === 'Ставка' && /танков|механиз|(^|\s)[тм]к(\s|$)/i.test(v.command?.hqs[id]?.name ?? '');

const KM_REACH: Record<LevelId, number> = { stavka: Infinity, front: 60, army: 30, corps: 20, division: 20 };
const km = (a: LngLat, b: LngLat) => Math.hypot((a[0] - b[0]) * 111.32 * Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180), (a[1] - b[1]) * 110.57);

/** Что штаб пункта ведёт на вкладке «Приказы» (тыл, переправы, полосы). */
export function staffScope(v: TurnView, level: LevelId, issuer: string): StaffScope {
  const name = v.command?.hqs[issuer]?.name ?? '';
  const whose = level === 'stavka' ? (v.terms?.topGen ?? 'Ставки') : `штаба: ${name}`;
  return {
    level, issuer, whose,
    bases: level === 'front' || level === 'army' ? 'move' : level === 'stavka' ? 'view' : 'none',
    // у советского танкового и механизированного корпуса — свой тыл: подвоз между его бригадами и дивизиями; у стрелкового — нет
    priority: level === 'stavka' || level === 'front' || level === 'army' || ((level === 'corps' || level === 'division') && mobileCorps(v, issuer)),
    bridges: level === 'stavka' ? 'view' : 'build',
    allotParks: level === 'stavka' || level === 'front' || level === 'army',
    bounds: level === 'stavka' ? 'fronts' : level === 'front' ? 'armies' : 'own',
  };
}

/** Все подвкладки видны (игра без пункта управления, нет обстановки). */
export const ALL_SUBS: Record<OrdersSub, true> = { units: true, rear: true, bridges: true, reserves: true, bounds: true };

/** Какие подвкладки «Приказов» видны на уровне: `true` — есть, строка — почему нет (для голоса). Игра без пункта — все. */
export function ordersSubs(v: TurnView, scope: StaffScope | null): Record<OrdersSub, true | string> {
  if (!scope) return ALL_SUBS;
  return {
    units: true,
    rear: scope.bases === 'move' || scope.priority || 'тыл ведут штабы фронта и армии (у подвижного корпуса — свой)',
    bridges: scope.bridges === 'build' || scope.allotParks || 'переправы наводят штабы с понтонными парками: фронт, армия, корпус',
    reserves: postReserves(v, scope.issuer).length > 0 || 'в подчинении нет резервов',
    bounds: scope.bounds === 'armies' || 'полосы этой ступени задаются в «Пункте управления» (директивой или приказом)',
  };
}

/** Базы, которые питают войска пункта: ближайшая база каждой его дивизии (Ставка — все). */
export function postBases(v: TurnView, s: StaffScope): BaseView[] {
  if (s.level === 'stavka') return v.bases;
  const divs = divisionsUnder(v, s.issuer);
  const ids = new Set<string>();
  for (const d of divs) {
    const best = v.bases.filter((b) => b.state !== 'idle').reduce<BaseView | null>((m, b) => (!m || km(d.at, b.at) < km(d.at, m.at) ? b : m), null);
    if (best) ids.add(best.id);
  }
  return v.bases.filter((b) => ids.has(b.id));
}

/** Переправы в полосе пункта: не дальше его досягаемости от его дивизий (Ставка — все). */
export function postBridges(v: TurnView, s: StaffScope): BridgeView[] {
  const reach = KM_REACH[s.level];
  if (!Number.isFinite(reach)) return v.bridges;
  const divs = divisionsUnder(v, s.issuer).map((d) => d.at);
  return v.bridges.filter((b) => divs.some((p) => km(p, b.at) <= reach));
}

/** Место в полосе пункта (для наводки переправы): не дальше досягаемости от его дивизий. */
export function inPostReach(v: TurnView, s: StaffScope, at: LngLat): boolean {
  const reach = KM_REACH[s.level];
  return !Number.isFinite(reach) || divisionsUnder(v, s.issuer).some((d) => km(d.at, at) <= reach);
}

/** Строка подвоза подчинённого: его сводка и время подвоза (худшее по его дивизиям). */
export interface SupplyRow { unit: UnitReport; hours: number | null }

/** Подчинённые пункта с подвозом: время подвоза — худшее по дивизиям подчинённого (нет пути у какой-то — «не доходит»). */
export function postSupply(v: TurnView, s: StaffScope): SupplyRow[] {
  return postReports(v, s.issuer).map((u) => {
    const divs = u.echelon === 'division' ? [u] : divisionsUnder(v, u.id);
    const hs = divs.map((d) => v.supplyHours[d.id]).filter((h) => h !== undefined);
    const hours = hs.length ? (hs.some((h) => h == null) ? null : Math.max(...(hs as number[]))) : (v.supplyHours[u.id] ?? null);
    return { unit: u, hours };
  });
}

/** Сколько подчинённых может получить приоритет: треть, не меньше одного. */
export const priorityLimit = (n: number) => Math.max(1, Math.ceil(n / 3));

/**
 * Приоритет подвоза стороны — один список; каждый пункт правит в нём свою часть (своих подчинённых): прежние его
 * подчинённые убираются, выбранные добавляются, приоритеты других пунктов остаются.
 */
export function mergePriority(global: string[], mine: string[], chosen: string[]): string[] {
  const own = new Set(mine);
  return [...global.filter((x) => !own.has(x)), ...chosen.filter((x) => own.has(x))];
}

/** Подчинённые пункта, среди которых распределяется подвоз. */
export const priorityPool = (v: TurnView, s: StaffScope) => recipients(v, s.issuer).map((x) => x.id);

const LEVEL_NAME: Record<LevelId, string> = { stavka: 'Ставка', front: 'Фронт', army: 'Армия', corps: 'Корпус', division: 'Дивизия' };

/**
 * Может ли штаб пункта отдать это распоряжение: null — может, иначе — почему нет (кто им распоряжается). Проверяется
 * перед включением в проект — и для кнопок, и для голоса.
 */
export function staffDeny(v: TurnView, s: StaffScope, a: StaffAction, reserveIds: string[] = []): string | null {
  const at = `сейчас пункт — уровень «${LEVEL_NAME[s.level]}»`;
  if (a.kind === 'base') {
    if (s.bases !== 'move') return `базы снабжения переносят штабы фронтов и армий (уровни «Фронт», «Армия»); ${at}`;
    if (!postBases(v, s).some((b) => b.id === a.base)) return 'эта база питает войска другого штаба — ей распоряжается он';
  }
  if (a.kind === 'priority' && !s.priority) return `приоритет подвоза распределяют Ставка, фронт и армия между подчинёнными; ${at}`;
  if (a.kind === 'bridge' || a.kind === 'demolish') {
    if (s.bridges !== 'build') return `Ставка переправ не наводит — она придаёт понтонные парки фронтам; наводят фронт, армия и корпус своими парками; ${at}`;
    if (!inPostReach(v, s, a.at)) return 'место вне полосы штаба — далеко от его войск';
  }
  if (a.kind === 'parks') {
    if (!s.allotParks) return `понтонные парки придают Ставка, фронт и армия своим подчинённым; ${at}`;
    if (!priorityPool(v, s).includes(a.hq)) return 'придать парки можно только своему подчинённому штабу';
  }
  if (a.kind === 'boundary') {
    if (s.bounds !== 'armies') return `линии между армиями проводит штаб фронта (уровень «Фронт»); ${at}`;
    const mine = new Set(priorityPool(v, s));
    if (!mine.has(a.a) || !mine.has(a.b)) return 'обе армии должны быть в подчинении этого фронта';
  }
  if (a.kind === 'commit' && reserveIds.length && !reserveIds.includes(a.formation)) return 'этот резерв — не в распоряжении штаба пункта';
  return null;
}

/** Понтонные парки штаба пункта: ключ в parksBy (верхняя инстанция — «top»). */
export const parksKey = (v: TurnView, issuer: string) => (v.command?.hqs[issuer]?.echelon === 'high_command' ? 'top' : issuer);
