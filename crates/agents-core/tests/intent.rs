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
    Task { at: 0, step: Step::Dir(d), goal, kind, issued: false }
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
        (Reason::Strayed { km: 41.6 }, "армия в 42 км от исторического места"), (Reason::Strayed { km: 15.2 }, "армия в 16 км от исторического места"), (Reason::ChainEnd, "цепочка кончилась"), (Reason::Player, "под командованием игрока"),
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

// ---------- след эталона ----------

use agents_core::intent::track::{self, Track};

fn fake_trace(lng: [f64; 2], dead_second: bool) -> serde_json::Value {
    let row = |x: f64, st: &str| json!([x, 52.0, st, 100, 0, 0, 1, 1, 0, 1, 0]);
    json!({
        "fields": ["lng", "lat", "state", "personnel", "tanks", "guns", "ammo", "fuel", "fatigue", "cohesion", "encircled"],
        "divisions": [{"id": "d1", "hq": "c1"}, {"id": "d2", "hq": "c2"}],
        "hqs": [{"id": "su_a", "parent": null, "echelon": "army"}, {"id": "c1", "parent": "su_a", "echelon": "corps"},
                {"id": "c2", "parent": "c1", "echelon": "division"}],
        "frames": [[row(lng[0], "резерв"), row(lng[0] + 2.0, "резерв")],
                   [row(lng[1], "резерв"), row(lng[1] + 2.0, if dead_second { "небоеспособна" } else { "резерв" })]],
    })
}

#[test]
fn track_record_mean() {
    let t = track::record(&[fake_trace([14.0, 15.0], true), fake_trace([16.0, 17.0], true)]);
    assert_eq!(t.hours, 1);
    // час 0: центр (x, x+2) = x+1; средняя по двум ходам (15 и 17) = 16; час 1: вторая дивизия выбыла, центр = x
    assert_eq!(t.at("su_a", 0), Some([16.0, 52.0]));
    assert_eq!(t.at("su_a", 1), Some([16.0, 52.0]));
    let t = track::record(&[fake_trace([14.0, 15.0], true), fake_trace([16.0, 17.0], false)]);
    assert_eq!(t.at("su_a", 1).unwrap()[0], (15.0 + 18.0) / 2.0);
}

#[test]
fn track_at_missing() {
    let t = track::record(&[fake_trace([14.0, 15.0], false)]);
    assert_eq!(t.at("su_zz", 0), None);
    assert_eq!(t.at("su_a", 5), None);
    assert_eq!(t.at("c1", 0), None, "не армия — не в следе");
}

#[test]
fn track_fingerprint() {
    assert_eq!(track::fingerprint("abc").len(), 16);
    assert_eq!(track::fingerprint("abc"), track::fingerprint("abc"));
    assert_ne!(track::fingerprint("abc"), track::fingerprint("abd"));
    let dir = std::env::temp_dir().join(format!("intent-track-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let scen = dir.join("s.json");
    let scen_s = scen.to_str().unwrap();
    assert_eq!(track::load(scen_s).unwrap_err(), "нет следа эталона");
    std::fs::write(&scen, "{\"a\":1}").unwrap();
    assert_eq!(track::load(scen_s).unwrap_err(), "нет следа эталона");
    let mut t = track::record(&[fake_trace([14.0, 15.0], false)]);
    t.fingerprint = track::fingerprint("{\"a\":1}");
    std::fs::write(dir.join("s.intent-track.json"), serde_json::to_string(&t).unwrap()).unwrap();
    let got: Track = track::load(scen_s).unwrap();
    assert_eq!(got.at("su_a", 0), t.at("su_a", 0));
    // чужой отпечаток — след устарел
    // след, записанный по другим правилам, — тоже устарел
    let mut t2 = t.clone();
    t2.rules = "other".into();
    std::fs::write(dir.join("s.intent-track.json"), serde_json::to_string(&t2).unwrap()).unwrap();
    assert_eq!(track::load(scen_s).unwrap_err(), "след эталона устарел — уход по расстоянию выключен");
    std::fs::write(&scen, "{\"a\":2}").unwrap();
    assert_eq!(track::load(scen_s).unwrap_err(), "след эталона устарел — уход по расстоянию выключен");
    std::fs::remove_dir_all(&dir).ok();
}

// ---------- подача, уход и возврат ----------

use agents_core::intent::{HqState, Status};

/// Берлинская в режиме intent у обеих сторон (след эталона — не из файла: тесты задают его сами).
fn intent_sim() -> Sim {
    let mut sim = load();
    for sd in [Side::Su, Side::De] {
        assert!(agents_core::command::control::command_mode(&mut sim, "intent", sd).unwrap().is_empty(), "intent подаёт сам");
    }
    sim.intent.track = None;
    sim
}

fn chain_of(sim: &Sim, owner: u32) -> usize { sim.intent.chains.iter().position(|c| c.owner == owner).expect("цепочка") }

fn status(sim: &Sim, h: u32) -> &HqState { &sim.intent.hq[h as usize] }

/// Документы штаба `from` штабу `to` по часам.
fn docs(sim: &Sim, from: u32, to: &str) -> Vec<u32> {
    sim.documents.iter().filter(|d| d.hq == from && d.to.iter().any(|t| t == to)).map(|d| d.tick).collect()
}

fn run_to(sim: &mut Sim, tick: u32) { while sim.world.tick < tick { sim.step(); } }

/// Живые дивизии штаба с подчинёнными.
fn under(sim: &Sim, h: u32) -> Vec<usize> {
    let up = |mut k: usize| { for _ in 0..8 { if k == h as usize { return true; } match sim.world.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
    (0..sim.world.divisions.len()).filter(|&i| !sim.world.divisions[i].state.out() && up(sim.world.divisions[i].hq as usize)).collect()
}

fn center(sim: &Sim, h: u32) -> XY {
    let ds = under(sim, h);
    let n = ds.len() as f64;
    XY::new(ds.iter().map(|&i| sim.world.divisions[i].vars.pos.x).sum::<f64>() / n, ds.iter().map(|&i| sim.world.divisions[i].vars.pos.y).sum::<f64>() / n)
}

fn shift(sim: &mut Sim, h: u32, dx: f64, dy: f64) {
    for i in under(sim, h) { let p = &mut sim.world.divisions[i].vars.pos; p.x += dx; p.y += dy; }
}

/// След эталона: армия `h` стоит там, где она сейчас, все часы.
fn still_track(sim: &Sim, hs: &[u32]) -> Track {
    let mut armies = std::collections::BTreeMap::new();
    for &h in hs { armies.insert(sim.world.hqs[h as usize].id.clone(), vec![Some(sim.theatre.proj.to_lnglat(center(sim, h))); 400]); }
    Track { fingerprint: String::new(), rules: track::RULES.into(), hours: 399, armies }
}

/// След армии `h` в `km` к северу (+y) от её нынешнего места: армия «отошла от следа» (returnKm < km ≤ leaveKm).
fn off_track(sim: &mut Sim, h: u32, km: f64) -> Track {
    shift(sim, h, 0.0, km);
    let t = still_track(sim, &[h]);
    shift(sim, h, 0.0, -km);
    t
}

/// Точка в `km` за целью задачи `a` по направлению от центра армии.
fn beyond(sim: &Sim, h: u32, goal: XY, km: f64) -> XY {
    let c = center(sim, h);
    let (dx, dy) = (goal.x - c.x, goal.y - c.y);
    let l = (dx * dx + dy * dy).sqrt().max(1e-6);
    XY::new(goal.x + dx / l * km, goal.y + dy / l * km)
}

#[test]
fn intent_enable_sets_history() {
    let sim = intent_sim();
    assert!(sim.intent.enabled == [true, true]);
    assert_eq!(sim.intent.hq.len(), sim.world.hqs.len());
    let a = hq(&sim, "su_8gva");
    assert_eq!(status(&sim, a).status, Status::History);
    assert_eq!(sim.command.control[a as usize], agents_core::command::control::Control::Agent);
    assert_eq!(sim.command.control[hq(&sim, "su_1bf") as usize], agents_core::command::control::Control::Script);
    assert_eq!(sim.command.control[hq(&sim, "de_9a") as usize], agents_core::command::control::Control::Script);
    assert!(sim.commanders.enabled == [true, true]);
}

#[test]
fn issue_by_hour() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(2);
    sim.intent.chains[ci].tasks[1].at = 6;
    run_to(&mut sim, 8);
    let got = docs(&sim, f, "su_8gva");
    assert_eq!(got, vec![sim.intent.chains[ci].tasks[0].at, 6], "подано в свой час");
    assert_eq!(status(&sim, a).status, Status::History);
    assert!(sim.intent.chains[ci].tasks.iter().all(|t| t.issued));
}

#[test]
fn off_track_rules_apply() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(4);
    run_to(&mut sim, 1);
    let g0 = sim.intent.chains[ci].tasks[0].goal.expect("цель");
    // армия на объекте задачи 0, след — в 20 км: подача по выполнению
    sim.intent.chains[ci].tasks[1].at = 500;
    sim.intent.chains[ci].tasks[1].goal = Some(beyond(&sim, a, g0, 15.0));
    let c = center(&sim, a);
    shift(&mut sim, a, g0.x - c.x, g0.y - c.y);
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    run_to(&mut sim, 2);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0, 1], "следующая подана по выполнению");
    assert_eq!(status(&sim, a).status, Status::Shifted);
    // объект задачи 2 занят своими — в свой час пропущена, взята задача 3
    let g2 = sim.intent.chains[ci].tasks[1].goal.unwrap();
    sim.intent.chains[ci].tasks[2].at = 3;
    sim.intent.chains[ci].tasks[2].goal = Some(g2);
    sim.intent.chains[ci].tasks[3].at = 600;
    sim.intent.chains[ci].tasks[3].goal = Some(beyond(&sim, a, g2, 10.0));
    run_to(&mut sim, 3);
    let mine = under(&sim, a);
    let fr = (0..sim.world.divisions.len()).find(|&i| sim.world.divisions[i].side == Side::Su && !sim.world.divisions[i].state.out() && !mine.contains(&i)).unwrap();
    sim.world.divisions[fr].vars.pos = g2;
    run_to(&mut sim, 4);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0, 1, 3], "задача 2 пропущена, задача 3 подана сразу");
    assert!(!sim.intent.chains[ci].tasks[2].issued && sim.intent.chains[ci].tasks[3].issued);
    assert_eq!((status(&sim, a).status, status(&sim, a).reason.clone()), (Status::Shifted, Some(Reason::Taken)));
}

