//! Потери по часам: выбывшие (люди, танки, орудия), пленные и пополнения нарастающим итогом в `Vars`
//! и в кадре хода. Счётчики не входят в отпечаток мира и на расчёт не влияют.

use agents_core::model::{Side, State};
use agents_core::scenario::EditsIn;
use agents_core::world::Sim;
use agents_core::{repo_root, DATA_DIR};

fn load(name: &str, edits: Option<&EditsIn>) -> Sim {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/{name}.json");
    agents_core::scenario::load_with(&path, &format!("{root}/{DATA_DIR}"), &root, None, edits).expect("сценарий").0
}

fn three(v: &agents_core::model::Vars) -> [f64; 3] { [v.personnel, v.tanks, v.guns] }

/// Баланс по стороне: в строю + выбывшие = на начало + пополнения.
#[test]
fn balance_berlin_48h() {
    let mut sim = load("berlin-1945", None);
    let sum = |sim: &Sim, side: Side, f: &dyn Fn(&agents_core::model::Division) -> [f64; 3]| {
        let mut s = [0.0; 3];
        for d in sim.world.divisions.iter().filter(|d| d.side == side) { let x = f(d); for k in 0..3 { s[k] += x[k]; } }
        s
    };
    let start: Vec<[f64; 3]> = [Side::Su, Side::De].iter().map(|&s| sum(&sim, s, &|d| three(&d.vars))).collect();
    for _ in 0..48 { sim.step(); }
    for (n, &side) in [Side::Su, Side::De].iter().enumerate() {
        let alive = sum(&sim, side, &|d| if matches!(d.state, State::Destroyed | State::Merged) { [0.0; 3] } else { three(&d.vars) });
        let lost = sum(&sim, side, &|d| d.vars.lost);
        let reinf = sum(&sim, side, &|d| d.vars.reinforced);
        for k in 0..3 {
            let tol = 1e-6 * start[n][k].max(1.0);
            assert!((alive[k] + lost[k] - start[n][k] - reinf[k]).abs() <= tol,
                "{side:?}[{k}]: в строю {} + выбыло {} ≠ на начало {} + пополнения {}", alive[k], lost[k], start[n][k], reinf[k]);
        }
        assert!(lost[0] > 0.0, "{side:?}: потерь людей нет");
    }
}

/// Сведение немецких остатков: не принятое соседом — выбывшие сведённой; принявшей — ни потеря, ни пополнение.
#[test]
fn merge_remainder_is_loss() {
    let mut sim = load("seelow-1945", None);
    let de = sim.world.divisions.iter().position(|d| d.side == Side::De).unwrap();
    let p0 = sim.world.divisions[de].vars.personnel0;
    sim.world.divisions[de].vars.personnel = 0.2 * p0;
    let name = sim.world.divisions[de].name.clone();
    let mut merged = false;
    for _ in 0..40 {
        let before: Vec<agents_core::model::Vars> = sim.world.divisions.iter().map(|d| d.vars.clone()).collect();
        let j0 = sim.journal.len();
        sim.step();
        if sim.world.divisions[de].state != State::Merged { continue; }
        let e = sim.journal[j0..].iter().find(|e| e.text.starts_with(&format!("приняла остатки «{name}»"))).expect("запись о приёме остатков");
        let p: f64 = e.text.split(": ").nth(1).unwrap().split(' ').next().unwrap().parse().unwrap();
        let d = &sim.world.divisions[de].vars;
        assert!((d.lost[0] - before[de].lost[0] - (before[de].personnel - p)).abs() <= 0.5,
            "выбыло {} при численности {} и принятых {p}", d.lost[0] - before[de].lost[0], before[de].personnel);
        let j = e.agent as usize;
        let r = &sim.world.divisions[j].vars;
        assert_eq!(r.reinforced, before[j].reinforced, "приём остатков — не пополнение");
        // принятые люди не списаны в потери принявшей: её численность выросла на принятое за вычетом её же потерь
        assert!((r.personnel - before[j].personnel - p + (r.lost[0] - before[j].lost[0])).abs() <= 0.5);
        merged = true;
        break;
    }
    assert!(merged, "остатки не сведены");
}

/// Пополнение по дате считается отдельно и потерь не уменьшает.
#[test]
fn reinforce_counts_separately() {
    let base = load("berlin-1945", None);
    let id = base.world.divisions.iter().find(|d| d.side == Side::Su && d.params.kind == "sd" && d.state != State::Pending).unwrap().id.clone();
    let e: EditsIn = serde_json::from_value(serde_json::json!({ "changes": [
        { "at": "1945-04-16T08:00", "formation": id, "kind": "reinforce", "personnel": 1000, "guns": 20 }
    ] })).unwrap();
    let mut sim = load("berlin-1945", Some(&e));
    let i = sim.world.divisions.iter().position(|d| d.id == id).unwrap();
    let mut lost = sim.world.divisions[i].vars.lost;
    let mut done = false;
    for _ in 0..8 {
        sim.step();
        let v = &sim.world.divisions[i].vars;
        for k in 0..3 { assert!(v.lost[k] >= lost[k], "выбывшие уменьшились"); }
        lost = v.lost;
        if sim.journal.iter().any(|e| e.agent as usize == i && e.text.contains("пополнение +1000 чел.")) { done = true; }
    }
    assert!(done, "пополнения не было");
    assert_eq!(sim.world.divisions[i].vars.reinforced, [1000.0, 0.0, 20.0]);
}

/// Кадр хода: прежние 11 полей и пять полей потерь в конце.
#[test]
fn frame_has_loss_fields() {
    use agents_core::trace::{frame, FIELDS};
    assert_eq!(FIELDS.len(), 16);
    assert_eq!(&FIELDS[11..], &["lost", "lostTanks", "lostGuns", "captured", "reinforced"]);
    let mut sim = load("seelow-1945", None);
    for _ in 0..3 { sim.step(); }
    let rows = frame(&sim);
    assert!(rows.iter().all(|r| r.as_array().unwrap().len() == 16));
}
