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
fn snapshot_is_lossless_intent() {
    let mut g = game("berlin-1945", 6, Mode::Intent, None);
    g.play_turn(TurnIn { hours: 4, ..Default::default() });
    let mut s = g.sim.snapshot();
    assert!(!s.intent.chains.is_empty());
    assert!(s.intent.any());
    let dbg = |x: &agents_core::world::Sim| format!("{:?}|{:?}|{:?}|{:?}|{:?}", x.intent.chains, x.intent.hq, x.intent.queue, x.intent.led, x.intent.actions);
    assert_eq!(dbg(&s), dbg(&g.sim));
    let (a, b) = (s.intent.track.as_ref().expect("след эталона"), g.sim.intent.track.as_ref().expect("след эталона"));
    assert!(std::sync::Arc::ptr_eq(a, b));
    assert_eq!(s.documents.len(), g.sim.documents.len());
    assert_eq!(s.journal.len(), g.sim.journal.len());
    for _ in 0..4 {
        s.step();
        g.sim.step();
        assert_eq!(s.digest(), g.sim.digest());
    }
    assert_eq!(dbg(&s), dbg(&g.sim));
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

// ── снимки каждые 2 хода и возврат к ходу ──────────────────────────────────────────────────────────────────────

use agents_core::command::control::Control;
use agents_core::game::{CommandOp, MAX_SNAPS};

/// Зееловский, «агенты», 5 ходов по 12 ч (входы как в `replay_log_same_digests` и ещё один ход без входа):
/// отпечатки до первого хода и после каждого.
fn five(seed: Option<u64>) -> (Game, Vec<u64>) {
    let mut g = game("seelow-1945", 24, Mode::Agents, seed);
    let mut ins = turns(&g);
    ins.push(TurnIn { hours: 12, ..Default::default() });
    let mut d = vec![g.state_digest()];
    for t in ins { g.play_turn(t); d.push(g.state_digest()); }
    (g, d)
}

#[test]
fn rewind_reproduces_digest() {
    let (mut g, d) = five(Some(7));
    g.rewind(4).expect("к ходу 5");
    assert_eq!(g.state_digest(), d[4]);
    assert_eq!(g.frames.len(), 25 + 4 * 12);
    assert_eq!(g.log.len(), 4);
    g.rewind(1).expect("к ходу 2");
    assert_eq!(g.state_digest(), d[1]);
    g.rewind(0).expect("к ходу 1");
    assert_eq!(g.state_digest(), d[0]);
    assert!(g.log.is_empty());
    assert_eq!(g.hour(), 24);
    assert_eq!(g.frames.len(), 25);
}

#[test]
fn rewind_then_same_inputs_same_future() {
    let (mut g, d) = five(Some(7));
    let saved = g.log.clone();
    g.rewind(2).expect("к ходу 3");
    assert_eq!(g.state_digest(), d[2]);
    for t in saved[2..].iter().cloned() { g.play_turn(t); }
    assert_eq!(g.state_digest(), d[5]);
    // другой вход на ходу 3 — другое состояние
    g.rewind(2).expect("к ходу 3");
    g.play_turn(TurnIn { command: vec![serde_json::json!({ "op": "take", "hq": "su_5ua" })], hours: 12, ..Default::default() });
    assert_ne!(g.state_digest(), d[3]);
}

#[test]
fn rewind_beyond_errors() {
    let (mut g, d) = five(Some(7));
    let e = g.rewind(6).expect_err("ходов только 5");
    assert!(e.contains("сыграно ходов: 5"), "{e}");
    assert_eq!(g.state_digest(), d[5]);
    assert_eq!(g.log.len(), 5);
}

#[test]
fn between_ops_replayed() {
    let mut g = game("seelow-1945", 24, Mode::Agents, Some(7));
    for _ in 0..2 { g.play_turn(TurnIn { hours: 12, ..Default::default() }); }
    g.between_op(CommandOp::Take { hq: "su_8gva".into() }).expect("взять между ходами");
    assert_eq!(g.between.len(), 1);
    g.play_turn(TurnIn { hours: 12, ..Default::default() });
    assert!(g.between.is_empty());
    assert_eq!(g.log[2].between.len(), 1);
    let d3 = g.state_digest();
    g.play_turn(TurnIn { hours: 12, ..Default::default() });
    g.rewind(3).expect("к ходу 4");
    assert_eq!(g.state_digest(), d3);
    let h = g.sim.world.hqs.iter().position(|x| x.id == "su_8gva").unwrap();
    assert_eq!(g.sim.command.control[h], Control::Player);
    g.rewind(2).expect("к ходу 3");
    assert_ne!(g.sim.command.control[h], Control::Player);
    // ошибочная команда между ходами не записывается
    assert!(g.between_op(CommandOp::Take { hq: "нет_такого".into() }).is_err());
    assert!(g.between.is_empty());
    // команда между ходами снимается возвратом к тому же ходу
    g.between_op(CommandOp::Take { hq: "su_8gva".into() }).unwrap();
    g.rewind(2).unwrap();
    assert!(g.between.is_empty());
    assert_ne!(g.sim.command.control[h], Control::Player);
}

fn state_key(g: &Game) -> String {
    let mut issued: Vec<&String> = g.issued.iter().collect();
    issued.sort();
    format!("{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{:?}|{}|{}",
        g.sim.intent.chains, g.sim.intent.hq, g.sim.intent.led, g.sim.intent.actions, g.sim.commanders.list, g.sim.commanders.raised,
        g.sim.documents, g.sim.command, issued, g.pending.len(), g.sim.journal.len())
}

#[test]
fn rewind_exact_intent_and_commanders() {
    for mode in [Mode::Intent, Mode::Commanders] {
        let mut g = game("berlin-1945", 6, mode, None);
        if mode == Mode::Commanders { g.enemy_agents(); } else { g.enemy_intent(); }
        let mut keys = vec![state_key(&g)];
        let mut digests = vec![g.state_digest()];
        for k in 0..4 {
            let mut command = Vec::new();
            if k == 0 { command.push(serde_json::json!({ "op": "take", "hq": "su_1bf" })); }
            if mode == Mode::Intent && k == 1 {
                command.push(serde_json::json!({ "op": "directive", "directive": { "to": "su_8gva", "task": "attack", "form": "instruction", "note": "наступать" } }));
            }
            if mode == Mode::Commanders {
                let w = &g.sim.world;
                if let Some(r) = g.sim.command.requests.iter().find(|r| r.answer.is_none() && w.hqs[r.hq as usize].side == Side::Su) {
                    command.push(serde_json::json!({ "op": "permit", "hq": w.hqs[r.hq as usize].id, "yes": k % 2 == 0 }));
                }
            }
            let r = g.play_turn(TurnIn { command, hours: 6, ..Default::default() });
            assert!(r.command_results.iter().all(|x| x.is_none()), "{mode:?}: {:?}", r.command_results);
            keys.push(state_key(&g));
            digests.push(g.state_digest());
        }
        for k in [3, 1] {
            g.rewind(k).expect("возврат");
            assert_eq!(state_key(&g), keys[k], "{mode:?}: ход {k}");
            assert_eq!(g.state_digest(), digests[k], "{mode:?}: ход {k}");
        }
    }
}

#[test]
fn snapshots_bounded() {
    let mut g = game("seelow-1945", 0, Mode::Agents, Some(3));
    g.limit = g.limit.max(200);
    let mut d = vec![g.state_digest()];
    for _ in 0..100 { g.play_turn(TurnIn { hours: 1, ..Default::default() }); d.push(g.state_digest()); }
    assert!(g.snaps.len() <= MAX_SNAPS, "снимков {}", g.snaps.len());
    assert_eq!(g.snaps[0].turn, 0);
    g.rewind(37).expect("к ходу 38");
    assert_eq!(g.state_digest(), d[37]);
    g.rewind(0).expect("к ходу 1");
    assert_eq!(g.state_digest(), d[0]);
}

#[test]
fn rewind_after_turn_only() {
    use std::io::{BufRead, BufReader, Write};
    let mut p = std::process::Command::new(env!("CARGO_BIN_EXE_agents-game"))
        .env("DEFOPS_ROOT", repo_root())
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).spawn().expect("agents-game");
    {
        let mut i = p.stdin.take().unwrap();
        let start = serde_json::json!({ "cmd": "game_start", "args": { "scenario": "packages/sim/data/scenarios/agents/seelow-1945.json", "seed": 1, "takeover": 24, "player": "su", "mode": "agents" } });
        let turn = serde_json::json!({ "cmd": "game_turn", "args": { "orders": [], "hours": 12 } });
        let back = serde_json::json!({ "cmd": "game_rewind", "args": { "keep": 0 } });
        // ход и возврат подряд, не дожидаясь ответа хода
        writeln!(i, "{start}\n{turn}\n{back}").unwrap();
    }
    let lines: Vec<serde_json::Value> = BufReader::new(p.stdout.take().unwrap()).lines().map(|l| serde_json::from_str(&l.unwrap()).unwrap()).collect();
    let _ = p.wait();
    assert_eq!(lines.len(), 3, "{lines:?}");
    let t0 = &lines[0]["ok"]["game"];
    let t1 = &lines[1]["ok"]["game"];
    let t2 = &lines[2]["ok"]["game"];
    assert_eq!(t1["turn"], 1, "ответ хода — вторым");
    assert_eq!(t1["hour"], 36);
    assert_eq!(t2["turn"], 0, "{:?}", lines[2]);
    assert_eq!(t2["hour"], 24);
    assert_eq!(t2["digest"], t0["digest"]);
}