#[test]
fn on_track_pure_history() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(2);
    run_to(&mut sim, 1);
    // армия на объекте задачи 0 и след там же: по выполнению не подаётся
    let g0 = sim.intent.chains[ci].tasks[0].goal.expect("цель");
    let c = center(&sim, a);
    shift(&mut sim, a, g0.x - c.x, g0.y - c.y);
    sim.intent.track = Some(still_track(&sim, &[a]));
    let g1 = beyond(&sim, a, g0, 15.0);
    sim.intent.chains[ci].tasks[1].at = 5;
    sim.intent.chains[ci].tasks[1].goal = Some(g1);
    run_to(&mut sim, 5);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0], "у следа — без подачи по выполнению");
    // объект задачи 1 занят своими — у следа всё равно подаётся в свой час
    let mine = under(&sim, a);
    let fr = (0..sim.world.divisions.len()).find(|&i| sim.world.divisions[i].side == Side::Su && !sim.world.divisions[i].state.out() && !mine.contains(&i)).unwrap();
    sim.world.divisions[fr].vars.pos = g1;
    assert_eq!(intent::sense(&sim, &sim.intent.chains[ci], &sim.intent.chains[ci].tasks[1]), Err(Reason::Taken));
    run_to(&mut sim, 6);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0, 5]);
    assert_eq!(status(&sim, a).status, Status::History);
}

#[test]
fn skip_senseless() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(3);
    let g0 = sim.intent.chains[ci].tasks[0].goal.expect("цель");
    sim.intent.chains[ci].tasks[1].at = 3;
    sim.intent.chains[ci].tasks[2].at = 500;
    let g2 = beyond(&sim, a, g0, 10.0);
    sim.intent.chains[ci].tasks[2].goal = Some(g2);
    sim.intent.track = Some(off_track(&mut sim, a, 22.0));
    run_to(&mut sim, 3);
    // объект задачи 1 занят своими (дивизия другой армии)
    let g1 = sim.intent.chains[ci].tasks[1].goal.expect("цель");
    let mine = under(&sim, a);
    let fr = (0..sim.world.divisions.len()).find(|&i| sim.world.divisions[i].side == Side::Su && !sim.world.divisions[i].state.out() && !mine.contains(&i)).unwrap();
    sim.world.divisions[fr].vars.pos = g1;
    run_to(&mut sim, 4);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0, 3], "задача 1 пропущена, взята задача 2");
    let ch = &sim.intent.chains[ci];
    assert!(!ch.tasks[1].issued && ch.tasks[2].issued && ch.next == 3);
    assert_eq!(status(&sim, a).status, Status::Shifted);
    assert_eq!(status(&sim, a).reason, Some(Reason::Taken));
}

#[test]
fn leave_and_return() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_8gva");
    run_to(&mut sim, 1);
    sim.intent.track = Some(still_track(&sim, &[a]));
    shift(&mut sim, a, 0.0, -35.0);
    run_to(&mut sim, 2);
    let s = status(&sim, a);
    assert_eq!(s.status, Status::Own);
    assert!(matches!(s.reason, Some(Reason::Strayed { km }) if km > 30.0), "{:?}", s.reason);
    assert!(intent::off_history(&sim, a));
    shift(&mut sim, a, 0.0, 25.0);
    run_to(&mut sim, 3);
    assert_eq!(status(&sim, a).status, Status::History, "{:?}", status(&sim, a));
    assert!(!intent::off_history(&sim, a));
    let log: Vec<Status> = sim.intent.log.iter().filter(|e| e.1 == a).map(|e| e.2).collect();
    assert_eq!(log, vec![Status::History, Status::Own, Status::History]);
}

#[test]
fn german_leave_to_agent() {
    use agents_core::command::control::Control;
    let mut sim = intent_sim();
    let a = hq(&sim, "de_9a");
    run_to(&mut sim, 1);
    sim.intent.track = Some(still_track(&sim, &[a]));
    let mine = under(&sim, a);
    let later = sim.script.iter().find(|o| o.to.iter().any(|d| mine.contains(&(*d as usize)))).expect("приказ сценария дивизиям 9 А").clone();
    assert!(intent::gate(&sim, &later), "на истории приказ проходит");
    shift(&mut sim, a, -35.0, 0.0);
    run_to(&mut sim, 2);
    assert_eq!(status(&sim, a).status, Status::Own);
    assert_eq!(sim.command.control[a as usize], Control::Agent);
    let subs: Vec<usize> = (0..sim.world.hqs.len()).filter(|&k| sim.world.hqs[k].parent == Some(a)).collect();
    assert!(!subs.is_empty() && subs.iter().all(|&k| sim.command.control[k] == Control::Agent));
    assert!(!intent::gate(&sim, &later), "ушла с истории — приказы сценария не проходят");
    // вернулась на место (сдвиг назад целиком: направление армии от старта — её собственное движение) — снова по
    // приказам сценария
    shift(&mut sim, a, 35.0, 0.0);
    run_to(&mut sim, 3);
    assert_eq!(status(&sim, a).status, Status::History, "{:?}", status(&sim, a));
    assert_eq!(sim.command.control[a as usize], Control::Script);
    assert!(subs.iter().all(|&k| sim.command.control[k] == Control::Script));
}

