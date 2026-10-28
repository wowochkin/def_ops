//! Проигрывание варианта «в уме»: копия мира (`Sim::fork`), в которой сила противника перед армиями приведена к
//! оценке командующего, вариант применён и пройдено несколько часов. Итог (продвижение, потери, охват) сравнивается
//! с проигрышем «продолжать по плану» и уточняет вклад варианта в мотивы. Копия командующих не включает.

use super::decide::{score, Commander, Decision, Scored};
use super::motives::narrowed;
use crate::model::Echelon;
use super::options::{Choice, Kind};
use super::picture::{dist_to_objective, divisions_of, Picture, RECON_X};
use super::profile::{Motive, Motives, Traits, Weights};
use super::MindResult;
use crate::world::Sim;

/// Сколько лучших по пользе вариантов проигрывается; при суженном обзоре — один (три стоили вдесятеро дороже счёта).
const TOP: usize = 2;
/// Доля проигрыша в уточнённом вкладе: вклад = (1 − доля)·прежний + доля·измеренный.
const BLEND: f64 = 0.5;
/// Разница продвижения с «продолжать», дающая вклад ±1, км на час проигрыша (допущение: суточный темп армии).
const ADVANCE_KM_PER_H: f64 = 1.0;
/// Разница потерь с «продолжать», дающая вклад ±1, доля силы своих дивизий (допущение).
const LOSSES_SCALE: f64 = 0.1;
/// Разница охвата с «продолжать», дающая вклад ±1, доля силы противника (допущение).
const ENCIRCLED_SCALE: f64 = 0.1;

/// Что меряется до и после проигрыша.
struct Gauge { to_objective: Option<f64>, own: f64, encircled: f64 }

fn gauge(sim: &Sim, c: &Commander, own: &[usize]) -> Gauge {
    let w = &sim.world;
    let own_s: f64 = own.iter().map(|&i| sim.material_strength(&w.divisions[i])).sum();
    let (mut all, mut cut) = (0.0, 0.0);
    let side = w.hqs[c.hq as usize].side;
    for d in w.divisions.iter().filter(|d| d.side != side && !d.state.out()) {
        let s = sim.strength(d);
        all += s;
        if d.cut_since.is_some() { cut += s; }
    }
    Gauge { to_objective: dist_to_objective(sim, c.hq), own: own_s, encircled: if all > 0.0 { cut / all } else { 0.0 } }
}

/// Сила противника в зоне разведки каждой армии — к оценке командующего (люди, танки, орудия).
fn scale_enemy(fork: &mut Sim, pic: &Picture) {
    let recon = fork.rules.contact_km * RECON_X;
    let mut done: Vec<usize> = Vec::new();
    for a in pic.armies.iter().filter(|a| a.enemy_true > 0.0) {
        let k = a.enemy_est / a.enemy_true;
        let side = fork.world.hqs[a.hq as usize].side;
        let mine: Vec<_> = divisions_of(fork, a.hq).into_iter().map(|i| fork.world.divisions[i].vars.pos).collect();
        for e in 0..fork.world.divisions.len() {
            let d = &mut fork.world.divisions[e];
            if d.side == side || d.state.out() || done.contains(&e) || !mine.iter().any(|p| p.dist(d.vars.pos) <= recon) { continue; }
            d.vars.personnel *= k;
            d.vars.tanks *= k;
            d.vars.guns *= k;
            done.push(e);
        }
    }
}

/// Вариант ничего не применяет: его проигрыш равен проигрышу «продолжать».
fn idle(k: &Kind) -> bool { matches!(k, Kind::Continue | Kind::WaitMobile | Kind::Hold | Kind::ShiftForces { .. }) }

/// Проиграть `choice` на `hours` часов вперёд.
pub fn imagine(sim: &Sim, c: &Commander, pic: &Picture, choice: &Choice, hours: u32) -> MindResult {
    let mut fork = sim.fork();
    scale_enemy(&mut fork, pic);
    let own = divisions_of(&fork, c.hq);
    let before = gauge(&fork, c, &own);
    // применение берёт решение из последнего документа командующего
    let scored = Scored { choice: choice.clone(), parts: Motives([0.0; 7]), penalty: 0.0, bonus: 0.0, total: 0.0, mind: None };
    let mut withdraw_at = c.withdraw_at.clone();
    if let Kind::Withdraw { hq } = &choice.kind {
        if !withdraw_at.iter().any(|x| x.0 == *hq) { withdraw_at = super::apply::rear_of(&fork, *hq).map(|at| (*hq, at)).into_iter().collect(); }
    }
    let tick = fork.world.tick;
    let temp = Commander {
        hq: c.hq, profile: c.profile, motives: c.motives, mood: c.mood, intent: Some(choice.kind.clone()), intent_label: Some(choice.label.clone()),
        last: tick, snapshots: Vec::new(), decisions: vec![Decision { tick, trigger: String::new(), options: vec![scored], chosen: 0, why: String::new() }],
        picture: None, seen: c.seen.clone(), withdraw_at,
    };
    let n0 = fork.command.requests.len();
    super::apply::apply(&mut fork, &temp, &choice.kind, tick);
    // командующий проигрывает исход своего варианта: поднятые запросы на отход и прорыв считаются разрешёнными
    for r in fork.command.requests[n0..].iter_mut() { r.answer = Some(true); r.answered_at = tick; }
    super::apply::execute_permitted(&mut fork, tick);
    for _ in 0..hours { fork.step(); }
    let after = gauge(&fork, c, &own);
    let advance_km = match (before.to_objective, after.to_objective) { (Some(a), Some(b)) => a - b, _ => 0.0 };
    let losses = if before.own > 0.0 { ((before.own - after.own) / before.own).max(0.0) } else { 0.0 };
    MindResult { hours, advance_km, losses, encircled: after.encircled - before.encircled }
}

