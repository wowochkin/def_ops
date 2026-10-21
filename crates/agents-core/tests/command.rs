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

/// Действующие подчинённые штаба — без изъятых через голову.
#[test]
fn active_subs_skip_led() {
    use agents_core::command::control::active_subs;
    let mut sim = load("seelow-1945");
    let a = hq(&sim, "su_8gva");
    let (corps, _) = active_subs(&sim, a);
    assert!(corps.len() >= 2, "{corps:?}");
    sim.command.led_hq[corps[0] as usize] = true;
    let (after, _) = active_subs(&sim, a);
    assert_eq!(after.len(), corps.len() - 1);
    assert!(!after.contains(&corps[0]));
    let k = corps[1];
    let (_, divs) = active_subs(&sim, k);
    assert!(!divs.is_empty());
    sim.command.led_div[divs[0] as usize] = true;
    let (_, divs2) = active_subs(&sim, k);
    assert_eq!(divs2.len(), divs.len() - 1);
}

/// Документ журнала выходит в ход прогона с id штаба.
#[test]
fn trace_has_documents() {
    use agents_core::command::control::{DocKind, Document};
    let mut sim = load("seelow-1945");
    let a = hq(&sim, "su_8gva");
    sim.documents.push(Document { tick: 0, hq: a, kind: DocKind::Notice, to: vec!["su_8gva".into()], text: "проба".into(), rule: None });
    let root = repo_root();
    let (_, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &format!("{root}/{DATA_DIR}"), &root).unwrap();
    let t = agents_core::trace::describe(&sim, &meta, vec![]);
    assert_eq!(t["documents"][0]["hq"], "su_8gva");
    assert_eq!(t["documents"][0]["kind"], "notice");
}

use agents_core::command::control::{Control, DocKind};
use agents_core::command::directive::{Directive, Line};
use agents_core::geo::XY;
use agents_core::model::{Echelon, OrderKind, Side, State};

/// Советские штабы ниже верхней инстанции — штабы-агенты.
fn agents_su(sim: &mut agents_core::world::Sim) {
    for (k, h) in sim.world.hqs.iter().enumerate() {
        if h.side == Side::Su && h.echelon != Echelon::HighCommand { sim.command.control[k] = Control::Agent; }
    }
}

/// Директива Ставки 1-му Белорусскому: наступать на Берлин, ближайшая задача — рубеж в 30 км поперёк оси.
fn to_front(sim: &agents_core::world::Sim, form: Form) -> Directive {
    let p = |q: [f64; 2]| sim.theatre.proj.to_xy(q);
    let su: Vec<XY> = sim.world.divisions.iter().filter(|d| d.side == Side::Su).map(|d| d.vars.pos).collect();
    let c = XY::new(su.iter().map(|p| p.x).sum::<f64>() / su.len() as f64, su.iter().map(|p| p.y).sum::<f64>() / su.len() as f64);
    let berlin = p([13.40, 52.52]);
    let d = c.dist(berlin);
    let (ux, uy) = ((berlin.x - c.x) / d, (berlin.y - c.y) / d);
    let at = XY::new(c.x + ux * 30.0, c.y + uy * 30.0);
    Directive {
        id: "проба".into(), from: hq(sim, "su_stavka"), to: Target::Hq(hq(sim, "su_1bf")), form, task: Task::Attack,
        axis: vec![c, berlin], immediate: Some(Line { pts: vec![XY::new(at.x - uy * 25.0, at.y + ux * 25.0), XY::new(at.x + uy * 25.0, at.y - ux * 25.0)], by: None }),
        subsequent: Some(Line { pts: vec![berlin], by: None }), boundaries: vec![], main_blow: vec![], reserve: vec![], junction: None, hasty: false, note: "проба".into(),
    }
}

fn active_su(sim: &agents_core::world::Sim) -> Vec<usize> {
    (0..sim.world.divisions.len()).filter(|&i| { let d = &sim.world.divisions[i]; d.side == Side::Su && !d.state.out() && d.state != State::Remnant }).collect()
}

