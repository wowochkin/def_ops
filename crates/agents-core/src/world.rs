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
}

/// Радиус начальной разметки территории вокруг войск, км.
pub const CONTROL_INIT_KM: f64 = 40.0;

#[inline]
pub fn side_code(s: Side) -> u8 { match s { Side::Su => 1, Side::De => 2 } }

impl World {
    /// Начальная разметка территории: клетка принадлежит стороне ближайшей дивизии (не дальше CONTROL_INIT_KM).
    pub fn init_control(&mut self, t: &Theatre) {
        let pts: Vec<(XY, u8)> = self.divisions.iter().map(|d| (d.vars.pos, side_code(d.side))).collect();
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
    /// Источник решений штабов: [советская сторона, немецкая].
    pub sources: [crate::staff::Source; 2],
    /// Направления «в тыл» дивизий по исходной обстановке (для штабов по доктрине).
    pub rear_dir: std::sync::OnceLock<Vec<(XY, f64)>>,
    pub journal: Vec<Event>,
    /// Снимки по шагам для перемотки (если включено).
    pub history: Option<Vec<World>>,
}

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
        let mut s = Sim { theatre, rules, seed, start_hour, world, script, fires: Vec::new(), withdrawals: Vec::new(), sources: [crate::staff::Source::Script; 2], rear_dir: std::sync::OnceLock::new(), journal: Vec::new(), history: None };
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

    fn bridge_open(&self, w: &World, b: u16) -> bool {
        w.objects.iter().find(|o| o.bridge == Some(b)).map_or(true, |o| o.intact)
    }

