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

/// Отпечатки прогонов до этапа 2а: прогон Зееловского сценария (48 ч) и игра «как сейчас» за советскую сторону
/// (передача в час 24, ещё 24 ч) — новое не должно их менять.
pub const SEELOW_48_DIGEST: u64 = 16739435988789117129;
pub const LEGACY_GAME_DIGEST: u64 = 11162555259053550150;

#[test]
fn coordination_one_changes_nothing() {
    let mut sim = load("seelow-1945");
    for _ in 0..48 { sim.step(); }
    assert_eq!(sim.digest(), SEELOW_48_DIGEST);
}

#[test]
fn legacy_game_unchanged() {
    let root = repo_root();
    let (sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    let mut g = agents_core::game::Game::start(sim, meta, 24, agents_core::model::Side::Su);
    g.advance(24);
    assert_eq!(g.sim.digest(), LEGACY_GAME_DIGEST);
}

/// Зееловский сценарий с правкой JSON — во временном файле.
fn seelow_with(name: &str, edit: impl Fn(&mut serde_json::Value)) -> agents_core::world::Sim {
    let root = repo_root();
    let mut s: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json")).unwrap()).unwrap();
    edit(&mut s);
    let path = std::env::temp_dir().join(format!("agents-command-{name}-{}.json", std::process::id()));
    std::fs::write(&path, s.to_string()).unwrap();
    agents_core::scenario::load(&path.to_string_lossy(), &format!("{root}/{DATA_DIR}"), &root).expect("сценарий").0
}

/// Слаженность 0,7 — сила в бою 0,85 от полной; вне боя восстанавливается на 0,03 в час.
#[test]
fn coordination_weakens_strength() {
    let mut sim = seelow_with("coord", |s| {
        let d = s["divisions"].as_array().unwrap().iter().find(|d| d["side"] == "su").unwrap().clone();
        s["divisions"] = serde_json::json!([d]);
        for k in ["orders", "fires", "directives", "withdrawals"] { s[k] = serde_json::json!([]); }
    });
    let full = sim.strength(&sim.world.divisions[0]);
    sim.world.divisions[0].vars.coord = 0.7;
    let weak = sim.strength(&sim.world.divisions[0]);
    assert!((weak / full - 0.85).abs() < 1e-9, "{weak} / {full}");
    for _ in 0..10 { sim.step(); }
    assert!((sim.world.divisions[0].vars.coord - 1.0).abs() < 1e-9, "{}", sim.world.divisions[0].vars.coord);
}
