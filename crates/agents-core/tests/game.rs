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
    let mut g = Game::start_free(sim, meta, 12, Side::Su, &[Side::Su, Side::De]);
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
