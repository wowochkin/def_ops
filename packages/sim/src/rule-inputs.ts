/**
 * Перечень входов правил: числа правил арбитра, профилей сторон и параметры агентной модели с нормативом — путь
 * (как параметр норматива в базе знаний), название, единица, группа, как прочесть значение и, у подбираемых
 * калибровкой, ключ множителя. Плюс пересчёт коридора норматива (значение или диапазон источника с допуском по
 * надёжности) в коридор множителя калибровки. Сборщик «база → правила» (packages/knowledge, compile-rules) получает
 * перечень и пересчёт параметром — пакеты друг от друга не зависят.
 */
import type { CalibKey } from './calibrate';
import { agentNumber } from './agents-params';
import { CORRIDOR_TOL } from './norms';
import { interp } from './rules';
import { ENGINEERING } from './staff';
import type { Rules, SideProfile, Table, TerrainClass } from './types';

export type RuleGroup = 'бой' | 'оборона и местность' | 'движение' | 'подвоз' | 'усталость' | 'окружение' | 'профили' | 'агентная модель';

export interface RuleInput {
  /** Путь параметра — тот же, что у норматива в базе (`param`), без масштаба и знака процента. */
  path: string;
  title: string;
  /** Единица значения, которое возвращает read (в ней же записан норматив). */
  unit?: string;
  group: RuleGroup;
  /** Таблица целиком; read — её значение при соотношении 3:1 (у прогрызания полос — уровень 1). */
  table?: true;
  /** Множитель калибровки, коридор которого задаёт норматив на этот вход. */
  calib?: CalibKey;
  /** Модель армий (правила и профили) или агентная модель (agents-v0.json, путь с приставкой «agents.»). */
  engine: 'army' | 'agents';
  /** Значение, которым пользуется модель (с умолчаниями движка); нет блока или профиля — null. */
  read(rules: Rules, profiles: Record<string, SideProfile>, agents?: unknown): number | null;
}

/** Допуск коридора по надёжности источника — допущение assume-corridor-tolerance (norms.json). */
export const TOLERANCE = CORRIDOR_TOL;

const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
/** Убрать хвосты плавающей точки (0,8 × 1,35 = 1,0800000000000002). */
const clean = (x: number) => +x.toPrecision(12);

/** Профили по умолчанию, если профили переданы по своим id, а не по сторонам. */
const SIDE_PROFILE = { su: 'rkka-1945', de: 'wehrmacht-1945' } as const;
function side(profiles: Record<string, SideProfile>, s: 'su' | 'de'): SideProfile | undefined {
  return profiles[s] ?? profiles[SIDE_PROFILE[s]];
}
const su = (p: Record<string, SideProfile>) => side(p, 'su');
const de = (p: Record<string, SideProfile>) => side(p, 'de');
const meanQuality = (p?: SideProfile) => {
  const q = p ? Object.values(p.unitTypes).map((u) => u.quality).filter((x) => Number.isFinite(x)) : [];
  return q.length ? clean(q.reduce((a, b) => a + b, 0) / q.length) : null;
};

/** Значение таблицы при соотношении 3:1 (как «при 3:1» в описании правил). */
const at3 = (t?: Table) => (t?.length ? interp(t, 3) : null);

const TERR_RU: Partial<Record<TerrainClass, string>> = { open: 'открытая местность', forest: 'лес', marsh: 'болото', urban: 'город', hills: 'высоты' };

const army = (path: string, title: string, group: RuleGroup, read: RuleInput['read'], o: Partial<Pick<RuleInput, 'unit' | 'table' | 'calib'>> = {}): RuleInput =>
  ({ path, title, group, engine: 'army', read, ...o });

/** Параметр agents-v0.json с нормативом (источник и надёжность); таблица — значение при 3:1. */
const agent = (path: string, title: string, unit?: string, table?: true): RuleInput => ({
  path: `agents.${path}`, title, group: 'агентная модель', engine: 'agents', ...(unit ? { unit } : {}), ...(table ? { table } : {}),
  read: (_r, _p, a) => (a === undefined ? null : agentNumber(a, path, !!table)),
});

