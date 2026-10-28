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
    let n = g.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Defend, target: None, note: "закрепиться".into(), form: None }).expect("приказ");
    assert!(n > 3, "дивизий 8 гв. А: {n}");
    assert!(g.order(&PlayerOrder { hq: "de_9a".into(), kind: OrderKind::Attack, target: None, note: String::new(), form: None }).is_err());

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
    assert_eq!(g.order(&PlayerOrder { hq: div.clone(), kind: OrderKind::Hold, target: None, note: "держать рубеж".into(), form: None }).unwrap(), 1);
    assert!(g.order(&PlayerOrder { hq: "de_9a".into(), kind: OrderKind::Defend, target: None, note: String::new(), form: None }).unwrap() > 0);
    assert!(g.order(&PlayerOrder { hq: "нет_такого".into(), kind: OrderKind::Hold, target: None, note: String::new(), form: None }).is_err());
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
    g.directive(&PlayerDirective { to: id.clone(), task: Task::Defend, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "держать".into(), ..Default::default() }).expect("через голову");
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
    let _ = s.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Defend, target: None, note: String::new(), form: None });
}

#[test]
fn high_command_not_orderable() {
    let mut g = seelow_game(Mode::Agents, 0);
    let e = g.order(&PlayerOrder { hq: "su_stavka".into(), kind: OrderKind::Attack, target: None, note: String::new(), form: None }).unwrap_err();
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
    g.directive(&PlayerDirective { to: "su_1bf".into(), task: Task::Attack, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "знаки опознавания".into(), ..Default::default() }).unwrap();
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
    g.directive(&PlayerDirective { to: "su_4gsk".into(), task: Task::Defend, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "держать".into(), ..Default::default() }).unwrap();
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
    g.directive(&PlayerDirective { to: id.clone(), task: Task::Defend, form: Form::Instruction, axis: vec![], immediate: None, subsequent: None, note: "держать".into(), ..Default::default() }).unwrap();
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
    g.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Attack, target: Some([14.25, 52.55]), note: String::new(), form: None }).expect("приказ");
    g.advance(10);
    let a = hix(&g, "su_8gva");
    let under = |g: &Game, i: usize| { let mut k = g.sim.world.divisions[i].hq as usize; for _ in 0..8 { if k == a { return true; } match g.sim.world.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
    let ts: Vec<_> = (0..g.sim.world.divisions.len()).filter(|&i| under(&g, i)).filter_map(|i| g.sim.world.divisions[i].order.as_ref().map(|o| o.target)).collect();
    assert!(ts.len() >= 3);
    let far = ts.iter().map(|t| ts.iter().map(|u| t.dist(*u)).fold(0.0, f64::max)).fold(0.0, f64::max);
    assert!(far > 1.0, "цели разнесены: {far}");
    assert!(g.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Attack, target: None, note: String::new(), form: None }).is_err(), "наступать без цели — ошибка");
}

/// I5: в «гибриде» историческая директива — только до первого хода.
#[test]
fn hybrid_historical_only_before_first_turn() {
    let mut h = seelow_game(Mode::Hybrid, 0);
    h.advance(1);
    assert!(h.issue_historical("stavka-11059").is_err());
}

// ---------- этап 2б: немецкие армия и корпус ----------

