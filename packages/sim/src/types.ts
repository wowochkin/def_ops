/**
 * Модель переигровки. Всё конкретное — данные:
 *  - SideProfile — эпоха и сторона: типы формирований, темпы, снабжение, управление;
 *  - Rules — калибровка арбитра: таблицы боя, поправки, разброс (общие для сторон);
 *  - TheatreData — местность: проходимость, дороги, реки, мосты, районы, рубежи;
 *  - Scenario — стороны, состав на начало, исторические приказы, сроки.
 * Движок от операции и эпохи не зависит.
 */
import type { LngLat } from '@def-ops/core';

export type Mobility = 'foot' | 'motor' | 'tracked';
export type TerrainClass = 'open' | 'forest' | 'marsh' | 'urban' | 'hills' | 'water';
export const TERRAIN_CLASSES: TerrainClass[] = ['open', 'forest', 'marsh', 'urban', 'hills', 'water'];
export type Echelon = 'front' | 'army' | 'corps' | 'division' | 'brigade' | 'regiment';

/* ---------------------------------- профиль ---------------------------------- */

export interface UnitType {
  id: string;
  name: string;
  mobility: Mobility;
  /** Качество войск: выучка, слаженность, управление (1 — норма эпохи). */
  quality: number;
  /**
   * Ширина полосы обороны, км: обороняющийся связывает боем наступающих в
   * пределах половины этой ширины (а не только в радиусе соприкосновения).
   */
  frontageKm?: number;
  /** Узел обороны (крепость): подвижные соединения, чья цель дальше него, обходят его, а не штурмуют. */
  bypassable?: boolean;
}

export interface SideProfile {
  id: string;
  name: string;
  /** Вклад в боевой потенциал: на 1000 человек, на танк/САУ, на орудие/миномёт. */
  weights: { personnel: number; tanks: number; guns: number };
  unitTypes: Record<string, UnitType>;
  /** Темп марша вне дорог по местности, км/сутки; 0 — непроходимо. */
  offRoad: Record<Mobility, Record<TerrainClass, number>>;
  /** Темп марша по дороге, км/сутки. */
  road: Record<Mobility, number>;
  /** Расход в сутки по виду действий: боекомплектов и заправок. */
  consumption: Record<Posture, { ammo: number; fuel: number }>;
  /** Задержка доведения приказа до исполнения, часов, по ступени получателя. */
  orderDelayHours: Partial<Record<Echelon, number>>;
  /**
   * Подвоз: пополнение в сутки (боекомплектов, заправок) для формирований, до
   * которых подвоз от источников доходит по своей территории не дольше rangeHours;
   * запасы не выше maxAmmo / maxFuel.
   */
  supply?: { ammoPerDay: number; fuelPerDay: number; maxAmmo: number; maxFuel: number; rangeHours: number;
    /** Перенос базы снабжения: развёртывание на новом месте, часов, и темп переезда, км/сутки (по умолчанию 24 ч и 60 км/сут). */
    baseSetupHours?: number; baseMoveKmPerDay?: number };
  /** Инженерные войска: наводка переправы через большую и малую реку, часов; сколько переправ одновременно (понтонные парки). */
  engineering?: { bridgeHoursMajor: number; bridgeHoursMinor: number; parks: number };
}

/* ----------------------------- правила (калибровка) ----------------------------- */

/** Кусочно-линейная таблица: [аргумент, значение], аргумент возрастает. */
export type Table = [number, number][];

