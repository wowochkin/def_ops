//! Игра на агентной модели: передача командования, приказ игрока армии, ход.

use agents_core::game::{Game, PlayerOrder};
use agents_core::model::{OrderKind, Side};
use agents_core::{repo_root, DATA_DIR};

#[test]
fn takeover_order_and_turn() {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (sim, meta) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    let hours = meta.hours;
    let mut g = Game::start(sim, meta, 24, Side::Su);
    assert_eq!(g.hour(), 24);
    assert_eq!(g.frames.len(), 25);
    // будущих исторических приказов и артподготовок советской стороны больше нет, немецкие остались
    assert!(g.sim.script.iter().all(|o| g.sim.world.hqs[o.hq as usize].side == Side::De));
    assert!(g.sim.fires.iter().all(|f| g.sim.world.hqs[f.hq as usize].side == Side::De));

    // приказ 8 гв. А: обороняться на месте; штаб противника — отказ
    let n = g.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Defend, target: None, note: "закрепиться".into() }).expect("приказ");
    assert!(n > 3, "дивизий 8 гв. А: {n}");
    assert!(g.order(&PlayerOrder { hq: "de_9a".into(), kind: OrderKind::Attack, target: None, note: String::new() }).is_err());

    g.advance(12);
    assert_eq!(g.hour(), 36);
    assert_eq!(g.frames.len(), 37);
    let got = g.sim.journal.iter().filter(|e| e.tick >= 24 && e.text.contains("закрепиться")).count();
    assert!(got > 0, "приказ игрока дошёл до дивизий");
    // ход не идёт дальше конца сценария
    g.advance(10_000);
    assert_eq!(g.hour(), hours);
    assert!(g.over());
    let t = g.trace();
    assert_eq!(t["game"]["takeover"], 24);
    assert_eq!(t["frames"].as_array().unwrap().len() as u32, hours + 1);
}

#[test]
fn division_orders_and_external_enemy() {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (sim, meta) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    // обе стороны под внешним управлением (противник — штаб на модели вне ядра): исторических приказов не осталось
    let mut g = Game::start_free(sim, meta, 12, Side::Su, &[Side::Su, Side::De], None);
    assert!(g.sim.script.is_empty());
    let div = g.sim.world.divisions.iter().find(|d| d.side == Side::Su && d.state != agents_core::model::State::Pending).unwrap().id.clone();
    assert_eq!(g.order(&PlayerOrder { hq: div.clone(), kind: OrderKind::Hold, target: None, note: "держать рубеж".into() }).unwrap(), 1);
    assert!(g.order(&PlayerOrder { hq: "de_9a".into(), kind: OrderKind::Defend, target: None, note: String::new() }).unwrap() > 0);
    assert!(g.order(&PlayerOrder { hq: "нет_такого".into(), kind: OrderKind::Hold, target: None, note: String::new() }).is_err());
    g.advance(6);
    let t = g.trace();
    let i = t["divisions"].as_array().unwrap().iter().position(|d| d["id"] == div.as_str()).unwrap();
    assert_eq!(t["orders"][i]["kind"], "hold");
    assert!(t["orders"][i]["note"].as_str().unwrap().contains("держать рубеж"));
}

use agents_core::game::{Commit, Demolish, StaffIn};

