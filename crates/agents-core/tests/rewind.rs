//! Ход игры как вход ядра: повтор записанных ходов даёт тот же мир; полный снимок мира без потерь; отпечаток игры.

use agents_core::game::{Game, Mode, PlayerOrder, StaffIn, TurnIn};
use agents_core::model::{OrderKind, Side};
use agents_core::{repo_root, DATA_DIR};

/// Как в tests/command.rs: прежний путь игры «как сейчас» после 24 ч хода.
const LEGACY_GAME_DIGEST: u64 = 5949968270007021613;

fn game(scenario: &str, takeover: u32, mode: Mode, seed: Option<u64>) -> Game {
    let root = repo_root();
    let (mut sim, meta) = agents_core::scenario::load(&format!("{root}/packages/sim/data/scenarios/agents/{scenario}.json"), &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    if let Some(s) = seed { sim.seed = s; }
    Game::start_mode(sim, meta, takeover, Side::Su, &[Side::Su], None, mode)
}

#[test]
fn play_turn_same_as_old_path() {
    let mut g = game("seelow-1945", 24, Mode::Legacy, None);
    g.play_turn(TurnIn { hours: 24, ..Default::default() });
    assert_eq!(g.sim.digest(), LEGACY_GAME_DIGEST);
    assert_eq!(g.log.len(), 1);
}

fn turns(g: &Game) -> Vec<TurnIn> {
    let div = g.sim.world.divisions.iter().find(|d| d.side == Side::Su && !d.state.out()).expect("дивизия").id.clone();
    let target = g.sim.theatre.proj.to_lnglat(g.sim.world.divisions.iter().find(|d| d.side == Side::De && !d.state.out()).expect("противник").vars.pos);
    vec![
        TurnIn { command: vec![serde_json::json!({ "op": "take", "hq": "su_8gva" })], hours: 12, ..Default::default() },
        TurnIn { orders: vec![PlayerOrder { hq: "su_5ua".into(), kind: OrderKind::Attack, target: Some(target), note: String::new(), form: None }], hours: 12, ..Default::default() },
        TurnIn { staff: Some(StaffIn { supply: vec![(div, 1.5)], ..Default::default() }), hours: 12, ..Default::default() },
        TurnIn { command: vec![serde_json::json!({ "op": "release", "id": "su_8gva" })], hours: 12, ..Default::default() },
    ]
}

#[test]
fn replay_log_same_digests() {
    let seed = Some(7);
    let mut g1 = game("seelow-1945", 24, Mode::Agents, seed);
    let mut d1 = Vec::new();
    for t in turns(&g1) {
        let r = g1.play_turn(t);
        assert!(r.command_results.iter().all(|x| x.is_none()), "команды: {:?}", r.command_results);
        d1.push(g1.state_digest());
    }
    assert_eq!(g1.log.len(), 4);
    let mut g2 = game("seelow-1945", 24, Mode::Agents, seed);
    let mut d2 = Vec::new();
    for t in g1.log.clone() { g2.play_turn(t); d2.push(g2.state_digest()); }
    assert_eq!(d1, d2);
    // ходы действительно меняют состояние игры
    assert!(d1.windows(2).all(|w| w[0] != w[1]));
}

#[test]
fn snapshot_is_lossless() {
    let mut g = game("berlin-1945", 6, Mode::Commanders, None);
    g.play_turn(TurnIn { hours: 6, ..Default::default() });
    let mut s = g.sim.snapshot();
    assert_eq!(s.documents.len(), g.sim.documents.len());
    assert_eq!(s.journal.len(), g.sim.journal.len());
    assert!(!g.sim.commanders.list.is_empty());
    assert_eq!(format!("{:?}", s.commanders.list), format!("{:?}", g.sim.commanders.list));
    assert_eq!(format!("{:?}", s.intent.chains), format!("{:?}", g.sim.intent.chains));
    assert_eq!(s.digest(), g.sim.digest());
    for _ in 0..6 {
        s.step();
        g.sim.step();
        assert_eq!(s.digest(), g.sim.digest());
    }
    assert_eq!(s.documents.len(), g.sim.documents.len());
}

#[test]
fn trace_has_turn_and_digest() {
    let mut g = game("seelow-1945", 24, Mode::Agents, None);
    assert_eq!(g.trace()["game"]["turn"], 0);
    let r = g.play_turn(TurnIn { hours: 6, ..Default::default() });
    let t = g.turn_trace(&r);
    assert_eq!(t["game"]["turn"], 1);
    let d = t["game"]["digest"].as_str().expect("строка");
    assert_eq!(d.len(), 16);
    assert!(d.chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(d, format!("{:016x}", g.state_digest()));
    assert!(t["game"]["applied"].is_array() && t["game"]["commandResults"].is_array());
}