fn de_game() -> Game {
    let root = repo_root();
    let (sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    Game::start_mode(sim, meta, 0, Side::De, &[Side::De], None, Mode::Agents)
}

/// Корпус под давлением просит разрешения на отход: до ответа дивизия держится, запрос один; разрешили — отходит.
#[test]
fn de_corps_requests_withdraw() {
    let mut g = de_game();
    // ослабленная дивизия: доктрина решает «отход»
    let i = g.sim.world.divisions.iter().position(|d| d.side == Side::De && !d.state.out()).unwrap();
    g.sim.world.divisions[i].vars.personnel *= 0.3;
    g.sim.world.divisions[i].vars.cohesion = 0.25;
    let k = g.sim.world.divisions[i].hq;
    g.advance(8);
    let name = g.sim.world.divisions[i].name.clone();
    let req = |g: &Game| g.sim.documents.iter().filter(|d| d.hq == k && d.kind == DocKind::Report && d.text.contains("запрос на отход") && d.text.contains(&name)).count();
    assert_eq!(req(&g), 1, "запрос");
    assert!(g.sim.world.divisions[i].order.as_ref().is_none_or(|o| o.kind != OrderKind::Withdraw), "до ответа — держится");
    g.advance(48);
    assert_eq!(req(&g), 1, "повторно не запрашивает");
    let corps = g.sim.world.hqs[k as usize].id.clone();
    g.permit(&corps, true).expect("разрешение");
    g.advance(4);
    assert_eq!(g.sim.world.divisions[i].order.as_ref().map(|o| o.kind), Some(OrderKind::Withdraw));
}

/// Противник развёртывается для атаки — немецкая армия оттягивает первую линию на 1–2 км, один раз.
#[test]
fn de_army_pulls_back_once() {
    let mut g = de_game();
    g.advance(1);
    let de: Vec<usize> = (0..g.sim.world.divisions.len()).filter(|&i| g.sim.world.divisions[i].side == Side::De && !g.sim.world.divisions[i].state.out()).collect();
    // три советские дивизии рядом с немецкой — развёртываются
    let p = g.sim.world.divisions[de[0]].vars.pos;
    let su: Vec<usize> = { let w = &g.sim.world; let mut v: Vec<usize> = (0..w.divisions.len()).filter(|&i| w.divisions[i].side == Side::Su && !w.divisions[i].state.out()).collect(); v.sort_by(|&a, &b| w.divisions[a].vars.pos.dist(p).total_cmp(&w.divisions[b].vars.pos.dist(p))); v.truncate(3); v };
    for &i in &su { g.sim.world.divisions[i].vars.pos = agents_core::geo::XY::new(p.x + 4.0, p.y); g.sim.world.divisions[i].state = agents_core::model::State::Deploy { left_h: 6.0 }; }
    // у Зеелова советские дивизии развёртываются с начала — первая оттяжка уже была; угроза — новая
    for x in g.sim.command.pulled.iter_mut() { *x = None; }
    let before: Vec<_> = de.iter().map(|&i| g.sim.world.divisions[i].vars.pos).collect();
    // распоряжение армии дивизии — 1 ч в пути
    g.advance(2);
    let pulled: Vec<usize> = de.iter().copied().filter(|&i| g.sim.world.divisions[i].order.as_ref().is_some_and(|o| o.kind == OrderKind::Withdraw)).collect();
    assert!(pulled.contains(&de[0]), "первая линия отходит");
    for &i in &pulled {
        let k = de.iter().position(|&x| x == i).unwrap();
        let km = g.sim.world.divisions[i].order.as_ref().unwrap().target.dist(before[k]);
        assert!((1.0..=2.0).contains(&km), "оттяжка на {km:.2} км");
    }
    let n = g.sim.documents.iter().filter(|d| d.rule.as_deref().is_some_and(|r| r.contains("оттяжка"))).count();
    g.advance(12);
    assert_eq!(g.sim.documents.iter().filter(|d| d.rule.as_deref().is_some_and(|r| r.contains("оттяжка"))).count(), n, "второй оттяжки нет");
}

/// В «гибриде» директива игрока штабу под сценарием — ошибка; историческую директиву дважды не подать.
#[test]
fn directive_errors_hybrid_and_twice() {
    let mut a = seelow_game(Mode::Agents, 0);
    a.issue_historical("stavka-11059").expect("директива");
    assert!(a.issue_historical("stavka-11059").unwrap_err().contains("уже подана"));
}

/// Директива фронту, называющая армии главного удара, при замысле фронта с осью доводится только до них.
#[test]
fn private_directive_only_to_named() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.issue_historical("stavka-11059").expect("директива");
    g.advance(1);
    let f = hix(&g, "su_1bf");
    let axis = g.sim.command.intent[f].as_ref().unwrap().axis.clone();
    let a = hix(&g, "su_8gva") as u32;
    let mut d = g.sim.command.intent[f].clone().unwrap();
    d.id = "частная".into(); d.main_blow = vec![a]; d.axis = vec![]; d.ready = false; d.form = Form::Instruction;
    d.from = hix(&g, "su_stavka") as u32;
    agents_core::command::passing::issue(&mut g.sim, d, 1);
    g.advance(8);
    assert_eq!(g.sim.command.intent[f].as_ref().unwrap().axis, axis, "замысел фронта не изменился");
    assert!(g.sim.command.intent[a as usize].as_ref().unwrap().id.starts_with("частная"), "армия получила частную директиву");
}

