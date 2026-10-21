//! Агенты: дивизия (параметры, переменные, иерархическая машина состояний), штаб, объект.
//! Устройство — docs/plans/agents.md, разделы 2–4.

use crate::geo::XY;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Side { Su, De }

impl Side {
    pub fn enemy(self) -> Side { match self { Side::Su => Side::De, Side::De => Side::Su } }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mobility { Foot = 0, Motor = 1, Tracked = 2 }

/// Размерный класс для норм марша, развёртывания и полосы.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SizeClass { Rifle = 0, Tank = 1, Other = 2 }

/// Параметры: задаются один раз из данных и не меняются в прогоне.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Params {
    /// Тип по реестру: sd, pd, tk, mk, kd, td, pzgr, …
    pub kind: String,
    pub mobility: Mobility,
    pub size: SizeClass,
    /// Качество (опыт, гвардия, сводная часть), множитель силы.
    pub quality: f64,
}

/// Переменные: меняются в ходе прогона, инспектор показывает их историю.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Vars {
    pub personnel: f64,
    pub tanks: f64,
    pub guns: f64,
    /// Запасы: боекомплекты и заправки.
    pub ammo: f64,
    pub fuel: f64,
    /// Усталость 0–1.
    pub fatigue: f64,
    /// Организованность 0–1: падает в бою и на марше, восстанавливается на отдыхе.
    pub cohesion: f64,
    /// Слаженность (0–1): после боевого распоряжения меньше 1 — подготовка наспех; ослабляет силу в бою
    /// (rules.command.coordinationEffect), вне боя восстанавливается.
    pub coord: f64,
    /// Часы подготовки обороны на месте.
    pub prepared_h: f64,
    /// Часы марша за текущие сутки (с 06:00).
    pub march_h_today: f64,
    /// Часы марша по часам (номер шага по модулю 24): скользящие сутки для темпа по территории противника.
    #[serde(default)]
    pub march_h_log: [f64; 24],
    pub pos: XY,
    /// Боевая сила в начале операции — для порога прекращения атаки.
    pub strength0: f64,
    /// Численность в начале операции — для порога разгрома.
    #[serde(default)]
    pub personnel0: f64,
    /// Доли войск на позициях главной полосы обороны (1-я, 2-я, 3-я) — под артподготовку; None — по умолчанию из
    /// правил. Отвод с первой позиции меняет их.
    #[serde(default)]
    pub positions: Option<[f64; 3]>,
}

/// Подсостояния марша.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum MarchSub { Road, OffRoad, Halt, Jam, Crossing }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum AttackSub { Assault, Depth, Consolidate, Echelon, Breakout }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum DefenseSub { Hasty, Prepared }

/// Иерархическая машина состояний дивизии (docs/plans/agents.md, раздел 3.3).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub enum State {
    Reserve,
    March(MarchSub),
    Deploy { left_h: f64 },
    Attack(AttackSub),
    Defense(DefenseSub),
    Withdraw,
    Rout,
    /// Остатки разгромленной дивизии выходят из боя (world.rs, apply_remnants).
    Remnant,
    Destroyed,
    /// Остатки сведены в другую дивизию — агент выбыл.
    Merged,
    /// Ещё не введена в операцию (Division::enter): на карте её нет, в расчёте не участвует.
    Pending,
}

