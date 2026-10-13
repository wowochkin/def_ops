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
