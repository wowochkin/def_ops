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
/// (передача в час 24, ещё 24 ч) — новое не должно их менять. Сменены вместе с данными: танки и орудия армий
/// по документам в сценарии seelow-1945 (прежние — 16739435988789117129 и 11162555259053550150, на прежнем сценарии
/// воспроизводятся), затем с темпом пехоты вне боя в глубине противника 14 → 25 км/сут (прежние — 4154387123457738608
/// и 11143781320962904725, при 14 км/сут воспроизводятся), затем с параметрами калибровки перебором (прежние —
/// 6188758119600658665 и 5665356261947276588).
pub const SEELOW_48_DIGEST: u64 = 16519880440056134377;
pub const LEGACY_GAME_DIGEST: u64 = 5949968270007021613;

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
        subsequent: Some(Line { pts: vec![berlin], by: None }), boundaries: vec![], main_blow: vec![], reserve: vec![], junction: None, hasty: false, ready: false, rule: None, issued: 0, note: "проба".into(),
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
    // время прохождения — на задаче «оборонять»: у наступления фронт по циклу уточняет задачи распоряжениями (этап 2б)
    let mut d = to_front(&sim, Form::Order);
    d.task = Task::Defend;
    // без перепланирования по циклу — только прохождение
    sim.rules.command.cycle_h = [1000.0; 3];
    agents_core::command::passing::issue(&mut sim, d, 0);
    for _ in 0..91 { sim.step(); }
    // за час до прибытия к дивизиям под корпусами приказов от корпусов ещё нет
    let from_corps = |sim: &agents_core::world::Sim| active_su(sim).into_iter().filter(|&i| sim.world.divisions[i].order.as_ref().is_some_and(|o| sim.world.hqs[o.from as usize].echelon == Echelon::Corps)).count();
    assert_eq!(from_corps(&sim), 0);
    for _ in 0..2 { sim.step(); }
    let act = active_su(&sim);
    let ok = act.iter().filter(|&&i| { let dv = &sim.world.divisions[i]; dv.order.as_ref().is_some_and(|o| o.from == dv.hq && o.kind == OrderKind::Defend) }).count();
    assert!(ok * 10 >= act.len() * 9, "{ok} из {}", act.len());
    for k in [DocKind::Directive, DocKind::Order] { assert!(sim.documents.iter().any(|x| x.kind == k), "{k:?}"); }
    // цели соседей по корпусу разнесены
    for (h, _) in sim.world.hqs.iter().enumerate().filter(|(_, h)| h.side == Side::Su && h.echelon == Echelon::Corps) {
        let ts: Vec<XY> = act.iter().filter(|&&i| sim.world.divisions[i].hq as usize == h).filter_map(|&i| sim.world.divisions[i].order.as_ref().filter(|o| o.kind == OrderKind::Defend).map(|o| o.target)).collect();
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


/// Продвижение вдоль оси наступления, км.
#[test]
fn advance_along_axis() {
    use agents_core::command::agent::advance;
    let a = advance(Some(XY::new(0.0, 0.0)), XY::new(5.0, 3.0), &[XY::new(0.0, 0.0), XY::new(10.0, 0.0)]);
    assert!((a - 5.0).abs() < 1e-9, "{a}");
    assert_eq!(advance(None, XY::new(5.0, 3.0), &[XY::new(0.0, 0.0), XY::new(10.0, 0.0)]), 0.0);
}

// ---------- этап 2б: советский корпус ----------

use agents_core::command::control::Role;

/// Директива армии корпусу `corps` (готова к началу): наступать на Берлин, полоса ±`half` км вокруг центра корпуса.
fn to_corps(sim: &agents_core::world::Sim, corps: &str, half: f64) -> Directive {
    let k = hq(sim, corps);
    let ds: Vec<XY> = sim.world.divisions.iter().filter(|d| d.hq == k && !d.state.out()).map(|d| d.vars.pos).collect();
    let c = XY::new(ds.iter().map(|p| p.x).sum::<f64>() / ds.len() as f64, ds.iter().map(|p| p.y).sum::<f64>() / ds.len() as f64);
    let berlin = sim.theatre.proj.to_xy([13.40, 52.52]);
    let d = c.dist(berlin);
    let (ux, uy) = ((berlin.x - c.x) / d, (berlin.y - c.y) / d);
    let side = |s: f64| vec![XY::new(c.x - uy * s - ux * 2.0, c.y + ux * s - uy * 2.0), XY::new(c.x - uy * s + ux * 40.0, c.y + ux * s + uy * 40.0)];
    let at = XY::new(c.x + ux * 15.0, c.y + uy * 15.0);
    Directive {
        id: "корпусу".into(), from: sim.world.hqs[k as usize].parent.unwrap(), to: Target::Hq(k), form: Form::Order, task: Task::Attack,
        axis: vec![c, berlin], immediate: Some(Line { pts: vec![XY::new(at.x - uy * 10.0, at.y + ux * 10.0), XY::new(at.x + uy * 10.0, at.y - ux * 10.0)], by: None }),
        subsequent: Some(Line { pts: vec![berlin], by: None }), boundaries: vec![(None, side(half)), (None, side(-half))], main_blow: vec![], reserve: vec![], junction: None,
        hasty: false, ready: true, rule: None, issued: 0, note: "проба".into(),
    }
}

fn corps_sim(half: f64, edit: impl Fn(&mut agents_core::world::Sim)) -> (agents_core::world::Sim, u32) {
    let mut sim = load("seelow-1945");
    agents_su(&mut sim);
    edit(&mut sim);
    let d = to_corps(&sim, "su_4gsk", half);
    let k = hq(&sim, "su_4gsk");
    agents_core::command::passing::issue(&mut sim, d, 0);
    (sim, k)
}

/// Корпус из 3 дивизий в полосе 4 км: 2 в первом эшелоне (по 1,5–2 км), 1 во втором — за первым на 5–7 км.
#[test]
fn corps_echelons_by_norm() {
    // правило при доле первого эшелона 0,55, втором эшелоне в 6 км и полосе дивизии 6 км (значения правил калибруются)
    let (mut sim, k) = corps_sim(2.0, |s| { s.rules.doctrine_su.first_echelon_share = 0.55; s.rules.command.su.second_echelon_behind_km = 6.0; s.rules.frontage_km[0] = 6.0; });
    sim.step();
    let divs: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| sim.world.divisions[i].hq == k).collect();
    assert_eq!(divs.len(), 3);
    let first: Vec<usize> = divs.iter().copied().filter(|&i| sim.command.role_div[i] == Role::First).collect();
    let second: Vec<usize> = divs.iter().copied().filter(|&i| sim.command.role_div[i] == Role::Second).collect();
    assert_eq!((first.len(), second.len()), (2, 1), "{:?}", divs.iter().map(|&i| sim.command.role_div[i]).collect::<Vec<_>>());
    let t: Vec<XY> = first.iter().map(|&i| sim.world.divisions[i].order.as_ref().unwrap().target).collect();
    assert!(t[0].dist(t[1]) >= 1.0, "{:?}", t);
    let o = sim.world.divisions[second[0]].order.as_ref().unwrap();
    assert_eq!(o.kind, OrderKind::Move);
    let c = XY::new(first.iter().map(|&i| sim.world.divisions[i].vars.pos.x).sum::<f64>() / 2.0, first.iter().map(|&i| sim.world.divisions[i].vars.pos.y).sum::<f64>() / 2.0);
    let behind = o.target.dist(c);
    assert!((5.0..=7.0).contains(&behind), "второй эшелон за первым на {behind:.1} км");
    assert!(sim.documents.iter().any(|d| d.rule.as_deref().is_some_and(|r| r.contains("ст. 103"))));
}