#[test]
fn takeover_mid_operation() {
    let mut sim = load();
    run_to(&mut sim, 72);
    for sd in [Side::Su, Side::De] { agents_core::command::control::command_mode(&mut sim, "intent", sd).unwrap(); }
    sim.intent.track = None;
    let (bf, uf) = (hq(&sim, "su_1bf"), hq(&sim, "su_1uf"));
    sim.command.control[bf as usize] = agents_core::command::control::Control::Player;
    intent::take(&mut sim, bf);
    // задачи до часа принятия — отданы
    assert!(sim.intent.chains.iter().all(|c| c.tasks[..c.next].iter().all(|t| t.at < 72) && c.tasks[c.next..].iter().all(|t| t.at >= 72)));
    run_to(&mut sim, 200);
    let armies = |f: u32| -> Vec<u32> { (0..sim.world.hqs.len() as u32).filter(|&k| sim.world.hqs[k as usize].parent == Some(f) && sim.intent.chains.iter().any(|c| c.owner == k)).collect() };
    for k in armies(bf) {
        let s = status(&sim, k);
        assert_eq!((s.status, s.reason.clone()), (Status::Own, Some(Reason::Player)), "{}", sim.world.hqs[k as usize].id);
        assert!(intent::off_history(&sim, k));
    }
    assert!(sim.documents.iter().all(|d| d.hq != bf || d.tick < 72), "за игрока история не подаёт");
    // 1 УФ продолжает цепочки — без повторной подачи прежних задач
    let sent = sim.documents.iter().filter(|d| d.hq == uf && d.tick >= 72).count();
    let issued: usize = armies(uf).iter().map(|&k| sim.intent.chains[chain_of(&sim, k)].tasks.iter().filter(|t| t.at >= 72 && t.issued).count()).sum();
    assert!(sent > 0, "1 УФ не подал ни одной задачи");
    assert_eq!(sent, issued);
    assert!(armies(uf).iter().any(|&k| status(&sim, k).status != Status::Own));
}

#[test]
fn army_without_track_no_leave() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_8gva");
    sim.intent.track = Some(still_track(&sim, &[]));
    shift(&mut sim, a, 0.0, -50.0);
    run_to(&mut sim, 6);
    assert!(!matches!(status(&sim, a).reason, Some(Reason::Strayed { .. })));
    assert_eq!(sim.world.tick, 6);
    assert_ne!(status(&sim, a).status, Status::Own);
}

#[test]
fn track_missing_journal() {
    // сценарий без файла следа: запись в журнал, следа нет
    let root = repo_root();
    let (mut sim, _) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &data(), &root).unwrap();
    agents_core::command::control::command_mode(&mut sim, "intent", Side::Su).unwrap();
    assert!(sim.intent.track.is_none());
    assert!(sim.journal.iter().any(|e| e.text == "история как замысел: нет следа эталона"));
}

#[test]
fn intent_no_intervention_digest() {
    let run = || { let mut sim = intent_sim(); run_to(&mut sim, 48); sim.digest() };
    assert_eq!(run(), run());
}

#[test]
fn intent_trace_field() {
    let root = repo_root();
    let (mut sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &data(), &root).unwrap();
    for sd in [Side::Su, Side::De] { agents_core::command::control::command_mode(&mut sim, "intent", sd).unwrap(); }
    let t = agents_core::trace::run_fed(&mut sim, 3, &meta, Vec::new(), false);
    let v = t["intent"].as_array().expect("поле intent");
    let e = v.iter().find(|x| x["hq"] == "su_8gva").expect("su_8gva");
    assert_eq!(e["changes"][0]["status"], "history");
    assert!(e["changes"][0]["reason"].is_null());
    let (mut sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &data(), &root).unwrap();
    let p = agents_core::command::control::command_mode(&mut sim, "fronts", Side::Su).unwrap();
    let t = agents_core::trace::run_fed(&mut sim, 1, &meta, p, true);
    assert!(t.get("intent").is_none(), "без режима — без поля");
}

#[test]
fn committed_tracks_match_scenarios() {
    // след эталона рядом со сценарием собран по нынешним данным сценария (отпечаток входа)
    let root = repo_root();
    for s in ["berlin-1945", "vistula-oder-1945"] {
        let t = track::load(&format!("{root}/packages/sim/data/scenarios/agents/{s}.json")).unwrap_or_else(|e| panic!("{s}: {e}"));
        assert!(t.armies.len() > 10 && t.hours > 100, "{s}");
    }
    let mut sim = intent_sim_with_track();
    assert!(sim.intent.track.is_some());
    assert!(!sim.journal.iter().any(|e| e.text.starts_with("история как замысел")));
    sim.step();
}

fn intent_sim_with_track() -> Sim {
    let mut sim = load();
    for sd in [Side::Su, Side::De] { agents_core::command::control::command_mode(&mut sim, "intent", sd).unwrap(); }
    sim
}

fn set_cohesion(sim: &mut Sim, h: u32, v: f64) { for i in under(sim, h) { sim.world.divisions[i].vars.cohesion = v; } }

#[test]
fn unfit_on_track_issues() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(2);
    sim.intent.chains[ci].tasks[1].at = 4;
    run_to(&mut sim, 4);
    sim.intent.track = Some(still_track(&sim, &[a]));
    set_cohesion(&mut sim, a, 0.2);
    assert_eq!(intent::sense(&sim, &sim.intent.chains[ci], &sim.intent.chains[ci].tasks[1]), Err(Reason::Unfit));
    run_to(&mut sim, 5);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0, 4], "у следа неспособность задачу не задерживает");
    assert_eq!(status(&sim, a).status, Status::History);
}

#[test]
fn unfit_off_track_held_then_issued() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(2);
    sim.intent.chains[ci].tasks[1].at = 4;
    run_to(&mut sim, 4);
    let g0 = sim.intent.chains[ci].tasks[0].goal.expect("цель");
    sim.intent.chains[ci].tasks[1].goal = Some(beyond(&sim, a, g0, 10.0));
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    set_cohesion(&mut sim, a, 0.2);
    run_to(&mut sim, 6);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0], "отошла от следа и неспособна — задача ждёт");
    let ch = &sim.intent.chains[ci];
    assert!(!ch.tasks[1].issued && ch.next == 1, "задача не пропущена");
    assert_eq!((status(&sim, a).status, status(&sim, a).reason.clone()), (Status::Shifted, Some(Reason::Unfit)));
    set_cohesion(&mut sim, a, 0.9);
    run_to(&mut sim, 7);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0, 6], "пришла в себя — задача подана");
    assert!(sim.intent.chains[ci].tasks[1].issued);
}

/// Получения приказа с этой пометкой дивизиями (журнал).
fn received(sim: &Sim, note: &str, divs: &[u32]) -> usize {
    sim.journal.iter().filter(|e| divs.contains(&e.agent) && e.text.starts_with("получен приказ") && e.text.ends_with(&format!(": {note}"))).count()
}