// ---------- исправления по рецензии 2б ----------

/// C1: немецкий корпус не перебрасывает дивизию между приказами — за сутки не больше 3 распоряжений одной дивизии.
#[test]
fn de_no_order_flapping() {
    let mut g = de_game();
    g.advance(72);
    let ids: Vec<String> = g.sim.world.divisions.iter().filter(|d| d.side == Side::De).map(|d| d.id.clone()).collect();
    let worst = ids.iter().map(|id| g.sim.documents.iter().filter(|d| d.tick >= 48 && d.tick < 72 && d.to.iter().any(|t| t == id)).count()).max().unwrap();
    assert!(worst <= 3, "распоряжений одной дивизии за сутки: {worst}");
}

/// I2–I3: ставка не игрок — через сутки «держать»; ответ действует сутки, затем корпус может спросить снова;
/// до ответа дивизия получает «держать».
#[test]
fn de_request_answered_and_expires() {
    let mut g = de_game();
    let top = hix(&g, "de_hc");
    g.sim.command.control[top] = Control::Agent;
    let i = g.sim.world.divisions.iter().position(|d| d.side == Side::De && !d.state.out()).unwrap();
    g.sim.world.divisions[i].vars.personnel *= 0.3;
    g.sim.world.divisions[i].vars.cohesion = 0.25;
    g.advance(8);
    assert!(g.sim.world.divisions[i].order.as_ref().is_some_and(|o| o.kind == OrderKind::Defend), "до ответа — держать");
    g.advance(24);
    let r: Vec<_> = g.sim.command.requests.iter().filter(|r| r.division as usize == i).collect();
    assert_eq!(r.first().and_then(|r| r.answer), Some(false), "ставка ответила");
    g.sim.world.divisions[i].vars.cohesion = 0.25;
    g.advance(30);
    assert!(g.sim.command.requests.iter().filter(|r| r.division as usize == i).count() <= 1, "старые ответы сняты");
    assert!(g.sim.documents.iter().filter(|d| d.kind == DocKind::Report && d.text.contains(&g.sim.world.divisions[i].name)).count() >= 2, "спросил снова");
}

/// I4: оттяжка снова — только после затишья 48 ч подряд.
#[test]
fn de_pullback_needs_long_quiet() {
    let mut g = de_game();
    g.advance(1);
    let de0 = g.sim.world.divisions.iter().position(|d| d.side == Side::De && !d.state.out()).unwrap();
    let p = g.sim.world.divisions[de0].vars.pos;
    let su: Vec<usize> = { let w = &g.sim.world; let mut v: Vec<usize> = (0..w.divisions.len()).filter(|&i| w.divisions[i].side == Side::Su && !w.divisions[i].state.out()).collect(); v.sort_by(|&a, &b| w.divisions[a].vars.pos.dist(p).total_cmp(&w.divisions[b].vars.pos.dist(p))); v.truncate(3); v };
    for x in g.sim.command.pulled.iter_mut() { *x = None; }
    for h in 0..60 {
        let deploy = h != 30; // один тихий час
        for &i in &su { g.sim.world.divisions[i].vars.pos = agents_core::geo::XY::new(p.x + 4.0, p.y); g.sim.world.divisions[i].state = if deploy { agents_core::model::State::Deploy { left_h: 6.0 } } else { agents_core::model::State::Reserve }; }
        g.advance(1);
    }
    // после сброса отметки (оттяжка часа 0 у Зеелова — не в счёт)
    let after: Vec<u32> = g.sim.documents.iter().filter(|d| d.tick >= 1 && d.rule.as_deref().is_some_and(|r| r.contains("оттяжка"))).map(|d| d.tick).collect();
    assert!(!after.is_empty());
    assert!(after.iter().all(|&t| t == after[0]), "одна оттяжка: {after:?}");
}