impl State {
    pub fn label(&self) -> &'static str {
        match self {
            State::Reserve => "резерв",
            State::March(MarchSub::Road) => "марш: по дороге",
            State::March(MarchSub::OffRoad) => "марш: вне дорог",
            State::March(MarchSub::Halt) => "марш: привал",
            State::March(MarchSub::Jam) => "марш: затор",
            State::March(MarchSub::Crossing) => "марш: переправа",
            State::Deploy { .. } => "развёртывание",
            State::Attack(AttackSub::Assault) => "наступление: атака",
            State::Attack(AttackSub::Depth) => "наступление: бой в глубине",
            State::Attack(AttackSub::Consolidate) => "наступление: закрепление",
            State::Attack(AttackSub::Echelon) => "наступление: второй эшелон",
            State::Attack(AttackSub::Breakout) => "наступление: прорыв из окружения",
            State::Defense(DefenseSub::Hasty) => "оборона: поспешная",
            State::Defense(DefenseSub::Prepared) => "оборона: подготовленная",
            State::Withdraw => "отход",
            State::Rout => "отступление",
            State::Remnant => "остатки: выход из боя",
            State::Destroyed => "небоеспособна",
            State::Merged => "сведена в другую дивизию",
            State::Pending => "не введена в операцию",
        }
    }
    /// Агент выбыл: рассеян или сведён в другую дивизию.
    pub fn out(&self) -> bool { matches!(self, State::Destroyed | State::Merged | State::Pending) }
    pub fn in_combat_posture(&self) -> bool { matches!(self, State::Attack(_) | State::Defense(_) | State::Deploy { .. }) }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum OrderKind {
    /// Выдвинуться в район.
    Move,
    /// Наступать до рубежа (точки).
    Attack,
    /// Оборонять район.
    Defend,
    /// Держаться: не отходить по своей воле.
    Hold,
    /// Отойти в район.
    Withdraw,
}

impl OrderKind {
    pub fn label(self) -> &'static str {
        match self { OrderKind::Move => "выдвинуться", OrderKind::Attack => "наступать", OrderKind::Defend => "оборонять", OrderKind::Hold => "держаться", OrderKind::Withdraw => "отойти" }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Order {
    pub kind: OrderKind,
    pub target: XY,
    /// Форсированный марш.
    #[serde(default)]
    pub forced: bool,
    pub issued: u32,
    /// Шаг, к которому приказ доходит до дивизии.
    pub arrives: u32,
    /// Кто отдал (индекс штаба).
    pub from: u32,
    pub note: String,
}

/// Маршрут: клетки театра от текущей до цели.
#[derive(Clone, Debug, Default)]
pub struct Route {
    pub cells: Vec<u32>,
    /// Индекс следующей клетки маршрута.
    pub next: usize,
    /// Задержка форсирования на текущем переходе, ч.
    pub crossing_left_h: f64,
    /// Переход (номер клетки маршрута), через реку на котором уже пропущены.
    pub cleared: usize,
}

#[derive(Clone, Debug)]
pub struct Division {
    pub id: String,
    pub name: String,
    pub side: Side,
    pub hq: u32,
    pub params: Params,
    pub vars: Vars,
    pub state: State,
    pub state_since: u32,
    pub order: Option<Order>,
    pub route: Option<Route>,
    /// Откуда взяты исходные цифры (из сценария): для карточки агента.
    pub note: String,
    /// Шаг ввода в операцию (0 — с начала); до него — State::Pending.
    pub enter: u32,
    /// С какого шага пути к своим нет (pocket.rs).
    pub cut_since: Option<u32>,
    /// Окружённая: с какого шага путь к своим снова есть.
    pub relink_since: Option<u32>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Echelon {
    /// Верховное командование: Ставка ВГК, ОКХ/ОКВ.
    #[serde(rename = "high_command")]
    HighCommand,
    Front,
    Army,
    Corps,
}

/// Штаб: получает задачу, доводит приказы подчинённым с задержкой.
#[derive(Clone, Debug)]
pub struct Hq {
    pub id: String,
    pub name: String,
    pub side: Side,
    pub echelon: Echelon,
    pub parent: Option<u32>,
    pub pos: XY,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ObjectKind { Bridge, Settlement, Depot }

/// Объект: без собственной воли, со своим состоянием.
#[derive(Clone, Debug)]
pub struct Object {
    pub id: String,
    pub name: String,
    pub kind: ObjectKind,
    pub pos: XY,
    /// Чей: по последнему, кто был рядом.
    pub control: Option<Side>,
    /// Для моста — индекс в theatre.bridges.
    pub bridge: Option<u16>,
    /// Мост цел (для мостов; по данным театра и событиям прогона).
    pub intact: bool,
    /// Мост занят колонной до шага (не включительно).
    pub busy_until: u32,
}