export const RULE_INPUTS: RuleInput[] = [
  // бой
  army('contactKm', 'Расстояние соприкосновения', 'бой', (r) => num(r.contactKm), { unit: 'км' }),
  army('advance', 'Таблица темпа наступления (при 3:1)', 'бой', (r) => at3(r.advance), { unit: 'км/сут', table: true }),
  army('advanceMax', 'Наибольший темп наступления (при 10:1)', 'бой', (r) => (r.advance?.length ? interp(r.advance, 10) : null), { unit: 'км/сут', calib: 'advance' }),
  army('attackerLoss', 'Таблица потерь наступающего (при 3:1)', 'бой', (r) => { const v = at3(r.attackerLoss); return v == null ? null : clean(v * 100); }, { unit: '%/сут', table: true, calib: 'attackerLoss' }),
  army('defenderLoss', 'Таблица потерь обороняющегося (при 3:1)', 'бой', (r) => { const v = at3(r.defenderLoss); return v == null ? null : clean(v * 100); }, { unit: '%/сут', table: true, calib: 'defenderLoss' }),
  army('noise', 'Разброс исхода боя', 'бой', (r) => num(r.noise), { unit: 'σ' }),
  army('regimes.urban.advance', 'Режим «бой в застройке»: темп', 'бой', (r) => (r.regimes ? r.regimes.urban?.advance ?? 1 : null), { unit: '×' }),
  army('regimes.belt.advance', 'Режим «бой в укреплённой полосе»: темп', 'бой', (r) => (r.regimes ? r.regimes.belt?.advance ?? 1 : null), { unit: '×' }),
  // оборона и местность
  army('defense.prepared', 'Подготовленная оборона', 'оборона и местность', (r) => num(r.defense?.prepared), { unit: '×', calib: 'prepared' }),
  army('defense.prepareHours', 'Время подготовки обороны', 'оборона и местность', (r) => num(r.defense?.prepareHours), { unit: 'ч' }),
  army('defense.fortificationPerLevel', 'Укрепления: прибавка за уровень', 'оборона и местность', (r) => num(r.defense?.fortificationPerLevel), { unit: '+', calib: 'fortPerLevel' }),
  ...(['open', 'forest', 'marsh', 'urban', 'hills'] as TerrainClass[]).map((t) =>
    army(`defense.terrain.${t}`, `Поправка обороны: ${TERR_RU[t]}`, 'оборона и местность', (r) => num(r.defense?.terrain?.[t]), { unit: '×', calib: 'terrainExp' })),
  army('advanceTerrain.urban', 'Темп боя в городе', 'оборона и местность', (r) => num(r.advanceTerrain?.urban), { unit: '×', calib: 'urbanAdvance' }),
  army('advanceTerrain.forest', 'Темп боя в лесу', 'оборона и местность', (r) => num(r.advanceTerrain?.forest), { unit: '×' }),
  army('advanceTerrain.marsh', 'Темп боя в болоте', 'оборона и местность', (r) => num(r.advanceTerrain?.marsh), { unit: '×' }),
  army('advanceTerrain.hills', 'Темп боя на высотах', 'оборона и местность', (r) => num(r.advanceTerrain?.hills), { unit: '×' }),
  army('fortAdvanceKm', 'Прогрызание полос (уровень 1)', 'оборона и местность', (r) => num(r.fortAdvanceKm?.[1]), { unit: 'км/сут', table: true, calib: 'fortAdvance' }),
  army('fortCrossHours', 'Заграждения вне боя', 'оборона и местность', (r) => num(r.fortCrossHours), { unit: 'ч/клетку за уровень' }),
  army('beltBreachKm', 'Прорванная полоса не держит', 'оборона и местность', (r) => (r.beltBreachKm ? r.beltBreachKm : null), { unit: 'км' }),
  army('heightAdvantage.bonus', 'Превышение: поправка обороны', 'оборона и местность', (r) => num(r.heightAdvantage?.bonus), { unit: 'доля' }),
  // движение
  army('foot.road', 'Марш пеших по дороге', 'движение', (r, p) => { const v = su(p)?.road.foot; return v == null ? null : clean(v * (r.movementScale ?? 1)); }, { unit: 'км/сут', calib: 'movement' }),
  army('foot.open', 'Марш пеших вне дорог по открытой местности', 'движение', (r, p) => { const v = su(p)?.offRoad.foot.open; return v == null ? null : clean(v * (r.movementScale ?? 1)); }, { unit: 'км/сут', calib: 'movement' }),
  army('movementScale', 'Множитель темпов марша', 'движение', (r) => r.movementScale ?? 1, { unit: '×' }),
  army('riverCrossHours', 'Река без моста для пехоты', 'движение', (r) => num(r.riverCrossHours), { unit: 'ч' }),
  army('bridgeHoursMajor', 'Наводка переправы через большую реку', 'движение', (_r, p) => (su(p)?.engineering ?? ENGINEERING).bridgeHoursMajor, { unit: 'ч' }),
  army('bridgeHoursMinor', 'Наводка переправы через малую реку', 'движение', (_r, p) => (su(p)?.engineering ?? ENGINEERING).bridgeHoursMinor, { unit: 'ч' }),
  army('engineers.hours', 'Сапёры без штаба: переправа открыта через', 'движение', (r) => (r.engineers === false ? null : r.engineers?.hours ?? 24), { unit: 'ч' }),
  army('territory.enemyKmPerDay.foot', 'Пешие по территории противника', 'движение', (r) => num(r.territory?.enemyKmPerDay.foot), { unit: 'км/сут', calib: 'terrFoot' }),
  army('territory.enemyKmPerDay.tracked', 'Подвижные по территории противника', 'движение', (r) => num(r.territory?.enemyKmPerDay.tracked), { unit: 'км/сут', calib: 'terrMobile' }),
  army('territory.radiusKm', 'Полоса перехода территории', 'движение', (r) => num(r.territory?.radiusKm), { unit: 'км' }),
  army('territory.consolidateKm', 'Закрепление земли за фронтом', 'движение', (r) => (r.territory ? r.territory.consolidateKm ?? r.contactKm * 1.5 : null), { unit: 'км' }),
  army('followParentKm', 'Корпус за армией', 'движение', (r) => (r.followParentKm ? r.followParentKm : null), { unit: 'км' }),
  army('pursuitClearKm', 'Преследование, если противник дальше', 'движение', (r) => r.pursuitClearKm ?? 2 * r.contactKm, { unit: 'км' }),
  army('routeVariety', 'Разброс выбора пути', 'движение', (r) => r.routeVariety ?? 0, { unit: 'доля' }),
  army('regimes.pursuitFoot.speed', 'Режим «преследование общевойсковыми»: темп', 'движение', (r) => (r.regimes ? r.regimes.pursuitFoot?.speed ?? 1 : null), { unit: '×' }),
  army('regimes.pursuitMobile.speed', 'Режим «преследование подвижными»: темп', 'движение', (r) => (r.regimes ? r.regimes.pursuitMobile?.speed ?? 1 : null), { unit: '×' }),
  // подвоз
  army('ammoShort', 'Нехватка боеприпасов: сила', 'подвоз', (r) => num(r.ammoShort), { unit: '×' }),
  army('fuelOut', 'Без горючего: сила техники', 'подвоз', (r) => num(r.fuelOut), { unit: '×' }),
  army('supplyFlow.fullHours', 'Полный подвоз до часов пути', 'подвоз', (r) => (r.supplyFlow ? r.supplyFlow.fullHours ?? 12 : null), { unit: 'ч пути' }),
  army('supplyFlow.fuelPer100km', 'Расход горючего на 100 км марша', 'подвоз', (r) => (r.supplyFlow ? r.supplyFlow.fuelPer100km ?? 1 : null), { unit: 'запр. на 100 км' }),
  // усталость
  army('fatigueEffect', 'Усталость: наибольшее ослабление', 'усталость', (r) => num(r.fatigueEffect), { unit: 'доля' }),
  army('fatigueGain.combat', 'Прирост усталости в бою', 'усталость', (r) => num(r.fatigueGain?.combat), { unit: 'доля/сут' }),
  army('fatigueGain.march', 'Прирост усталости на марше', 'усталость', (r) => num(r.fatigueGain?.march), { unit: 'доля/сут' }),
  army('fatigueGain.rest', 'Снижение усталости на отдыхе', 'усталость', (r) => num(r.fatigueGain?.rest), { unit: 'доля/сут' }),
  // окружение
  army('encircleHours', 'Окружение после разрыва подвоза', 'окружение', (r) => r.encircleHours ?? 36, { unit: 'ч' }),
  army('pocket.capitulateHours', 'Котёл держится до сдачи', 'окружение', (r) => r.pocket?.capitulateHours ?? 96, { unit: 'ч' }),
  army('pocket.ammoBelow', 'Котёл сдаётся при боеприпасах меньше', 'окружение', (r) => r.pocket?.ammoBelow ?? 0.25, { unit: 'бк' }),
  army('pocket.breakoutKeep', 'Прорвавшиеся выносят танков и орудий', 'окружение', (r) => clean((r.pocket?.breakoutKeep ?? 0.3) * 100), { unit: '%' }),
  army('stockDays.fortress', 'Запасы крепости', 'окружение', (_r, p) => num(de(p)?.unitTypes.fortress?.stockDays), { unit: 'сут' }),
  // профили (советская сторона — без приставки, как в нормативах; прочее — profiles.<сторона>.…)
  ...(['army', 'corps', 'division', 'brigade'] as const).map((e) =>
    army(`orderDelay.${e}`, `Задержка приказа: ${{ army: 'армия', corps: 'корпус', division: 'дивизия', brigade: 'бригада' }[e]}`, 'профили', (_r, p) => num(su(p)?.orderDelayHours[e]), { unit: 'ч' })),
  ...(['su', 'de'] as const).flatMap((s) => {
    const nm = s === 'su' ? 'Красная армия' : 'вермахт';
    return [
      army(`profiles.${s}.quality`, `Качество формирований (среднее), ${nm}`, 'профили', (_r, p) => meanQuality(side(p, s)), { unit: '×' }),
      army(`profiles.${s}.weights.tanks`, `Вес танка/САУ в потенциале, ${nm}`, 'профили', (_r, p) => num(side(p, s)?.weights.tanks), { unit: 'на 1000 чел.' }),
      army(`profiles.${s}.weights.guns`, `Вес орудия в потенциале, ${nm}`, 'профили', (_r, p) => num(side(p, s)?.weights.guns), { unit: 'на 1000 чел.' }),
      army(`profiles.${s}.supply.ammoPerDay`, `Подвоз боеприпасов, ${nm}`, 'профили', (_r, p) => num(side(p, s)?.supply?.ammoPerDay), { unit: 'бк/сут' }),
      army(`profiles.${s}.supply.fuelPerDay`, `Подвоз горючего, ${nm}`, 'профили', (_r, p) => num(side(p, s)?.supply?.fuelPerDay), { unit: 'запр./сут' }),
      army(`profiles.${s}.supply.rangeHours`, `Дальность подвоза, ${nm}`, 'профили', (_r, p) => num(side(p, s)?.supply?.rangeHours), { unit: 'ч пути' }),
    ];
  }),
  // агентная модель: параметры с источником и надёжностью
  agent('march.kmh.foot', 'Скорость марша пеших', 'км/ч'),
  agent('march.kmh.motor', 'Скорость марша автоколонн', 'км/ч'),
  agent('march.hoursPerDay.normal', 'Часов марша в сутки, обычный переход', 'ч'),
  agent('march.hoursPerDay.forced', 'Часов марша в сутки, форсированный переход', 'ч'),
  agent('march.enemyTerritoryKmDay.foot', 'Пешие по территории противника', 'км/сут'),
  agent('march.enemyTerritoryKmDay.motor', 'Моторизованные по территории противника', 'км/сут'),
  agent('march.enemyTerritoryKmDay.tracked', 'Гусеничные по территории противника', 'км/сут'),
  agent('combat.advance.hasty', 'Темп против поспешной обороны (при 3:1)', 'км/сут', true),
  agent('combat.advance.prepared', 'Темп против подготовленной обороны (при 3:1)', 'км/сут', true),
  agent('combat.advance.fortified', 'Темп против укреплённой полосы (при 3:1)', 'км/сут', true),
  agent('combat.penetrationKmDay', 'Темп в прорыве', 'км/сут'),
  agent('combat.armorFactor', 'Вес танков в боевой силе', '×'),
  agent('combat.attackerLossDay', 'Потери наступающего в сутки', 'доля/сут'),
  agent('combat.defenderLossDay', 'Потери обороняющегося в сутки', 'доля/сут'),
  agent('combat.attackerLossMaxDay', 'Наибольшие потери наступающего в сутки', 'доля/сут'),
  agent('combat.defenderLossPenetrationDay', 'Потери обороняющегося при прорыве', 'доля/сут'),
  agent('combat.urban.citadel', 'Темп в цитадели города', 'км/сут'),
  agent('combat.tankLossFactor', 'Потери танков к потерям людей', '×'),
  agent('combat.gunLossFactor', 'Потери орудий к потерям людей', '×'),
  agent('combat.attackFrontageKm.suRifle', 'Фронт атаки советской стрелковой дивизии', 'км'),
  agent('combat.attackFrontageKm.de', 'Фронт атаки немецкой дивизии', 'км'),
  agent('combat.defenseFrontageKm.su', 'Полоса обороны советской дивизии', 'км'),
  agent('combat.defenseFrontageKm.de', 'Полоса обороны немецкой дивизии', 'км'),
  agent('combat.breakpointLoss', 'Предел потерь (срыв атаки)', 'доля'),
  agent('combat.artillery.normDensityPerKm', 'Плотность артиллерии на прорыве', 'ствол/км'),
  agent('combat.artillery.normDurationMin', 'Длительность артподготовки', 'мин'),
  agent('combat.artillery.depthKm', 'Глубина огневого вала', 'км'),
  agent('doctrine.de.counterattackRatio', 'Немцы контратакуют при соотношении', 'доля'),
  agent('doctrine.de.withdrawStepKm', 'Шаг отхода немцев', 'км'),
  agent('doctrine.de.penetrationDepthKm', 'Глубина вклинения до ввода резервов', 'км'),
  agent('doctrine.su.firstEchelonShare', 'Доля первого эшелона', 'доля'),
  agent('doctrine.su.commitDepthKm', 'Глубина ввода второго эшелона', 'км'),
  agent('doctrine.su.tankCommitDepthKm', 'Глубина ввода танков', 'км'),
  agent('command.preparedHours.corps', 'Подготовленный приказ корпуса', 'ч'),
  agent('command.preparedHours.division', 'Подготовленный приказ дивизии', 'ч'),
  agent('command.su.divisionBandKm', 'Участок прорыва дивизии', 'км'),
  agent('pocket.breakoutKeep', 'Прорвавшиеся выносят техники', 'доля'),
  agent('pocket.breakoutKmDay', 'Темп прорыва из котла', 'км/сут'),
  agent('pocket.breakoutLossDay', 'Потери при прорыве из котла', 'доля/сут'),
];

