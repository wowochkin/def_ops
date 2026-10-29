//! Условие смысла (спецификация, раздел 1.4): есть ли у задачи смысл в обстановке на час её подачи; выполнена ли она.

use super::chain::{Goal, Task};
use crate::command::agent::{mid, place};
use crate::command::directive::Target;
use crate::geo::XY;
use crate::world::Sim;

/// Почему задача не подана (или цепочка прекращена).
#[derive(Clone, Debug, PartialEq)]
pub enum Reason { Taken, Behind, TooFar, OwnLost, RetreatCut, Unfit, Strayed { km: f64 }, ChainEnd, Player }

pub fn reason_text(r: &Reason) -> String {
    match r {
        Reason::Taken => "объект уже взят".into(),
        Reason::Behind => "объект позади армии".into(),
        Reason::TooFar => "объект дальше двух переходов".into(),
        Reason::OwnLost => "рубеж потерян".into(),
        Reason::RetreatCut => "путь отхода перерезан".into(),
        Reason::Unfit => "армия не способна выполнять".into(),
        Reason::Strayed { km } => format!("армия в {} км от исторического места", km.round() as i64),
        Reason::ChainEnd => "цепочка кончилась".into(),
        Reason::Player => "под командованием игрока".into(),
    }
}

/// Живые дивизии получателя (он и его подчинённые штабы).
fn live(sim: &Sim, owner: u32) -> Vec<usize> {
    let w = &sim.world;
    let under = |mut k: usize| { for _ in 0..8 { if k == owner as usize { return true; } match w.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
    (0..w.divisions.len()).filter(|&i| !w.divisions[i].state.out() && under(w.divisions[i].hq as usize)).collect()
}

fn seg_dist(p: XY, a: XY, b: XY) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = dx * dx + dy * dy;
    if l2 < 1e-9 { return p.dist(a); }
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0);
    p.dist(XY::new(a.x + t * dx, a.y + t * dy))
}

/// Направление армии: ось замысла, если он есть; иначе от стартового места (место штаба в сценарии) к нынешнему, если
/// армия сдвинулась больше 2 км; иначе направления нет.
fn army_axis(sim: &Sim, owner: u32, now: XY) -> Option<XY> {
    if let Some(Some(d)) = sim.command.intent.get(owner as usize) {
        if let (Some(a), Some(b)) = (d.axis.first(), d.axis.last()) { if a.dist(*b) > 1e-6 { return Some(XY::new(b.x - a.x, b.y - a.y)); } }
    }
    let s = sim.world.hqs[owner as usize].pos;
    (s.dist(now) > 2.0).then(|| XY::new(now.x - s.x, now.y - s.y))
}

/// Задача имеет смысл (`Ok`) или нет (причина).
pub fn sense(sim: &Sim, owner: u32, t: &Task) -> Result<(), Reason> {
    let w = &sim.world;
    let r = &sim.rules;
    let me = w.hqs[owner as usize].side;
    let ds = live(sim, owner);
    if ds.is_empty() { return Err(Reason::Unfit); }
    let cut = ds.iter().filter(|&&i| w.divisions[i].cut_since.is_some()).count();
    let coh = ds.iter().map(|&i| w.divisions[i].vars.cohesion).sum::<f64>() / ds.len() as f64;
    if cut * 2 > ds.len() || coh < r.rout_cohesion { return Err(Reason::Unfit); }
    let Some(goal) = t.goal else { return Ok(()) };
    let c = place(sim, Target::Hq(owner));
    let mine = |i: usize| w.divisions[i].side == me && !w.divisions[i].state.out();
    let foes = || (0..w.divisions.len()).filter(|&i| w.divisions[i].side != me && !w.divisions[i].state.out());
    match t.kind {
        Goal::Attack | Goal::Move => {
            if (0..w.divisions.len()).any(|i| mine(i) && w.divisions[i].vars.pos.dist(goal) <= r.contact_km) { return Err(Reason::Taken); }
            if let Some(ax) = army_axis(sim, owner, c) {
                let (gx, gy) = (goal.x - c.x, goal.y - c.y);
                if gx * ax.x + gy * ax.y < 0.0 { return Err(Reason::Behind); }
            }
            let rate = ds.iter().map(|&i| r.enemy_territory_km_day[w.divisions[i].params.mobility as usize]).sum::<f64>() / ds.len() as f64;
            if c.dist(goal) > r.intent.reach_days * rate { return Err(Reason::TooFar); }
            Ok(())
        }
        Goal::Defend => {
            let own = (0..w.divisions.len()).filter(|&i| mine(i)).map(|i| w.divisions[i].vars.pos.dist(goal)).fold(f64::INFINITY, f64::min);
            let foe = foes().map(|i| w.divisions[i].vars.pos.dist(goal)).fold(f64::INFINITY, f64::min);
            if own > r.contact_km || foe < own { Err(Reason::OwnLost) } else { Ok(()) }
        }
        Goal::Withdraw => {
            if foes().any(|i| seg_dist(w.divisions[i].vars.pos, c, goal) <= r.contact_km) { Err(Reason::RetreatCut) } else { Ok(()) }
        }
    }
}

/// Задача выполнена: центр получателя у цели; оборона — только по часу.
pub fn done(sim: &Sim, owner: u32, t: &Task) -> bool {
    let Some(goal) = t.goal else { return false };
    match t.kind {
        Goal::Defend => false,
        _ => {
            let ds = live(sim, owner);
            let pts: Vec<XY> = ds.iter().map(|&i| sim.world.divisions[i].vars.pos).collect();
            mid(&pts).is_some_and(|c| c.dist(goal) <= sim.rules.contact_km)
        }
    }
}