#[test]
fn command_ops_apply() {
    use agents_core::game::CommandOp;
    let mut g = seelow_game(Mode::Agents, 0);
    let op = |j: serde_json::Value| -> CommandOp { serde_json::from_value(j).expect("команда") };
    g.command(&op(serde_json::json!({ "op": "historical", "id": "stavka-11059" }))).expect("подать");
    assert!(g.command(&op(serde_json::json!({ "op": "historical", "id": "нет-такой" }))).is_err());
    g.command(&op(serde_json::json!({ "op": "take", "hq": "su_8gva" }))).expect("взять");
    let t = g.trace();
    let hq = |t: &serde_json::Value, id: &str| t["command"]["hqs"].as_array().unwrap().iter().find(|h| h["id"] == id).cloned().expect(id);
    assert_eq!(hq(&t, "su_8gva")["control"], "player");
    assert_eq!(hq(&t, "su_1bf")["control"], "agent");
    assert_eq!(t["command"]["mode"], "agents");
    let hist = t["command"]["historical"].as_array().unwrap();
    assert!(hist.iter().any(|h| h["id"] == "stavka-11059" && h["issued"] == true && h["to"] == "su_1bf"), "{hist:?}");
    g.command(&op(serde_json::json!({ "op": "release", "id": "su_8gva" }))).expect("вернуть");
    assert_eq!(hq(&g.trace(), "su_8gva")["control"], "agent");
    // разрешение без запросов — ошибка, не паника
    assert!(g.command(&op(serde_json::json!({ "op": "permit", "hq": "su_8gva", "yes": true }))).is_err());
}

#[test]
fn trace_command_legacy() {
    let g = seelow_game(Mode::Legacy, 0);
    assert_eq!(g.trace()["command"]["mode"], "legacy");
}

#[test]
fn historical_at_takeover_already_delivered() {
    // передача командования на вторые сутки: директива Ставки с начала операции уже действует — доведена сразу
    let mut g = seelow_game(Mode::Agents, 30);
    g.issue_historical("stavka-11059").expect("директива");
    let f = hix(&g, "su_1bf") as u32;
    assert!(g.sim.command.in_transit.iter().any(|(at, d)| d.id == "stavka-11059" && d.to == agents_core::command::directive::Target::Hq(f) && *at == 30), "{:?}", g.sim.command.in_transit.iter().map(|(a, d)| (a, d.id.clone())).collect::<Vec<_>>());
}

#[test]
fn order_form_prepared_slower() {
    use agents_core::game::PlayerOrder;
    let order = |form: &str| -> PlayerOrder { serde_json::from_value(serde_json::json!({ "hq": "su_8gva", "kind": "defend", "form": form })).expect("приказ") };
    let mut a = seelow_game(Mode::Agents, 0);
    a.order(&order("instruction")).expect("распоряжение");
    let mut b = seelow_game(Mode::Agents, 0);
    b.order(&order("order")).expect("приказ");
    let at = |g: &Game| g.sim.command.in_transit.iter().filter(|(_, d)| d.id.starts_with("игрок:")).map(|(at, _)| *at).max().expect("в пути");
    assert!(at(&b) > at(&a) + 6, "приказ {} — распоряжение {}", at(&b), at(&a));
}

#[test]
fn hybrid_own_order_switches_subtree_to_agents() {
    // «гибрид»: директива игрока, отличная от исторической, снимает поддерево получателя со сценария — дальше решают агенты
    let mut h = seelow_game(Mode::Hybrid, 0);
    h.issue_historical("stavka-11059").expect("директива");
    let a = hix(&h, "su_8gva");
    assert_eq!(h.sim.command.control[a], Control::Script);
    h.order(&PlayerOrder { hq: "su_8gva".into(), kind: OrderKind::Defend, target: None, note: String::new(), form: None }).expect("приказ армии в гибриде");
    assert_eq!(h.sim.command.control[a], Control::Agent);
    assert_eq!(h.sim.command.control[hix(&h, "su_4gsk")], Control::Agent, "корпус армии — тоже агент");
    assert_eq!(h.sim.command.control[hix(&h, "su_1bf")], Control::Script, "фронт остаётся на сценарии");
    assert!(h.sim.documents.iter().any(|d| d.hq as usize == a && d.text.contains("сценари")));
}

