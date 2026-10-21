//! Мир и шаг модели (1 час). Шаг в три фазы (docs/plans/agents.md, раздел 7.2):
//!
//! 1. **Оценить и решить — параллельно.** Каждая дивизия читает неизменный снимок мира и решает: переход
//!    состояния, маршрут (поиск пути — самая дорогая часть), желаемое движение, с кем вступает в бой.
//! 2. **Разрешить — по порядку.** Очередь на мостах и бои разрешаются в фиксированном порядке (по индексам),
//!    независимо от числа потоков.
//! 3. **Применить** — расход, подвоз, усталость, объекты; получается новый снимок.
//!
//! Случайные числа — по номеру агента и шага (rng.rs), поэтому прогон воспроизводится на любом числе ядер.

use crate::geo::XY;
use crate::model::*;
use crate::rng::{Rng, Stream};
use crate::route;
use crate::rules::{Activity, Rules};
use crate::spatial::Index;
use crate::theatre::Theatre;
use rayon::prelude::*;
use std::collections::BTreeMap;
use std::sync::Arc;

/// Событие журнала: что произошло и почему.
#[derive(Clone, Debug)]
pub struct Event {
    pub tick: u32,
    /// Индекс дивизии; u32::MAX — не дивизия.
    pub agent: u32,
    pub text: String,
}

/// Приказ сценария: штаб отдаёт его в момент `at` (шаг), до дивизий он доходит с задержкой штаба.
#[derive(Clone, Debug)]
pub struct ScriptOrder {
    pub at: u32,
    pub hq: u32,
    /// Кому: индексы дивизий.
    pub to: Vec<u32>,
    pub kind: OrderKind,
    /// Цель; None — на месте (район, где дивизия получит приказ).
    pub target: Option<XY>,
    pub forced: bool,
    pub note: String,
    /// Цель — соединение («наступать вместе с 3 гв. ТА»): его место в момент приказа (центр дивизий штаба или
    /// положение дивизии) со сдвигом `offset`, км; иначе — `target`.
    pub follow: Option<String>,
    pub offset: XY,
}

/// Артподготовка (огневой удар) сценария: штаб армии в момент `at` проводит её на полосе своих дивизий.
#[derive(Clone, Debug)]
pub struct ScriptFire {
    pub at: u32,
    pub hq: u32,
    pub duration_min: f64,
    pub density_per_km: f64,
    pub note: String,
}

/// Событие сценария: отвод войск с первой позиции (доли войск по позициям у названных дивизий).
#[derive(Clone, Debug)]
pub struct ScriptWithdraw {
    pub at: u32,
    pub to: Vec<u32>,
    pub positions: [f64; 3],
    pub note: String,
}

/// Вид изменения по дате.
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeKind { Reinforce, Resubordinate }

/// Изменение по дате (поправки сценария из базы знаний, scenario::EditsIn): пополнение дивизии или переподчинение
/// дивизии или штаба. Исполняется на первом шаге не раньше `at`; пополнение не введённой дивизии — при вводе.
#[derive(Clone, Debug)]
pub struct ScriptChange {
    pub at: u32,
    /// id дивизии или штаба.
    pub formation: String,
    pub kind: ChangeKind,
    pub personnel: f64,
    pub tanks: f64,
    pub guns: f64,
    /// Новый вышестоящий штаб (id) — для переподчинения.
    pub parent: Option<String>,
}

/// Снимок мира на шаг.
#[derive(Clone)]
pub struct World {
    pub tick: u32,
    pub divisions: Vec<Division>,
    pub hqs: Vec<Hq>,
    pub objects: Vec<Object>,
    /// Приказы в пути: (дивизия, приказ).
    pub in_transit: Vec<(u32, Order)>,
    /// Чья клетка театра: 0 — ничья, 1 — советская, 2 — немецкая. В начале — по ближайшей дивизии (не дальше
    /// CONTROL_INIT_KM), дальше — клетки, где побывали войска.
    pub control: Vec<u8>,
    /// Клетки, до которых доходит путь к своим: [советская сторона, немецкая] (pocket.rs).
    pub reach: [Vec<bool>; 2],
    /// Клетки ближе pocket.hold_km к войскам стороны — её территорию там держат: [советская, немецкая].
    pub held: [Vec<bool>; 2],
    /// Дивизия вела бой в этом часе (наступала или оборонялась).
    pub engaged: Vec<bool>,
}

/// Радиус начальной разметки территории вокруг войск, км.
pub const CONTROL_INIT_KM: f64 = 40.0;
/// Закрепление земли: на каком удалении искать свою землю по четырём сторонам, км (как в нынешней модели).
pub const CONSOLIDATE_REACH_KM: f64 = 24.0;

#[inline]
pub fn side_code(s: Side) -> u8 { match s { Side::Su => 1, Side::De => 2 } }

impl World {
    /// Начальная разметка территории: клетка принадлежит стороне ближайшей дивизии (не дальше CONTROL_INIT_KM). Не
    /// введённые в операцию не считаются: их место в сценарии — район будущего ввода (28 А у Котбуса размечала бы
    /// немецкий тыл Котбус — Люббен своим с первого часа).
    pub fn init_control(&mut self, t: &Theatre) {
        let pts: Vec<(XY, u8)> = self.divisions.iter().filter(|d| d.state != State::Pending && !d.state.out()).map(|d| (d.vars.pos, side_code(d.side))).collect();
        self.control = t.centers.par_iter().map(|c| {
            pts.iter().map(|&(p, s)| (p.dist(*c), s)).filter(|&(k, _)| k <= CONTROL_INIT_KM)
                .min_by(|a, b| a.0.total_cmp(&b.0)).map_or(0, |(_, s)| s)
        }).collect();
    }
}

pub struct Sim {
    pub theatre: Arc<Theatre>,
    pub rules: Rules,
    pub seed: u64,
    /// Начало сценария, часы от 1970-01-01.
    pub start_hour: i64,
    pub world: World,
    pub script: Vec<ScriptOrder>,
    pub fires: Vec<ScriptFire>,
    pub withdrawals: Vec<ScriptWithdraw>,
    /// Изменения по датам, ещё не исполненные (по возрастанию часа).
    pub changes: Vec<ScriptChange>,
    /// Источник решений штабов: [советская сторона, немецкая].
    pub sources: [crate::staff::Source; 2],
    /// Направления «в тыл» дивизий по исходной обстановке (для штабов по доктрине).
    pub rear_dir: std::sync::OnceLock<Vec<(XY, f64)>>,
    /// Текст доктрины из базы знаний для штабов на модели: [советская сторона, немецкая]; нет — зашитое предложение.
    pub doctrine_text: [Option<String>; 2],
    /// Языковая модель для штабов на модели.
    pub llm: Option<crate::llm::LlmConfig>,
    /// Запросы к модели и ответы (для разбора и записи прогона).
    pub llm_log: std::sync::Mutex<Vec<serde_json::Value>>,
    /// Число одновременных запросов, определённое замером (если в настройках «авто»), и сам замер.
    pub llm_par: std::sync::OnceLock<usize>,
    pub llm_probe: std::sync::Mutex<Option<serde_json::Value>>,
    /// Советские штабы по доктрине: замысел и построение армий (staff_su.rs).
    pub su_staff: std::sync::Mutex<crate::staff_su::SuStaff>,
    /// Сообщения о ходе долгих решений (запрос к модели) — для окна приложения.
    pub on_progress: Option<Box<dyn Fn(String) + Send + Sync>>,
    /// Ход ответа модели-штаба по мере прихода (размышления и ответ) — для окна приложения.
    pub on_stream: Option<Box<dyn Fn(serde_json::Value) + Send + Sync>>,
    pub journal: Vec<Event>,
    /// Снимки по шагам для перемотки (если включено).
    pub history: Option<Vec<World>>,
    /// Распоряжения штаба игрока (игра): подвоз, переправы, подрыв мостов, полосы армий.
    pub staff: StaffFx,
}

/// Распоряжения штаба, которые ядро исполняет в расчёте (игра; их проверяет и ведёт штаб вне ядра).
#[derive(Default, Clone, Debug)]
pub struct StaffFx {
    /// Множитель подвоза по дивизиям (индекс; нет — 1): база далеко или подвоз не доходит — меньше, приоритет — больше.
    pub supply: std::collections::HashMap<u32, f64>,
    /// Наведённые переправы: место, сторона, с какого шага — переход реки рядом (до PONTOON_KM) без задержки форсирования.
    pub pontoons: Vec<(XY, Side, u32)>,
    /// Подорванные мосты театра: индекс моста → с какого шага.
    pub demolished: std::collections::HashMap<u16, u32>,
    /// Полосы объединений (фронтов, армий): клетка в полосе соседа «дороже» при выборе пути (время движения то же);
    /// множители уровней перемножаются.
    pub sectors: Vec<Sectors>,
}