/// Немецкий приказ сценария дивизиям 9 А (час не раньше 6) подаётся раньше часа по выполнению прежней задачи: к часу
/// `o.at - 4` цепочка 9 А — выполненная задача A и этот приказ, армия отошла от следа. (приказ, его дивизии, цепочка)
fn german_early(sim: &mut Sim) -> (agents_core::world::ScriptOrder, Vec<u32>, usize) {
    use agents_core::intent::Step;
    let a = hq(sim, "de_9a");
    let mine: Vec<u32> = under(sim, a).into_iter().map(|i| i as u32).collect();
    // приказ сценария дивизиям 9 А с неповторяющейся пометкой, час — не раньше 6
    let o = sim.script.iter().find(|o| o.at >= 6 && !o.note.is_empty() && o.to.iter().any(|d| mine.contains(d))
        && sim.script.iter().filter(|x| x.note == o.note).count() == 1).expect("приказ").clone();
    let divs: Vec<u32> = o.to.iter().copied().filter(|d| mine.contains(d)).collect();
    run_to(sim, o.at - 4);
    // цепочка 9 А: выполненная задача A, за ней — этот приказ («держать» у своих — смысл есть)
    let ci = chain_of(sim, a);
    let c = center(sim, a);
    let pos = sim.world.divisions[divs[0] as usize].vars.pos;
    let mut done_a = sim.intent.chains[ci].tasks[0].clone();
    let mut dummy = o.clone();
    dummy.at = 0;
    dummy.note = "задача A".into();
    done_a.step = Step::Order(dummy);
    done_a.at = 0;
    done_a.goal = Some(c);
    done_a.kind = Goal::Move;
    done_a.issued = true;
    let mut b = done_a.clone();
    b.step = Step::Order(o.clone());
    b.at = o.at;
    b.goal = Some(pos);
    b.kind = Goal::Defend;
    b.issued = false;
    sim.intent.chains[ci].tasks = vec![done_a, b];
    sim.intent.chains[ci].next = 1;
    sim.intent.track = Some(off_track(sim, a, 20.0));
    (o, divs, ci)
}

#[test]
fn german_early_order_not_twice() {
    let mut sim = intent_sim();
    let a = hq(&sim, "de_9a");
    let (o, divs, ci) = german_early(&mut sim);
    run_to(&mut sim, o.at - 3);
    assert!(sim.intent.chains[ci].tasks[1].issued, "подан раньше часа по выполнению: {:?}", status(&sim, a));
    run_to(&mut sim, o.at + 30);
    let got = received(&sim, &o.note, &divs);
    assert!(got >= 1 && got <= divs.len(), "дивизии получили приказ {got} раз (дивизий {})", divs.len());
    // в свой час приказ сценария до дивизий второй раз не дошёл: каждая получила его не больше раза
    for &d in &divs { assert!(received(&sim, &o.note, &[d]) <= 1, "{} получила дважды", sim.world.divisions[d as usize].id); }
    assert!(sim.world.in_transit.iter().all(|(_, x)| x.note != o.note), "в пути второго нет");
}

#[test]
fn withdrawal_through_world() {
    let ev = load().withdrawals.iter().min_by_key(|w| w.at).unwrap().clone();
    assert_eq!(ev.at, 0);
    // у следа — отвод применяется
    let mut sim = intent_sim();
    let a = hq(&sim, "de_9a");
    let mine: Vec<u32> = under(&sim, a).into_iter().map(|i| i as u32).filter(|d| ev.to.contains(d)).collect();
    assert!(!mine.is_empty());
    run_to(&mut sim, 1);
    assert!(mine.iter().all(|&d| sim.world.divisions[d as usize].vars.positions == Some(ev.positions)));
    // отошла от следа и неспособна — отвод задержан, затем устарел: не применён, смена записана
    let mut sim = intent_sim();
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    set_cohesion(&mut sim, a, 0.2);
    let before: Vec<_> = mine.iter().map(|&d| sim.world.divisions[d as usize].vars.positions).collect();
    run_to(&mut sim, 3);
    let after: Vec<_> = mine.iter().map(|&d| sim.world.divisions[d as usize].vars.positions).collect();
    assert_eq!(before, after, "отвод не применён");
    let ci = chain_of(&sim, a);
    let wi = sim.intent.chains[ci].tasks.iter().position(|t| matches!(&t.step, Step::Withdrawal(w) if w.at == ev.at)).unwrap();
    assert!(!sim.intent.chains[ci].tasks[wi].issued && sim.intent.chains[ci].next > wi);
    assert!(sim.intent.log.iter().any(|e| e.1 == a && e.0 > 0 && e.2 == Status::Shifted && e.3 == Some(Reason::Unfit)), "устаревшая задача записана");
}

#[test]
fn stale_task_superseded() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(3);
    sim.intent.chains[ci].tasks[1].at = 4;
    sim.intent.chains[ci].tasks[2].at = 6;
    run_to(&mut sim, 4);
    let g0 = sim.intent.chains[ci].tasks[0].goal.expect("цель");
    sim.intent.chains[ci].tasks[1].goal = Some(beyond(&sim, a, g0, 8.0));
    sim.intent.chains[ci].tasks[2].goal = Some(beyond(&sim, a, g0, 12.0));
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    set_cohesion(&mut sim, a, 0.2);
    run_to(&mut sim, 6);
    assert_eq!(status(&sim, a).reason, Some(Reason::Unfit));
    // пришла в себя в час задачи 2: задача 1 устарела, подана только задача 2
    set_cohesion(&mut sim, a, 0.9);
    run_to(&mut sim, 7);
    assert_eq!(docs(&sim, f, "su_8gva"), vec![0, 6]);
    let ch = &sim.intent.chains[ci];
    assert!(!ch.tasks[1].issued && ch.tasks[2].issued);
    assert!(sim.intent.log.iter().any(|e| e.0 == 6 && e.1 == a && e.2 == Status::Shifted && e.3 == Some(Reason::Unfit)));
}

#[test]
fn shifted_band_reason_strayed() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_8gva");
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    run_to(&mut sim, 3);
    let s = status(&sim, a);
    assert_eq!(s.status, Status::Shifted);
    assert!(matches!(s.reason, Some(Reason::Strayed { km }) if km > 15.0 && km <= 30.0), "{:?}", s.reason);
    assert!(intent::reason_text(s.reason.as_ref().unwrap()).starts_with("армия в "));
    // расстояние меняется каждый час — запись одна
    assert_eq!(sim.intent.log.iter().filter(|e| e.1 == a && matches!(e.3, Some(Reason::Strayed { .. }))).count(), 1);
}

// ---------- командующие за армии вне истории ----------

use agents_core::commander::options::Kind;
use agents_core::commander::Commander;

fn commander(sim: &Sim, h: u32) -> &Commander { sim.commanders.list.iter().find(|c| c.hq == h).expect("командующий") }

/// Армию `a` увели с истории в час 1: след эталона на месте, армия — в 35 км к югу.
fn stray(sim: &mut Sim, a: u32) {
    run_to(sim, 1);
    sim.intent.track = Some(still_track(sim, &[a]));
    shift(sim, a, 0.0, -35.0);
    run_to(sim, 2);
    assert_eq!(status(sim, a).status, Status::Own);
}

/// Выбранные решения «поставить задачу» армии `a`: (час, точка, из плана).
fn assigns(sim: &Sim, f: u32, a: u32) -> Vec<(u32, XY, bool)> {
    commander(sim, f).decisions.iter().filter_map(|d| match &d.options[d.chosen].choice.kind {
        Kind::Assign { army, at, from_plan, .. } if *army == a => Some((d.tick, *at, *from_plan)),
        _ => None,
    }).collect()
}

