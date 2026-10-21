//! Командование по ступеням: директивы, прохождение, управление штабами, штабы-агенты.

use agents_core::command::directive::{Form, Target, Task};
use agents_core::{repo_root, DATA_DIR};

fn load(name: &str) -> agents_core::world::Sim {
    let root = repo_root();
    let (sim, _) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/{name}.json"), &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    sim
}

fn hq(sim: &agents_core::world::Sim, id: &str) -> u32 { sim.world.hqs.iter().position(|h| h.id == id).expect(id) as u32 }

/// Исторические директивы сценария загружаются по получателям.
#[test]
fn historical_directives_load() {
    let sim = load("berlin-1945");
    assert!(sim.historical.len() >= 23, "{}", sim.historical.len());
    let d = sim.historical.iter().map(|(_, d)| d).find(|d| d.id == "stavka-11059").expect("11059");
    assert_eq!(d.to, Target::Hq(hq(&sim, "su_1bf")));
    assert_eq!(d.form, Form::Order);
    assert_eq!(d.axis.len(), 2);
    assert!(!d.immediate.as_ref().expect("рубеж").pts.is_empty());
    let h = sim.historical.iter().map(|(_, d)| d).find(|d| d.id == "hitler-1504").expect("1504");
    assert_eq!(h.task, Task::Defend);
}