/// Общее на час: копия мира после «продолжать» (строится при первом близком выборе часа) и сколько раз строилась.
#[derive(Default)]
pub struct Hourly { pub fork: Option<Sim>, pub count: u32 }

/// Базовый проигрыш «продолжать» на копии мира этого часа; копия общая для всех командующих часа.
fn baseline(sim: &Sim, c: &Commander, shared: &mut Hourly, hours: u32) -> MindResult {
    if shared.fork.is_none() {
        let mut f = sim.fork();
        for _ in 0..hours { f.step(); }
        shared.fork = Some(f);
        shared.count += 1;
    }
    let after = shared.fork.as_ref().expect("копия часа");
    let own = divisions_of(sim, c.hq);
    let (b, a) = (gauge(sim, c, &own), gauge(after, c, &own));
    let advance_km = match (b.to_objective, a.to_objective) { (Some(x), Some(y)) => x - y, _ => 0.0 };
    let losses = if b.own > 0.0 { ((b.own - a.own) / b.own).max(0.0) } else { 0.0 };
    MindResult { hours, advance_km, losses, encircled: a.encircled - b.encircled }
}

/// Вклад варианта, уточнённый проигрышем: измеренное (относительно «продолжать»), нормированное к −1…1,
/// смешивается с прежним вкладом. Задача и соперник — по продвижению, сохранение армий — по потерям, разгром — по охвату.
pub fn refine(contrib: &Motives, m: &MindResult, base: &MindResult) -> Motives {
    let adv = ((m.advance_km - base.advance_km) / (ADVANCE_KM_PER_H * m.hours.max(1) as f64)).clamp(-1.0, 1.0);
    let loss = ((base.losses - m.losses) / LOSSES_SCALE).clamp(-1.0, 1.0);
    let enc = ((m.encircled - base.encircled) / ENCIRCLED_SCALE).clamp(-1.0, 1.0);
    let mut out = *contrib;
    for (k, x) in [(Motive::Task, adv), (Motive::Rival, adv), (Motive::Preserve, loss), (Motive::Destroy, enc)] {
        out.0[k as usize] = (1.0 - BLEND) * contrib.get(k) + BLEND * x;
    }
    out
}

/// Проигрывание «в уме» ведут только фронты и группы армий, и только когда выбор близок.
pub fn wanted(sim: &Sim, c: &Commander, options: &[Scored]) -> bool {
    if sim.world.hqs[c.hq as usize].echelon != Echelon::Front || options.len() < 2 { return false; }
    let mut v: Vec<f64> = options.iter().map(|s| s.total).collect();
    v.sort_by(|a, b| b.total_cmp(a));
    v[0] - v[1] < sim.rules.commanders.mind_margin
}

/// Два лучших по пользе варианта (один при суженном обзоре) проигрываются «в уме», польза пересчитывается.
/// `shared` — общая на час копия базового проигрыша.
pub fn look(sim: &Sim, c: &Commander, pic: &Picture, options: &mut [Scored], t: &Traits, w: &Weights, hours: u32, shared: &mut Hourly, continuing: impl Fn(&Kind) -> bool) {
    if !wanted(sim, c, options) { return; }
    let n = if narrowed(&c.mood, &sim.rules.commanders.mood) { 1 } else { TOP };
    let mut order: Vec<usize> = (0..options.len()).collect();
    order.sort_by(|&a, &b| options[b].total.total_cmp(&options[a].total));
    order.truncate(n);
    let base = baseline(sim, c, shared, hours);
    for i in order {
        let ch = options[i].choice.clone();
        // «продолжать» — сам базовый проигрыш; варианты без действия — его же, вклад прежний
        let (refined, m) = if idle(&ch.kind) { (ch, base.clone()) } else {
            let m = imagine(sim, c, pic, &ch, hours);
            (Choice { contrib: refine(&ch.contrib, &m, &base), ..ch }, m)
        };
        let mut s = score(&refined, &c.motives, t, w, continuing(&refined.kind));
        s.mind = Some(m);
        options[i] = s;
    }
}
