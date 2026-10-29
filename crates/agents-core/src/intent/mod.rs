//! «История как замысел»: исторические директивы и приказы сценария как цепочки задач получателей (армий) и условия
//! смысла — подаётся ли задача в обстановке, сложившейся к её часу (docs/superpowers/specs/2026-10-29-history-intent-design.md,
//! раздел 1). Подача, уход и возврат — dispatch.rs; всё включается режимом `intent`, старые режимы идут как шли.

pub mod chain;
pub mod dispatch;
pub mod sense;
pub mod track;

pub use chain::{build, of_directive, Chain, Goal, Step, Task};
pub use sense::{done, reason_text, sense, Reason};
pub use dispatch::{admit, describe, enable, gate, off_history, step, take, withdrawal_ok, HqState, State, Status};

use crate::geo::XY;
use crate::model::Echelon;
use crate::world::Sim;

/// Объекты плана ближе друг к другу, чем на столько, км, — один объект.
const PLAN_SAME_KM: f64 = 2.0;

/// Объекты плана фронта `front` (спецификация, раздел 2.2): цели всех задач цепочек его армий, в любой час — план фронта
/// командующему известен; повторы ближе `PLAN_SAME_KM` — один объект.
pub fn plan_objectives(sim: &Sim, front: u32) -> Vec<XY> {
    let w = &sim.world;
    let under = |h: u32| { let mut k = h as usize; for _ in 0..8 { match w.hqs[k].parent { Some(p) if p == front => return true, Some(p) => k = p as usize, None => return false } } false };
    let mut out: Vec<XY> = Vec::new();
    for c in sim.intent.chains.iter().filter(|c| w.hqs[c.owner as usize].echelon == Echelon::Army && under(c.owner)) {
        for g in c.tasks.iter().filter_map(|t| t.goal) {
            if !out.iter().any(|p| p.dist(g) <= PLAN_SAME_KM) { out.push(g); }
        }
    }
    out
}