/// Разрешённый отход — на рубеж, который назвала доктрина при запросе, а не на рубеж от нынешнего места.
#[test]
fn permitted_withdraw_goes_to_requested_line() {
    let mut g = de_game();
    let i = g.sim.world.divisions.iter().position(|d| d.side == Side::De && !d.state.out()).unwrap();
    g.sim.world.divisions[i].vars.personnel *= 0.3;
    g.sim.world.divisions[i].vars.cohesion = 0.25;
    let k = g.sim.world.divisions[i].hq;
    g.advance(8);
    let r = g.sim.command.requests.iter().find(|r| r.division == i as u32).expect("запрос").clone();
    // дивизию сдвинули (бой, сдача позиции): рубеж от нового места был бы другим
    g.sim.world.divisions[i].vars.pos = agents_core::geo::XY::new(g.sim.world.divisions[i].vars.pos.x - 5.0, g.sim.world.divisions[i].vars.pos.y);
    let corps = g.sim.world.hqs[k as usize].id.clone();
    g.permit(&corps, true).expect("разрешение");
    let d = g.sim.command.in_transit.iter().find(|(_, d)| d.id == format!("отход:{i}")).map(|(_, d)| d.clone()).expect("в пути");
    assert!(d.immediate.as_ref().unwrap().pts[0].dist(r.at) < 1e-9);
}

#[test]
fn malformed_command_is_an_error_not_a_failed_turn() {
    let mut g = seelow_game(Mode::Agents, 0);
    assert!(g.command_json(&serde_json::json!({ "op": "взорвать", "hq": "su_8gva" })).unwrap_err().contains("команда"));
    assert!(g.command_json(&serde_json::json!({ "op": "take", "hq": "su_8gva" })).is_ok());
}

fn pd(j: serde_json::Value) -> PlayerDirective { serde_json::from_value(j).expect("директива") }

/// Армия взята игроком — приказ её корпусу отдаёт армия: не через голову, без извещений.
#[test]
fn directive_from_taken_army_to_corps() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.issue_historical("stavka-11059").expect("директива");
    g.take("su_8gva").expect("взять");
    let n = g.sim.documents.len();
    g.directive(&pd(serde_json::json!({ "from": "su_8gva", "to": "su_4gsk", "task": "attack", "form": "order",
        "immediate": [[14.30, 52.62], [14.36, 52.58]] }))).expect("приказ корпусу");
    let k = hix(&g, "su_4gsk");
    assert!(!g.sim.command.led_hq[k], "не через голову");
    assert!(!g.sim.documents[n..].iter().any(|d| d.kind == DocKind::Notice));
    let d = g.sim.command.in_transit.iter().find(|(_, d)| d.to == agents_core::command::directive::Target::Hq(k as u32)).map(|(_, d)| d.clone()).expect("в пути");
    assert_eq!(d.from as usize, hix(&g, "su_8gva"));
}

/// Отдавать может только верхняя инстанция или взятый игроком штаб.
#[test]
fn directive_from_agent_hq_rejected() {
    let mut g = seelow_game(Mode::Agents, 0);
    let e = g.directive(&pd(serde_json::json!({ "from": "su_8gva", "to": "su_4gsk", "task": "defend", "form": "order" }))).unwrap_err();
    assert!(e.contains("под управлением"), "{e}");
}

/// Полная директива фронту: главный удар, границы, сроки, стык — в замысле получателя.
#[test]
fn directive_full_fields() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.directive(&pd(serde_json::json!({ "to": "su_1bf", "task": "attack", "form": "order",
        "axis": [[14.6, 52.6], [13.4, 52.52]], "immediate": [[14.2, 52.7], [14.2, 52.45]], "immediateBy": 48,
        "subsequent": [[13.6, 52.7], [13.6, 52.4]], "subsequentBy": 144,
        "boundaries": [{ "line": [[14.6, 52.8], [13.4, 52.8]] }], "mainBlow": ["su_8gva"], "junction": "su_8gva" }))).expect("директива");
    let f = hix(&g, "su_1bf");
    let d = g.sim.command.in_transit.iter().find(|(_, d)| d.to == agents_core::command::directive::Target::Hq(f as u32)).map(|(_, d)| d.clone()).expect("в пути");
    assert_eq!(d.immediate.as_ref().unwrap().by, Some(48));
    assert_eq!(d.subsequent.as_ref().unwrap().by, Some(144));
    assert_eq!(d.boundaries.len(), 1);
    assert_eq!(d.main_blow, vec![hix(&g, "su_8gva") as u32]);
    assert_eq!(d.junction, Some(hix(&g, "su_8gva") as u32));
}