/// Полоса корпуса 1 км — в первом эшелоне одна дивизия.
#[test]
fn narrow_band_keeps_one_first() {
    let (mut sim, k) = corps_sim(0.5, |_| {});
    sim.step();
    let n = (0..sim.world.divisions.len()).filter(|&i| sim.world.divisions[i].hq == k && sim.command.role_div[i] == Role::First).count();
    assert_eq!(n, 1);
}

/// Без продвижения второй эшелон вводится через 48 ч.
#[test]
fn second_echelon_commits_by_fallback() {
    let (mut sim, k) = corps_sim(2.0, |s| { s.rules.doctrine_su.commit_depth_km = 1000.0; s.rules.doctrine_su.first_echelon_share = 0.55; s.rules.doctrine_su.second_echelon_fallback_hours = 33.6; });
    for _ in 0..50 { sim.step(); }
    let second: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| sim.world.divisions[i].hq == k && sim.command.role_div[i] == Role::Committed).collect();
    assert!(!second.is_empty(), "введён");
    for _ in 0..4 { sim.step(); }
    assert!(second.iter().all(|&i| sim.world.divisions[i].order.as_ref().is_some_and(|o| o.kind == OrderKind::Attack)));
}

// ---------- этап 2б: советские армия и фронт ----------

/// Армия 8 гв. из 3 корпусов: 2 в первом эшелоне, 1 во втором — его дивизии выдвигаются за первым.
#[test]
fn army_echelons_corps() {
    let mut sim = load("seelow-1945");
    agents_su(&mut sim);
    sim.rules.doctrine_su.first_echelon_share = 0.55;
    let mut d = to_corps(&sim, "su_4gsk", 6.0);
    let a = hq(&sim, "su_8gva");
    d.from = sim.world.hqs[a as usize].parent.unwrap();
    d.to = Target::Hq(a);
    agents_core::command::passing::issue(&mut sim, d, 0);
    sim.step();
    let corps: Vec<usize> = (0..sim.world.hqs.len()).filter(|&k| sim.world.hqs[k].parent == Some(a)).collect();
    let roles: Vec<Role> = corps.iter().map(|&k| sim.command.role_hq[k]).collect();
    assert_eq!(roles.iter().filter(|r| **r == Role::First).count(), 2, "{roles:?}");
    let second = corps[roles.iter().position(|r| *r == Role::Second).expect("второй эшелон")];
    let ds: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| sim.world.divisions[i].hq as usize == second).collect();
    assert!(ds.iter().all(|&i| sim.world.divisions[i].order.as_ref().is_some_and(|o| o.kind == OrderKind::Move)));
}