const BY_PATH = new Map(RULE_INPUTS.map((x) => [x.path, x]));
export const ruleInput = (path: string): RuleInput | undefined => BY_PATH.get(path);

/**
 * Сторона входа: профиль советской стороны (марш, переправы, задержка приказа) — su, крепость и профиль вермахта — de;
 * иначе — по сегменту пути «.su» / «.de» (agents.doctrine.su.…, agents.combat.attackFrontageKm.de).
 */
export function inputSide(path: string): 'su' | 'de' | undefined {
  const seg = path.split('.');
  if (path.startsWith('profiles.su.') || seg.includes('su') || path.startsWith('orderDelay.') || ['foot.road', 'foot.open', 'bridgeHoursMajor', 'bridgeHoursMinor'].includes(path)) return 'su';
  if (path.startsWith('profiles.de.') || seg.includes('de') || path === 'stockDays.fortress') return 'de';
  return undefined;
}

/** Вход с его значением в наборе правил — то, что получает сборщик «база → правила» (RuleInputRef в packages/knowledge). */
export interface RuleInputValue { path: string; engine: RuleInput['engine']; value: number | null; calib?: CalibKey; side?: 'su' | 'de' }
/** Весь перечень входов со значениями набора правил, профилей и агентной модели. */
export function ruleInputRefs(rules: Rules, profiles: Record<string, SideProfile>, agents?: unknown): RuleInputValue[] {
  return RULE_INPUTS.map((i) => {
    const s = inputSide(i.path);
    return { path: i.path, engine: i.engine, value: i.read(rules, profiles, agents), ...(i.calib ? { calib: i.calib } : {}), ...(s ? { side: s } : {}) };
  });
}

