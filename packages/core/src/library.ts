/**
 * Библиотека условных знаков: логические категории, описание каждого элемента,
 * варианты оформления по стилям, учёт принадлежности.
 *
 * Основа систематизации — разделы уставных «Условных обозначений, применяемых
 * в боевых документах» (положение и действия войск, пункты управления, огневые
 * средства, бронетехника, авиация, фортификационные сооружения, заграждения,
 * переправы, тыл) и практика военно-исторических карт (атласы, схемы операций).
 *
 * Цвета по уставу: свои войска — красный, противник — синий,
 * оборонительные сооружения, заграждения и топография — чёрный.
 */
import type { FeatureKind } from './model';

export type StyleId = 'ustav' | 'atlas' | 'inf' | 'tac';

export const STYLES: { id: StyleId; name: string; short: string; description: string }[] = [
  { id: 'ustav', name: 'Уставной', short: 'Устав', description: 'Знаки рабочей (штабной) карты по системе советских тактических условных обозначений: свои — красным, противник — синим, сооружения — чёрным.' },
  { id: 'atlas', name: 'Атлас', short: 'Атлас', description: 'Оформление карт исторических атласов: стрелки-клинья с градиентом, многоцветные линии фронта по датам, овалы объединений.' },
  { id: 'inf', name: 'Инфографика', short: 'Инфогр.', description: 'Современная схема-инфографика: крупные плоские стрелки, полоса наступающих, укрепления с зубцами.' },
  { id: 'tac', name: 'Тактическая схема', short: 'Тактика', description: 'Крупномасштабная схема боя: позиции полков по датам, объёмные стрелки атак, оборона противника в городе.' },
];

export interface LibraryCategory {
  id: string;
  name: string;
  description: string;
}

export const CATEGORIES: LibraryCategory[] = [
  { id: 'maneuver', name: 'Действия войск', description: 'Направления ударов, контратаки, отход, марш, десанты — всё, что показывается стрелками.' },
  { id: 'front', name: 'Линия фронта и положение войск', description: 'Линии фронта на даты, передний край, позиции частей и подразделений.' },
  { id: 'lines', name: 'Рубежи и разграничительные линии', description: 'Исходные рубежи, рубежи атаки и развёртывания, разграничительные линии фронтов, армий, корпусов, дивизий, полков.' },
  { id: 'areas', name: 'Районы и группировки', description: 'Районы сосредоточения и обороны, плацдармы, окружённые группировки, районы высадки десанта, занятая территория.' },
  { id: 'formations', name: 'Соединения и объединения', description: 'Условные знаки армий, корпусов, дивизий в резерве и во втором эшелоне, резервы противника.' },
  { id: 'command', name: 'Пункты управления и связь', description: 'Командные, наблюдательные и запасные пункты, штабы, узлы связи.' },
  { id: 'fires', name: 'Артиллерия и огневые средства', description: 'Орудия, миномёты, реактивная артиллерия, пулемёты, огневые позиции, участки заградительного и сосредоточенного огня.' },
  { id: 'armor', name: 'Танки и бронетехника', description: 'Танки, самоходные установки, бронеавтомобили, бронепоезда.' },
  { id: 'air', name: 'Авиация, ПВО и десант', description: 'Самолёты, аэродромы, удары авиации, воздушные десанты, зенитные средства.' },
  { id: 'navy', name: 'Флот', description: 'Корабли, катера, флотилии, базы, береговая артиллерия, морские десанты.' },
  { id: 'fortification', name: 'Фортификационные сооружения', description: 'Траншеи, ходы сообщения, окопы, ДОТ, ДЗОТ, блиндажи, укреплённые районы и города-крепости.' },
  { id: 'obstacles', name: 'Инженерные заграждения', description: 'Проволочные и минно-взрывные заграждения, надолбы, рвы, эскарпы, завалы, разрушения.' },
  { id: 'crossings', name: 'Переправы, дороги и пути', description: 'Мосты, переправы, броды, дороги, КПП, станции снабжения.' },
  { id: 'logistics', name: 'Тыл и обеспечение', description: 'Склады, обменные пункты, медицинские и ремонтные пункты.' },
  { id: 'special', name: 'Особые отметки', description: 'Знамя Победы, даты встречи войск, партизаны, районы заражения и затопления, пожары, дымовые завесы.' },
  { id: 'labels', name: 'Подписи', description: 'Обозначения частей и соединений, названия фронтов, географические подписи, даты.' },
  { id: 'terrain', name: 'Топографическая основа', description: 'Населённые пункты, реки, озёра, леса, болота, дороги, границы, отметки высот.' },
];

export interface LibraryElement {
  id: string;
  name: string;
  category: string;
  kind: FeatureKind;
  /** Что обозначает и как применяется. */
  description: string;
  /** Пресет оформления для каждого стиля, где элемент есть. */
  variants: Partial<Record<StyleId, string>>;
  /** Знак меняет цвет по принадлежности (свои / противник / нейтральное). */
  sideAware?: boolean;
  /** Начертание имело варианты в разные годы — нужна сверка с таблицей-первоисточником. */
  verify?: boolean;
  /** Синонимы для поиска. */
  keywords?: string[];
}

const E = (
  id: string, name: string, category: string, kind: FeatureKind, description: string,
  variants: Partial<Record<StyleId, string>>, o: Partial<Pick<LibraryElement, 'sideAware' | 'verify' | 'keywords'>> = {},
): LibraryElement => ({ id, name, category, kind, description, variants, ...o });