#[test]
fn staff_supply_demolish_and_reserves() {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json");
    let load = || agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    let (sim, meta) = load();
    let mut a = Game::start(sim, meta, 6, Side::Su);
    // резервы советской стороны ждут решения игрока: сами не вводятся
    assert!(!a.reserves.is_empty(), "у Берлинской операции есть будущие вводы");
    let (&ri, &rfrom) = a.reserves.iter().next().unwrap();
    let rid = a.sim.world.divisions[ri as usize].id.clone();
    // подвоз: у первой советской дивизии в бою — ноль против двойного
    let div = a.sim.world.divisions.iter().position(|d| d.side == Side::Su && d.state != agents_core::model::State::Pending).unwrap();
    let id = a.sim.world.divisions[div].id.clone();
    let (sim, meta) = load();
    let mut b = Game::start(sim, meta, 6, Side::Su);
    a.staff(&StaffIn { supply: vec![(id.clone(), 0.0)], ..Default::default() });
    b.staff(&StaffIn { supply: vec![(id.clone(), 2.0)], ..Default::default() });
    // подрыв моста: ближайший к первому мосту театра — с часа 8
    let bid = a.sim.theatre.bridges[0].id.clone();
    let bad = a.staff(&StaffIn { supply: vec![(id.clone(), 0.0)], demolish: vec![Demolish { bridge: bid, from: 8 }], commit: vec![Commit { division: rid.clone(), at: [14.3, 52.6], from: 10 }], ..Default::default() });
    assert!(bad.is_empty(), "{bad:?}");
    assert!(!a.reserves.contains_key(&ri));
    a.advance(24);
    b.advance(24);
    assert!(a.sim.world.divisions[div].vars.ammo < b.sim.world.divisions[div].vars.ammo, "подвоз 0 против 2");
    let obj = a.sim.world.objects.iter().find(|o| o.bridge == Some(0)).unwrap();
    assert!(!obj.intact, "мост подорван");
    // резерв введён в назначенном районе к своему часу (не раньше 10-го)
    let d = &a.sim.world.divisions[ri as usize];
    assert_ne!(d.state, agents_core::model::State::Pending, "резерв введён (готов с {rfrom})");
    let at = a.sim.theatre.proj.to_lnglat(d.vars.pos);
    assert!((at[0] - 14.3).abs() < 0.3 && (at[1] - 52.6).abs() < 0.3, "{at:?}");
    assert!(a.trace()["game"]["reserves"].as_array().unwrap().iter().all(|x| x["id"] != rid.as_str()));
}

// ---------- режимы «агенты» и «гибрид», приказ через голову, взять и вернуть ----------

use agents_core::command::control::{Control, DocKind};
use agents_core::command::directive::{Form, Task};
use agents_core::game::{Mode, PlayerDirective};

fn seelow_game(mode: Mode, takeover: u32) -> Game {
    let root = repo_root();
    let (sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    Game::start_mode(sim, meta, takeover, Side::Su, &[Side::Su], None, mode)
}
fn hix(g: &Game, id: &str) -> usize { g.sim.world.hqs.iter().position(|h| h.id == id).expect(id) }
fn dix(g: &Game, id: &str) -> usize { g.sim.world.divisions.iter().position(|d| d.id == id).expect(id) }

#[test]
fn agents_mode_player_is_high_command() {
    let mut g = seelow_game(Mode::Agents, 0);
    assert_eq!(g.sim.command.control[hix(&g, "su_stavka")], Control::Player);
    assert_eq!(g.sim.command.control[hix(&g, "su_1bf")], Control::Agent);
    assert_eq!(g.sim.command.control[hix(&g, "su_8gva")], Control::Agent);
    assert_eq!(g.sim.command.control[hix(&g, "de_9a")], Control::Script);
    g.issue_historical("stavka-11059").expect("директива");
    g.advance(93);
    let w = &g.sim.world;
    let su: Vec<_> = w.divisions.iter().filter(|d| d.side == Side::Su && !d.state.out()).collect();
    let ok = su.iter().filter(|d| d.order.as_ref().is_some_and(|o| o.from == d.hq)).count();
    assert!(ok * 10 >= su.len() * 9, "{ok} из {}", su.len());
}

#[test]
fn over_head_marks_and_notifies() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.issue_historical("stavka-11059").expect("директива");
    // дивизия под корпусом 8 гв. А
    let k = hix(&g, "su_4gsk");
    let div = g.sim.world.divisions.iter().position(|d| d.hq as usize == k).unwrap();
    let id = g.sim.world.divisions[div].id.clone();
    g.directive(&PlayerDirective { to: id.clone(), task: Task::Defend, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "держать".into() }).expect("через голову");
    assert!(g.sim.command.led_div[div]);
    for h in ["su_4gsk", "su_8gva", "su_1bf"] {
        let x = hix(&g, h) as u32;
        assert!(g.sim.documents.iter().any(|d| d.hq == x && d.kind == DocKind::Notice && d.text.contains("через голову")), "{h}");
    }
    g.advance(100);
    // приказ дивизии — от игрока (верхней инстанции), а не от корпуса
    let o = g.sim.world.divisions[div].order.as_ref().expect("приказ");
    assert_eq!(o.from as usize, hix(&g, "su_stavka"));
    assert_eq!(o.kind, OrderKind::Defend);
    let _ = dix(&g, &id);
}