/**
 * Коридор норматива: значение v → [v(1−t), v(1+t)], диапазон [a, b] → [a(1−t), b(1+t)], t — допуск надёжности.
 * Допущение (без надёжности) или факт без числа — null (остаются прежние границы).
 */
export function corridorOf(v: { value?: number; range?: [number, number] }, rel: 'A' | 'B' | 'C' | undefined): [number, number] | null {
  if (!rel || !(rel in TOLERANCE)) return null;
  const t = TOLERANCE[rel];
  const [a, b] = v.range ? [Math.min(...v.range), Math.max(...v.range)] : v.value != null ? [v.value, v.value] : [NaN, NaN];
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const lo = a >= 0 ? a * (1 - t) : a * (1 + t), hi = b >= 0 ? b * (1 + t) : b * (1 - t);
  return [clean(lo), clean(hi)];
}

/** Делитель для пересчёта через исходное значение: только положительный (иначе — без коридора). */
const ratio = (c: [number, number], base: number | null | undefined): [number, number] | null =>
  base != null && Number.isFinite(base) && base > 0 ? [clean(c[0] / base), clean(c[1] / base)] : null;

/**
 * Коридор норматива (в единицах входа) → коридор множителя калибровки key. Прямые множители (prepared, fortPerLevel,
 * urbanAdvance, terrFoot, terrMobile) — сам коридор; advance — коридор / наибольший темп исходной таблицы;
 * attackerLoss, defenderLoss — коридор / значение таблицы при 3:1; terrainExp — ln(коридор) / ln(исходная поправка)
 * местности path (по умолчанию — лес); fortAdvance — коридор / темп прогрызания уровня 1; movement — коридор / темп
 * марша профиля (path: foot.road или foot.open). Нулевой знаменатель, ln 1 = 0 или неположительный коридор у
 * показателя — null: вход остаётся в прежних границах.
 */