export interface Rules {
  id: string;
  /** Базовые правила, поверх которых пишутся поля этого файла (масштабный вариант). */
  extends?: string;
  /** Расстояние соприкосновения, км: ближе — бой. */
  contactKm: number;
  /** Темп продвижения наступающего, км/сутки, от соотношения сил. */
  advance: Table;
  /** Потери наступающего и обороняющегося, доля состава в сутки, от соотношения сил. */
  attackerLoss: Table;
  defenderLoss: Table;
  /** Поправки к силе обороняющегося. */
  defense: {
    /** За местность. */
    terrain: Partial<Record<TerrainClass, number>>;
    /** Подготовленная оборона: множитель после prepareHours в обороне на месте. */
    prepared: number;
    prepareHours: number;
    /** Укрепления района: множитель за каждый уровень. */
    fortificationPerLevel: number;
  };
  /** Боеприпасы < 0,5 боекомплекта — сила × этот множитель; горючего нет — подвижные части × fuelOut. */
  ammoShort: number;
  fuelOut: number;
  /** Усталость: сила × (1 − fatigue × fatigueEffect); прирост в бою и на марше, отдых — снижение (доля/сутки). */
  fatigueEffect: number;
  fatigueGain: { combat: number; march: number; rest: number };
  /** Разброс исхода боя: σ логнормального множителя к соотношению сил. */
  noise: number;
  /** Пересечение реки без моста: доп. часов на клетку для пеших; техника — только по мостам (если не bridgeless). */
  riverCrossHours: number;
  /**
   * Множитель темпа продвижения в бою по местности обороняющегося: город —
   * кварталами (сотни метров в сутки), лес и болото — медленнее открытой местности.
   */
  advanceTerrain?: Partial<Record<TerrainClass, number>>;
  /**
   * Преодоление укреплённой полосы противника вне боя (мины, рвы, заграждения):
   * часов на клетку за каждый уровень укреплённости, пока полоса не прорвана
   * (клетку не заняли войска стороны).
   */
  fortCrossHours?: number;
  /**
   * Предельный темп «прогрызания» укреплённой полосы, км/сутки, по уровню
   * укреплённости клеток обороняющихся (индекс — уровень 1..3): пока оборона
   * стоит в полосе, прорыва (выхода на оперативный простор) нет при любом перевесе.
   */
  fortAdvanceKm?: number[];
  /** Городской масштаб: части с приказом «держаться» (и окружённые) не отходят сами, но под натиском уступают кварталы с повышенными потерями. */
  holdGivesGround?: boolean;
  /** Обход крепостей подвижными соединениями (по умолчанию — да; в городском бою — нет: там гарнизоны и есть цель). */
  bypassStrongpoints?: boolean;
  /**
   * Территория как сплошная полоса: клетки переходят к стороне, только когда её войска проходят через них
   * (в радиусе radiusKm от пути и положения). По территории противника движение медленнее — заслоны,
   * разрушения, зачистка: к времени марша добавляется клетка / enemyKmPerDay[подвижность]. Подвоз — только
   * по своей территории. Нет поля — территория не ведётся (как раньше).
   */
  territory?: { radiusKm: number; enemyKmPerDay: Partial<Record<Mobility, number>>;
    /** Подвоз проходит и по чужой территории, где наши войска ближе этого (км) и ближе противника (по умолчанию — contactKm); 0 — только по своей. */
    supplyHoldKm?: number };
  /** Через сколько часов непрерывного разрыва подвоза формирование считается окружённым (по умолчанию 36). */
  encircleHours?: number;
  /**
   * Превышение в бою (нужна сетка высот театра): оборона выше наступающих на perM метров — сила × (1 + bonus),
   * ниже — × (1 − bonus); не больше ±max. Нет поля — не учитывается (класс «высоты» действует отдельно).
   */
  heightAdvantage?: { perM: number; bonus: number; max: number };
  /** Множитель темпов марша из профилей (калибровка: заторы, разрушенные дороги, беженцы). */
  movementScale?: number;
  /** Откуда взяты числа: калибровка — сценарий, мерило, дата. */
  calibration?: Record<string, unknown>;
}

/* ---------------------------------- театр ---------------------------------- */

/** Однобуквенные коды классов местности для растра. */
export const TERRAIN_CODES: Record<string, TerrainClass> = { o: 'open', f: 'forest', m: 'marsh', u: 'urban', h: 'hills', w: 'water' };

export interface TerrainGrid {
  /** [запад, юг, восток, север], градусы. */
  bbox: [number, number, number, number];
  cols: number;
  rows: number;
  /** RLE: число повторов (необязательно, по умолчанию 1) и код класса. */
  rle: string;
  /** Откуда растр и как получен. */
  source?: string;
}

