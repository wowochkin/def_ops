//! «История как замысел»: цепочки задач и условия смысла.

use agents_core::command::directive::Target;
use agents_core::geo::XY;
use agents_core::intent::{self, Chain, Goal, Reason, Step, Task};
use agents_core::model::Side;
use agents_core::rules::Rules;
use agents_core::world::Sim;
use agents_core::{repo_root, DATA_DIR};
use serde_json::json;

fn data() -> String { format!("{}/{DATA_DIR}", repo_root()) }

fn load() -> Sim {
    let root = repo_root();
    let (sim, _) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &data(), &root).expect("сценарий");
    sim
}

fn hq(sim: &Sim, id: &str) -> u32 { sim.world.hqs.iter().position(|h| h.id == id).expect(id) as u32 }

#[test]
fn intent_rules_load() {
    let r = Rules::load(&data()).expect("правила").intent;
    assert_eq!((r.leave_km, r.return_km, r.reach_days), (30.0, 15.0, 2.0));
    let raw: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(format!("{}/rules/agents-v0.json", data())).unwrap()).unwrap();
    assert_eq!(raw["intent"]["leaveKm"]["range"], json!([15, 60]));
    assert_eq!(raw["intent"]["returnKm"]["range"], json!([5, 30]));
    assert_eq!(raw["intent"]["reachDays"]["range"], json!([1, 3]));
    let r = Rules::load_with(&data(), Some(&json!({"intent.leaveKm": 40}))).expect("правила").intent;
    assert_eq!(r.leave_km, 40.0);
}

#[test]
fn chains_built() {
    let sim = load();
    let su = intent::build(&sim, Side::Su);
    for id in ["su_8gva", "su_1gta", "su_3gta"] {
        let c = su.iter().find(|c| c.owner == hq(&sim, id)).unwrap_or_else(|| panic!("нет цепочки {id}"));
        assert!(!c.tasks.is_empty() && c.next == 0);
        assert!(c.tasks.windows(2).all(|w| w[0].at <= w[1].at), "{id}: не по часу");
    }
    let want = sim.historical.iter().filter(|(_, d)| !d.id.ends_with(":journal") && sim.world.hqs[d.from as usize].side == Side::Su && matches!(d.to, Target::Hq(_))).count();
    let got: usize = su.iter().map(|c| c.tasks.len()).sum();
    assert_eq!(got, want);
    assert!(su.iter().flat_map(|c| &c.tasks).all(|t| matches!(t.step, Step::Dir(_))));
    let de = intent::build(&sim, Side::De);
    assert!(de.iter().any(|c| c.owner == hq(&sim, "de_9a")), "нет цепочки de_9a");
    assert!(de.iter().all(|c| c.tasks.windows(2).all(|w| w[0].at <= w[1].at)));
    let hc = hq(&sim, "de_hc");
    let steps: Vec<&Step> = de.iter().flat_map(|c| &c.tasks).map(|t| &t.step).collect();
    assert!(steps.iter().any(|s| matches!(s, Step::Order(_))));
    assert!(steps.iter().any(|s| matches!(s, Step::Dir(d) if d.from == hc)), "нет директив de_hc");
    let n_dir = sim.historical.iter().filter(|(_, d)| !d.id.ends_with(":journal") && sim.world.hqs[d.from as usize].side == Side::De && matches!(d.to, Target::Hq(_))).count();
    assert_eq!(steps.iter().filter(|s| matches!(s, Step::Dir(_))).count(), n_dir);
    assert!(!sim.withdrawals.is_empty());
    let day16 = sim.withdrawals.iter().map(|w| w.at).min().unwrap();
    assert!(de.iter().flat_map(|c| &c.tasks).any(|t| matches!(&t.step, Step::Withdrawal(w) if w.at == day16) && t.kind == Goal::Withdraw), "нет отвода");
    assert!(steps.iter().all(|s| !matches!(s, Step::Dir(d) if sim.world.hqs[d.from as usize].side == Side::Su)));
    eprintln!("цепочек: su {}, de {}; задач: su {}, de {}", su.len(), de.len(), got, de.iter().map(|c| c.tasks.len()).sum::<usize>());
}