/// Точка в `km` от центра армии к цели фронта (объект профиля командующего).
fn toward_objective(sim: &Sim, f: u32, a: u32, km: f64) -> XY {
    let r = &sim.rules.commanders;
    let p = r.for_hq(&sim.world.hqs[f as usize].id).expect("профиль");
    let o = sim.theatre.proj.to_xy(r.objective_at(p.objective.as_deref().expect("объект")).expect("объект"));
    let c = center(sim, a);
    let l = c.dist(o).max(1e-6);
    XY::new(c.x + (o.x - c.x) / l * km, c.y + (o.y - c.y) / l * km)
}

#[test]
fn commander_silent_on_history() {
    let mut sim = intent_sim();
    let f = hq(&sim, "su_1bf");
    run_to(&mut sim, 48);
    assert!(commander(&sim, f).decisions.is_empty(), "все армии на истории — Жуков не решает: {:?}", commander(&sim, f).decisions.iter().map(|d| d.trigger.clone()).collect::<Vec<_>>());
}

#[test]
fn assign_from_plan() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    stray(&mut sim, a);
    sim.command.intent[a as usize] = None;
    // объект плана впереди, у противника
    let p = toward_objective(&sim, f, a, 12.0);
    let ci = chain_of(&sim, a);
    let mut t = sim.intent.chains[ci].tasks[0].clone();
    (t.at, t.goal, t.kind, t.issued) = (9999, Some(p), Goal::Attack, false);
    sim.intent.chains[ci].tasks.push(t.clone());
    run_to(&mut sim, 26);
    let got = assigns(&sim, f, a);
    assert!(!got.is_empty(), "решения: {:?}", commander(&sim, f).decisions.iter().map(|d| d.options[d.chosen].choice.label.clone()).collect::<Vec<_>>());
    let (tick, at, from_plan) = got[0];
    assert!(from_plan, "объект из плана: {at:?}");
    assert!(intent::plan_objectives(&sim, f).iter().any(|q| q.dist(at) < 1e-6));
    assert!(docs(&sim, f, "su_8gva").iter().any(|&d| d >= tick), "директива армии подана");
    // диспетчер задачу командующего не перебивает: у армии вне истории цепочка стоит
    let ci = chain_of(&sim, a);
    t.at = sim.world.tick + 1;
    t.goal = Some(toward_objective(&sim, f, a, 5.0));
    sim.intent.chains[ci].tasks.push(t);
    let end = sim.world.tick + 6;
    run_to(&mut sim, end);
    let d = sim.command.intent[a as usize].as_ref().expect("задача армии");
    assert!(d.id.starts_with("командующий:"), "{}", d.id);
    assert!(!sim.intent.chains[ci].tasks.last().unwrap().issued);
}

#[test]
fn assign_terrain_fallback() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    stray(&mut sim, a);
    sim.command.intent[a as usize] = None;
    for c in sim.intent.chains.iter_mut() { for t in c.tasks.iter_mut() { t.goal = None; } }
    assert!(intent::plan_objectives(&sim, f).is_empty());
    run_to(&mut sim, 26);
    let got = assigns(&sim, f, a);
    assert!(!got.is_empty());
    let (_, at, from_plan) = got[0];
    assert!(!from_plan);
    let pr = &sim.theatre.proj;
    let centre = |ring: &[[f64; 2]]| { let n = ring.len() as f64; let v: Vec<XY> = ring.iter().map(|q| pr.to_xy(*q)).collect(); XY::new(v.iter().map(|q| q.x).sum::<f64>() / n, v.iter().map(|q| q.y).sum::<f64>() / n) };
    let named = sim.theatre.areas.iter().any(|ar| centre(&ar.ring).dist(at) < 1e-6) || sim.theatre.bridges.iter().any(|b| b.pos.dist(at) < 1e-6);
    assert!(named, "точка — населённый пункт или мост: {at:?}");
}

#[test]
fn no_idle_army() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    stray(&mut sim, a);
    run_to(&mut sim, 50);
    let mut ticks = vec![2];
    ticks.extend(docs(&sim, f, "su_8gva").into_iter().filter(|&t| t >= 2));
    ticks.push(50);
    let gap = ticks.windows(2).map(|w| w[1] - w[0]).max().unwrap();
    assert!(gap <= 24, "промежуток без задачи {gap} ч: {ticks:?}");
}

#[test]
fn no_idle_army_96h() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    stray(&mut sim, a);
    run_to(&mut sim, 98);
    let mut ticks = vec![2];
    ticks.extend(docs(&sim, f, "su_8gva").into_iter().filter(|&t| t >= 2));
    ticks.push(98);
    let gap = ticks.windows(2).map(|w| w[1] - w[0]).max().unwrap();
    assert!(gap <= 24, "промежуток без задачи {gap} ч: {ticks:?}");
}

/// Армия вне истории с директивой командующего (задача поставлена и дошла).
fn strayed_with_task(sim: &mut Sim, a: u32) {
    stray(sim, a);
    while !sim.command.intent[a as usize].as_ref().is_some_and(|d| d.id.starts_with("командующий:")) && sim.world.tick < 60 { sim.step(); }
    assert!(sim.command.intent[a as usize].as_ref().unwrap().id.starts_with("командующий:"), "задача командующего не дошла");
}

fn goal_of(sim: &Sim, a: u32) -> XY { intent::of_directive(0, sim.command.intent[a as usize].as_ref().unwrap()).goal.expect("цель") }

#[test]
fn needs_task_branches() {
    use agents_core::commander::options_su::needs_task;
    let mut sim = intent_sim();
    let a = hq(&sim, "su_8gva");
    strayed_with_task(&mut sim, a);
    assert!(!needs_task(&sim, a), "задача действует");
    // выполнена: армия у цели
    let g = goal_of(&sim, a);
    let mut done = sim.fork();
    let c = center(&done, a);
    shift(&mut done, a, g.x - c.x, g.y - c.y);
    assert!(needs_task(&done, a), "выполнена");
    // без смысла: объект занят своими (дивизия другой армии), армия на месте
    let mine = under(&sim, a);
    let fr = friend(&sim, &mine);
    sim.world.divisions[fr].vars.pos = g;
    assert!(needs_task(&sim, a), "объект взят — без смысла");
    sim.command.intent[a as usize] = None;
    assert!(needs_task(&sim, a), "задачи нет");
}

#[test]
fn assign_promptly_when_done() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    strayed_with_task(&mut sim, a);
    let g = goal_of(&sim, a);
    let c = center(&sim, a);
    shift(&mut sim, a, g.x - c.x, g.y - c.y);
    let t0 = sim.world.tick;
    run_to(&mut sim, t0 + 2);
    assert_eq!(status(&sim, a).status, Status::Own);
    let d = commander(&sim, f).decisions.iter().find(|d| d.tick >= t0).expect("решение в тот же час");
    assert!(d.trigger.contains("армия без задачи"), "{}", d.trigger);
    assert!(matches!(d.options[d.chosen].choice.kind, Kind::Assign { army, .. } if army == a), "{}", d.options[d.chosen].choice.label);
    assert!(!d.options.iter().any(|o| o.choice.kind == Kind::Continue), "«продолжать» не в меню");
}