/// Танковые армии фронта — подвижная группа: сначала выдвигаются, через 48 ч без прорыва — наступают.
#[test]
fn front_holds_tank_armies() {
    let mut sim = load("seelow-1945");
    agents_su(&mut sim);
    sim.rules.doctrine_su.tank_commit_depth_km = 1000.0;
    let mut d = to_front(&sim, Form::Order);
    d.ready = true;
    agents_core::command::passing::issue(&mut sim, d, 0);
    sim.step();
    let tank = |sim: &agents_core::world::Sim| -> Vec<usize> { ["su_1gta", "su_2gta"].iter().map(|id| hq(sim, id)).flat_map(|t| (0..sim.world.divisions.len()).filter(move |&i| sim.world.divisions[i].hq == t || sim.world.hqs[sim.world.divisions[i].hq as usize].parent == Some(t))).collect() };
    let ts = tank(&sim);
    assert!(!ts.is_empty());
    assert_eq!(sim.command.role_hq[hq(&sim, "su_1gta") as usize], Role::Mobile);
    assert!(ts.iter().all(|&i| sim.world.divisions[i].order.as_ref().is_none_or(|o| o.kind != OrderKind::Attack)), "до прорыва не наступают");
    for _ in 0..60 { sim.step(); }
    assert_eq!(sim.command.role_hq[hq(&sim, "su_1gta") as usize], Role::Committed);
    assert!(ts.iter().any(|&i| sim.world.divisions[i].order.as_ref().is_some_and(|o| o.kind == OrderKind::Attack)));
}

/// Первый эшелон армии выбыл — второй эшелон вводится в следующий цикл.
#[test]
fn all_second_echelon_commit() {
    let mut sim = load("seelow-1945");
    agents_su(&mut sim);
    sim.rules.doctrine_su.first_echelon_share = 0.55;
    sim.rules.doctrine_su.commit_depth_km = 1000.0;
    let mut d = to_corps(&sim, "su_4gsk", 6.0);
    let a = hq(&sim, "su_8gva");
    d.from = sim.world.hqs[a as usize].parent.unwrap();
    d.to = Target::Hq(a);
    agents_core::command::passing::issue(&mut sim, d, 0);
    sim.step();
    let corps: Vec<usize> = (0..sim.world.hqs.len()).filter(|&k| sim.world.hqs[k].parent == Some(a)).collect();
    for &k in corps.iter().filter(|&&k| sim.command.role_hq[k] == Role::First) {
        for dv in sim.world.divisions.iter_mut().filter(|dv| dv.hq as usize == k) { dv.state = State::Destroyed; }
    }
    for _ in 0..8 { sim.step(); }
    let second = corps.iter().copied().find(|&k| sim.world.divisions.iter().any(|dv| dv.hq as usize == k && !dv.state.out())).unwrap();
    assert_eq!(sim.command.role_hq[second], Role::Committed);
}


// ---------- этап 2б: мелочи этапа 2а ----------

/// Штаб без действующих дивизий — не подчинённый для задачи.
#[test]
fn active_subs_skip_empty_hqs() {
    use agents_core::command::control::active_subs;
    let mut sim = load("seelow-1945");
    let a = hq(&sim, "su_8gva");
    let k = hq(&sim, "su_4gsk");
    for d in sim.world.divisions.iter_mut().filter(|d| d.hq == k) { d.state = State::Destroyed; }
    assert!(!active_subs(&sim, a).0.contains(&k));
}