/// Армия su_8gva в начале координат, ось наступления +x, остальные дивизии далеко; возвращает армию и индексы её дивизий.
fn arena(sim: &mut Sim) -> (Chain, Vec<usize>) {
    let army = hq(sim, "su_8gva");
    let under = |sim: &Sim, mut k: usize| { for _ in 0..8 { if k == army as usize { return true; } match sim.world.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
    let mine: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| !sim.world.divisions[i].state.out() && under(sim, sim.world.divisions[i].hq as usize)).collect();
    assert!(mine.len() >= 2, "дивизий армии: {}", mine.len());
    for i in 0..sim.world.divisions.len() { if !sim.world.divisions[i].state.out() { sim.world.divisions[i].vars.pos = XY::new(4000.0 + i as f64 * 50.0, 4000.0); } }
    for &i in &mine { sim.world.divisions[i].vars.pos = XY::new(0.0, 0.0); }
    // штаб далеко позади войск: направление армии он не задаёт
    sim.world.hqs[army as usize].pos = XY::new(-300.0, 0.0);
    (Chain { owner: army, tasks: vec![], next: 0, start: Some(XY::new(-10.0, 0.0)) }, mine)
}

fn task(kind: Goal, x: f64) -> Task { task_xy(kind, Some(XY::new(x, 0.0))) }

fn task_xy(kind: Goal, goal: Option<XY>) -> Task {
    let d = agents_core::command::directive::Directive { id: "t".into(), from: 0, to: Target::Hq(0), form: Default::default(), task: Default::default(), axis: vec![], immediate: None, subsequent: None, boundaries: vec![], main_blow: vec![], reserve: vec![], junction: None, hasty: false, ready: false, rule: None, issued: 0, note: String::new() };
    Task { at: 0, step: Step::Dir(d), goal, kind }
}

fn foe(sim: &Sim) -> usize { (0..sim.world.divisions.len()).find(|&i| sim.world.divisions[i].side == Side::De && !sim.world.divisions[i].state.out()).expect("противник") }
fn friend(sim: &Sim, mine: &[usize]) -> usize { (0..sim.world.divisions.len()).find(|&i| sim.world.divisions[i].side == Side::Su && !sim.world.divisions[i].state.out() && !mine.contains(&i)).expect("свой") }

#[test]
fn sense_attack_cases() {
    let mut sim = load();
    let (ch, mine) = arena(&mut sim);
    let (e, f) = (foe(&sim), friend(&sim, &mine));
    sim.world.divisions[e].vars.pos = XY::new(40.0, 0.0);
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Attack, 40.0)), Ok(()));
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Attack, -40.0)), Err(Reason::Behind));
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Attack, 400.0)), Err(Reason::TooFar));
    sim.world.divisions[f].vars.pos = XY::new(40.0, 0.0);
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Attack, 40.0)), Err(Reason::Taken));
}

#[test]
fn sense_defend_and_withdraw() {
    let mut sim = load();
    let (ch, _) = arena(&mut sim);
    let e = foe(&sim);
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Defend, 0.0)), Ok(()));
    sim.world.divisions[e].vars.pos = XY::new(3.0, 0.0);
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Defend, 3.0)), Err(Reason::OwnLost), "противник ближе своих");
    sim.world.divisions[e].vars.pos = XY::new(4000.0, 4000.0);
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Defend, 60.0)), Err(Reason::OwnLost));
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Withdraw, -40.0)), Ok(()));
    sim.world.divisions[e].vars.pos = XY::new(-20.0, 0.0);
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Withdraw, -40.0)), Err(Reason::RetreatCut));
}