export function toMultiplier(key: CalibKey, corridor: [number, number], rules: Rules, profiles: Record<string, SideProfile>, path?: string): [number, number] | null {
  const c: [number, number] = [Math.min(...corridor), Math.max(...corridor)];
  if (!c.every(Number.isFinite)) return null;
  switch (key) {
    case 'prepared': case 'fortPerLevel': case 'urbanAdvance': case 'terrFoot': case 'terrMobile':
      return c;
    case 'advance':
      return ratio(c, rules.advance?.length ? interp(rules.advance, 10) : null);
    case 'attackerLoss': case 'defenderLoss': {
      const v = ruleInput(key)!.read(rules, profiles);
      return ratio(c, v);
    }
    case 'terrainExp': {
      const t = (path?.startsWith('defense.terrain.') ? path.slice('defense.terrain.'.length) : 'forest') as TerrainClass;
      const b = rules.defense?.terrain?.[t];
      if (b == null || !(b > 0) || Math.abs(Math.log(b)) < 1e-9 || !(c[0] > 0)) return null;
      const e = [Math.log(c[0]) / Math.log(b), Math.log(c[1]) / Math.log(b)].map(clean);
      return [Math.min(e[0], e[1]), Math.max(e[0], e[1])];
    }
    case 'fortAdvance':
      return ratio(c, rules.fortAdvanceKm?.[1]);
    case 'movement': {
      const p = su(profiles);
      return ratio(c, path === 'foot.open' ? p?.offRoad.foot.open : p?.road.foot);
    }
  }
}