#[test]
fn german_off_history_army_decides() {
    use agents_core::command::control::Control;
    let mut sim = intent_sim();
    let (a, g) = (hq(&sim, "de_9a"), hq(&sim, "de_hgr_weichsel"));
    run_to(&mut sim, 1);
    assert_eq!(sim.command.control[a as usize], Control::Script, "на истории — по приказам сценария");
    assert!(commander(&sim, a).decisions.is_empty(), "на истории командующий не решает");
    sim.intent.track = Some(still_track(&sim, &[a]));
    shift(&mut sim, a, -35.0, 0.0);
    run_to(&mut sim, 2);
    assert_eq!(status(&sim, a).status, Status::Own);
    assert_eq!(sim.command.control[a as usize], Control::Agent);
    let left = sim.intent.log.iter().filter(|e| e.1 == a && e.2 == Status::Own).map(|e| e.0).min().expect("уход записан");
    assert_eq!(sim.command.control[g as usize], Control::Script, "группа армий — по приказам сценария");
    run_to(&mut sim, 2 + 8);
    let c = commander(&sim, a);
    assert!(!c.decisions.is_empty(), "командующий 9 А решает сам");
    assert!(c.decisions.iter().all(|d| d.tick >= left), "решения — после ухода с истории (час {left})");
    assert!(sim.documents.iter().any(|d| d.hq == a && d.tick >= 1), "документы 9 А");
    assert!(sim.commanders.list.iter().find(|c| c.hq == g).is_none_or(|c| c.decisions.is_empty()), "группа армий за неё не решает");
}

/// Режим `intent` у обеих сторон: советские фронты по сценарию, армии — агенты, немецкие штабы по сценарию.
#[test]
fn intent_mode_both_sides() {
    use agents_core::command::control::Control;
    let mut sim = load();
    for sd in [Side::Su, Side::De] { agents_core::command::control::command_mode(&mut sim, "intent", sd).expect("режим"); }
    assert_eq!(sim.intent.enabled, [true, true]);
    let c = |id: &str| sim.command.control[hq(&sim, id) as usize];
    assert_eq!((c("su_1bf"), c("su_1uf")), (Control::Script, Control::Script));
    assert_eq!(c("de_9a"), Control::Script);
    let army = sim.world.hqs.iter().position(|h| h.side == Side::Su && h.echelon == agents_core::model::Echelon::Army).expect("армия");
    assert_eq!(sim.command.control[army], Control::Agent);
}

// ---------- вмешательства (мерило 2) ----------

fn subtree_of(sim: &Sim, h: u32) -> Vec<usize> {
    (0..sim.world.hqs.len()).filter(|&k| { let mut x = k; for _ in 0..8 { if x == h as usize { return true; } match sim.world.hqs[x].parent { Some(p) => x = p as usize, None => return false } } false }).collect()
}

/// `hold`: поддерево штаба с `from` — у игрока («оборонять на месте» его армиям), через `hours` — снова как было.
#[test]
fn intervene_hold() {
    use agents_core::command::control::Control;
    let mut sim = intent_sim();
    let f = hq(&sim, "su_1bf");
    let a = hq(&sim, "su_8gva");
    let sub = subtree_of(&sim, f);
    let before: Vec<Control> = sub.iter().map(|&k| sim.command.control[k]).collect();
    intent::intervene(&mut sim, &json!({ "id": "t", "actions": [{ "hold": { "hq": "su_1bf", "from": 2, "hours": 3 } }] })).expect("вмешательство");
    run_to(&mut sim, 3);
    assert!(sub.iter().all(|&k| sim.command.control[k] == Control::Player), "поддерево у игрока");
    assert_eq!((status(&sim, a).status, status(&sim, a).reason.clone()), (Status::Own, Some(Reason::Player)));
    assert!(sim.documents.iter().any(|d| d.hq == f && d.tick == 2 && d.to.iter().any(|t| t == "su_8gva") && d.text.starts_with("оборонять")), "оборонять на месте");
    run_to(&mut sim, 6);
    let after: Vec<Control> = sub.iter().map(|&k| sim.command.control[k]).collect();
    assert_eq!(after, before, "управление — как до вмешательства");
    assert_ne!(status(&sim, a).reason, Some(Reason::Player), "снова по обычным правилам");
    assert!(sim.intent.log.iter().any(|&(t, h, s, _)| t == 5 && h == a && s == Status::History), "в час возврата — на истории");
}

/// `remove`: дивизии штаба выведены с начала (не введены в операцию), штаб — «сам» с причиной.
#[test]
fn intervene_remove() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_1gta");
    let ds = under(&sim, a);
    assert!(!ds.is_empty());
    intent::intervene(&mut sim, &json!({ "id": "t", "actions": [{ "remove": { "hq": "su_1gta" } }] })).expect("вмешательство");
    run_to(&mut sim, 5);
    assert!(ds.iter().all(|&i| sim.world.divisions[i].state == agents_core::model::State::Pending), "выведены");
    assert!(under(&sim, a).is_empty());
    assert_eq!(status(&sim, a).status, Status::Own);
    assert!(matches!(status(&sim, a).reason, Some(Reason::Intervention(_))));
    assert!(sim.journal.iter().any(|e| e.text.contains("выведена")), "запись в журнале");
}

/// `drop`: задачи получателя после часа с целью у точки — не существуют; прочие остаются.
#[test]
fn intervene_drop() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_3gta");
    let ci = chain_of(&sim, a);
    let berlin = sim.theatre.proj.to_xy([13.40, 52.52]);
    let after = (agents_core::time::parse_hours("1945-04-20T00:00").unwrap() - sim.start_hour) as u32;
    let hit = |t: &Task| t.at >= after && t.goal.is_some_and(|g| g.dist(berlin) <= 25.0);
    let n = sim.intent.chains[ci].tasks.len();
    let k = sim.intent.chains[ci].tasks.iter().filter(|t| hit(t)).count();
    assert!(k > 0, "у 3 гв. ТА есть задачи на Берлин");
    intent::intervene(&mut sim, &json!({ "id": "t", "actions": [{ "drop": { "to": "su_3gta", "after": "1945-04-20T00:00", "near": [13.40, 52.52], "km": 25 } }] })).expect("вмешательство");
    let c = &sim.intent.chains[ci];
    assert_eq!(c.tasks.len(), n - k);
    assert!(!c.tasks.iter().any(hit));
}

/// `permit`: немецкая армия в свой час получает разрешение на отход — приказы отхода дивизиям, армия с истории.
#[test]
fn intervene_permit() {
    use agents_core::command::directive::Task as DTask;
    let mut sim = intent_sim();
    let a = hq(&sim, "de_9a");
    intent::intervene(&mut sim, &json!({ "id": "t", "actions": [{ "permit": { "army": "de_9a", "at": 3 } }] })).expect("вмешательство");
    run_to(&mut sim, 3);
    assert_ne!(status(&sim, a).status, Status::Own, "до часа — по истории");
    run_to(&mut sim, 4);
    assert_eq!(status(&sim, a).status, Status::Own);
    assert!(matches!(status(&sim, a).reason, Some(Reason::Intervention(_))));
    let ds = under(&sim, a);
    let w = ds.iter().filter(|&&i| sim.command.div_task[i].as_ref().is_some_and(|d| d.task == DTask::Withdraw) || sim.command.in_transit.iter().any(|(_, d)| d.to == Target::Division(i as u32) && d.task == DTask::Withdraw)).count();
    assert_eq!(w, ds.len(), "отход — всем дивизиям армии");
}

#[test]
fn intervene_errors() {
    let mut sim = intent_sim();
    assert!(intent::intervene(&mut sim, &json!({ "actions": [{ "remove": { "hq": "su_нет" } }] })).is_err());
    assert!(intent::intervene(&mut sim, &json!({ "actions": [{ "fly": {} }] })).is_err());
    assert!(intent::intervene(&mut sim, &json!({ "actions": [{ "permit": { "army": "su_8gva", "at": 1 } }] })).is_err(), "разрешение — немецкой армии");
}