/// Дивизия, ушедшая к последующей задаче, при новой директиве с той же последующей задачей не возвращается к ближайшей.
#[test]
fn fresh_keeps_subsequent() {
    let mut sim = load("seelow-1945");
    let i = sim.world.divisions.iter().position(|d| d.side == Side::Su && !d.state.out()).unwrap();
    let k = sim.world.divisions[i].hq;
    // дивизия в тылу (в 60 км восточнее): рубеж ближайшей задачи свободен от противника
    let p = XY::new(sim.world.divisions[i].vars.pos.x + 60.0, sim.world.divisions[i].vars.pos.y);
    sim.world.divisions[i].vars.pos = p;
    let sub = XY::new(p.x - 30.0, p.y);
    let mk = |near: XY| Directive { id: "д".into(), from: k, to: Target::Division(i as u32), form: Form::Instruction, task: Task::Attack, axis: vec![], immediate: Some(Line { pts: vec![near], by: None }),
        subsequent: Some(Line { pts: vec![sub], by: None }), boundaries: vec![], main_blow: vec![], reserve: vec![], junction: None, hasty: false, ready: true, rule: None, issued: 0, note: "проба".into() };
    agents_core::command::passing::issue(&mut sim, mk(p), 0);
    sim.step();
    sim.step();
    assert_eq!(sim.world.divisions[i].order.as_ref().unwrap().target, sub, "к последующей");
    let mut d2 = mk(XY::new(p.x - 10.0, p.y));
    d2.issued = 0;
    let now = sim.world.tick;
    agents_core::command::passing::issue(&mut sim, d2, now);
    sim.step();
    assert_eq!(sim.world.divisions[i].order.as_ref().unwrap().target, sub, "осталась последующая");
}

/// Граница точно на оси считается левой, если другой левой нет.
#[test]
fn boundary_on_axis_is_deterministic() {
    use agents_core::command::band::band_of;
    let axis = [XY::new(0.0, 0.0), XY::new(20.0, 0.0)];
    let on = vec![XY::new(0.0, 0.0), XY::new(20.0, 0.0)];
    let b = band_of(&axis, &[(None, on.clone())], &[XY::new(0.0, -3.0)], 4.0);
    assert_eq!(b.left, on);
}

/// I5: новый замысел с другой осью — продвижение считается заново, от нынешнего положения.
#[test]
fn roles_reset_on_new_axis() {
    let (mut sim, k) = corps_sim(2.0, |_| {});
    sim.step();
    let divs: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| sim.world.divisions[i].hq == k).collect();
    let s0: Vec<_> = divs.iter().map(|&i| sim.command.start_div[i]).collect();
    for _ in 0..5 { sim.step(); }
    let mut d = to_corps(&sim, "su_4gsk", 2.0);
    // ось — на север
    let c = d.axis[0];
    d.axis = vec![c, XY::new(c.x, c.y + 50.0)];
    d.immediate = Some(Line { pts: vec![XY::new(c.x - 10.0, c.y + 15.0), XY::new(c.x + 10.0, c.y + 15.0)], by: None });
    d.ready = false; d.form = Form::Instruction;
    let now = sim.world.tick;
    agents_core::command::passing::issue(&mut sim, d, now);
    for _ in 0..4 { sim.step(); }
    // продвижение считается от нынешнего положения (не от исходного прежнего замысла)
    assert!(divs.iter().zip(&s0).all(|(&i, s)| sim.command.start_div[i] != *s), "исходные положения обновлены");
}

/// Частная директива старшей инстанции армиям через голову фронта: армия на этой задаче, свой фронт по циклу её
/// не перебивает, пока не получит новый замысел.
#[test]
fn named_army_keeps_higher_instruction() {
    let mut sim = load("seelow-1945");
    agents_su(&mut sim);
    let mut d = to_front(&sim, Form::Order);
    d.ready = true;
    agents_core::command::passing::issue(&mut sim, d.clone(), 0);
    for _ in 0..3 { sim.step(); }
    let a = hq(&sim, "su_8gva");
    let mut x = to_front(&sim, Form::Instruction);
    x.id = "через голову".into();
    x.main_blow = vec![a];
    x.ready = true;
    let now = sim.world.tick;
    agents_core::command::passing::issue(&mut sim, x, now);
    for _ in 0..60 { sim.step(); }
    assert!(sim.command.intent[a as usize].as_ref().is_some_and(|i| i.id.starts_with("через голову")), "{:?}", sim.command.intent[a as usize].as_ref().map(|i| i.id.clone()));
    assert!(sim.command.named_hq[a as usize]);
    // новый замысел фронту — армия снова в разделе его полосы
    let mut d2 = to_front(&sim, Form::Order);
    d2.id = "новый".into();
    d2.axis[1] = XY::new(d2.axis[1].x, d2.axis[1].y + 40.0);
    let now = sim.world.tick;
    agents_core::command::passing::issue(&mut sim, d2, now);
    for _ in 0..30 { sim.step(); }
    assert!(!sim.command.named_hq[a as usize]);
}

