/**
 * Описание моделей словами: правила арбитра (таблицы боя, поправки, темпы, территория, калибровка) и профили
 * сторон (вес сил, управление, подвоз, инженерные войска) — параметр, значение, что он значит. Плюс разница
 * между двумя наборами правил — для сравнения моделей.
 */
import type { Rules, SideProfile, Table } from './types';

export interface ParamRow { key: string; group: string; title: string; value: string; hint: string; num?: number }

const n = (x: number, d = 2) => (Math.round(x * 10 ** d) / 10 ** d).toLocaleString('ru-RU');
const TERR: Record<string, string> = { open: 'открытая', forest: 'лес', marsh: 'болото', urban: 'город', hills: 'высоты', water: 'вода' };
const table = (t: Table, unit = '') => t.map(([x, y]) => `${n(x, 1)}:1 → ${n(y, 3)}${unit}`).join('; ');
/** Значение таблицы при соотношении 3:1 (интерполяция в лог-шкале) — одно число для сравнения. */
function at3(t: Table): number {
  const f = Math.log;
  if (3 <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (3 <= t[i][0]) { const [x0, y0] = t[i - 1], [x1, y1] = t[i]; return y0 + (y1 - y0) * ((f(3) - f(x0)) / (f(x1) - f(x0))); }
  return t[t.length - 1][1];
}

/** Параметры правил по группам. */
export function describeRules(r: Rules): ParamRow[] {
  const R: ParamRow[] = [];
  const add = (key: string, group: string, title: string, value: string, hint: string, num?: number) => R.push({ key, group, title, value, hint, num });
  add('contactKm', 'Бой', 'Расстояние соприкосновения', `${n(r.contactKm, 1)} км`, 'ближе — части вступают в бой', r.contactKm);
  add('advance3', 'Бой', 'Темп наступления при 3:1', `${n(at3(r.advance), 1)} км/сут`, `таблица по соотношению сил: ${table(r.advance, ' км/сут')}`, at3(r.advance));
  add('attLoss3', 'Бой', 'Потери наступающего при 3:1', `${n(at3(r.attackerLoss) * 100, 1)} %/сут`, `доля состава в сутки: ${table(r.attackerLoss)}`, at3(r.attackerLoss));
  add('defLoss3', 'Бой', 'Потери обороняющегося при 3:1', `${n(at3(r.defenderLoss) * 100, 1)} %/сут`, `доля состава в сутки: ${table(r.defenderLoss)}`, at3(r.defenderLoss));
  add('noise', 'Бой', 'Разброс исхода боя', `±${n(r.noise * 100, 0)} %`, 'случайный множитель к соотношению сил (σ логнормального)', r.noise);
  add('prepared', 'Оборона', 'Подготовленная оборона', `×${n(r.defense.prepared)} после ${r.defense.prepareHours} ч`, 'сила обороняющегося, простоявшего на месте', r.defense.prepared);
  add('fort', 'Оборона', 'Укрепления', `+${n(r.defense.fortificationPerLevel * 100, 0)} % за уровень`, 'прибавка к силе обороны за уровень укреплённости района', r.defense.fortificationPerLevel);
  add('terrain', 'Оборона', 'Местность', Object.entries(r.defense.terrain).map(([k, v]) => `${TERR[k] ?? k} ×${n(v!)}`).join(', ') || '—', 'поправка к силе обороняющегося за местность');
  if (r.heightAdvantage) add('height', 'Оборона', 'Превышение', `±${n(r.heightAdvantage.bonus * 100, 0)} % за ${r.heightAdvantage.perM} м, не больше ±${n(r.heightAdvantage.max * 100, 0)} %`, 'оборона выше наступающих — сильнее, ниже — слабее (нужна сетка высот театра)', r.heightAdvantage.bonus);
  if (r.advanceTerrain) add('advTerrain', 'Оборона', 'Темп по местности обороны', Object.entries(r.advanceTerrain).map(([k, v]) => `${TERR[k] ?? k} ×${n(v!)}`).join(', '), 'доля обычного темпа наступления', r.advanceTerrain.urban);
  if (r.fortAdvanceKm) add('fortAdvance', 'Оборона', 'Прогрызание полос', r.fortAdvanceKm.slice(1).map((v, i) => `ур. ${i + 1}: ${n(v, 1)} км/сут`).join(', '), 'предельный темп прорыва укреплённой полосы, пока оборона в ней стоит', r.fortAdvanceKm[1]);
  if (r.fortCrossHours) add('fortCross', 'Оборона', 'Заграждения вне боя', `${n(r.fortCrossHours, 1)} ч/клетку за уровень`, 'мины, рвы, заграждения непрорванной полосы', r.fortCrossHours);
  add('ammo', 'Снабжение и состояние', 'Нехватка боеприпасов', `сила ×${n(r.ammoShort)}`, 'при запасе меньше 0,5 боекомплекта', r.ammoShort);
  add('fuel', 'Снабжение и состояние', 'Без горючего', `техника ×${n(r.fuelOut)}`, 'подвижные части без горючего не движутся и слабеют', r.fuelOut);
  add('fatigue', 'Снабжение и состояние', 'Усталость', `до −${n(r.fatigueEffect * 100, 0)} % силы`, `прирост в бою ${n(r.fatigueGain.combat * 100, 0)} %/сут, на марше ${n(r.fatigueGain.march * 100, 0)} %/сут, отдых −${n(r.fatigueGain.rest * 100, 0)} %/сут`, r.fatigueEffect);
  add('encircle', 'Снабжение и состояние', 'Окружение', `${r.encircleHours ?? 36} ч без подвоза`, 'через сколько часов без подвоза формирование считается окружённым', r.encircleHours ?? 36);
  add('movement', 'Движение', 'Темп марша', `×${n(r.movementScale ?? 1)}`, 'множитель к темпам марша из профилей сторон', r.movementScale ?? 1);
  add('river', 'Движение', 'Река без моста', `+${r.riverCrossHours} ч для пехоты`, 'техника — только по мостам и переправам', r.riverCrossHours);
  if (r.territory) add('territory', 'Движение', 'Территория противника', `пешие ${n(r.territory.enemyKmPerDay.foot ?? 0, 0)}, подвижные ${n(r.territory.enemyKmPerDay.tracked ?? 0, 0)} км/сут`, `территория переходит к стороне, где прошли её войска (полоса ${r.territory.radiusKm} км); по чужой — медленнее`, r.territory.enemyKmPerDay.foot);
  add('city', 'Движение', 'Городской бой', [r.holdGivesGround ? '«держаться» — уступая кварталы' : null, r.bypassStrongpoints === false ? 'узлы обороны не обходятся' : 'узлы обороны обходятся'].filter(Boolean).join('; '), 'правила городского масштаба');
  return R;
}

/** Откуда правила: базовые, калибровка, мерило до и после. */
export function rulesOrigin(r: Rules): { status: string; extends?: string; calibration?: { scenario: string; date: string; from: string; evals: number; before: Record<string, number>; after: Record<string, number>; multipliers: Record<string, number> } } {
  const c = r.calibration as Record<string, unknown> | undefined;
  return {
    status: String((r as unknown as Record<string, unknown>)._status ?? ''),
    extends: r.extends,
    ...(c && c.after ? { calibration: { scenario: String(c.scenario), date: String(c.date), from: String(c.from), evals: Number(c.evals), before: c.before as Record<string, number>, after: c.after as Record<string, number>, multipliers: (c.multipliers ?? {}) as Record<string, number> } } : {}),
  };
}

/** Чем различаются два набора правил: строки, где значения не совпадают. */
export function diffRules(a: Rules, b: Rules): { key: string; group: string; title: string; a: string; b: string }[] {
  const A = describeRules(a), B = new Map(describeRules(b).map((x) => [x.key, x]));
  return A.filter((x) => B.get(x.key) && B.get(x.key)!.value !== x.value).map((x) => ({ key: x.key, group: x.group, title: x.title, a: x.value, b: B.get(x.key)!.value }));
}

const ECH: Record<string, string> = { front: 'фронт', army: 'армия', corps: 'корпус', division: 'дивизия', brigade: 'бригада', regiment: 'полк' };
const MOB: Record<string, string> = { foot: 'пешие', motor: 'моторизованные', tracked: 'гусеничные' };

/** Профиль стороны словами. */
export function describeProfile(p: SideProfile): ParamRow[] {
  const R: ParamRow[] = [];
  const add = (key: string, group: string, title: string, value: string, hint: string) => R.push({ key, group, title, value, hint });
  add('weights', 'Боевой потенциал', 'Вес сил', `1000 чел. — ${n(p.weights.personnel)}, танк/САУ — ${n(p.weights.tanks)}, орудие — ${n(p.weights.guns)}`, 'вклад в боевой потенциал');
  add('types', 'Боевой потенциал', 'Типы формирований', Object.values(p.unitTypes).map((u) => `${u.name} (${MOB[u.mobility] ?? u.mobility}, качество ×${n(u.quality)})`).join('; '), 'качество — выучка, слаженность, управление');
  add('road', 'Движение', 'Марш по дороге', Object.entries(p.road).map(([k, v]) => `${MOB[k] ?? k} ${v} км/сут`).join(', '), 'темп марша по дорогам');
  add('offroad', 'Движение', 'Марш вне дорог (открытая)', Object.entries(p.offRoad).map(([k, v]) => `${MOB[k] ?? k} ${v.open} км/сут`).join(', '), 'по открытой местности; лес, болото, город — по таблице профиля');
  add('delay', 'Управление', 'Доведение приказов', Object.entries(p.orderDelayHours).map(([k, v]) => `${ECH[k] ?? k} — ${v} ч`).join(', '), 'сколько приказ идёт до исполнения');
  if (p.supply) add('supply', 'Тыл', 'Подвоз', `${n(p.supply.ammoPerDay)} бк и ${n(p.supply.fuelPerDay)} запр. в сутки, до ${p.supply.rangeHours} ч от базы`, `запасы не выше ${p.supply.maxAmmo} бк / ${p.supply.maxFuel} запр.`);
  if (p.engineering) add('eng', 'Тыл', 'Переправы', `большая река ${p.engineering.bridgeHoursMajor} ч, малая ${p.engineering.bridgeHoursMinor} ч, парков ${p.engineering.parks}`, 'наводка переправ инженерными войсками');
  return R;
}