/// Подготовленная директива проходит фронт → армии → корпуса → дивизии за 24 + 24 + 22 + 22 = 92 ч; цели дивизий — в
/// своих полосах, разнесены.
#[test]
fn directive_reaches_divisions_through_agents() {
    let mut sim = load("seelow-1945");
    agents_su(&mut sim);
    let d = to_front(&sim, Form::Order);
    agents_core::command::passing::issue(&mut sim, d, 0);
    for _ in 0..91 { sim.step(); }
    // за час до прибытия к дивизиям под корпусами приказов от корпусов ещё нет
    let from_corps = |sim: &agents_core::world::Sim| active_su(sim).into_iter().filter(|&i| sim.world.divisions[i].order.as_ref().is_some_and(|o| sim.world.hqs[o.from as usize].echelon == Echelon::Corps)).count();
    assert_eq!(from_corps(&sim), 0);
    for _ in 0..2 { sim.step(); }
    let act = active_su(&sim);
    let ok = act.iter().filter(|&&i| { let dv = &sim.world.divisions[i]; dv.order.as_ref().is_some_and(|o| o.from == dv.hq && o.kind == OrderKind::Attack) }).count();
    assert!(ok * 10 >= act.len() * 9, "{ok} из {}", act.len());
    for k in [DocKind::Directive, DocKind::Order] { assert!(sim.documents.iter().any(|x| x.kind == k), "{k:?}"); }
    // цели соседей по корпусу разнесены
    for (h, _) in sim.world.hqs.iter().enumerate().filter(|(_, h)| h.side == Side::Su && h.echelon == Echelon::Corps) {
        let ts: Vec<XY> = act.iter().filter(|&&i| sim.world.divisions[i].hq as usize == h).filter_map(|&i| sim.world.divisions[i].order.as_ref().map(|o| o.target)).collect();
        for a in 0..ts.len() { for b in a + 1..ts.len() { assert!(ts[a].dist(ts[b]) >= 0.05, "корпус {h}: {:?} {:?}", ts[a], ts[b]); } }
    }
}

/// Боевое распоряжение — до дивизии за 3 + 2 + 2 + 1 = 8 ч, слаженность падает.
#[test]
fn instruction_is_faster_and_hasty() {
    let mut sim = load("seelow-1945");
    agents_su(&mut sim);
    let d = to_front(&sim, Form::Instruction);
    agents_core::command::passing::issue(&mut sim, d, 0);
    for _ in 0..9 { sim.step(); }
    let got: Vec<usize> = active_su(&sim).into_iter().filter(|&i| sim.world.divisions[i].order.as_ref().is_some_and(|o| o.from == sim.world.divisions[i].hq)).collect();
    assert!(!got.is_empty());
    assert!(got.iter().any(|&i| sim.world.divisions[i].vars.coord < 0.75), "слаженность");
    assert!(sim.documents.iter().any(|x| x.kind == DocKind::Instruction));
}

/// Приказы сценария штаба-агента не доставляются; у штаба по сценарию — как раньше.
#[test]
fn script_orders_skipped_for_agent_hq() {
    let mut sim = load("seelow-1945");
    let a = hq(&sim, "su_8gva");
    sim.command.control[a as usize] = Control::Agent;
    for _ in 0..30 { sim.step(); }
    let under = |sim: &agents_core::world::Sim, i: usize, h: u32| { let mut k = sim.world.divisions[i].hq; for _ in 0..8 { if k == h { return true; } match sim.world.hqs[k as usize].parent { Some(p) => k = p, None => return false } } false };
    let mine: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| under(&sim, i, a)).collect();
    assert!(!mine.is_empty());
    assert!(mine.iter().all(|&i| sim.world.divisions[i].order.as_ref().is_none_or(|o| o.from != a)), "приказы 8 гв. А дошли");
    let b = hq(&sim, "su_5ua");
    assert!((0..sim.world.divisions.len()).any(|i| under(&sim, i, b) && sim.world.divisions[i].order.as_ref().is_some_and(|o| o.from == b)));
}

/// У корпуса все дивизии изъяты — директива даёт извещение «нет подчинённых для задачи», директив нет.
#[test]
fn no_subs_notice() {
    let mut sim = load("seelow-1945");
    let k = sim.world.hqs.iter().position(|h| h.side == Side::Su && h.echelon == Echelon::Corps).unwrap() as u32;
    sim.command.control[k as usize] = Control::Agent;
    for i in 0..sim.world.divisions.len() { if sim.world.divisions[i].hq == k { sim.command.led_div[i] = true; } }
    let mut d = to_front(&sim, Form::Instruction);
    d.from = sim.world.hqs[k as usize].parent.unwrap();
    d.to = Target::Hq(k);
    agents_core::command::passing::issue(&mut sim, d, 0);
    let before = sim.documents.len();
    for _ in 0..4 { sim.step(); }
    let new = &sim.documents[before..];
    assert!(new.iter().any(|x| x.hq == k && x.kind == DocKind::Notice && x.text.contains("нет подчинённых")));
    assert!(!new.iter().any(|x| x.hq == k && x.kind != DocKind::Notice));
}