#[test]
fn take_and_release() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.issue_historical("stavka-11059").expect("директива");
    g.advance(30);
    let a = hix(&g, "su_8gva");
    g.take("su_8gva").expect("взять");
    assert_eq!(g.sim.command.control[a], Control::Player);
    let before = g.sim.documents.iter().filter(|d| d.hq as usize == a && d.kind != DocKind::Notice).count();
    g.advance(24);
    assert_eq!(g.sim.documents.iter().filter(|d| d.hq as usize == a && d.kind != DocKind::Notice).count(), before, "взятая армия не решает сама");
    g.release("su_8gva").expect("вернуть");
    assert_eq!(g.sim.command.control[a], Control::Agent);
    let n = g.sim.documents.len();
    g.advance(1);
    let now: Vec<_> = g.sim.documents[n..].iter().filter(|d| d.hq as usize == a && d.kind != DocKind::Notice).collect();
    let mut to: Vec<_> = now.iter().flat_map(|d| d.to.clone()).collect();
    let m = to.len();
    to.sort(); to.dedup();
    assert_eq!(m, to.len(), "в час возврата — не больше одной директивы каждому");
}

#[test]
fn hybrid_historical_keeps_script() {
    let mut s = seelow_game(Mode::Legacy, 0);
    let mut h = seelow_game(Mode::Hybrid, 0);
    h.issue_historical("stavka-11059").expect("директива");
    // как прогон по сценарию: штабы 1 БФ ведут приказы сценария
    assert_eq!(h.sim.command.control[hix(&h, "su_8gva")], Control::Script);
    let mut plain = { let root = repo_root(); agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &format!("{root}/{DATA_DIR}"), &root).unwrap().0 };
    for _ in 0..24 { plain.step(); }
    h.advance(24);
    assert_eq!(h.sim.digest(), plain.digest());
    let _ = s.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Defend, target: None, note: String::new() });
}

#[test]
fn high_command_not_orderable() {
    let mut g = seelow_game(Mode::Agents, 0);
    let e = g.order(&PlayerOrder { hq: "su_stavka".into(), kind: OrderKind::Attack, target: None, note: String::new() }).unwrap_err();
    assert!(e.contains("верхней инстанции"), "{e}");
}

/// Ставка подаёт все исторические директивы, ниже — штабы-агенты: 96 ч без сбоев, советские дивизии идут на запад;
/// в «гибриде» — как прогон по сценарию.
#[test]
fn historical_directives_run() {
    let ids = |g: &Game| { let top = hix(g, "su_stavka") as u32; let mut v: Vec<String> = g.sim.historical.iter().filter(|(_, d)| d.from == top).map(|(_, d)| d.id.clone()).collect(); v.dedup(); v };
    let mut a = seelow_game(Mode::Agents, 0);
    let x0: Vec<f64> = a.sim.world.divisions.iter().map(|d| d.vars.pos.x).collect();
    for id in ids(&a) { a.issue_historical(&id).expect("директива"); }
    a.advance(96);
    let su: Vec<usize> = (0..a.sim.world.divisions.len()).filter(|&i| a.sim.world.divisions[i].side == Side::Su).collect();
    let west = su.iter().filter(|&&i| a.sim.world.divisions[i].vars.pos.x < x0[i] - 1.0).count();
    assert!(west * 2 > su.len(), "на запад {west} из {}", su.len());
    let mut h = seelow_game(Mode::Hybrid, 0);
    for id in ids(&h) { h.issue_historical(&id).expect("директива"); }
    h.advance(96);
    let mut plain = { let root = repo_root(); agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &format!("{root}/{DATA_DIR}"), &root).unwrap().0 };
    for _ in 0..96 { plain.step(); }
    assert_eq!(h.sim.digest(), plain.digest());
}

// ---------- исправления по рецензии ----------