/// Цель-точка вне главного удара — на её глубине в своей полосе; в полосе — она сама.
#[test]
fn point_objective_stays_in_band() {
    use agents_core::command::band::{point_in_band, Band};
    let b = Band { left: vec![XY::new(0.0, 5.0), XY::new(50.0, 5.0)], right: vec![XY::new(0.0, -5.0), XY::new(50.0, -5.0)] };
    assert!(point_in_band(XY::new(30.0, 20.0), &b).dist(XY::new(30.0, 0.0)) < 1e-6);
    assert_eq!(point_in_band(XY::new(30.0, 1.0), &b), XY::new(30.0, 1.0));
}

/// Ближайшая задача выполнена, когда рубеж занят: пока у него противник — к последующей не переходить.
#[test]
fn immediate_not_done_while_enemy_holds() {
    let mut sim = load("seelow-1945");
    let i = sim.world.divisions.iter().position(|d| d.side == Side::Su && !d.state.out()).unwrap();
    let e = sim.world.divisions.iter().position(|d| d.side == Side::De && !d.state.out()).unwrap();
    let k = sim.world.divisions[i].hq;
    let p = sim.world.divisions[i].vars.pos;
    // противник — у самого рубежа ближайшей задачи
    sim.world.divisions[e].vars.pos = XY::new(p.x + 1.0, p.y);
    let sub = XY::new(p.x - 30.0, p.y);
    let d = Directive { id: "д".into(), from: k, to: Target::Division(i as u32), form: Form::Instruction, task: Task::Attack, axis: vec![], immediate: Some(Line { pts: vec![p], by: None }),
        subsequent: Some(Line { pts: vec![sub], by: None }), boundaries: vec![], main_blow: vec![], reserve: vec![], junction: None, hasty: false, ready: true, rule: None, issued: 0, note: "проба".into() };
    agents_core::command::passing::issue(&mut sim, d, 0);
    sim.step();
    sim.step();
    assert_ne!(sim.world.divisions[i].order.as_ref().unwrap().target, sub, "рубеж не занят");
}

/// «Фронты по истории»: Ставка и фронты — по приказам сценария, армии и ниже — агенты; распоряжения фронтов армиям
/// подаются по часам, с осью от места армии к цели — и становятся замыслом армии.
#[test]
fn fronts_mode_feeds_front_directives() {
    let mut sim = load("berlin-1945");
    let mut pending = agents_core::command::control::command_mode(&mut sim, "fronts", Side::Su).expect("режим");
    assert!(pending.iter().all(|(_, d)| !d.id.ends_with(":journal")), "задачи по журналам — только в режиме journals");
    assert!(pending.len() >= 100, "{}", pending.len());
    assert!(pending.iter().all(|(_, d)| sim.world.hqs[d.from as usize].echelon == Echelon::Front));
    let (f, a) = (hq(&sim, "su_1bf"), hq(&sim, "su_8gva"));
    assert_eq!(sim.command.control[f as usize], Control::Script);
    assert_eq!(sim.command.control[a as usize], Control::Agent);
    for _ in 0..30 { agents_core::command::control::feed(&mut sim, &mut pending, true); sim.step(); }
    let i = sim.command.intent[a as usize].as_ref().expect("замысел 8 гв. А");
    assert_eq!(i.from, f);
    assert_eq!(i.axis.len(), 2, "ось достроена");
    assert!(agents_core::command::control::command_mode(&mut sim, "что-то", Side::Su).is_err());
    // «армии по журналам» — те же распоряжения и задачи армий по журналам между ними
    let mut sim = load("berlin-1945");
    let j = agents_core::command::control::command_mode(&mut sim, "journals", Side::Su).expect("режим");
    assert!(j.iter().any(|(_, d)| d.id.ends_with(":journal")));
    assert!(j.len() > pending.len());
}