#[test]
fn sense_unfit() {
    let mut sim = load();
    let (ch, mine) = arena(&mut sim);
    for &i in mine.iter().take(mine.len() / 2 + 1) { sim.world.divisions[i].cut_since = Some(1); }
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Attack, 40.0)), Err(Reason::Unfit));
    for &i in &mine { sim.world.divisions[i].cut_since = None; sim.world.divisions[i].vars.cohesion = 0.25; }
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Attack, 40.0)), Err(Reason::Unfit), "слаженность на пороге");
    for &i in &mine { sim.world.divisions[i].vars.cohesion = 0.9; }
    assert!(intent::sense(&sim, &ch, &task(Goal::Defend, 0.0)).is_ok());
    for &i in &mine { sim.world.divisions[i].state = agents_core::model::State::Destroyed; }
    assert_eq!(intent::sense(&sim, &ch, &task(Goal::Defend, 0.0)), Err(Reason::Unfit), "нет живых дивизий");
}

#[test]
fn reason_texts() {
    let all = [
        (Reason::Taken, "объект уже взят"), (Reason::Behind, "объект позади армии"), (Reason::TooFar, "объект дальше двух переходов"),
        (Reason::OwnLost, "рубеж потерян"), (Reason::RetreatCut, "путь отхода перерезан"), (Reason::Unfit, "армия не способна выполнять"),
        (Reason::Strayed { km: 41.6 }, "армия в 42 км от исторического места"), (Reason::ChainEnd, "цепочка кончилась"), (Reason::Player, "под командованием игрока"),
    ];
    for (r, t) in all { assert_eq!(intent::reason_text(&r), t); }
}

#[test]
fn sense_direction_and_goal_none() {
    let mut sim = load();
    let (mut ch, _) = arena(&mut sim);
    let at = |y: f64| task_xy(Goal::Attack, Some(XY::new(0.0, y)));
    // армия сдвинулась в сторону от старта (0, -20) -> (0, 0): ось +y; штаб (300 км позади по x) ничего не говорит
    ch.start = Some(XY::new(0.0, -20.0));
    assert_eq!(intent::sense(&sim, &ch, &at(-40.0)), Err(Reason::Behind));
    assert_eq!(intent::sense(&sim, &ch, &at(40.0)), Ok(()));
    // сдвиг до 2 км и нет старта — направления нет, принимается
    ch.start = Some(XY::new(0.0, -1.0));
    assert_eq!(intent::sense(&sim, &ch, &at(-40.0)), Ok(()));
    ch.start = None;
    assert_eq!(intent::sense(&sim, &ch, &at(-40.0)), Ok(()));
    // ось замысла армии важнее
    let mut d = match &task(Goal::Attack, 0.0).step { Step::Dir(d) => d.clone(), _ => unreachable!() };
    d.axis = vec![XY::new(0.0, 0.0), XY::new(0.0, 10.0)];
    sim.command.intent[ch.owner as usize] = Some(d);
    assert_eq!(intent::sense(&sim, &ch, &at(-40.0)), Err(Reason::Behind));
    assert_eq!(intent::sense(&sim, &ch, &at(40.0)), Ok(()));
    // цели нет — «на месте»
    assert_eq!(intent::sense(&sim, &ch, &task_xy(Goal::Attack, None)), Ok(()));
    assert!(!intent::done(&sim, ch.owner, &task_xy(Goal::Attack, None)));
}

#[test]
fn done_on_reach() {
    let mut sim = load();
    let (ch, mine) = arena(&mut sim);
    assert!(!intent::done(&sim, ch.owner, &task(Goal::Attack, 40.0)));
    for &i in &mine { sim.world.divisions[i].vars.pos = XY::new(38.0, 0.0); }
    assert!(intent::done(&sim, ch.owner, &task(Goal::Attack, 40.0)));
    assert!(!intent::done(&sim, ch.owner, &task(Goal::Defend, 40.0)));
}