export const LIBRARY: LibraryElement[] = [
  /* ------------------------------ действия войск ------------------------------ */
  E('attack.main', 'Направление главного удара', 'maneuver', 'arrow',
    'Основное направление наступления объединения/соединения. Толщина стрелки показывает силу удара; хвост может крепиться к линии фронта (исходному положению).',
    { ustav: 'ustav.attackMain', inf: 'inf.attack', atlas: 'atlas.p2', tac: 'tac.attack' }, { sideAware: true, keywords: ['наступление', 'удар', 'стрелка'] }),
  E('attack.aux', 'Направление вспомогательного удара', 'maneuver', 'arrow',
    'Удар на второстепенном направлении, сковывающий противника. Изображается более узкой стрелкой.',
    { ustav: 'ustav.attack', atlas: 'atlas.thin', tac: 'tac.thin' }, { sideAware: true }),
  E('attack.fade', 'Удар (развитие наступления)', 'maneuver', 'arrow',
    'Стрелка с растворяющимся хвостом — развитие наступления в глубину без привязки к исходному положению (стиль инфографики).',
    { inf: 'inf.attackFade' }),
  E('attack.stage1', 'Удар — 1-й этап операции', 'maneuver', 'arrow',
    'Стрелка-клин атласа для первого этапа (в образце — удары 16–19 апреля): жёлто-красная, с открытым хвостом-вырезом.', { atlas: 'atlas.p1' }),
  E('attack.stage2', 'Удар — 2-й этап операции', 'maneuver', 'arrow',
    'Стрелка-клин второго этапа (20–25 апреля): розово-красная.', { atlas: 'atlas.p2' }),
  E('attack.stage3', 'Удар — 3-й этап операции', 'maneuver', 'arrow',
    'Стрелка-клин завершающего этапа (26 апреля — 8 мая): бледная, с красным контуром.', { atlas: 'atlas.p3' }),
  E('attack.front2', 'Удар соседнего фронта', 'maneuver', 'arrow',
    'Стрелка-клин другого цвета для различения фронтов на одной карте (в образце — 2-й Белорусский фронт, малиновая).', { atlas: 'atlas.magenta' }),
  E('attack.tank', 'Удар танковых соединений', 'maneuver', 'arrow',
    'Направление действий танковой армии/корпуса. Ромб — уставной знак танков; в атласе — тонкая стрелка с ромбом и полосой.',
    { ustav: 'ustav.tankThrust', inf: 'inf.tank', atlas: 'atlas.tank' }, { sideAware: true, keywords: ['танковая армия', 'танковый корпус', 'ромб'] }),
  E('attack.counter', 'Контратака / контрудар', 'maneuver', 'arrow',
    'Ответный удар обороняющихся. В уставном оформлении — стрелка с прерывистым контуром; на исторических картах — контрудары противника синим.',
    { ustav: 'ustav.counterattack', inf: 'inf.counter', atlas: 'atlas.german' }, { sideAware: true, verify: true }),
  E('retreat', 'Отход', 'maneuver', 'arrow',
    'Направление отхода (отступления) войск — прерывистая линия со стрелкой.',
    { ustav: 'ustav.retreat', inf: 'inf.retreat' }, { sideAware: true, keywords: ['отступление'] }),
  E('pursuit', 'Преследование', 'maneuver', 'arrow', 'Направление преследования отходящего противника (стрелка с дополнительными «шевронами» скорости).',
    { ustav: 'ustav.pursuit' }, { sideAware: true, verify: true }),
  E('march', 'Марш (маршрут движения)', 'maneuver', 'arrow', 'Маршрут выдвижения колонн, перегруппировки войск.',
    { ustav: 'ustav.march' }, { sideAware: true, keywords: ['маршрут', 'перегруппировка'] }),
  E('allied', 'Удар войск союзников', 'maneuver', 'arrow', 'Направления ударов войск союзников по антигитлеровской коалиции (коричневые клинья атласа).', { atlas: 'atlas.allied' }),
  E('polish', 'Удар Войска Польского', 'maneuver', 'arrow', 'Направления ударов 1-й и 2-й армий Войска Польского (фиолетовые клинья атласа).', { atlas: 'atlas.polish' }),
  E('airStrike', 'Удар авиации', 'maneuver', 'arrow', 'Направление удара авиации по объекту; на оси — силуэт самолёта.', { ustav: 'ustav.airStrike' }, { sideAware: true }),
  E('seaLanding', 'Высадка морского десанта', 'maneuver', 'arrow', 'Направление высадки морского десанта; на оси — якорь.', { ustav: 'ustav.seaLanding' }, { sideAware: true }),
  E('airLanding', 'Выброска воздушного десанта', 'maneuver', 'arrow', 'Маршрут доставки и выброски воздушного десанта; на оси — парашют.', { ustav: 'ustav.airLanding' }, { sideAware: true }),
  E('fireDirection', 'Направление огня', 'maneuver', 'arrow', 'Направление стрельбы огневого средства, границы сектора обстрела.', { ustav: 'ustav.fireDirection' }, { sideAware: true }),

  /* ----------------------- линия фронта и положение войск ----------------------- */
  E('front.line', 'Передний край (линия соприкосновения)', 'front', 'line', 'Линия переднего края своих войск или противника на определённое время.',
    { ustav: 'ustav.frontLine', inf: 'inf.frontEdge' }, { sideAware: true }),
  E('front.d1', 'Линия фронта на дату — исходная', 'front', 'line', 'Многоцветная линия фронта атласа (оранжевая полоса, красная и синяя линии с зубцами) — исходное положение перед операцией.', { atlas: 'atlas.front15' }),
  E('front.d2', 'Линия фронта на дату — этап 1', 'front', 'line', 'Положение сторон к исходу первого этапа: красный пунктир и синяя линия.', { atlas: 'atlas.front19' }),
  E('front.d3', 'Линия фронта на дату — этап 2', 'front', 'line', 'Положение к исходу второго этапа: розовая полоса с пунктиром, красная и синяя линии.', { atlas: 'atlas.front25' }),
  E('front.d4', 'Линия фронта на дату — этап 3', 'front', 'line', 'Положение на вспомогательном направлении к исходу последнего этапа.', { atlas: 'atlas.frontDresden' }),
  E('front.meet', 'Рубеж встречи с союзниками', 'front', 'line', 'Рубеж выхода советских войск и войск союзников к концу операции.', { atlas: 'atlas.meetLine' }),
  E('pos.d1', 'Положение части — дата 1 (сплошная)', 'front', 'line', 'Позиция полка/батальона на первую дату: сплошная дуга с засечками на флангах.', { tac: 'tac.pos28' }),
  E('pos.d2', 'Положение части — дата 2 (двойная)', 'front', 'line', 'Позиция на вторую дату — двойная линия.', { tac: 'tac.pos29' }),
  E('pos.d3', 'Положение части — дата 3 (штрих)', 'front', 'line', 'Позиция на третью дату — двойная линия с пунктиром.', { tac: 'tac.pos30m' }),
  E('pos.d4', 'Положение части — дата 4 (точки)', 'front', 'line', 'Позиция на четвёртую дату — линия с точками.', { tac: 'tac.pos30e' }),
  E('pos.d5', 'Положение части — дата 5 (штрихпунктир)', 'front', 'line', 'Позиция на пятую дату — штрихпунктир.', { tac: 'tac.pos2may' }),

  /* ---------------------- рубежи и разграничительные линии ---------------------- */
  E('line.start', 'Исходный рубеж для наступления', 'lines', 'line', 'Рубеж, с которого подразделения начинают наступление (ИР).', { ustav: 'ustav.startLine' }, { sideAware: true, verify: true }),
  E('line.attack', 'Рубеж атаки', 'lines', 'line', 'Рубеж перехода в атаку (РА) — развёртывание в боевой порядок для атаки.', { ustav: 'ustav.attackLine' }, { sideAware: true, verify: true }),
  E('line.deploy', 'Рубеж развёртывания', 'lines', 'line', 'Рубеж развёртывания колонн в предбоевой (боевой) порядок.', { ustav: 'ustav.deployLine' }, { sideAware: true, verify: true }),
  E('line.control', 'Рубеж регулирования', 'lines', 'line', 'Рубеж, по достижении которого старший начальник уточняет задачи.', { ustav: 'ustav.controlLine' }, { sideAware: true, verify: true }),
  E('line.defense', 'Оборонительный рубеж (позиция)', 'lines', 'line', 'Рубеж обороны; зубцы обращены в сторону противника.',
    { ustav: 'ustav.defenseLine', atlas: 'atlas.defense', inf: 'inf.fortification', tac: 'tac.enemyDefense' }, { sideAware: true, keywords: ['оборона', 'полоса обороны'] }),
  E('line.defense2', 'Оборонительная полоса (двойная)', 'lines', 'line', 'Полоса обороны из двух позиций (атлас).', { atlas: 'atlas.defenseDouble' }),
  E('boundary.front', 'Разграничительная линия фронтов', 'lines', 'line', 'Граница полос фронтов; у линии подписываются наименования соседей.', { ustav: 'ustav.boundaryFront' }, { sideAware: true, verify: true }),
  E('boundary.army', 'Разграничительная линия армий', 'lines', 'line', 'Граница полос армий.', { ustav: 'ustav.boundaryArmy' }, { sideAware: true, verify: true }),
  E('boundary.corps', 'Разграничительная линия корпусов', 'lines', 'line', 'Граница полос корпусов.', { ustav: 'ustav.boundaryCorps' }, { sideAware: true, verify: true }),
  E('boundary.division', 'Разграничительная линия дивизий', 'lines', 'line', 'Граница полос дивизий (бригад).', { ustav: 'ustav.boundaryDivision' }, { sideAware: true, verify: true }),
  E('boundary.regiment', 'Разграничительная линия полков', 'lines', 'line', 'Граница полос полков.', { ustav: 'ustav.boundaryRegiment' }, { sideAware: true, verify: true }),
  E('boundary.battalion', 'Разграничительная линия батальонов', 'lines', 'line', 'Граница полос батальонов.', { ustav: 'ustav.boundaryBattalion' }, { sideAware: true, verify: true }),

  /* ---------------------------- районы и группировки ---------------------------- */
  E('area.zone', 'Занятая территория (исходное положение)', 'areas', 'area', 'Полоса/территория, занимаемая войсками; к её кромке крепятся хвосты стрелок.', { inf: 'inf.frontZone' }),
  E('area.concentration', 'Район сосредоточения', 'areas', 'area', 'Район, где сосредоточены войска перед вводом в бой (резервы, второй эшелон).', { ustav: 'ustav.concentration' }, { sideAware: true }),
  E('area.defense', 'Район обороны (опорный пункт)', 'areas', 'area', 'Район обороны подразделения; зубцы обращены к противнику.', { ustav: 'ustav.defenseArea' }, { sideAware: true }),
  E('area.bridgehead', 'Плацдарм', 'areas', 'area', 'Захваченный участок на берегу водной преграды или в обороне противника.', { ustav: 'ustav.bridgehead' }, { sideAware: true }),
  E('area.encircled', 'Окружённая группировка', 'areas', 'area', 'Группировка войск, окружённая противником («котёл»).',
    { ustav: 'ustav.encircled', inf: 'inf.encircled', atlas: 'atlas.encircled' }, { sideAware: true, keywords: ['котёл', 'окружение'] }),
  E('area.destroyed', 'Окружённая и уничтоженная группировка', 'areas', 'area', 'Окружённая группировка, перечёркнутая крестом, — ликвидирована.', { inf: 'inf.destroyed' }),
  E('area.landing', 'Район высадки (выброски) десанта', 'areas', 'area', 'Район приземления воздушного или высадки морского десанта.', { ustav: 'ustav.landingZone' }, { sideAware: true }),
  E('area.strongpoint', 'Опорный пункт противника в городе', 'areas', 'area', 'Укреплённое здание/квартал, обороняемый противником.', { tac: 'tac.enemyStrongpoint' }),

  /* --------------------------- соединения и объединения --------------------------- */
  E('unit.tankArmy', 'Танковая армия', 'formations', 'symbol', 'Овал с ромбом — танковая армия во втором эшелоне/в резерве; номер подписывается рядом.', { atlas: 'atlas.tankArmy', ustav: 'ustav.mechCorps' }, { sideAware: true }),
  E('unit.mechCorps', 'Механизированный (танковый) корпус', 'formations', 'symbol', 'Овал с ромбом меньшего размера — танковый или механизированный корпус.', { ustav: 'ustav.mechCorps' }, { sideAware: true }),
  E('unit.cavalry', 'Кавалерийский корпус', 'formations', 'symbol', 'Овал с частичной штриховкой — кавалерийский корпус.', { atlas: 'atlas.cavalry' }),
  E('unit.army', 'Армия (соединение) во втором эшелоне', 'formations', 'symbol', 'Овал — общевойсковая армия или соединение в резерве/втором эшелоне.', { atlas: 'atlas.army', ustav: 'ustav.unitOval' }, { sideAware: true }),
  E('unit.reserve', 'Резерв противника («Р»)', 'formations', 'symbol', 'Синий овал с буквой «Р» — оперативный резерв противника.', { atlas: 'atlas.reserve' }),

  /* --------------------------- пункты управления и связь --------------------------- */
  E('cp', 'Командный пункт (КП)', 'command', 'symbol', 'Флажок на древке; точка стояния — основание древка. Принадлежность и номер — подписью.', { ustav: 'ustav.cp' }, { sideAware: true }),
  E('hq', 'Штаб', 'command', 'symbol', 'Залитый флажок с номером соединения.', { ustav: 'ustav.hq' }, { sideAware: true, verify: true }),
  E('cp.reserve', 'Запасной командный пункт (ЗКП)', 'command', 'symbol', 'Флажок с обозначением ЗКП.', { ustav: 'ustav.reserveCp' }, { sideAware: true }),
  E('cop', 'Командно-наблюдательный пункт (КНП)', 'command', 'symbol', 'Флажок с треугольником у основания древка.', { ustav: 'ustav.cop' }, { sideAware: true, verify: true }),
  E('op', 'Наблюдательный пункт (НП)', 'command', 'symbol', 'Треугольник; внутри — буква вида: А — артиллерийский, И — инженерный, Х — химический, В — воздушного наблюдения.', { ustav: 'ustav.op' }, { sideAware: true }),
  E('op.art', 'Наблюдательный пункт артиллерийский', 'command', 'symbol', 'Треугольник с буквой «А».', { ustav: 'ustav.opArt' }, { sideAware: true }),
  E('commsNode', 'Узел связи', 'command', 'symbol', 'Узел связи пункта управления.', { ustav: 'ustav.commsNode' }, { sideAware: true, verify: true }),
  E('radio', 'Радиостанция', 'command', 'symbol', 'Радиостанция (радиоузел).', { ustav: 'ustav.radio' }, { sideAware: true, verify: true }),

  /* ------------------------ артиллерия и огневые средства ------------------------ */
  E('gun', 'Орудие (пушка)', 'fires', 'symbol', 'Полевое орудие на огневой позиции; ствол обращён в сторону стрельбы.', { ustav: 'ustav.gun' }, { sideAware: true, verify: true }),
  E('howitzer', 'Гаубица', 'fires', 'symbol', 'Гаубица (навесная стрельба).', { ustav: 'ustav.howitzer' }, { sideAware: true, verify: true }),
  E('atGun', 'Противотанковое орудие', 'fires', 'symbol', 'Противотанковая пушка; калибр подписывается рядом.', { ustav: 'ustav.atGun' }, { sideAware: true, verify: true, keywords: ['ПТО'] }),
  E('mortar', 'Миномёт', 'fires', 'symbol', 'Миномёт на огневой позиции.', { ustav: 'ustav.mortar' }, { sideAware: true, verify: true }),
  E('rocket', 'Реактивная установка (гвардейский миномёт)', 'fires', 'symbol', 'Боевая машина реактивной артиллерии («катюша»).', { ustav: 'ustav.rocket' }, { sideAware: true, verify: true, keywords: ['катюша', 'РС'] }),
  E('aaGun', 'Зенитное орудие', 'fires', 'symbol', 'Зенитная пушка/пулемёт ПВО.', { ustav: 'ustav.aaGun' }, { sideAware: true, verify: true }),
  E('hmg', 'Станковый пулемёт', 'fires', 'symbol', 'Станковый пулемёт на позиции.', { ustav: 'ustav.hmg' }, { sideAware: true, verify: true }),
  E('lmg', 'Ручной пулемёт', 'fires', 'symbol', 'Ручной пулемёт.', { ustav: 'ustav.lmg' }, { sideAware: true, verify: true }),
  E('battery', 'Огневая позиция батареи', 'fires', 'symbol', 'Огневая позиция артиллерийской (миномётной) батареи; калибр и номер — подписью.', { ustav: 'ustav.battery' }, { sideAware: true, verify: true }),
  E('firePoint', 'Огневая точка противника', 'fires', 'symbol', 'Выявленная огневая точка (флажок-вымпел).', { tac: 'tac.pennant' }),
  E('nzo', 'Неподвижный заградительный огонь (НЗО)', 'fires', 'area', 'Участок НЗО перед передним краем; номер участка подписывается.', { ustav: 'ustav.nzo' }, { sideAware: true, verify: true }),
  E('fireConc', 'Сосредоточенный огонь', 'fires', 'area', 'Участок сосредоточенного огня артиллерии.', { ustav: 'ustav.fireConcentration' }, { sideAware: true, verify: true }),
  E('fireBarrage', 'Огневой вал / подвижный заградительный огонь', 'fires', 'line', 'Рубежи огневого вала при поддержке атаки или подвижного заградительного огня.', { ustav: 'ustav.fireBarrage' }, { sideAware: true, verify: true }),

  /* ------------------------------ танки и бронетехника ------------------------------ */
  E('tank', 'Танк', 'armor', 'symbol', 'Ромб — уставной знак танка (танковой части).', { ustav: 'ustav.tank' }, { sideAware: true }),
  E('tankDug', 'Танк в окопе', 'armor', 'symbol', 'Танк, вкопанный в землю (засада, огневая точка в обороне).', { ustav: 'ustav.tankDug' }, { sideAware: true }),
  E('spg', 'Самоходная установка (САУ)', 'armor', 'symbol', 'Самоходная артиллерийская установка.', { ustav: 'ustav.spg' }, { sideAware: true, verify: true }),
  E('armoredCar', 'Бронеавтомобиль', 'armor', 'symbol', 'Бронеавтомобиль (бронемашина).', { ustav: 'ustav.armoredCar' }, { sideAware: true, verify: true }),
  E('armoredTrain', 'Бронепоезд', 'armor', 'symbol', 'Бронепоезд на железной дороге.', { ustav: 'ustav.armoredTrain' }, { sideAware: true, verify: true }),

  /* ------------------------------ авиация, ПВО, десант ------------------------------ */
  E('aviation', 'Авиация (воздушная армия)', 'air', 'symbol', 'Силуэт самолёта; группы самолётов — воздушная армия, рядом номер (16 ВА).', { atlas: 'atlas.aviation', ustav: 'ustav.plane' }, { sideAware: true }),
  E('bomber', 'Бомбардировщик', 'air', 'symbol', 'Бомбардировочная авиация.', { ustav: 'ustav.bomber' }, { sideAware: true }),
  E('airfield', 'Аэродром', 'air', 'symbol', 'Аэродром базирования авиации.', { ustav: 'ustav.airfield' }, { sideAware: true }),
  E('landingStrip', 'Посадочная площадка', 'air', 'symbol', 'Полевая посадочная площадка.', { ustav: 'ustav.landingStrip' }, { sideAware: true, verify: true }),
  E('parachute', 'Воздушный десант', 'air', 'symbol', 'Парашют — воздушно-десантные войска, место выброски.', { ustav: 'ustav.parachute' }, { sideAware: true }),
  E('searchlight', 'Зенитный прожектор', 'air', 'symbol', 'Прожекторная станция ПВО.', { ustav: 'ustav.searchlight' }, { sideAware: true, verify: true }),
  E('balloon', 'Аэростат заграждения', 'air', 'symbol', 'Аэростат воздушного заграждения ПВО.', { ustav: 'ustav.balloon' }, { sideAware: true, verify: true }),

  /* ------------------------------------- флот ------------------------------------- */
  E('ship', 'Боевой корабль', 'navy', 'symbol', 'Корабль (отряд кораблей).', { ustav: 'ustav.ship' }, { sideAware: true }),
  E('boat', 'Катер (бронекатер)', 'navy', 'symbol', 'Катер, бронекатер речной флотилии.', { ustav: 'ustav.boat' }, { sideAware: true }),
  E('flotilla', 'Действия речной флотилии', 'navy', 'arrow', 'Маршрут/действия военной флотилии (в образце — Днепровской).', { atlas: 'atlas.flotilla' }),
  E('navalBase', 'Военно-морская база', 'navy', 'symbol', 'Якорь — база флота, якорная стоянка.', { ustav: 'ustav.navalBase' }, { sideAware: true }),
  E('coastBattery', 'Береговая батарея', 'navy', 'symbol', 'Береговая артиллерийская батарея.', { ustav: 'ustav.coastBattery' }, { sideAware: true, verify: true }),

  /* ---------------------------- фортификационные сооружения ---------------------------- */
  E('trench', 'Траншея', 'fortification', 'line', 'Траншея (окоп полного профиля), проведённая по переднему краю позиции.', { ustav: 'ustav.trench' }, { sideAware: true, verify: true }),
  E('commTrench', 'Ход сообщения', 'fortification', 'line', 'Ход сообщения между траншеями и в тыл.', { ustav: 'ustav.commTrench' }, { sideAware: true, verify: true }),
  E('trenchSquad', 'Окоп (стрелковая ячейка)', 'fortification', 'symbol', 'Окоп отделения, стрелковая ячейка; обращён к противнику.', { ustav: 'ustav.trenchSquad' }, { sideAware: true, verify: true }),
  E('pillbox', 'ДОТ', 'fortification', 'symbol', 'Долговременная огневая точка (железобетон).', { ustav: 'ustav.pillbox' }, { sideAware: true, verify: true }),
  E('dzot', 'ДЗОТ', 'fortification', 'symbol', 'Дерево-земляная огневая точка.', { ustav: 'ustav.dzot' }, { sideAware: true, verify: true }),
  E('dugout', 'Блиндаж', 'fortification', 'symbol', 'Блиндаж (укрытие с перекрытием).', { ustav: 'ustav.dugout' }, { sideAware: true, verify: true }),
  E('shelter', 'Щель, убежище', 'fortification', 'symbol', 'Открытая/перекрытая щель, убежище.', { ustav: 'ustav.shelter' }, { sideAware: true, verify: true }),
  E('fortRegion', 'Укреплённый район (УР)', 'fortification', 'line', 'Передний край укреплённого района.', { ustav: 'ustav.fortifiedRegion' }, { sideAware: true, verify: true }),
  E('fortCity', 'Город-крепость (узел обороны)', 'fortification', 'symbol', 'Город, превращённый в узел обороны (шестерня атласа).', { atlas: 'atlas.fortCity' }),

  /* ------------------------------ инженерные заграждения ------------------------------ */
  E('wire', 'Проволочное заграждение на кольях', 'obstacles', 'line', 'Проволочный забор/сеть на кольях; количество рядов — подписью или многорядным знаком.', { ustav: 'ustav.wire' }, { sideAware: true }),
  E('wireMulti', 'Проволочное заграждение многорядное', 'obstacles', 'line', 'Несколько рядов проволочного заграждения.', { ustav: 'ustav.wireMulti' }, { sideAware: true }),
  E('wireElectric', 'Электризуемое заграждение', 'obstacles', 'line', 'Проволочное заграждение под током (знак молнии).', { ustav: 'ustav.wireElectric' }, { sideAware: true }),
  E('wireLow', 'Малозаметное заграждение', 'obstacles', 'line', 'Спираль, сеть на низких кольях, проволока внаброс.', { ustav: 'ustav.wireLow' }, { sideAware: true, verify: true }),
  E('minesAT.line', 'Минное поле ПТ (полоса)', 'obstacles', 'line', 'Противотанковое минное поле вдоль рубежа (кружки).', { ustav: 'ustav.minesAT' }, { sideAware: true }),
  E('minesAP.line', 'Минное поле ПП (полоса)', 'obstacles', 'line', 'Противопехотное минное поле вдоль рубежа (точки).', { ustav: 'ustav.minesAP' }, { sideAware: true }),
  E('minesAT.area', 'Минное поле противотанковое (площадное)', 'obstacles', 'area', 'Противотанковое минное поле в границах района.', { ustav: 'ustav.minefieldAT' }, { sideAware: true }),
  E('minesAP.area', 'Минное поле противопехотное (площадное)', 'obstacles', 'area', 'Противопехотное минное поле в границах района.', { ustav: 'ustav.minefieldAP' }, { sideAware: true }),
  E('mineAT', 'Противотанковая мина', 'obstacles', 'symbol', 'Одиночная противотанковая мина.', { ustav: 'ustav.mineAT' }, { sideAware: true }),
  E('mineAP', 'Противопехотная мина', 'obstacles', 'symbol', 'Одиночная противопехотная мина.', { ustav: 'ustav.mineAP' }, { sideAware: true }),
  E('fougasse', 'Фугас', 'obstacles', 'symbol', 'Управляемый/неуправляемый фугас.', { ustav: 'ustav.fougasse' }, { sideAware: true, verify: true }),
  E('dragonTeeth', 'Надолбы', 'obstacles', 'line', 'Противотанковые надолбы (металлические, железобетонные, деревянные); вид и число рядов — подписью.', { ustav: 'ustav.dragonTeeth' }, { sideAware: true }),
  E('dragonTooth', 'Надолба одиночная', 'obstacles', 'symbol', 'Отдельная надолба.', { ustav: 'ustav.dragonTooth' }, { sideAware: true }),
  E('atDitch', 'Противотанковый ров', 'obstacles', 'line', 'Противотанковый ров; длина — подписью.', { ustav: 'ustav.atDitch', tac: 'tac.ditch' }, { sideAware: true, verify: true }),
  E('escarp', 'Эскарп / контрэскарп', 'obstacles', 'line', 'Искусственный крутой откос — противотанковое препятствие.', { ustav: 'ustav.escarp' }, { sideAware: true, verify: true }),
  E('abatis', 'Завал', 'obstacles', 'line', 'Лесной завал из поваленных деревьев.', { ustav: 'ustav.abatis' }, { sideAware: true, verify: true }),
  E('demolition', 'Разрушение (подрыв)', 'obstacles', 'symbol', 'Подготовленное или произведённое разрушение объекта (моста, дороги).', { ustav: 'ustav.demolition' }, { sideAware: true }),

  /* ---------------------------- переправы, дороги и пути ---------------------------- */
  E('bridge', 'Мост', 'crossings', 'symbol', 'Мост; поверните знак вдоль дороги. Материал и грузоподъёмность — подписью.', { ustav: 'ustav.bridge' }, { sideAware: true }),
  E('bridgeDestroyed', 'Мост разрушен', 'crossings', 'symbol', 'Взорванный (разрушенный) мост.', { ustav: 'ustav.bridgeDestroyed' }, { sideAware: true }),
  E('pontoon', 'Понтонный (наплавной) мост', 'crossings', 'symbol', 'Наплавной мост из понтонного парка.', { ustav: 'ustav.pontoon' }, { sideAware: true, verify: true }),
  E('ferry', 'Паромная переправа', 'crossings', 'symbol', 'Паромная переправа; число паромов и грузоподъёмность — подписью.', { ustav: 'ustav.ferry' }, { sideAware: true }),
  E('ford', 'Брод', 'crossings', 'symbol', 'Брод (с характеристикой: глубина, грунт дна).', { ustav: 'ustav.ford' }, { sideAware: true }),
  E('iceRoad', 'Ледовая дорога (переправа)', 'crossings', 'line', 'Дорога/переправа по льду.', { ustav: 'ustav.iceRoad' }),
  E('kpp', 'Контрольно-пропускной пункт', 'crossings', 'symbol', 'КПП на маршруте.', { ustav: 'ustav.kpp' }, { sideAware: true, verify: true }),
  E('railStation', 'Станция снабжения (выгрузки)', 'crossings', 'symbol', 'Железнодорожная станция снабжения или выгрузки войск.', { ustav: 'ustav.railStation' }, { sideAware: true, verify: true }),

  /* ------------------------------- тыл и обеспечение ------------------------------- */
  E('depot.ammo', 'Склад боеприпасов', 'logistics', 'symbol', 'Склад с буквой вида: Б — боеприпасы.', { ustav: 'ustav.depotAmmo' }, { sideAware: true, verify: true }),
  E('depot.fuel', 'Склад горючего', 'logistics', 'symbol', 'Склад горюче-смазочных материалов (ГСМ).', { ustav: 'ustav.depotFuel' }, { sideAware: true, verify: true }),
  E('depot.food', 'Склад продовольствия', 'logistics', 'symbol', 'Продовольственный склад.', { ustav: 'ustav.depotFood' }, { sideAware: true, verify: true }),
  E('dop', 'Обменный пункт (ДОП)', 'logistics', 'symbol', 'Дивизионный обменный пункт боеприпасов.', { ustav: 'ustav.dop' }, { sideAware: true, verify: true }),
  E('medical', 'Медицинский пункт', 'logistics', 'symbol', 'Медпункт полка (МПП) или батальона (МПБ); вид — подписью.', { ustav: 'ustav.medical' }, { sideAware: true }),
  E('hospital', 'Госпиталь, медсанбат', 'logistics', 'symbol', 'Медико-санитарный батальон, полевой госпиталь.', { ustav: 'ustav.hospital' }, { sideAware: true }),
  E('repair', 'Ремонтный пункт, СПАМ', 'logistics', 'symbol', 'Пункт технической помощи, сборный пункт аварийных машин.', { ustav: 'ustav.repair' }, { sideAware: true, verify: true }),

  /* ---------------------------------- особые отметки ---------------------------------- */
  E('victoryFlag', 'Знамя Победы', 'special', 'symbol', 'Знамя, водружённое над Рейхстагом (особая отметка схем штурма).', { tac: 'tac.victoryFlag' }),
  E('meeting', 'Дата встречи войск', 'special', 'symbol', 'Встречные стрелки и дата встречи советских войск с войсками союзников.', { atlas: 'atlas.meeting' }),
  E('dateBox', 'Дата события в рамке', 'special', 'symbol', 'Дата исторического события в рамке (подписание Акта о капитуляции).', { atlas: 'atlas.dateBox' }),
  E('partisans', 'Партизанский отряд', 'special', 'symbol', 'Партизанский отряд или бригада; номер/название — подписью.', { ustav: 'ustav.partisans' }),
  E('partisanArea', 'Партизанский район', 'special', 'area', 'Территория, контролируемая партизанами (партизанский край).', { ustav: 'ustav.partisanArea' }),
  E('contamination', 'Район заражения', 'special', 'area', 'Район химического заражения (ОВ).', { ustav: 'ustav.contamination' }),
  E('flooding', 'Район затопления', 'special', 'area', 'Затопленная местность (разрушение плотин, разлив).', { ustav: 'ustav.flooding' }),
  E('smoke', 'Дымовая завеса', 'special', 'line', 'Рубеж постановки дымовой завесы.', { ustav: 'ustav.smoke' }),
  E('fire', 'Пожар', 'special', 'symbol', 'Очаг пожара (горящий населённый пункт, объект).', { ustav: 'ustav.fire' }),

  /* ------------------------------------- подписи ------------------------------------- */
  E('label.unit', 'Обозначение части/соединения', 'labels', 'label', 'Номер и сокращённое наименование: «65 А», «3 гв. тк», «756 сп». Свои — красным, противник — синим.',
    { ustav: 'ustav.unit', atlas: 'atlas.unit', tac: 'tac.unit' }, { sideAware: true }),
  E('label.unitSmall', 'Обозначение соединения (мелкое)', 'labels', 'label', 'Подпись корпусов и дивизий рядом со стрелками.', { atlas: 'atlas.unitSmall' }),
  E('label.enemyUnit', 'Обозначение соединения противника', 'labels', 'label', 'Синие подписи соединений противника («56 тк», «9 А»).', { atlas: 'atlas.enemyUnit' }),
  E('label.front', 'Название фронта', 'labels', 'label', 'Наименование фронта крупным шрифтом.', { atlas: 'atlas.front', inf: 'inf.front' }),
  E('label.frontNote', 'Пояснение к фронту', 'labels', 'label', 'Подпись «Начало наступления 16 апреля» и т.п.', { inf: 'inf.frontNote' }),
  E('label.date', 'Дата / время', 'labels', 'label', 'Дата или время положения войск («к исходу 19.4»).', { ustav: 'ustav.time', atlas: 'atlas.date' }, { sideAware: true }),
  E('label.note', 'Пояснительная надпись', 'labels', 'label', 'Произвольная поясняющая надпись.', { ustav: 'ustav.note' }),
  E('label.city', 'Населённый пункт (подпись)', 'labels', 'label', 'Название города.', { atlas: 'atlas.city', inf: 'inf.city' }),
  E('label.capital', 'Столица / крупный город', 'labels', 'label', 'Название столицы или крупного города.', { inf: 'inf.capital' }),
  E('label.town', 'Малый населённый пункт', 'labels', 'label', 'Курсивная подпись малого пункта.', { atlas: 'atlas.town' }),
  E('label.water', 'Гидроним', 'labels', 'label', 'Название реки, озера, моря (курсив, голубой).', { atlas: 'atlas.water' }),
  E('label.region', 'Название региона (вразрядку)', 'labels', 'label', 'Крупная разрядка: «П О М Е Р А Н И Я».', { atlas: 'atlas.region' }),
  E('label.place', 'Объект на тактической схеме', 'labels', 'label', 'Название здания, площади, парка.', { tac: 'tac.place' }),

  /* ------------------------------ топографическая основа ------------------------------ */
  E('settlement', 'Населённый пункт', 'terrain', 'symbol', 'Пунсон населённого пункта.', { inf: 'inf.settlement', atlas: 'atlas.town' }),
  E('city', 'Город (застройка)', 'terrain', 'area', 'Контур застройки города.', { atlas: 'atlas.city', inf: 'inf.cityCenter', tac: 'tac.block' }),
  E('river', 'Река', 'terrain', 'line', 'Река, ручей, канал (одной линией).', { atlas: 'atlas.river', inf: 'inf.river' }),
  E('lake', 'Озеро, водоём', 'terrain', 'area', 'Озеро, пруд, водохранилище.', { atlas: 'atlas.lake' }),
  E('forest', 'Лес', 'terrain', 'area', 'Лесной массив.', { ustav: 'ustav.forest' }),
  E('swamp', 'Болото', 'terrain', 'area', 'Болото, заболоченная местность.', { ustav: 'ustav.swamp' }),
  E('rail', 'Железная дорога', 'terrain', 'line', 'Железная дорога (одно- и двухпутная).', { atlas: 'atlas.rail', inf: 'inf.rail' }),
  E('road', 'Шоссе', 'terrain', 'line', 'Шоссе, дорога с покрытием.', { ustav: 'ustav.road' }),
  E('dirtRoad', 'Грунтовая дорога', 'terrain', 'line', 'Грунтовая (полевая) дорога.', { ustav: 'ustav.dirtRoad' }),
  E('border', 'Государственная граница', 'terrain', 'line', 'Государственная граница.', { ustav: 'ustav.border' }),
  E('height', 'Отметка высоты', 'terrain', 'symbol', 'Высота с отметкой (в метрах).', { ustav: 'ustav.height' }),
  E('northArrow', 'Стрелка «север»', 'terrain', 'symbol', 'Ориентирование схемы по сторонам света.', { ustav: 'ustav.northArrow' }),
];

/** Вариант элемента для выбранного стиля (или ближайший доступный). */
export function variantFor(el: LibraryElement, style: StyleId): { style: StyleId; preset: string } {
  const order: StyleId[] = [style, 'ustav', 'atlas', 'inf', 'tac'];
  for (const s of order) if (el.variants[s]) return { style: s, preset: el.variants[s]! };
  throw new Error(`У элемента ${el.id} нет вариантов`);
}

/** Поиск элементов по названию, описанию и синонимам. */
export function searchLibrary(q: string): LibraryElement[] {
  const t = q.trim().toLowerCase();
  if (!t) return LIBRARY;
  return LIBRARY.filter((e) => [e.name, e.description, ...(e.keywords ?? [])].some((x) => x.toLowerCase().includes(t)));
}