/// Цепочка кончилась у армии, отошедшей от следа (дальше returnKm, не дальше leaveKm), — «сам» (цепочка кончилась),
/// и командующий фронта ставит ей задачу за 1–2 ч (последняя задача выполнена: армия у её цели; невыполненную
/// командующий оставляет в силе).
#[test]
fn chain_end_off_track_hands_over() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    run_to(&mut sim, 1);
    let ci = chain_of(&sim, a);
    let n = sim.intent.chains[ci].next;
    sim.intent.chains[ci].tasks.truncate(n);
    let g = sim.intent.chains[ci].tasks[n - 1].goal.expect("цель");
    let c = center(&sim, a);
    shift(&mut sim, a, g.x - c.x, g.y - c.y);
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    run_to(&mut sim, 2);
    assert_eq!((status(&sim, a).status, status(&sim, a).reason.clone()), (Status::Own, Some(Reason::ChainEnd)));
    run_to(&mut sim, 3);
    assert!(assigns(&sim, f, a).iter().any(|&(t, _, _)| t <= 3), "командующий ставит задачу");
}

/// Цепочка кончилась у армии у следа — чистая история: остаётся «по истории», без приказов.
#[test]
fn chain_end_on_track_stays_history() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_8gva");
    run_to(&mut sim, 1);
    let ci = chain_of(&sim, a);
    let n = sim.intent.chains[ci].next;
    sim.intent.chains[ci].tasks.truncate(n);
    sim.intent.track = Some(still_track(&sim, &[a]));
    run_to(&mut sim, 3);
    assert_eq!(status(&sim, a).status, Status::History);
}

// ---------- задача армии вне истории — обязанность штаба фронта ----------

/// Армия вне истории без задачи получает задачу за 1–2 ч независимо от решения командующего по фронту («поставить
/// задачу» — решение штаба без других вариантов, не вариант в споре решений); несколько таких армий в один час — все.
#[test]
fn idle_off_history_armies_all_tasked() {
    let mut sim = intent_sim();
    let f = hq(&sim, "su_1bf");
    let (a, b) = (hq(&sim, "su_8gva"), hq(&sim, "su_5ua"));
    run_to(&mut sim, 1);
    for h in [a, b] {
        let ci = chain_of(&sim, h);
        let n = sim.intent.chains[ci].next;
        sim.intent.chains[ci].tasks.truncate(n);
        let g = sim.intent.chains[ci].tasks[n - 1].goal.expect("цель");
        let c = center(&sim, h);
        shift(&mut sim, h, g.x - c.x, g.y - c.y);
    }
    let mut t = off_track(&mut sim, a, 20.0);
    t.armies.extend(off_track(&mut sim, b, 20.0).armies);
    sim.intent.track = Some(t);
    run_to(&mut sim, 3);
    assert_eq!((status(&sim, a).status, status(&sim, b).status), (Status::Own, Status::Own));
    let (ta, tb) = (assigns(&sim, f, a), assigns(&sim, f, b));
    assert!(ta.iter().any(|x| x.0 <= 3) && tb.iter().any(|x| x.0 <= 3), "обе армии с задачей: {ta:?} {tb:?}");
    assert_eq!(ta.iter().map(|x| x.0).min(), tb.iter().map(|x| x.0).min(), "в одном часе");
    // решения командующего по фронту — без «поставить задачу» среди вариантов
    let c = commander(&sim, f);
    // «поставить задачу» — решение штаба без спора: где оно есть, других вариантов нет (решения есть — проверка не пустая)
    let tasking: Vec<_> = c.decisions.iter().filter(|d| d.options.iter().any(|o| matches!(o.choice.kind, Kind::Assign { .. }))).collect();
    assert!(!tasking.is_empty(), "решения «поставить задачу» есть");
    assert!(tasking.iter().all(|d| d.options.len() == 1), "{:?}", tasking.iter().map(|d| d.options.len()).collect::<Vec<_>>());
    assert!(sim.documents.iter().any(|d| d.hq == f && d.text.contains("задача армии вне истории")), "документ штаба");
}

/// Зона изменённого замысла (`drop`): командующий не ставит армии задачу в ней.
#[test]
fn drop_zone_excluded_from_assign() {
    // армия у цели последней задачи, цепочка кончилась, след в 20 км
    let prepare = |zone: Option<(XY, f64)>| {
        let mut sim = intent_sim();
        let a = hq(&sim, "su_8gva");
        run_to(&mut sim, 1);
        let ci = chain_of(&sim, a);
        let n = sim.intent.chains[ci].next;
        sim.intent.chains[ci].tasks.truncate(n);
        let g = sim.intent.chains[ci].tasks[n - 1].goal.expect("цель");
        let c = center(&sim, a);
        shift(&mut sim, a, g.x - c.x, g.y - c.y);
        if let Some((at, km)) = zone {
            let ll = sim.theatre.proj.to_lnglat(at);
            intent::intervene(&mut sim, &json!({ "actions": [{ "drop": { "to": "su_8gva", "after": 0, "near": ll, "km": km } }] })).expect("вмешательство");
        }
        sim.intent.track = Some(off_track(&mut sim, a, 20.0));
        run_to(&mut sim, 3);
        sim
    };
    let free = prepare(None);
    let (a, f) = (hq(&free, "su_8gva"), hq(&free, "su_1bf"));
    let (_, at, _) = *assigns(&free, f, a).first().expect("задача без зоны");
    let sim = prepare(Some((at, 15.0)));
    assert!(!sim.intent.drops.is_empty(), "зона хранится");
    assert!(assigns(&sim, f, a).iter().all(|x| x.1.dist(at) > 15.0), "задача вне зоны");
}

/// Конец удержания: распоряжение «оборонять на месте» снято — армии, ушедшей с истории, нужна задача.
#[test]
fn release_clears_hold_intent() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_8gva");
    intent::intervene(&mut sim, &json!({ "actions": [{ "hold": { "hq": "su_1bf", "from": 1, "hours": 2 } }] })).expect("вмешательство");
    run_to(&mut sim, 2);
    assert!(sim.command.intent[a as usize].as_ref().is_some_and(|d| d.id.starts_with("вмешательство:держать")));
    run_to(&mut sim, 4);
    assert!(!sim.command.intent[a as usize].as_ref().is_some_and(|d| d.id.starts_with("вмешательство:держать")), "держать — снято");
}

/// Запасная задача по местности — только в районе операции фронта (не дальше leaveKm от объекта плана); такой точки
/// нет — «занять оборону» у ближайшего населённого пункта.
#[test]
fn assign_stays_in_operation_area() {
    use agents_core::command::directive::Task as DTask;
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    run_to(&mut sim, 1);
    let ci = chain_of(&sim, a);
    let n = sim.intent.chains[ci].next;
    sim.intent.chains[ci].tasks.truncate(n);
    // армия за 150 км восточнее, её ось — на восток: прочь от всех объектов плана фронта
    shift(&mut sim, a, 150.0, 0.0);
    let c = center(&sim, a);
    if let Some(d) = sim.command.intent[a as usize].as_mut() { d.axis = vec![c, XY::new(c.x + 100.0, c.y)]; }
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    run_to(&mut sim, 3);
    assert_eq!(status(&sim, a).status, Status::Own);
    let plan = intent::plan_objectives(&sim, f);
    let leave = sim.rules.intent.leave_km;
    let ds: Vec<_> = commander(&sim, f).decisions.iter().filter_map(|d| match &d.options[d.chosen].choice.kind {
        Kind::Assign { army, at, defend, .. } if *army == a => Some((*at, *defend, d.options[d.chosen].choice.label.clone())),
        _ => None,
    }).collect();
    assert!(!ds.is_empty(), "задача поставлена");
    for (at, defend, label) in &ds {
        assert!(*defend || plan.iter().any(|g| g.dist(*at) <= leave), "цель вне района операции: {label}");
    }
    let (_, defend, label) = &ds[0];
    assert!(*defend && label.contains("нет задачи в полосе фронта — оборона"), "{label}");
    run_to(&mut sim, 8);
    assert_eq!(sim.command.intent[a as usize].as_ref().map(|d| d.task), Some(DTask::Defend), "оборона дошла");
}