/// C1: директива без оси, рубежей и границ не затирает оперативный замысел.
#[test]
fn geometryless_directive_keeps_intent() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.issue_historical("stavka-11059").expect("директива");
    g.advance(1);
    let f = hix(&g, "su_1bf");
    let axis = g.sim.command.intent[f].as_ref().unwrap().axis.clone();
    assert!(!axis.is_empty());
    g.directive(&PlayerDirective { to: "su_1bf".into(), task: Task::Attack, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "знаки опознавания".into() }).unwrap();
    g.advance(4);
    assert_eq!(g.sim.command.intent[f].as_ref().unwrap().axis, axis, "замысел с осью сохранился");
}

/// I1: «доведена до начала» — только в час подачи: перепланирование по циклу идёт со временем прохождения.
#[test]
fn ready_only_at_issue_hour() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.issue_historical("stavka-11059").expect("директива");
    g.advance(1);
    assert!(g.sim.command.intent.iter().flatten().all(|d| !d.ready), "ready снят после доведения");
    g.advance(20);
    let now = g.hour();
    assert!(g.sim.command.in_transit.iter().all(|(at, d)| !d.ready && *at + 0 >= now), "в пути — с временем прохождения");
}

/// I2: штаб, изъятый через голову, не перехватывается директивой старшего, которая была в пути.
#[test]
fn led_hq_not_overridden_by_superior_in_transit() {
    let mut g = seelow_game(Mode::Agents, 0);
    let a = hix(&g, "su_8gva") as u32;
    let k = hix(&g, "su_4gsk");
    // старший отдал корпусу подготовленный приказ (22 ч в пути)
    let mut d = g.sim.historical.iter().find(|(_, d)| d.id == "stavka-11059").unwrap().1.clone();
    d.from = a; d.to = agents_core::command::directive::Target::Hq(k as u32); d.ready = false; d.form = Form::Order;
    agents_core::command::passing::issue(&mut g.sim, d, 0);
    // игрок — распоряжением через голову
    g.directive(&PlayerDirective { to: "su_4gsk".into(), task: Task::Defend, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "держать".into() }).unwrap();
    g.advance(30);
    let top = hix(&g, "su_stavka") as u32;
    assert_eq!(g.sim.command.intent[k].as_ref().unwrap().from, top);
}

/// I3: «вернуть» снова включает изъятую дивизию в замысел старшего — в его следующий цикл она получает от него задачу.
#[test]
fn release_returns_to_superior_plan() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.issue_historical("stavka-11059").expect("директива");
    g.advance(2);
    let k = hix(&g, "su_4gsk");
    let div = g.sim.world.divisions.iter().position(|d| d.hq as usize == k && !d.state.out()).unwrap();
    let id = g.sim.world.divisions[div].id.clone();
    g.directive(&PlayerDirective { to: id.clone(), task: Task::Defend, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "держать".into() }).unwrap();
    g.advance(4);
    g.release(&id).unwrap();
    g.advance(8);
    let o = g.sim.world.divisions[div].order.as_ref().unwrap();
    assert_eq!(o.from as usize, k, "задача снова от корпуса");
}

/// I4: приказ штабу на точку в режимах агентов — дивизиям разные цели, а не одна точка.
#[test]
fn point_order_spreads_targets() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Attack, target: Some([14.25, 52.55]), note: String::new() }).expect("приказ");
    g.advance(10);
    let a = hix(&g, "su_8gva");
    let under = |g: &Game, i: usize| { let mut k = g.sim.world.divisions[i].hq as usize; for _ in 0..8 { if k == a { return true; } match g.sim.world.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
    let ts: Vec<_> = (0..g.sim.world.divisions.len()).filter(|&i| under(&g, i)).filter_map(|i| g.sim.world.divisions[i].order.as_ref().map(|o| o.target)).collect();
    assert!(ts.len() >= 3);
    let far = ts.iter().map(|t| ts.iter().map(|u| t.dist(*u)).fold(0.0, f64::max)).fold(0.0, f64::max);
    assert!(far > 1.0, "цели разнесены: {far}");
    assert!(g.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Attack, target: None, note: String::new() }).is_err(), "наступать без цели — ошибка");
}

/// I5: в «гибриде» историческая директива — только до первого хода.
#[test]
fn hybrid_historical_only_before_first_turn() {
    let mut h = seelow_game(Mode::Hybrid, 0);
    h.advance(1);
    assert!(h.issue_historical("stavka-11059").is_err());
}