export interface TheatreData {
  id: string;
  name: string;
  /** Ледостав: в эти даты большие реки преодолимы для всех родов войск (по льду и с наводкой), с задержкой riverCrossHours. */
  frozen?: { from: string; until: string; note?: string };
  /** [запад, юг, восток, север], градусы. */
  bbox: [number, number, number, number];
  /** Шаг сетки проходимости, км. */
  cellKm: number;
  defaultTerrain: TerrainClass;
  /**
   * Растр местности (например, из карты земного покрова): сетка в градусах,
   * строки с севера на юг, клетки — буквы TERRAIN_CODES, сжатые RLE («12o3f»).
   * Берётся по центру каждой клетки театра; контуры terrain ложатся поверх.
   */
  terrainGrid?: TerrainGrid;
  /**
   * Растр дорог (например, распознанных по исторической карте): та же схема,
   * что у terrainGrid, коды «n» — нет дороги, «r» — дорога, «h» — шоссе.
   * Дополняет линии roads.
   */
  roadGrid?: TerrainGrid;
  /**
   * Сетка высот (Copernicus DEM, средняя высота клетки): высота = base + значение × stepM, м; строки с севера на
   * юг; rle — «значение» или «значение*повторы» через запятую. Нет — превышение в бою не учитывается.
   */
  heightGrid?: { bbox: [number, number, number, number]; cols: number; rows: number; stepM: number; base: number; rle: string; source?: string };
  /** Контуры местности; позже в списке — поверх. */
  terrain: { class: TerrainClass; ring: LngLat[] }[];
  roads: { kind: 'highway' | 'road' | 'rail'; line: LngLat[]; name?: string }[];
  rivers: { name: string; line: LngLat[]; major: boolean }[];
  /** Мосты и переправы: openFrom — с какого момента действует (наведённая переправа), destroyedAt — с какого разрушен. */
  /** side — чья переправа (наведённая стороной): при передаче командования её будущие наводки снимаются. */
  bridges: { id: string; at: LngLat; name?: string; openFrom?: string | null; destroyedAt?: string | null; side?: string; kind?: string }[];
  /** Именованные районы (для приказов и учёта контроля). */
  areas: { id: string; name: string; ring: LngLat[] }[];
  /** Рубежи и позиции: линия и уровень укреплённости (1–3). */
  /** depthKm — глубина полосы (по умолчанию — одна клетка); side — чья полоса. */
  lines: { id: string; name: string; line: LngLat[]; fortification?: number; side?: string; depthKm?: number }[];
  /**
   * Препятствия на дорогах (из сведений об инфраструктуре: разрушена, завалена, заминирована): в радиусе от точки
   * дорога в эти сроки не даёт дорожного темпа — движение как вне дорог. kind rail — сведение (подвоз по железной
   * дороге не моделируется).
   */
  obstacles?: { id: string; at: LngLat; radiusKm: number; kind: 'road' | 'rail'; from?: string | null; until?: string | null; note?: string }[];
  /** Откуда взяты слои (лицензии, даты), для справки и отчёта. */
  sources?: string[];
}

/* --------------------------------- сценарий --------------------------------- */

export type Controller = 'human' | 'llm' | 'script';

export interface SideDef {
  id: string;
  name: string;
  profile: string;
  controller: Controller;
}

export interface FormationDef {
  id: string;
  name: string;
  side: string;
  echelon: Echelon;
  parent?: string | null;
  /** Тип из профиля стороны (для действующих формирований). */
  type?: string;
  position?: LngLat;
  personnel?: number;
  tanks?: number;
  guns?: number;
  /** Запасы на начало: боекомплектов и заправок. */
  ammo?: number;
  fuel?: number;
  posture?: Posture;
  /** С какого момента формирование на театре (ввод из резерва, прибытие); до этого его нет на карте. */
  enterAt?: string | null;
  /** Откуда цифры и положение (для отчёта и справки). */
  note?: string;
}

export interface Scenario {
  id: string;
  name: string;
  start: string;
  end: string;
  /** Длительность хода, часов. */
  turnHours: number;
  theatre: string;
  rules: string;
  sides: SideDef[];
  formations: FormationDef[];
  /** Приказы по сценарию (исторический план или заданные экспертом изменения). */
  orders: Order[];
  /** Источники снабжения сторон: точки или районы (станции, переправы, тыл). Нет — снабжение без подвоза.
   *  phases — склады, действующие с даты from (и до until, если узел потерян): добавляются к постоянным. */
  supply?: Record<string, { sources: (LngLat | string)[]; phases?: { from: string; until?: string; sources: (LngLat | string)[] }[] }>;
}

/* --------------------------------- состояние --------------------------------- */

export type Posture = 'attack' | 'defend' | 'march' | 'withdraw' | 'reserve';

export const TASKS = ['defend', 'hold', 'delay', 'withdraw', 'counterattack', 'attack', 'breakout', 'regroup', 'reserve', 'relieve'] as const;
export type Task = (typeof TASKS)[number];

export type Target = LngLat | string | { formation: string } | null;

export interface Order {
  id: string;
  formation: string;
  task: Task;
  /** Цель: точка, район (id из театра) или формирование противника ({ formation }). */
  target?: Target;
  /** С какого момента приказ отдан (исполнение — после задержки доведения). */
  issuedAt: string;
  /** Кто отдал: эксперт, модель, сценарий. */
  source: Controller;
  note?: string;
}