// ---------- мелочи этапа ----------

/// Армия вернулась к следу в час более поздней задачи: задержанная задача устаревает молча — у следа армия идёт как
/// чистая история, короткой записи «со сдвигом» в этот час нет.
#[test]
fn supersede_on_track_silent() {
    let mut sim = intent_sim();
    let a = hq(&sim, "su_8gva");
    let ci = chain_of(&sim, a);
    sim.intent.chains[ci].tasks.truncate(3);
    sim.intent.chains[ci].tasks[1].at = 4;
    sim.intent.chains[ci].tasks[2].at = 6;
    run_to(&mut sim, 4);
    let g0 = sim.intent.chains[ci].tasks[0].goal.expect("цель");
    sim.intent.chains[ci].tasks[1].goal = Some(beyond(&sim, a, g0, 8.0));
    sim.intent.chains[ci].tasks[2].goal = Some(beyond(&sim, a, g0, 12.0));
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    set_cohesion(&mut sim, a, 0.2);
    run_to(&mut sim, 6);
    assert_eq!(status(&sim, a).status, Status::Shifted);
    assert!(!sim.intent.chains[ci].tasks[1].issued, "задача 1 задержана");
    // в час задачи 2 армия снова у следа и в себе
    set_cohesion(&mut sim, a, 0.9);
    sim.intent.track = Some(still_track(&sim, &[a]));
    run_to(&mut sim, 7);
    let ch = &sim.intent.chains[ci];
    assert!(!ch.tasks[1].issued && ch.tasks[2].issued, "задача 1 устарела, подана задача 2");
    assert_eq!(status(&sim, a).status, Status::History);
    let at6: Vec<_> = sim.intent.log.iter().filter(|e| e.0 == 6 && e.1 == a).map(|e| e.2).collect();
    assert_eq!(at6, vec![Status::History], "в час 6 — одна смена «по истории»");
}

/// Немецкий приказ, поданный раньше своего часа (очередь диспетчера), проходит те же проверки, что приказ в свой час:
/// штаб, отдающий его, — по приказам сценария, штабы стороны — по сценарию (не по доктрине).
#[test]
fn german_queue_checks_control_and_sources() {
    use agents_core::command::control::Control;
    // штабы стороны по доктрине — приказ сценария не идёт
    let mut sim = intent_sim();
    let (o, divs, ci) = german_early(&mut sim);
    sim.sources[1] = agents_core::staff::Source::Doctrine;
    run_to(&mut sim, o.at - 2);
    assert!(sim.intent.chains[ci].tasks[1].issued, "подан диспетчером");
    assert_eq!(received(&sim, &o.note, &divs), 0);
    assert!(sim.world.in_transit.iter().all(|(_, x)| x.note != o.note), "в пути нет");
    // отдающий штаб не по сценарию — тоже
    let mut sim = intent_sim();
    let (o, divs, ci) = german_early(&mut sim);
    sim.command.control[o.hq as usize] = Control::Agent;
    run_to(&mut sim, o.at - 2);
    assert!(sim.intent.chains[ci].tasks[1].issued, "подан диспетчером");
    assert_eq!(received(&sim, &o.note, &divs), 0);
    assert!(sim.world.in_transit.iter().all(|(_, x)| x.note != o.note), "в пути нет");
}

/// Оборона при отсутствии задачи в районе операции — у населённого пункта не дальше 10 км от центра армии, иначе на месте.
#[test]
fn assign_defend_near_or_in_place() {
    let mut sim = intent_sim();
    let (a, f) = (hq(&sim, "su_8gva"), hq(&sim, "su_1bf"));
    run_to(&mut sim, 1);
    let ci = chain_of(&sim, a);
    let n = sim.intent.chains[ci].next;
    sim.intent.chains[ci].tasks.truncate(n);
    // армия за 150 км восточнее, её ось — на восток: прочь от всех объектов плана фронта
    shift(&mut sim, a, 150.0, 0.0);
    let c = center(&sim, a);
    if let Some(d) = sim.command.intent[a as usize].as_mut() { d.axis = vec![c, XY::new(c.x + 100.0, c.y)]; }
    sim.intent.track = Some(off_track(&mut sim, a, 20.0));
    run_to(&mut sim, 3);
    let ds: Vec<_> = commander(&sim, f).decisions.iter().filter_map(|d| match &d.options[d.chosen].choice.kind {
        Kind::Assign { army, at, defend: true, .. } if *army == a => Some((*at, d.options[d.chosen].choice.label.clone())),
        _ => None,
    }).collect();
    assert!(!ds.is_empty(), "оборона поставлена");
    for (at, label) in &ds {
        // армия за 2 ч сдвинулась мало: точка — у её центра (на месте) или у пункта в 10 км от него
        assert!(at.dist(c) <= 12.0, "{label}: {:.1} км от армии", at.dist(c));
    }
}

/// Режим `intent`: управление по ступеням — советские Ставка и фронты по приказам сценария, армии и ниже — агенты;
/// немецкие штабы — по приказам сценария.
#[test]
fn intent_control_vector() {
    use agents_core::command::control::Control;
    use agents_core::model::Echelon;
    let sim = intent_sim();
    let w = &sim.world;
    assert!(w.hqs.iter().any(|h| h.side == Side::Su && h.echelon == Echelon::HighCommand));
    for (k, h) in w.hqs.iter().enumerate() {
        let want = match (h.side, h.echelon) {
            (Side::Su, Echelon::HighCommand | Echelon::Front) => Control::Script,
            (Side::Su, _) => Control::Agent,
            (Side::De, _) => Control::Script,
        };
        assert_eq!(sim.command.control[k], want, "{}", h.id);
    }
}

/// Поддерево, взятое игроком, за сутки не получает исторических задач: диспетчер его цепочкам не подаёт.
#[test]
fn taken_subtree_no_history_24h() {
    use agents_core::command::control::Control;
    let mut sim = intent_sim();
    let f = hq(&sim, "su_1bf");
    run_to(&mut sim, 24);
    sim.command.control[f as usize] = Control::Player;
    intent::take(&mut sim, f);
    let sub = subtree_of(&sim, f);
    let mine: Vec<usize> = (0..sim.intent.chains.len()).filter(|&ci| sub.contains(&(sim.intent.chains[ci].owner as usize))).collect();
    assert!(!mine.is_empty());
    let issued = |sim: &Sim| mine.iter().map(|&ci| sim.intent.chains[ci].tasks.iter().filter(|t| t.issued).count()).collect::<Vec<_>>();
    let before = issued(&sim);
    // задачи на эти сутки у цепочек поддерева есть
    assert!(mine.iter().any(|&ci| sim.intent.chains[ci].tasks.iter().any(|t| !t.issued && t.at >= 24 && t.at < 48)), "есть задачи на эти сутки");
    let docs0 = sim.documents.len();
    run_to(&mut sim, 48);
    assert_eq!(issued(&sim), before, "цепочкам поддерева не подано");
    let names: Vec<&str> = sub.iter().map(|&k| sim.world.hqs[k].id.as_str()).collect();
    let hist = sim.documents[docs0..].iter().filter(|d| d.hq == f && d.to.iter().any(|t| names.contains(&t.as_str()))).count();
    assert_eq!(hist, 0, "директив фронта армиям нет");
}