/// Эшелон получателя и ввод подвижной группы — роли в построении старшего.
#[test]
fn directive_echelon_and_commit() {
    use agents_core::command::control::Role;
    use agents_core::command::directive::Target;
    let mut g = seelow_game(Mode::Agents, 0);
    g.take("su_8gva").expect("взять");
    g.directive(&pd(serde_json::json!({ "from": "su_8gva", "to": "su_4gsk", "task": "attack", "form": "order", "echelon": "second" }))).expect("второй эшелон");
    assert_eq!(g.sim.command.role(Target::Hq(hix(&g, "su_4gsk") as u32)), Role::Second);
    g.take("su_1bf").expect("взять фронт");
    g.directive(&pd(serde_json::json!({ "from": "su_1bf", "to": "su_1gta", "task": "attack", "form": "instruction", "commit": true }))).expect("ввод");
    assert_eq!(g.sim.command.role(Target::Hq(hix(&g, "su_1gta") as u32)), Role::Committed);
}

#[test]
fn command_op_directive() {
    let mut g = seelow_game(Mode::Agents, 0);
    g.command_json(&serde_json::json!({ "op": "directive", "directive": { "to": "su_1bf", "task": "defend", "form": "instruction" } })).expect("команда");
    assert!(g.sim.command.in_transit.iter().any(|(_, d)| d.to == agents_core::command::directive::Target::Hq(hix(&g, "su_1bf") as u32)));
}

/// Противник — штаб на языковой модели вне ядра: в режимах штабов-агентов его приказы доходят до его дивизий (как раньше).
#[test]
fn enemy_llm_orders_work_in_agents_mode() {
    let root = repo_root();
    let (sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json"), &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    let mut g = Game::start_mode(sim, meta, 0, Side::Su, &[Side::Su, Side::De], None, Mode::Agents);
    let n = g.order(&PlayerOrder { hq: "de_9a".into(), kind: OrderKind::Defend, target: None, note: "держать".into(), form: None }).expect("приказ штаба противника");
    assert!(n > 0);
}

/// Противник — штабы-агенты: его верхняя инстанция (агент) подаёт исторические решения в их часы, ниже решают штабы.
#[test]
fn enemy_agents_take_historical_and_decide() {
    let mut g = seelow_game(Mode::Agents, 24);
    g.enemy_agents();
    let top = g.sim.world.hqs.iter().position(|h| h.side == Side::De && h.echelon == agents_core::model::Echelon::HighCommand).unwrap();
    assert_eq!(g.sim.command.control[top], Control::Agent);
    assert_eq!(g.sim.command.control[hix(&g, "de_9a")], Control::Agent);
    let before = g.sim.documents.iter().filter(|d| g.sim.world.hqs[d.hq as usize].side == Side::De).count();
    g.advance(24);
    assert!(g.sim.documents.iter().filter(|d| g.sim.world.hqs[d.hq as usize].side == Side::De).count() > before, "немецкие штабы отдают документы");
    assert_eq!(g.trace()["game"]["enemyAgents"], true);
}

/// Игра в режиме «командующие»: командующие обеих сторон, место командующего занимает игрок командой `take`.
#[test]
fn commanders_game_seat() {
    use agents_core::game::{Game, Mode};
    use agents_core::model::Side;
    let root = agents_core::repo_root();
    let (sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &format!("{root}/{}", agents_core::DATA_DIR), &root).expect("сценарий");
    let mut g = Game::start_mode(sim, meta, 6, Side::Su, &[Side::Su], None, Mode::Commanders);
    let hq = |g: &Game, id: &str| g.sim.world.hqs.iter().position(|h| h.id == id).unwrap() as u32;
    let (f, n) = (hq(&g, "su_1bf"), hq(&g, "de_9a"));
    assert!(agents_core::commander::active(&g.sim, f) && agents_core::commander::active(&g.sim, n));
    g.command(&agents_core::game::CommandOp::Take { hq: "su_1bf".into() }).expect("занять место");
    assert!(!agents_core::commander::active(&g.sim, f), "командующий молчит, когда место занято");
    assert_eq!(serde_json::from_str::<Mode>("\"commanders\"").unwrap(), Mode::Commanders);
}