/// Полосы объединений на грубой сетке театра: метка объединения клетки (−1 — вне полос), объединение дивизий.
#[derive(Clone, Debug)]
pub struct Sectors {
    /// Клеток театра в клетке сетки по каждой оси; столбцов сетки.
    pub step: usize,
    pub cols: usize,
    pub label: Vec<i16>,
    /// Объединение (метка) дивизии по её индексу.
    pub group: std::collections::HashMap<u32, i16>,
    /// Насколько «дороже» клетка чужой полосы (как sectorPrefer: 1 + foreign).
    pub foreign: f64,
}

/// Радиус наведённой переправы, км.
pub const PONTOON_KM: f64 = 3.0;

#[derive(Clone, Copy, Debug)]
struct Moved {
    pos: XY,
    /// Номер следующей клетки маршрута.
    next: usize,
    /// Часы марша.
    used_h: f64,
    crossing_left_h: f64,
    /// Переход маршрута, уже пройденный через реку (мост занят своей колонной или форсирование начато).
    cleared: usize,
}

/// Решение дивизии на шаг (фаза 1).
#[derive(Clone, Debug, Default)]
struct Intent {
    state: Option<(State, String)>,
    /// Новый маршрут (Some(None) — сбросить).
    route: Option<Option<Route>>,
    /// Движение по маршруту за час.
    moved: Option<Moved>,
    /// Мост на пути в этом часе: (объект, позиция перед мостом, следующая клетка перед мостом).
    bridge: Option<(u32, XY, usize)>,
    /// Атакует дивизию противника.
    attacks: Option<u32>,
    /// Досягаемые дивизии противника по возрастанию расстояния (для распределения по участкам) и расстояния до них.
    options: Vec<(u32, f64)>,
    /// Отход от противника: куда.
    retreat_to: Option<XY>,
    activity: Option<Activity>,
}

impl Sim {
    pub fn new(theatre: Arc<Theatre>, rules: Rules, seed: u64, start_hour: i64, world: World, script: Vec<ScriptOrder>) -> Sim {
        let mut s = Sim { theatre, rules, seed, start_hour, world, script, fires: Vec::new(), withdrawals: Vec::new(), changes: Vec::new(), sources: [crate::staff::Source::Script; 2], rear_dir: std::sync::OnceLock::new(), doctrine_text: [None, None], llm: None, llm_log: std::sync::Mutex::new(Vec::new()), llm_par: std::sync::OnceLock::new(), llm_probe: std::sync::Mutex::new(None), su_staff: std::sync::Mutex::new(Default::default()), on_progress: None, on_stream: None, journal: Vec::new(), history: None, staff: StaffFx::default() };
        s.script.sort_by_key(|o| o.at);
        s
    }

    pub fn hour(&self) -> i64 { self.start_hour + self.world.tick as i64 }

    /// Боевая сила дивизии (часть II описания, раздел 19.1).
    pub fn strength(&self, d: &Division) -> f64 {
        let r = &self.rules;
        let (wp, wt, wg) = r.side(d.side).weights;
        let v = &d.vars;
        let base = v.personnel / 1000.0 * wp + v.tanks * wt + v.guns * wg;
        let ammo = if v.ammo >= 0.5 { 1.0 } else { r.ammo_short + (1.0 - r.ammo_short) * (v.ammo / 0.5).max(0.0) };
        let fuel = if v.fuel <= 0.0 && d.params.mobility != Mobility::Foot { r.fuel_out } else { 1.0 };
        base * d.params.quality * ammo * fuel * (1.0 - v.fatigue * r.fatigue_effect)
    }

    /// Боевая сила по составу (люди, танки, орудия и качество) — без запасов и усталости; как strength0.
    pub fn material_strength(&self, d: &Division) -> f64 {
        let (wp, wt, wg) = self.rules.side(d.side).weights;
        let v = &d.vars;
        (v.personnel / 1000.0 * wp + v.tanks * wt + v.guns * wg) * d.params.quality
    }

    fn bridge_open(&self, w: &World, b: u16) -> bool {
        w.objects.iter().find(|o| o.bridge == Some(b)).map_or(true, |o| o.intact)
    }

    /// Переход реки из клетки `c` в `nb` по наведённой переправе своей стороны (действует с этого шага).
    fn pontoon(&self, side: Side, tick: u32, c: usize, nb: usize) -> bool {
        let t = &*self.theatre;
        self.staff.pontoons.iter().any(|&(p, s, from)| s == side && tick >= from && (t.centers[c].dist(p) <= PONTOON_KM || t.centers[nb].dist(p) <= PONTOON_KM))
    }

    /// Множитель выбора пути для дивизии `i`: в полосе соседа — 1 + foreign.
    fn sector_cost(&self, i: usize, cell: usize) -> f64 {
        let t = &*self.theatre;
        self.staff.sectors.iter().map(|s| {
            let Some(&g) = s.group.get(&(i as u32)) else { return 1.0 };
            let k = (cell / t.cols / s.step) * s.cols + (cell % t.cols) / s.step;
            match s.label.get(k) { Some(&l) if l >= 0 && l != g => 1.0 + s.foreign, _ => 1.0 }
        }).product()
    }

    /// Один шаг (1 час).
    pub fn step(&mut self) {
        if let Some(h) = self.history.as_mut() { h.push(self.world.clone()); }
        let tick = self.world.tick;
        // направления «в тыл» — по исходной обстановке (штабы и выход остатков из боя)
        if tick == 0 { let _ = self.fronts(&self.world); }
        let mut next = self.world.clone();
        let mut journal = Vec::new();
        // ввод в операцию по времени сценария
        for (i, d) in next.divisions.iter_mut().enumerate() {
            if d.state == State::Pending && tick >= d.enter {
                journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: введена в операцию", State::Pending.label(), State::Reserve.label()) });
                d.state = State::Reserve;
                d.state_since = tick;
            }
        }
        // изменения по датам: пополнения и переподчинение (после ввода — введённая в этом часе уже пополняется)
        self.apply_changes(&mut next, tick, &mut journal);

        // 0. Приказы: штабы отдают по сценарию или решают по доктрине (staff.rs); до дивизий приказы доходят с задержкой
        // своего уровня. У стороны со штабами по доктрине приказы сценария не действуют.
        let mut due: Vec<ScriptOrder> = Vec::new();
        while let Some(o) = self.script.first() {
            if o.at > tick { break; }
            let o = self.script.remove(0);
            let side = next.hqs[o.hq as usize].side;
            match self.sources[crate::staff::side_idx(side)] {
                crate::staff::Source::Script => due.push(o),
                // советские штабы по доктрине: задача сценария — замысел армии (staff_su.rs)
                _ if side == Side::Su => self.su_plan(&next, &o, &mut due),
                _ => {}
            }
        }
        let (doc_orders, doc_journal) = self.doctrine_orders(&next, tick);
        due.extend(doc_orders);
        journal.extend(doc_journal);
        for o in due {
            let hq = &next.hqs[o.hq as usize];
            let sr = self.rules.side(hq.side);
            let delay = match hq.echelon { Echelon::HighCommand | Echelon::Front => sr.delay_army, Echelon::Army => sr.delay_corps, Echelon::Corps => sr.delay_division };
            let follow_at = o.follow.as_deref().and_then(|f| self.place_of(&next, f));
            for &d in &o.to {
                let target = match follow_at {
                    Some(c) => XY::new(c.x + o.offset.x, c.y + o.offset.y),
                    None => o.target.unwrap_or(next.divisions[d as usize].vars.pos),
                };
                // приказы на начало сценария отданы накануне и уже дошли до дивизий (кроме атаки — у неё свой час «Ч»)
                let arrives = if o.at == 0 && o.kind != OrderKind::Attack && self.rules.start_orders_delivered { 0 } else { o.at + delay.round() as u32 };
                let order = Order { kind: o.kind, target, forced: o.forced, issued: o.at, arrives, from: o.hq, note: o.note.clone() };
                next.in_transit.push((d, order));
            }
        }
        let mut arrived = Vec::new();
        next.in_transit.retain(|(d, o)| if o.arrives <= tick { arrived.push((*d, o.clone())); false } else { true });
        for (d, o) in arrived {
            let div = &mut next.divisions[d as usize];
            // не введённая получает приказ заранее — выполнит после ввода
            if (div.state.out() && div.state != State::Pending) || div.state == State::Remnant { continue; }
            journal.push(Event { tick, agent: d, text: format!("получен приказ «{}» от штаба «{}»: {}", o.kind.label(), next.hqs[o.from as usize].name, o.note) });
            div.order = Some(o);
            div.route = None;
        }
        // отвод с первой позиции и артподготовка (события сценария)
        self.apply_withdrawals(&mut next, tick, &mut journal);
        self.apply_fires(&mut next, tick, &mut journal);
        // мосты по данным театра (наведение, подрыв)
        let hour = self.hour();
        for ob in next.objects.iter_mut() {
            if let Some(b) = ob.bridge { ob.intact = self.theatre.bridges[b as usize].open_at(hour) && !self.staff.demolished.get(&b).is_some_and(|&from| tick >= from); }
        }

        // 1. Решения — параллельно по снимку `next` (после доставки приказов).
        let index = Index::build(next.divisions.iter().enumerate().filter(|(_, d)| !d.state.out()).map(|(i, d)| (i as u32, d.vars.pos)), 5.0);
        let snap = &next;
        let intents: Vec<Intent> = (0..snap.divisions.len()).into_par_iter().map(|i| self.decide(snap, &index, i as u32)).collect();

        // 2. Разрешение по порядку: мосты, бои.
        self.resolve(&mut next, intents, &mut journal);

        // 3. Применение: расход, подвоз, усталость, объекты.
        self.apply(&mut next, &mut journal);

        next.tick += 1;
        self.world = next;
        self.journal.extend(journal);
    }

