//! Проигрывание варианта «в уме»: копия мира (`Sim::fork`), в которой сила противника перед армиями приведена к
//! оценке командующего, вариант применён и пройдено несколько часов. Итог (продвижение, потери, охват) сравнивается
//! с проигрышем «продолжать по плану» и уточняет вклад варианта в мотивы. Копия командующих не включает.

use super::decide::{score, Commander, Decision, Scored};
use super::motives::narrowed;
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
    super::apply::apply(&mut fork, &temp, &choice.kind, tick);
    for _ in 0..hours { fork.step(); }
    let after = gauge(&fork, c, &own);
    let advance_km = match (before.to_objective, after.to_objective) { (Some(a), Some(b)) => a - b, _ => 0.0 };
    let losses = if before.own > 0.0 { ((before.own - after.own) / before.own).max(0.0) } else { 0.0 };
    MindResult { hours, advance_km, losses, encircled: after.encircled - before.encircled }
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

/// Три лучших по пользе варианта (один при суженном обзоре) проигрываются «в уме», пользу пересчитать.
pub fn look(sim: &Sim, c: &Commander, pic: &Picture, options: &mut [Scored], t: &Traits, w: &Weights, hours: u32, continuing: impl Fn(&Kind) -> bool) {
    let n = if narrowed(&c.mood, &sim.rules.commanders.mood) { 1 } else { TOP };
    let mut order: Vec<usize> = (0..options.len()).collect();
    order.sort_by(|&a, &b| options[b].total.total_cmp(&options[a].total));
    order.truncate(n);
    let blank = Choice { kind: Kind::Continue, label: String::new(), contrib: Motives([0.0; 7]), uncertainty: 0.0, losses: 0.0, rule: "" };
    let base_choice = options.iter().find(|s| s.choice.kind == Kind::Continue).map_or(&blank, |s| &s.choice);
    let base = imagine(sim, c, pic, base_choice, hours);
    for i in order {
        let ch = options[i].choice.clone();
        let m = if idle(&ch.kind) { base.clone() } else { imagine(sim, c, pic, &ch, hours) };
        let refined = Choice { contrib: refine(&ch.contrib, &m, &base), ..ch };
        let mut s = score(&refined, &c.motives, t, w, continuing(&refined.kind));
        s.mind = Some(m);
        options[i] = s;
    }
}