export interface Formation {
  id: string;
  name: string;
  side: string;
  echelon: Echelon;
  parent: string | null;
  type: string;
  position: LngLat;
  personnel: number;
  tanks: number;
  guns: number;
  /** Начальные значения — для укомплектованности. */
  initial: { personnel: number; tanks: number; guns: number };
  ammo: number;
  fuel: number;
  fatigue: number;
  posture: Posture;
  /** Часов в обороне на месте (для подготовленной обороны). */
  dugInHours: number;
  /** Действующий приказ (после задержки) и маршрут к цели. */
  order: Order | null;
  route: LngLat[] | null;
  /** Уничтожено или распалось. */
  destroyed: boolean;
  /** С какого момента на театре (null — с начала). */
  enterAt: string | null;
  /** Отрезано от снабжения (окружено). */
  cutOff?: boolean;
  /** Сколько часов подряд подвоз не доходит. */
  cutHours?: number;
  /** Резерв Ставки, ещё не введённый в сражение: с какого момента может быть введён (enterAt — когда введут). */
  reserveFrom?: string;
}

export interface CombatFactor {
  name: string;
  value: number;
}

export type JournalEntry =
  | { kind: 'order'; time: string; formation: string; order: Order; effective: boolean }
  | { kind: 'move'; time: string; formation: string; from: LngLat; to: LngLat; km: number }
  | { kind: 'combat'; time: string; attackers: string[]; defenders: string[]; at: LngLat; ratio: number; factors: CombatFactor[];
      noise: number; advanceKm: number; attackerLoss: number; defenderLoss: number; outcome: 'breakthrough' | 'advance' | 'held' | 'repelled' }
  | { kind: 'supply'; time: string; formation: string; what: 'ammo' | 'fuel'; left: number }
  | { kind: 'encircled'; time: string; formation: string; cut: boolean }
  | { kind: 'destroyed'; time: string; formation: string };

export interface SimState {
  scenario: string;
  time: string;
  turn: number;
  formations: Formation[];
  /** Приказы, ещё не дошедшие до исполнителя. */
  pending: Order[];
  rngState: number;
  journal: JournalEntry[];
  /** Клетки укреплённых полос, уже занятые противником их владельца (прорваны). */
  breached?: number[];
  /** Территория: индекс стороны (по scenario.sides), владеющей клеткой; −1 — ничья. Меняется, только когда через клетку проходят войска. */
  territory?: number[];
  /** Тыл стороны под управлением штаба (игра): базы снабжения и приоритет подвоза. Нет — источники из сценария. */
  logistics?: Record<string, Logistics>;
  /** Поправки посредника на ближайший ход (снимаются после хода). */
  umpire?: UmpireMod[];
}

/**
 * Поправка посредника (модель-посредник с опорой на базу знаний): нюанс, который арбитр сам не учитывает
 * (видимость, внезапность, взаимодействие родов войск, заграждения, качество войск…). Действует один ход на
 * бои, где участвует любое из формирований; множитель ограничен UMPIRE_LIMITS. Записывается в игру —
 * переигровка точна.
 */
export interface UmpireMod {
  formations: string[];
  factor: UmpireFactor;
  mult: number;
  reason: string;
  /** На что опирается: записи базы знаний (id) или «обстановка». */
  basis: string[];
}
export type UmpireFactor = 'attack' | 'defense' | 'pace' | 'attackerLoss' | 'defenderLoss';
export const UMPIRE_FACTORS: UmpireFactor[] = ['attack', 'defense', 'pace', 'attackerLoss', 'defenderLoss'];
export const UMPIRE_FACTOR_RU: Record<UmpireFactor, string> = { attack: 'сила наступающих', defense: 'сила обороны', pace: 'темп продвижения', attackerLoss: 'потери наступающих', defenderLoss: 'потери обороняющихся' };
/** Пределы множителя поправки: посредник уточняет, а не решает исход. */
export const UMPIRE_LIMITS: [number, number] = [0.8, 1.25];

/** База снабжения: activeFrom — с какого момента действует на новом месте (после переноса); null — действует. */
export interface SupplyBase { id: string; name: string; at: LngLat; activeFrom: string | null; moved?: boolean }
export interface Logistics { bases: SupplyBase[]; /** Объединения с приоритетом подвоза. */ priority: string[] }

/** Распоряжения штаба помимо приказов войскам: тыл, инженерные, резервы. */
export type StaffAction =
  | { kind: 'base'; side: string; base: string; to: LngLat; toName?: string; issuedAt: string }
  | { kind: 'priority'; side: string; formations: string[]; issuedAt: string }
  | { kind: 'bridge'; side: string; at: LngLat; issuedAt: string }
  /** Подорвать мост или переправу у точки (на своей территории): через 2 ч не действует. */
  | { kind: 'demolish'; side: string; at: LngLat; issuedAt: string }
  | { kind: 'commit'; side: string; formation: string; at: LngLat; atName?: string; issuedAt: string };