    /// Место соединения по id: дивизия — её положение; штаб — центр его действующих дивизий (с подчинёнными штабами).
    pub(crate) fn place_of(&self, w: &World, id: &str) -> Option<XY> {
        if let Some(d) = w.divisions.iter().find(|d| d.id == id && !d.state.out()) { return Some(d.vars.pos); }
        let h = w.hqs.iter().position(|h| h.id == id)?;
        let under = |mut k: usize| { for _ in 0..8 { if k == h { return true; } match w.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
        let ps: Vec<XY> = w.divisions.iter().filter(|d| !d.state.out() && under(d.hq as usize)).map(|d| d.vars.pos).collect();
        if ps.is_empty() { return None; }
        let n = ps.len() as f64;
        Some(ps.iter().fold(XY::default(), |s, p| XY::new(s.x + p.x / n, s.y + p.y / n)))
    }

    fn night(&self) -> bool { let h = self.hour().rem_euclid(24); !(5..21).contains(&h) }

    fn decide(&self, w: &World, index: &Index, i: u32) -> Intent {
        let d = &w.divisions[i as usize];
        let mut out = Intent::default();
        if d.state.out() { return out; }
        let r = &self.rules;
        let pos = d.vars.pos;
        // ближайший противник в пределах соприкосновения
        let reach = r.contact_km + r.size(&r.frontage_km, d.params.size) / 2.0;
        let mut options: Vec<(u32, f64)> = index.near(pos, reach).into_iter()
            .filter(|&j| w.divisions[j as usize].side != d.side)
            .map(|j| (j, w.divisions[j as usize].vars.pos.dist(pos)))
            .filter(|&(_, k)| k <= reach)
            .collect();
        options.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        let enemy = options.first().copied();
        out.options = options;
        let set = |out: &mut Intent, s: State, why: &str| if s != d.state { out.state = Some((s, why.to_string())); };

        // остатки выходят из боя к своей точке в тылу и там стоят; приказов не получают
        if d.state == State::Remnant {
            if let Some(o) = d.order.as_ref().filter(|o| pos.dist(o.target) >= 1.5) {
                self.march(w, d, o.target, r.march_hours_forced, &mut out);
                out.state = None;
                out.activity = Some(Activity::Withdraw);
            } else {
                out.activity = Some(Activity::Reserve);
            }
            return out;
        }

        // прорыв из окружения: окружённая дивизия с приказом наступать не ввязывается в бой, а колонной идёт к цели
        // через бреши в кольце, неся потери (apply); темп — не выше pocket.breakout_km_day (march); вырвавшись, идёт до цели.
        // Только немецкая сторона (котёл 9 А): советские подвижные группы, отрезанные в немецком тылу, продолжали задачу
        if let Some(o) = d.order.as_ref().filter(|o| d.side == Side::De && o.kind == OrderKind::Attack && pos.dist(o.target) >= 1.5 && (self.encircled(d, w.tick) || d.state == State::Attack(AttackSub::Breakout))) {
            self.march(w, d, o.target, r.march_hours_forced, &mut out);
            out.state = if d.state == State::Attack(AttackSub::Breakout) { None } else {
                Some((State::Attack(AttackSub::Breakout), "окружена — прорыв к своим колоннами через бреши".into())) };
            out.activity = Some(Activity::Attack);
            return out;
        }

        // отступление при потере организованности
        if d.vars.cohesion < r.rout_cohesion && enemy.is_some() && !matches!(d.order.as_ref().map(|o| o.kind), Some(OrderKind::Hold)) {
            let (j, _) = enemy.unwrap();
            let e = w.divisions[j as usize].vars.pos;
            let away = XY::new(pos.x + (pos.x - e.x), pos.y + (pos.y - e.y));
            set(&mut out, State::Rout, "организованность потеряна, отходит беспорядочно");
            out.retreat_to = Some(pos.toward(away, r.march_kmh[Mobility::Foot as usize]));
            out.activity = Some(Activity::Withdraw);
            return out;
        }
        if d.state == State::Rout && d.vars.cohesion > 2.0 * r.rout_cohesion {
            set(&mut out, State::Defense(DefenseSub::Hasty), "управление восстановлено, переходит к обороне");
        }

        let Some(order) = d.order.as_ref() else {
            out.activity = Some(if d.state.in_combat_posture() { Activity::Defend } else { Activity::Reserve });
            return out;
        };
        let at_target = pos.dist(order.target) < 1.5;
        let hours_limit = if order.forced { r.march_hours_forced } else { r.march_hours_normal };

        match order.kind {
            OrderKind::Attack => {
                if let Some((j, _)) = enemy {
                    let s0 = d.vars.strength0.max(1e-9);
                    // порог срыва атаки — по потерям (люди, танки, орудия), а не по боевой силе с усталостью и запасами:
                    // иначе за неделю боёв одна усталость доводит дивизию до порога (боеприпасы — своя проверка ниже)
                    if self.material_strength(d) / s0 < 1.0 - r.combat.breakpoint_loss {
                        set(&mut out, State::Defense(DefenseSub::Hasty), "атака прекращена: боевая сила ниже порога");
                        out.activity = Some(Activity::Defend);
                    } else if d.vars.ammo < r.stop_ammo {
                        set(&mut out, State::Defense(DefenseSub::Hasty), "атака прекращена: нет боеприпасов");
                        out.activity = Some(Activity::Defend);
                    } else {
                        match d.state {
                            State::Deploy { left_h } if left_h > 1.0 => { out.state = Some((State::Deploy { left_h: left_h - 1.0 }, String::new())); out.activity = Some(Activity::Defend); }
                            State::Attack(_) => {
                                out.attacks = Some(j);
                                out.activity = Some(Activity::Attack);
                            }
                            State::Deploy { .. } => {
                                set(&mut out, State::Attack(AttackSub::Assault), "развернулась, атакует");
                                out.attacks = Some(j);
                                out.activity = Some(Activity::Attack);
                            }
                            _ => {
                                let h = r.size(&r.deploy_hours, d.params.size);
                                set(&mut out, State::Deploy { left_h: h }, "противник в соприкосновении, развёртывается для атаки");
                                out.activity = Some(Activity::Defend);
                            }
                        }
                    }
                    return out;
                }
                if at_target {
                    set(&mut out, State::Defense(DefenseSub::Hasty), "задача выполнена: рубеж достигнут");
                    out.activity = Some(Activity::Defend);
                    return out;
                }
                self.march(w, d, order.target, hours_limit, &mut out);
            }
            OrderKind::Move | OrderKind::Withdraw => {
                if at_target {
                    let s = if order.kind == OrderKind::Move { State::Reserve } else { State::Defense(DefenseSub::Hasty) };
                    set(&mut out, s, "вышла в назначенный район");
                    out.activity = Some(Activity::Reserve);
                    return out;
                }
                if enemy.is_some() && order.kind == OrderKind::Move {
                    set(&mut out, State::Defense(DefenseSub::Hasty), "встретила противника на марше, переходит к обороне");
                    out.activity = Some(Activity::Defend);
                    return out;
                }
                self.march(w, d, order.target, hours_limit, &mut out);
                if order.kind == OrderKind::Withdraw { out.activity = Some(Activity::Withdraw); }
            }
            OrderKind::Defend | OrderKind::Hold => {
                if pos.dist(order.target) > 3.0 && enemy.is_none() {
                    self.march(w, d, order.target, hours_limit, &mut out);
                    return out;
                }
                let s = if d.vars.prepared_h >= r.prepare_hours { State::Defense(DefenseSub::Prepared) } else { State::Defense(DefenseSub::Hasty) };
                let why = if s == State::Defense(DefenseSub::Prepared) { "оборона подготовлена" } else { "занимает оборону" };
                set(&mut out, s, why);
                out.activity = Some(Activity::Defend);
            }
        }
        out
    }

    /// Марш к цели по маршруту: часы марша в сутки ограничены нормой, ночью медленнее.
    fn march(&self, w: &World, d: &Division, target: XY, hours_limit: f64, out: &mut Intent) {
        let r = &self.rules;
        let t = &*self.theatre;
        out.activity = Some(Activity::March);
        if d.vars.march_h_today >= hours_limit {
            if !matches!(d.state, State::March(MarchSub::Halt)) { out.state = Some((State::March(MarchSub::Halt), "суточная норма марша выполнена, привал".into())); }
            out.activity = Some(Activity::Reserve);
            return;
        }
        if d.params.mobility != Mobility::Foot && d.vars.fuel <= 0.0 {
            if !matches!(d.state, State::March(MarchSub::Halt)) { out.state = Some((State::March(MarchSub::Halt), "нет горючего".into())); }
            out.activity = Some(Activity::Reserve);
            return;
        }
        let bopen = |b: u16| self.bridge_open(w, b);
        let tick = w.tick;
        let pont = |c: usize, nb: usize| self.pontoon(d.side, tick, c, nb);
        // индекс дивизии — для её полосы (только когда полосы заданы)
        let di = if !self.staff.sectors.is_empty() { w.divisions.iter().position(|x| std::ptr::eq(x, d)).unwrap_or(usize::MAX) } else { usize::MAX };
        let prefer = |cell: usize| self.sector_cost(di, cell);
        let goal = t.land_cell_near(target);
        let mut route = d.route.clone();
        let need = match (&route, goal) {
            (Some(rt), Some(g)) => rt.cells.last().map(|&c| c as usize) != Some(g),
            (None, Some(_)) => true,
            _ => false,
        };
        if need {
            let (Some(from), Some(g)) = (t.land_cell_near(d.vars.pos), goal) else { return };
            match route::find(t, r, d.side, d.params.mobility, from, g, &route::Ways { bridge_open: &bopen, pontoon: &pont, prefer: &prefer }) {
                Some((cells, _)) => { route = Some(Route { cells, next: 1, crossing_left_h: 0.0, cleared: 0 }); out.route = Some(route.clone()); }
                None => {
                    out.route = Some(None);
                    if !matches!(d.state, State::March(MarchSub::Halt)) { out.state = Some((State::March(MarchSub::Halt), "нет пути к цели (река без моста или вода)".into())); }
                    return;
                }
            }
        }
        let Some(mut rt) = route else { return };
        let mut pos = d.vars.pos;
        let mut left = 1.0f64;
        let night = self.night();
        let mut sub = MarchSub::Road;
        // часы марша за 23 часа до этого: по территории противника норма — за любые сутки, а не за календарные (ход
        // через 06:00 давал бы 4 ч до сброса суточных часов и ещё 8 после — полторы нормы темпа подряд)
        let day_h: f64 = d.vars.march_h_log.iter().enumerate().filter(|&(k, _)| k != w.tick as usize % 24).map(|(_, h)| h).sum();
        let mut deep_done = false;
        if rt.crossing_left_h > 0.0 {
            let used = rt.crossing_left_h.min(left);
            rt.crossing_left_h -= used;
            left -= used;
            sub = MarchSub::Crossing;
        }
        while left > 1e-9 && rt.next < rt.cells.len() {
            let c = rt.cells[rt.next - 1] as usize;
            let nb = rt.cells[rt.next] as usize;
            let dir = (0..8).find(|&k| t.neighbor(c, k) == Some(nb));
            let Some(dir) = dir else { break };
            // переход через реку (один раз на переход)
            if t.river_cross[c] & (1 << dir) != 0 && rt.cleared != rt.next {
                match t.crossing_bridge.get(&(c as u32, dir as u8)) {
                    Some(&b) if self.bridge_open(w, b) => {
                        let obj = w.objects.iter().position(|o| o.bridge == Some(b)).unwrap_or(usize::MAX) as u32;
                        out.bridge = Some((obj, pos, rt.next));
                        rt.cleared = rt.next;
                    }
                    // наведённая переправа (распоряжение штаба) — без задержки форсирования
                    _ if self.pontoon(d.side, w.tick, c, nb) => { rt.cleared = rt.next; }
                    // моста нет или он разрушен: пехота — на подручных средствах, технике наводят переправу
                    _ => {
                        rt.crossing_left_h = if d.params.mobility == Mobility::Foot { r.river_cross_hours } else { r.bridging_hours };
                        rt.cleared = rt.next;
                        sub = MarchSub::Crossing;
                        let used = rt.crossing_left_h.min(left);
                        rt.crossing_left_h -= used;
                        left -= used;
                        if rt.crossing_left_h > 0.0 { break; }
                    }
                }
            }
            let road = t.road[c].min(t.road[nb]);
            if road == 0 && sub == MarchSub::Road { sub = MarchSub::OffRoad; }
            let mut v = r.speed_kmh(d.side, d.params.mobility, road, t.terrain[nb], night);
            // по территории противника — не марш, а наступление в глубине: темп не выше нормы за сутки
            // (за часы марша в сутки, поэтому за сутки выходит не больше нормы). Всюду, а не только у его войск: в
            // глубине — заслоны, гарнизоны, разрушения. Свой тыл с немецкой разметкой — след своих колонн — размечен
            // своим при проходе (resolve); клетка рядом с дивизией своя по её же разметке, поэтому смотрим на две
            // клетки маршрута вперёд — иначе голова колонны каждый час проходила бы её полным ходом
            let enemy_code = side_code(d.side.enemy());
            let enemy_land = (rt.next..(rt.next + 3).min(rt.cells.len())).any(|k| w.control.get(rt.cells[k] as usize).copied() == Some(enemy_code));
            if enemy_land {
                if day_h + 1.0 - left >= hours_limit { deep_done = true; break; }
                v = v.min(r.enemy_territory_km_day[d.params.mobility as usize] / hours_limit);
                // город противника — кварталами, даже без соприкосновения с его дивизиями: гарнизон рассредоточен
                let city = t.city[nb] as usize;
                if city > 0 { v = v.min(r.combat.urban_km_day[city.min(3) - 1] / hours_limit); }
                if sub != MarchSub::Crossing { sub = MarchSub::OffRoad; }
            }
            // прорыв из окружения — колоннами по лесам и через бреши, с боями у каждого рубежа
            if d.state == State::Attack(AttackSub::Breakout) || d.side == Side::De && self.encircled(d, w.tick) && d.order.as_ref().is_some_and(|o| o.kind == OrderKind::Attack) {
                v = v.min(r.pocket.breakout_km_day / hours_limit);
            }
            if v <= 0.0 { break; }
            let goal_p = if rt.next + 1 == rt.cells.len() { target } else { t.centers[nb] };
            let dist = pos.dist(goal_p);
            let can = v * left;
            if can >= dist {
                pos = goal_p;
                left -= dist / v;
                rt.next += 1;
            } else {
                pos = pos.toward(goal_p, can);
                left = 0.0;
            }
        }
        let used_h = 1.0 - left;
        if deep_done && used_h < 1e-9 {
            if !matches!(d.state, State::March(MarchSub::Halt)) { out.state = Some((State::March(MarchSub::Halt), "суточная норма наступления по территории противника выполнена, привал".into())); }
            out.activity = Some(Activity::Reserve);
            return;
        }
        if out.state.is_none() {
            let s = State::March(sub);
            if s != d.state { out.state = Some((s, if matches!(d.state, State::March(_)) { String::new() } else { "выступила маршем".into() })); }
        }
        out.moved = Some(Moved { pos, next: rt.next, used_h, crossing_left_h: rt.crossing_left_h, cleared: rt.cleared });
    }

    fn resolve(&self, w: &mut World, intents: Vec<Intent>, journal: &mut Vec<Event>) {
        let tick = w.tick;
        w.engaged = vec![false; w.divisions.len()];
        let r = &self.rules;
        // маршруты и состояния
        for (i, it) in intents.iter().enumerate() {
            let d = &mut w.divisions[i];
            if let Some(rt) = &it.route { d.route = rt.clone(); }
            if let Some((s, why)) = &it.state {
                if *s != d.state {
                    if !why.is_empty() { journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: {}", d.state.label(), s.label(), why) }); }
                    if !matches!((d.state, s), (State::Deploy { .. }, State::Deploy { .. })) { d.state_since = tick; }
                    d.state = *s;
                }
            }
        }
        // часы марша этого часа суток — заново (скользящие сутки для темпа по территории противника)
        let slot = tick as usize % 24;
        for d in w.divisions.iter_mut() { d.vars.march_h_log[slot] = 0.0; }
        // движение и мосты: по порядку индексов, мост держит колонну, пока она не пройдёт
        for (i, it) in intents.iter().enumerate() {
            let Some(m) = it.moved else { continue };
            let mut final_pos = m.pos;
            let mut final_next = m.next;
            let mut used = m.used_h;
            let mut cleared = m.cleared;
            if let Some((obj, before, before_next)) = it.bridge {
                if obj != u32::MAX {
                    let o = &w.objects[obj as usize];
                    if o.busy_until > tick {
                        final_pos = before;
                        final_next = before_next;
                        cleared = 0;
                        used = 0.0;
                        let name = o.name.clone();
                        let d = &mut w.divisions[i];
                        if d.state != State::March(MarchSub::Jam) && d.state != State::Remnant {
                            journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: мост «{}» занят другой колонной", d.state.label(), State::March(MarchSub::Jam).label(), name) });
                            d.state = State::March(MarchSub::Jam);
                            d.state_since = tick;
                        }
                    } else {
                        let d = &w.divisions[i];
                        let v = r.march_kmh[d.params.mobility as usize];
                        let hold = (r.size(&r.column_km, d.params.size) / v).ceil() as u32;
                        let o = &mut w.objects[obj as usize];
                        o.busy_until = tick + hold.max(1);
                        o.control = Some(d.side);
                    }
                }
            }
            let d = &mut w.divisions[i];
            d.vars.pos = final_pos;
            d.vars.march_h_today += used;
            d.vars.march_h_log[slot] = used;
            let code = side_code(d.side);
            let mut passed: Vec<usize> = Vec::new();
            if let Some(rt) = d.route.as_mut() {
                passed = rt.cells[rt.next.saturating_sub(1).min(final_next)..final_next.min(rt.cells.len())].iter().map(|&c| c as usize).collect();
                rt.next = final_next; rt.crossing_left_h = m.crossing_left_h; rt.cleared = cleared;
            }
            // пройденные за час клетки маршрута с соседними — её стороны (как клетка, где она стоит): за колонной не
            // остаётся немецкой разметки, и идущие следом не замедляются темпом по территории противника
            for c in passed {
                if let Some(x) = w.control.get_mut(c) { *x = code; }
                for k in 0..8 { if let Some(nb) = self.theatre.neighbor(c, k) { w.control[nb] = code; } }
            }
        }
        // отступление
        for (i, it) in intents.iter().enumerate() {
            if let Some(p) = it.retreat_to { w.divisions[i].vars.pos = p; }
        }
        // бои: по обороняющимся, в порядке индексов (нормативы дивизионного уровня — rules.combat, docs/plans/agents.md, 10в)
        // распределение по участкам: наступающие по удалению от противника (ближние первыми) занимают участки на полосе
        // ближайшей досягаемой обороняющейся дивизии, где осталось место; кому места нет — ждёт во втором эшелоне
        let t = &*self.theatre;
        let c = &r.combat;
        let mut order: Vec<(f64, u32)> = intents.iter().enumerate().filter(|(_, it)| it.attacks.is_some()).map(|(i, it)| (it.options.first().map_or(f64::MAX, |o| o.1), i as u32)).collect();
        order.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let mut free: BTreeMap<u32, f64> = BTreeMap::new();
        let mut battles: BTreeMap<u32, Vec<u32>> = BTreeMap::new();
        let mut waiting: Vec<u32> = Vec::new();
        for (_, a) in order {
            let f = c.attack_frontage_km(&w.divisions[a as usize]);
            let pick = intents[a as usize].options.iter().map(|o| o.0).find(|&j| {
                let dj = &w.divisions[j as usize];
                if dj.state.out() { return false; }
                let left = *free.entry(j).or_insert_with(|| c.defense_frontage_km(dj));
                left + 1e-9 >= f || !battles.contains_key(&j)
            });
            match pick {
                Some(j) => { *free.get_mut(&j).unwrap() -= f; battles.entry(j).or_default().push(a); }
                None => waiting.push(a),
            }
        }
        // сила в бою для поправки на размер (QJM): по полосе одной обороняющейся дивизии или по армии целиком
        let div_army: Vec<usize> = if c.size_by_army {
            let army_of = |mut h: usize| { for _ in 0..8 { if w.hqs[h].echelon == Echelon::Army { return h; } match w.hqs[h].parent { Some(p) => h = p as usize, None => return h } } h };
            w.divisions.iter().map(|d| army_of(d.hq as usize)).collect()
        } else { Vec::new() };
        let mut army_people: BTreeMap<usize, f64> = BTreeMap::new();
        if c.size_by_army {
            for (&def, atts) in &battles {
                *army_people.entry(div_army[def as usize]).or_default() += w.divisions[def as usize].vars.personnel;
                for &a in atts { *army_people.entry(div_army[a as usize]).or_default() += w.divisions[a as usize].vars.personnel; }
            }
        }
        let size_people = |i: u32, own: f64| if c.size_by_army { army_people.get(&div_army[i as usize]).copied().unwrap_or(own) } else { own };
        for (&def, atts) in &battles { w.engaged[def as usize] = true; for &a in atts { w.engaged[a as usize] = true; } }
        // темп боя на полосе каждой обороняющейся дивизии, км за час — за ним идут ожидающие второго эшелона
        let mut battle_pace: BTreeMap<u32, f64> = BTreeMap::new();
        for (def, atts) in battles {
            let dd = &w.divisions[def as usize];
            let dpos = dd.vars.pos;
            let def_front = c.defense_frontage_km(dd);
            let att_power: f64 = atts.iter().map(|&a| self.strength(&w.divisions[a as usize])).sum();
            let cell = t.cell_of_xy(dpos).unwrap_or(0);
            let terrain = t.terrain[cell] as usize;
            // поза обороны: укреплённая — своя полоса 2-го уровня и выше; подготовленная — полоса 1-го уровня или
            // подготовленная оборона; иначе — поспешная
            let side_code = match dd.side { Side::Su => "su", Side::De => "de" };
            let fort_lv = if t.fort_side[cell].as_deref() == Some(side_code) { t.fort[cell] as usize } else { 0 };
            let posture = if fort_lv >= 2 { 2 } else if fort_lv == 1 || dd.state == State::Defense(DefenseSub::Prepared) { 1 } else { 0 };
            let def_power = (self.strength(dd) * r.defense_terrain[terrain]).max(1e-6);
            let ratio = att_power / def_power;
            let mut rng = Rng::new(self.seed, def, tick, Stream::Combat);
            let noise = rng.jitter(r.noise);
            // темп, км/сут: стандартные темпы Дюпюи по позе обороны; танковым — поправка по танковой таблице
            let tracked: f64 = atts.iter().filter(|&&a| w.divisions[a as usize].params.mobility != Mobility::Foot).map(|&a| self.strength(&w.divisions[a as usize])).sum();
            let armor = if tracked > 0.5 * att_power { c.armor_factor } else { 1.0 };
            let mut adv_day = c.advance[posture].step(ratio) * armor * r.advance_terrain[terrain] * noise;
            // в городе — кварталами: темп не выше городской нормы по обводу (docs/plans/agents.md, 10р)
            let city = t.city[cell] as usize;
            if city > 0 { adv_day = adv_day.min(c.urban_km_day[city.min(3) - 1] * noise); }
            // потери, доля в сутки: база QJM с поправкой на размер; обороне — до нормы прорыва по мере продвижения
            // против подготовленной и укреплённой обороны наступающий теряет больше (калибровка — docs/plans/agents.md, 10п)
            let a_post = if posture >= 1 { c.attacker_loss_prepared } else { 1.0 };
            // перевес: потери наступающего падают с ним (attacker_ratio_exp; 0 — не зависят)
            let a_ratio = if c.attacker_ratio_exp > 0.0 { ratio.max(0.25).powf(-c.attacker_ratio_exp) } else { 1.0 };
            let a_day = (c.attacker_loss_day * c.size_factor(size_people(atts[0], att_power_people(w, &atts))) * a_post * a_ratio * noise).min(c.attacker_loss_max_day * a_post);
            let d_base = c.defender_loss_day * c.size_factor(size_people(def, dd.vars.personnel));
            let d_rate = d_base + (c.defender_loss_penetration_day - d_base).max(0.0) * (adv_day / c.penetration_km_day).min(1.0);
            // перевес наступающего на полосе: потери обороны растут с ним (калибровка — docs/plans/agents.md, 10и)
            let d_ratio = (ratio / c.defender_ratio_ref).max(1.0).powf(c.defender_ratio_exp);
            let d_day = (d_rate * d_ratio).min(c.defender_loss_cap_day) * noise;
            let (a_loss, d_loss, adv_km) = (a_day / 24.0, d_day / 24.0, adv_day / 24.0);
            battle_pace.insert(def, adv_km);
            let hold = matches!(dd.order.as_ref().map(|o| o.kind), Some(OrderKind::Hold));
            let att_center = {
                let n = atts.len() as f64;
                let (sx, sy) = atts.iter().fold((0.0, 0.0), |(x, y), &a| { let p = w.divisions[a as usize].vars.pos; (x + p.x, y + p.y) });
                XY::new(sx / n, sy / n)
            };
            {
                let d = &mut w.divisions[def as usize];
                lose(d, d_loss, r.cohesion_loss_factor, c);
                if adv_km > 0.0 && !hold {
                    let p = d.vars.pos;
                    let away = XY::new(p.x + (p.x - att_center.x), p.y + (p.y - att_center.y));
                    d.vars.pos = p.toward(away, adv_km);
                    d.vars.prepared_h = 0.0;
                }
            }
            for &a in &atts {
                let d = &mut w.divisions[a as usize];
                if d.state == State::Attack(AttackSub::Echelon) {
                    journal.push(Event { tick, agent: a, text: format!("{} → {}: участок освободился, вступает в бой", d.state.label(), State::Attack(AttackSub::Assault).label()) });
                    d.state = State::Attack(AttackSub::Assault);
                }
                lose(d, a_loss, r.cohesion_loss_factor, c);
                if adv_km > 0.0 {
                    let target = d.order.as_ref().map(|o| o.target).unwrap_or(d.vars.pos);
                    d.vars.pos = d.vars.pos.toward(target, adv_km);
                }
            }
            if tick % 6 == 0 {
                const POSTURE: [&str; 3] = ["поспешная", "подготовленная", "укреплённая"];
                journal.push(Event { tick, agent: def, text: format!("бой: {} наступающих на полосе {:.0} км, соотношение {:.1}:1, оборона {}; за сутки темп {:.1} км, потери обороны {:.1} %, наступающих {:.1} %",
                    atts.len(), def_front, ratio, POSTURE[posture], adv_day, d_day * 100.0, a_day * 100.0) });
            }
        }
        // ожидающие участка: в бой не вступают и потерь не несут, но идут за первым эшелоном с темпом боя на своём
        // направлении (второй эшелон следует за первым, а не стоит на исходном рубеже)
        for a in waiting {
            let pace = intents[a as usize].options.iter().find_map(|o| battle_pace.get(&o.0).copied()).unwrap_or(0.0);
            let d = &mut w.divisions[a as usize];
            if pace > 0.0 {
                let target = d.order.as_ref().map(|o| o.target).unwrap_or(d.vars.pos);
                d.vars.pos = d.vars.pos.toward(target, pace);
            }
            if !matches!(d.state, State::Deploy { .. }) && d.state != State::Attack(AttackSub::Depth) {
                if d.state != State::Attack(AttackSub::Echelon) {
                    journal.push(Event { tick, agent: a, text: format!("{} → {}: участок прорыва занят, ждёт во втором эшелоне", d.state.label(), State::Attack(AttackSub::Echelon).label()) });
                }
                d.state = State::Attack(AttackSub::Echelon);
            }
        }
        // расход по действию
        for (i, it) in intents.iter().enumerate() {
            let d = &mut w.divisions[i];
            if d.state.out() { continue; }
            let act = it.activity.unwrap_or(Activity::Reserve);
            let sr = r.side(d.side);
            let (ammo, fuel) = sr.consumption[act as usize];
            d.vars.ammo = (d.vars.ammo - ammo / 24.0).max(0.0);
            if d.params.mobility != Mobility::Foot { d.vars.fuel = (d.vars.fuel - fuel / 24.0).max(0.0); }
            let (gc, gm, gr) = r.fatigue_gain;
            d.vars.fatigue = match act {
                Activity::Attack | Activity::Defend if it.attacks.is_some() => d.vars.fatigue + gc / 24.0,
                Activity::March | Activity::Withdraw => d.vars.fatigue + gm / 24.0,
                _ => d.vars.fatigue - gr / 24.0,
            }.clamp(0.0, 1.0);
            if matches!(d.state, State::Defense(_)) { d.vars.prepared_h += 1.0; } else if !matches!(d.state, State::Deploy { .. }) { d.vars.prepared_h = 0.0; }
        }
    }

    /// Остатки разгромленных дивизий (правила — agents-v0.json, раздел remnants; источники —
    /// docs/sources/division-remnants-1945.json). Немецкая дивизия ниже доли исходной численности разгромлена: выходит
    /// из боя в тыл, а через сутки остатки сводятся в ближайшую свою дивизию корпуса (иначе армии) — люди и часть
    /// техники переходят к ней, агент выбывает. Советская дивизия ниже порога численности выводится в резерв армии и
    /// в пределах операции не сводится.
    fn apply_remnants(&self, w: &mut World, journal: &mut Vec<Event>) {
        let rr = &self.rules.remnants;
        let tick = w.tick;
        for i in 0..w.divisions.len() {
            let d = &w.divisions[i];
            if d.state.out() || d.state == State::Remnant { continue; }
            let share = d.vars.personnel / d.vars.personnel0.max(1.0);
            let why = match d.side {
                Side::De if share < rr.de_share => format!("численность {:.0} % исходной — дивизия разгромлена, остатки выходят из боя", 100.0 * share),
                // порог — по стрелковым дивизиям (источники); бригады и корпуса меньше его с начала операции
                Side::Su if d.params.kind == "sd" && d.vars.personnel < rr.su_personnel => format!("численность меньше {:.0} человек — выводится из боя в резерв армии", rr.su_personnel),
                _ => continue,
            };
            let target = self.behind(w, i, rr.rear_km);
            let d = &mut w.divisions[i];
            journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: {why}", d.state.label(), State::Remnant.label()) });
            d.state = State::Remnant;
            d.state_since = tick;
            d.order = Some(Order { kind: OrderKind::Withdraw, target, forced: true, issued: tick, arrives: tick, from: d.hq, note: "выход остатков из боя".into() });
            d.route = None;
        }
        // сведение немецких остатков в соседнюю дивизию
        for i in 0..w.divisions.len() {
            let d = &w.divisions[i];
            if d.side != Side::De || d.state != State::Remnant || ((tick - d.state_since) as f64) < rr.de_consolidate_hours { continue; }
            let army = |h: u32| { let mut k = h as usize; while w.hqs[k].echelon == Echelon::Corps { match w.hqs[k].parent { Some(p) => k = p as usize, None => break } } k };
            let pick = |same: &dyn Fn(&Division) -> bool| w.divisions.iter().enumerate()
                .filter(|(j, e)| *j != i && e.side == d.side && !e.state.out() && e.state != State::Remnant && same(e))
                .map(|(j, e)| (j, e.vars.pos.dist(d.vars.pos)))
                .filter(|x| x.1 <= rr.de_search_km)
                .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
            let Some((j, _)) = pick(&|e| e.hq == d.hq).or_else(|| pick(&|e| army(e.hq) == army(d.hq))) else { continue };
            let (p, t, g) = (d.vars.personnel * rr.de_personnel_share, d.vars.tanks * rr.de_heavy_share, d.vars.guns * rr.de_heavy_share);
            let (from, into) = (d.name.clone(), w.divisions[j].name.clone());
            let e = &mut w.divisions[j];
            e.vars.personnel += p;
            e.vars.tanks += t;
            e.vars.guns += g;
            journal.push(Event { tick, agent: j as u32, text: format!("приняла остатки «{from}»: {:.0} человек, танков {:.0}, орудий {:.0}", p, t, g) });
            let d = &mut w.divisions[i];
            journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: остатки сведены в «{into}» ({:.0} человек, танков {:.0}, орудий {:.0}; остальное — отставшие и брошенная техника)", d.state.label(), State::Merged.label(), p, t, g) });
            d.note = if d.note.is_empty() { format!("сведена в «{into}»") } else { format!("{}; сведена в «{into}»", d.note) };
            d.state = State::Merged;
            d.state_since = tick;
            d.vars.personnel = 0.0;
            d.vars.tanks = 0.0;
            d.vars.guns = 0.0;
            d.order = None;
        }
    }

    fn apply(&self, w: &mut World, journal: &mut Vec<Event>) {
        let r = &self.rules;
        let tick = w.tick;
        let day_start = self.hour().rem_euclid(24) == 6;
        let in_battle: Vec<bool> = w.divisions.iter().map(|d| matches!(d.state, State::Attack(_))).collect();
        for (i, d) in w.divisions.iter_mut().enumerate() {
            if d.state.out() { continue; }
            let sr = r.side(d.side);
            // окружённым подвоза нет; гарнизон крепости живёт со складов (на 30 суток боя — дольше сценария)
            let supplied = d.params.kind == "garrison" || !d.cut_since.is_some_and(|s| tick.saturating_sub(s) as f64 >= r.pocket.encircle_hours);
            if supplied {
                // распоряжения тыла (игра): база далеко — меньше, приоритет — больше; без распоряжений — 1
                let k = self.staff.supply.get(&(i as u32)).copied().unwrap_or(1.0);
                d.vars.ammo = (d.vars.ammo + k * sr.ammo_per_day / 24.0).min(sr.max_ammo);
                if d.params.mobility != Mobility::Foot { d.vars.fuel = (d.vars.fuel + k * sr.fuel_per_day / 24.0).min(sr.max_fuel); }
            }
            if !in_battle[i] { d.vars.cohesion = (d.vars.cohesion + r.cohesion_recover).min(1.0); }
            if day_start { d.vars.march_h_today = 0.0; }
            if d.vars.personnel < r.destroyed_personnel {
                journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: численность меньше {} человек — дивизия рассеяна", d.state.label(), State::Destroyed.label(), r.destroyed_personnel) });
                d.state = State::Destroyed;
                d.state_since = tick;
            }
        }
        self.apply_remnants(w, journal);
        // территория: клетка дивизии и соседние становятся её стороны
        let t = &*self.theatre;
        for d in w.divisions.iter().filter(|d| !d.state.out()) {
            let Some(c) = t.cell_of_xy(d.vars.pos) else { continue };
            let code = side_code(d.side);
            if let Some(x) = w.control.get_mut(c) { *x = code; }
            for k in 0..8 { if let Some(nb) = t.neighbor(c, k) { w.control[nb] = code; } }
        }
        self.apply_pockets(w, journal);
        self.consolidate(w);
        self.apply_breakout_losses(w);
        // потери в соприкосновении без боя: огонь, мины, поиски (contact_loss_day; 0 — нет)
        if r.combat.contact_loss_day > 0.0 {
            let reach = r.contact_km;
            let hit: Vec<usize> = (0..w.divisions.len()).filter(|&i| {
                let d = &w.divisions[i];
                !d.state.out() && d.state != State::Remnant && !w.engaged.get(i).copied().unwrap_or(false)
                    && w.divisions.iter().any(|e| e.side != d.side && !e.state.out() && e.state != State::Remnant && e.vars.pos.dist(d.vars.pos) <= reach)
            }).collect();
            for i in hit { lose(&mut w.divisions[i], r.combat.contact_loss_day / 24.0, 1.0, &r.combat); }
        }
        // объекты: чей район — по ближайшей дивизии в 2 км (параллельно, только чтение)
        let index = Index::build(w.divisions.iter().enumerate().filter(|(_, d)| !d.state.out()).map(|(i, d)| (i as u32, d.vars.pos)), 5.0);
        let divs = &w.divisions;
        let control: Vec<Option<Side>> = w.objects.par_iter().map(|o| {
            index.near(o.pos, 2.0).into_iter()
                .map(|j| (j, divs[j as usize].vars.pos.dist(o.pos)))
                .filter(|&(_, k)| k <= 2.0)
                .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
                .map(|(j, _)| divs[j as usize].side)
                .or(o.control)
        }).collect();
        for (o, c) in w.objects.iter_mut().zip(control) { o.control = c; }
    }

    /// Закрепление земли за своим фронтом (как в нынешней модели, docs/system.md, «Территория — сплошная полоса»):
    /// клетка противника становится своей, если его войск нет ближе pocket.hold_km (там его территорию не держат), а
    /// своя земля — со всех четырёх сторон в пределах CONSOLIDATE_REACH_KM: полосы между коридорами своих армий — свой
    /// тыл, и идущие следом не ползут по ним темпом наступления. Со всех четырёх, а не с трёх, как в нынешней модели:
    /// клетки перед головой колонны между соседними корпусами иначе закреплялись бы раньше, чем она до них дошла.
    /// Обойдённые узлы, где войска противника есть, остаются его.
    fn consolidate(&self, w: &mut World) {
        let t = &*self.theatre;
        let n = w.control.len();
        if n == 0 || w.held[0].len() != n || w.held[1].len() != n { return; }
        let cell = if t.centers.len() > 1 { t.centers[0].dist(t.centers[1]).max(0.1) } else { 1.0 };
        let reach = (CONSOLIDATE_REACH_KM / cell).round().max(1.0) as i64;
        for _ in 0..3 {
            let flips: Vec<(usize, u8)> = (0..n).into_par_iter().filter_map(|i| {
                let o = w.control[i];
                if o == 0 { return None; }
                let own = if o == 1 { 2 } else { 1 };
                // войска владельца ближе hold_km — его территорию держат
                if w.held[(o - 1) as usize][i] { return None; }
                let (c0, r0) = ((i % t.cols) as i64, (i / t.cols) as i64);
                let all = [(1, 0), (-1, 0), (0, 1), (0, -1)].iter().all(|&(dc, dr)| (1..=reach).any(|k| {
                    let (cc, rr) = (c0 + dc * k, r0 + dr * k);
                    cc >= 0 && rr >= 0 && cc < t.cols as i64 && rr < t.rows as i64 && w.control[rr as usize * t.cols + cc as usize] == own
                }));
                all.then_some((i, own))
            }).collect();
            if flips.is_empty() { break; }
            for (i, s) in flips { w.control[i] = s; }
        }
    }

    /// Изменения по датам на шаге `tick`. Пополнение — к текущим силам и к начальным (personnel0, strength0 — на силу
    /// прибавки), чтобы доли от начальных оставались осмысленными; не введённой дивизии — откладывается до ввода.
    /// Переподчинение дивизии меняет её штаб, штаба — его вышестоящий штаб; новый штаб должен существовать, быть своей
    /// стороны, не совпадать с переподчиняемым и не быть его подчинённым (цикл). Иначе — запись «изменение пропущено».
    fn apply_changes(&mut self, w: &mut World, tick: u32, journal: &mut Vec<Event>) {
        if self.changes.first().map_or(true, |c| c.at > tick) { return; }
        let mut keep = Vec::new();
        for c in std::mem::take(&mut self.changes) {
            if c.at > tick { keep.push(c); continue; }
            let div = w.divisions.iter().position(|d| d.id == c.formation);
            let hq = w.hqs.iter().position(|h| h.id == c.formation);
            let agent = div.map_or(u32::MAX, |i| i as u32);
            let mut skip = |why: String| journal.push(Event { tick, agent, text: format!("изменение пропущено: {why}") });
            match c.kind {
                ChangeKind::Reinforce => {
                    let Some(i) = div else { skip(format!("пополнение {} — нет такой дивизии", c.formation)); continue };
                    let d = &mut w.divisions[i];
                    if d.state == State::Pending { keep.push(c); continue; }
                    if matches!(d.state, State::Destroyed | State::Merged) { skip(format!("пополнение «{}» — дивизия выбыла, пополнять нечего", d.name)); continue; }
                    let (p, t, g) = (c.personnel.max(0.0), c.tanks.max(0.0), c.guns.max(0.0));
                    let (wp, wt, wg) = self.rules.side(d.side).weights;
                    d.vars.personnel += p;
                    d.vars.tanks += t;
                    d.vars.guns += g;
                    d.vars.personnel0 += p;
                    d.vars.strength0 += (p / 1000.0 * wp + t * wt + g * wg) * d.params.quality;
                    let mut text = format!("пополнение +{p:.0} чел.");
                    if t > 0.0 { text += &format!(", танков +{t:.0}"); }
                    if g > 0.0 { text += &format!(", орудий +{g:.0}"); }
                    journal.push(Event { tick, agent, text });
                }
                ChangeKind::Resubordinate => {
                    let Some(pid) = c.parent.as_deref() else { skip(format!("переподчинение {} — не указан новый штаб", c.formation)); continue };
                    if pid == c.formation { skip(format!("переподчинение {} самому себе", c.formation)); continue; }
                    let Some(p) = w.hqs.iter().position(|h| h.id == pid) else { skip(format!("переподчинение {} — нет штаба {pid}", c.formation)); continue };
                    let (side, name) = (w.hqs[p].side, w.hqs[p].name.clone());
                    if let Some(i) = div {
                        if w.divisions[i].side != side { skip(format!("переподчинение {} — штаб {pid} другой стороны", c.formation)); continue; }
                        w.divisions[i].hq = p as u32;
                        journal.push(Event { tick, agent, text: format!("переподчинение → {name}") });
                    } else if let Some(h) = hq {
                        if w.hqs[h].side != side { skip(format!("переподчинение {} — штаб {pid} другой стороны", c.formation)); continue; }
                        // новый вышестоящий — в подчинении переподчиняемого: цикл
                        let mut up = Some(p);
                        let mut cycle = false;
                        for _ in 0..=w.hqs.len() {
                            match up { Some(x) if x == h => { cycle = true; break } Some(x) => up = w.hqs[x].parent.map(|q| q as usize), None => break }
                        }
                        if cycle { skip(format!("{pid} — в подчинении самого {}: переподчинение образовало бы цикл", c.formation)); continue; }
                        w.hqs[h].parent = Some(p as u32);
                        journal.push(Event { tick, agent: u32::MAX, text: format!("{}: переподчинение → {name}", w.hqs[h].name) });
                    } else {
                        skip(format!("переподчинение {} — нет такой дивизии или штаба", c.formation));
                    }
                }
            }
        }
        self.changes = keep;
    }

    fn apply_withdrawals(&self, w: &mut World, tick: u32, journal: &mut Vec<Event>) {
        for ev in self.withdrawals.iter().filter(|e| e.at == tick) {
            for &d in &ev.to {
                let div = &mut w.divisions[d as usize];
                div.vars.positions = Some(ev.positions);
                journal.push(Event { tick, agent: d, text: format!("войска отведены с первой позиции: на позициях {:.0} / {:.0} / {:.0} % — {}", ev.positions[0] * 100.0, ev.positions[1] * 100.0, ev.positions[2] * 100.0, ev.note) });
            }
        }
    }

    /// Артподготовка: по каждой дивизии противника на полосе армии (в пределах досягаемости её дивизий) потери —
    /// сумма по позициям «доля войск × потери от огня по позиции» (Радзиевский), в доле от нормы по плотности и
    /// длительности; организованность падает так же, как в бою. Артподготовки одного часа разбираются вместе:
    /// полосу дивизии противника обрабатывает одна армия — та, чьи дивизии к ней ближе всего.
    fn apply_fires(&self, w: &mut World, tick: u32, journal: &mut Vec<Event>) {
        let a = &self.rules.combat.artillery;
        let now: Vec<&ScriptFire> = self.fires.iter().filter(|f| f.at == tick).collect();
        if now.is_empty() { return; }
        let reach = self.rules.contact_km + a.depth_km;
        // цель → (огонь, расстояние до ближайшей дивизии стреляющей армии)
        let mut pick: BTreeMap<usize, (usize, f64)> = BTreeMap::new();
        for (fi, f) in now.iter().enumerate() {
            let own: Vec<usize> = (0..w.divisions.len()).filter(|&i| w.divisions[i].hq == f.hq && !w.divisions[i].state.out()).collect();
            let Some(&first) = own.first() else { continue };
            let side = w.divisions[first].side;
            for j in 0..w.divisions.len() {
                let e = &w.divisions[j];
                if e.side == side || e.state.out() { continue; }
                let dmin = own.iter().map(|&i| w.divisions[i].vars.pos.dist(e.vars.pos)).fold(f64::INFINITY, f64::min);
                if dmin > reach { continue; }
                let better = pick.get(&j).map_or(true, |&(_, d0)| dmin < d0 - 1e-9);
                if better { pick.insert(j, (fi, dmin)); }
            }
        }
        let mut parts: Vec<Vec<String>> = vec![Vec::new(); now.len()];
        for (&j, &(fi, _)) in &pick {
            let f = now[fi];
            let k = (f.density_per_km / a.norm_density).min(1.0) * (f.duration_min / a.norm_duration_min).min(1.0);
            let d = &mut w.divisions[j];
            let pos = d.vars.positions.unwrap_or(a.positions);
            let loss = (0..3).map(|p| pos[p] * a.loss_by_position[p]).sum::<f64>() * k;
            lose(d, loss, a.cohesion_factor, &self.rules.combat);
            parts[fi].push(format!("{} — {:.1} %", d.name, loss * 100.0));
            journal.push(Event { tick, agent: j as u32, text: format!("под артподготовкой ({}, {:.0} ств./км, {:.0} мин): потери {:.1} %{}", w.hqs[f.hq as usize].name, f.density_per_km, f.duration_min, loss * 100.0,
                if d.vars.positions.is_some() { ", первая позиция отведена" } else { "" }) });
        }
        for (fi, f) in now.iter().enumerate() {
            let k = (f.density_per_km / a.norm_density).min(1.0) * (f.duration_min / a.norm_duration_min).min(1.0);
            let hq = w.hqs[f.hq as usize].name.clone();
            journal.push(Event { tick, agent: u32::MAX, text: format!("артподготовка: {hq}, {:.0} ств./км, {:.0} мин (доля нормы {:.2}); {}. {}", f.density_per_km, f.duration_min, k,
                if parts[fi].is_empty() { "противника на полосе нет".to_string() } else { parts[fi].join(", ") }, f.note) });
        }
    }

    /// Свёртка состояния для проверки воспроизводимости.
    pub fn digest(&self) -> u64 {
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        let mut eat = |x: u64| { h ^= x; h = h.wrapping_mul(0x0100_0000_01b3); };
        for d in &self.world.divisions {
            let v = &d.vars;
            for x in [v.personnel, v.tanks, v.guns, v.ammo, v.fuel, v.fatigue, v.cohesion, v.pos.x, v.pos.y] { eat(x.to_bits()); }
            eat(d.state_since as u64);
            eat(d.state.label().len() as u64);
        }
        for o in &self.world.objects { eat(o.busy_until as u64); eat(o.control.map_or(0, |s| s as u64 + 1)); }
        eat(self.journal.len() as u64);
        h
    }
}

/// Численность наступающих, для поправки на размер (QJM).
fn att_power_people(w: &World, atts: &[u32]) -> f64 { atts.iter().map(|&a| w.divisions[a as usize].vars.personnel).sum() }

pub(crate) fn lose(d: &mut Division, frac: f64, cohesion_factor: f64, c: &crate::rules::Combat) {
    d.vars.personnel *= 1.0 - frac;
    d.vars.tanks *= 1.0 - (frac * c.tank_loss_factor).min(1.0);
    d.vars.guns *= 1.0 - (frac * c.gun_loss_factor).min(1.0);
    d.vars.cohesion = (d.vars.cohesion - frac * cohesion_factor).max(0.0);
}