    /// Один шаг (1 час).
    pub fn step(&mut self) {
        if let Some(h) = self.history.as_mut() { h.push(self.world.clone()); }
        let tick = self.world.tick;
        let mut next = self.world.clone();
        let mut journal = Vec::new();

        // 0. Приказы: штабы отдают по сценарию или решают по доктрине (staff.rs); до дивизий приказы доходят с задержкой
        // своего уровня. У стороны со штабами по доктрине приказы сценария не действуют.
        let mut due: Vec<ScriptOrder> = Vec::new();
        while let Some(o) = self.script.first() {
            if o.at > tick { break; }
            let o = self.script.remove(0);
            if self.sources[crate::staff::side_idx(next.hqs[o.hq as usize].side)] == crate::staff::Source::Script { due.push(o); }
        }
        let (doc_orders, doc_journal) = self.doctrine_orders(&next, tick);
        due.extend(doc_orders);
        journal.extend(doc_journal);
        for o in due {
            let hq = &next.hqs[o.hq as usize];
            let sr = self.rules.side(hq.side);
            let delay = match hq.echelon { Echelon::Front => sr.delay_army, Echelon::Army => sr.delay_corps, Echelon::Corps => sr.delay_division };
            for &d in &o.to {
                let target = o.target.unwrap_or(next.divisions[d as usize].vars.pos);
                let order = Order { kind: o.kind, target, forced: o.forced, issued: o.at, arrives: o.at + delay.round() as u32, from: o.hq, note: o.note.clone() };
                next.in_transit.push((d, order));
            }
        }
        let mut arrived = Vec::new();
        next.in_transit.retain(|(d, o)| if o.arrives <= tick { arrived.push((*d, o.clone())); false } else { true });
        for (d, o) in arrived {
            let div = &mut next.divisions[d as usize];
            if div.state == State::Destroyed { continue; }
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
            if let Some(b) = ob.bridge { ob.intact = self.theatre.bridges[b as usize].open_at(hour); }
        }

        // 1. Решения — параллельно по снимку `next` (после доставки приказов).
        let index = Index::build(next.divisions.iter().enumerate().filter(|(_, d)| d.state != State::Destroyed).map(|(i, d)| (i as u32, d.vars.pos)), 5.0);
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

    fn night(&self) -> bool { let h = self.hour().rem_euclid(24); !(5..21).contains(&h) }

    fn decide(&self, w: &World, index: &Index, i: u32) -> Intent {
        let d = &w.divisions[i as usize];
        let mut out = Intent::default();
        if d.state == State::Destroyed { return out; }
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
                    if self.strength(d) / s0 < 1.0 - r.combat.breakpoint_loss {
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
        let goal = t.land_cell_near(target);
        let mut route = d.route.clone();
        let need = match (&route, goal) {
            (Some(rt), Some(g)) => rt.cells.last().map(|&c| c as usize) != Some(g),
            (None, Some(_)) => true,
            _ => false,
        };
        if need {
            let (Some(from), Some(g)) = (t.land_cell_near(d.vars.pos), goal) else { return };
            match route::find(t, r, d.side, d.params.mobility, from, g, &bopen) {
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
                    Some(_) => { out.route = Some(None); out.state = Some((State::March(MarchSub::Halt), "мост на маршруте разрушен, ищет новый путь".into())); break; }
                    None if d.params.mobility == Mobility::Foot => {
                        rt.crossing_left_h = r.river_cross_hours;
                        rt.cleared = rt.next;
                        sub = MarchSub::Crossing;
                        let used = rt.crossing_left_h.min(left);
                        rt.crossing_left_h -= used;
                        left -= used;
                        if rt.crossing_left_h > 0.0 { break; }
                    }
                    None => { out.route = Some(None); break; }
                }
            }
            let road = t.road[c].min(t.road[nb]);
            if road == 0 && sub == MarchSub::Road { sub = MarchSub::OffRoad; }
            let mut v = r.speed_kmh(d.side, d.params.mobility, road, t.terrain[nb], night);
            // по территории противника — не марш, а наступление в глубине: темп не выше нормы за сутки
            // (за часы марша в сутки, поэтому за сутки выходит не больше нормы)
            if w.control.get(nb).copied() == Some(side_code(d.side.enemy())) {
                v = v.min(r.enemy_territory_km_day[d.params.mobility as usize] / hours_limit);
                if sub != MarchSub::Crossing { sub = MarchSub::OffRoad; }
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
        if out.state.is_none() {
            let s = State::March(sub);
            if s != d.state { out.state = Some((s, if matches!(d.state, State::March(_)) { String::new() } else { "выступила маршем".into() })); }
        }
        out.moved = Some(Moved { pos, next: rt.next, used_h, crossing_left_h: rt.crossing_left_h, cleared: rt.cleared });
    }

    fn resolve(&self, w: &mut World, intents: Vec<Intent>, journal: &mut Vec<Event>) {
        let tick = w.tick;
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
                        if d.state != State::March(MarchSub::Jam) {
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
            if let Some(rt) = d.route.as_mut() { rt.next = final_next; rt.crossing_left_h = m.crossing_left_h; rt.cleared = cleared; }
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
                if dj.state == State::Destroyed { return false; }
                let left = *free.entry(j).or_insert_with(|| c.defense_frontage_km(dj));
                left + 1e-9 >= f || !battles.contains_key(&j)
            });
            match pick {
                Some(j) => { *free.get_mut(&j).unwrap() -= f; battles.entry(j).or_default().push(a); }
                None => waiting.push(a),
            }
        }
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
            let adv_day = c.advance[posture].step(ratio) * armor * r.advance_terrain[terrain] * noise;
            // потери, доля в сутки: база QJM с поправкой на размер; обороне — до нормы прорыва по мере продвижения
            let a_day = (c.attacker_loss_day * c.size_factor(att_power_people(w, &atts)) * noise).min(c.attacker_loss_max_day);
            let d_base = c.defender_loss_day * c.size_factor(dd.vars.personnel);
            let d_day = (d_base + (c.defender_loss_penetration_day - d_base).max(0.0) * (adv_day / c.penetration_km_day).min(1.0)) * noise;
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
            if d.state == State::Destroyed { continue; }
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

    fn apply(&self, w: &mut World, journal: &mut Vec<Event>) {
        let r = &self.rules;
        let tick = w.tick;
        let day_start = self.hour().rem_euclid(24) == 6;
        let in_battle: Vec<bool> = w.divisions.iter().map(|d| matches!(d.state, State::Attack(_))).collect();
        for (i, d) in w.divisions.iter_mut().enumerate() {
            if d.state == State::Destroyed { continue; }
            let sr = r.side(d.side);
            d.vars.ammo = (d.vars.ammo + sr.ammo_per_day / 24.0).min(sr.max_ammo);
            if d.params.mobility != Mobility::Foot { d.vars.fuel = (d.vars.fuel + sr.fuel_per_day / 24.0).min(sr.max_fuel); }
            if !in_battle[i] { d.vars.cohesion = (d.vars.cohesion + r.cohesion_recover).min(1.0); }
            if day_start { d.vars.march_h_today = 0.0; }
            if d.vars.personnel < r.destroyed_personnel {
                journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: численность меньше {} человек", d.state.label(), State::Destroyed.label(), r.destroyed_personnel) });
                d.state = State::Destroyed;
                d.state_since = tick;
            }
        }
        // территория: клетка дивизии и соседние становятся её стороны
        let t = &*self.theatre;
        for d in w.divisions.iter().filter(|d| d.state != State::Destroyed) {
            let Some(c) = t.cell_of_xy(d.vars.pos) else { continue };
            let code = side_code(d.side);
            if let Some(x) = w.control.get_mut(c) { *x = code; }
            for k in 0..8 { if let Some(nb) = t.neighbor(c, k) { w.control[nb] = code; } }
        }
        // объекты: чей район — по ближайшей дивизии в 2 км (параллельно, только чтение)
        let index = Index::build(w.divisions.iter().enumerate().filter(|(_, d)| d.state != State::Destroyed).map(|(i, d)| (i as u32, d.vars.pos)), 5.0);
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
            let own: Vec<usize> = (0..w.divisions.len()).filter(|&i| w.divisions[i].hq == f.hq && w.divisions[i].state != State::Destroyed).collect();
            let Some(&first) = own.first() else { continue };
            let side = w.divisions[first].side;
            for j in 0..w.divisions.len() {
                let e = &w.divisions[j];
                if e.side == side || e.state == State::Destroyed { continue; }
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
            lose(d, loss, self.rules.cohesion_loss_factor, &self.rules.combat);
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

fn lose(d: &mut Division, frac: f64, cohesion_factor: f64, c: &crate::rules::Combat) {
    d.vars.personnel *= 1.0 - frac;
    d.vars.tanks *= 1.0 - (frac * c.tank_loss_factor).min(1.0);
    d.vars.guns *= 1.0 - (frac * c.gun_loss_factor).min(1.0);
    d.vars.cohesion = (d.vars.cohesion - frac * cohesion_factor).max(0.0);
}
