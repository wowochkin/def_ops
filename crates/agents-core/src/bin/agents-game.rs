//! Игра на агентной модели без окна приложения — для проверок: команды run_scenario / game_start / game_turn / game_rewind / game_stop / read_text
//! строками JSON на входе ({"cmd": …, "args": {…}}), ответ — строкой JSON на выходе ({"ok": …} или {"error": …}).
//! Те же команды, что у настольного приложения (crates/agents-tauri).

use agents_core::game::{CommandOp, Game, TakeoverIn};
use agents_core::scenario::EditsIn;
use agents_core::model::Side;
use agents_core::staff::Source;
use agents_core::{repo_root, scenario, DATA_DIR};
use serde_json::{json, Value};
use std::io::{BufRead, Write};

/// Команда управления между ходами (`Game::between_op`).
fn between(game: &mut Option<Game>, c: CommandOp) -> Result<Value, String> {
    game.as_mut().ok_or("игра не начата")?.between_op(c).map(|_| Value::Null)
}

fn main() {
    let root = std::env::var("DEFOPS_ROOT").unwrap_or_else(|_| repo_root());
    let mut game: Option<Game> = None;
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines().map_while(Result::ok) {
        let q: Value = match serde_json::from_str(&line) { Ok(v) => v, Err(e) => { let _ = writeln!(out, "{}", json!({ "error": e.to_string() })); continue } };
        let a = &q["args"];
        // поправки сценария из базы знаний (edits) и состояние дивизий на час передачи (takeoverState) — необязательны
        let opt = |k: &str| -> Option<Value> { if a[k].is_null() { None } else { Some(a[k].clone()) } };
        let r: Result<Value, String> = (|| match q["cmd"].as_str().unwrap_or("") {
            "read_text" => std::fs::read_to_string(format!("{root}/{}", a["path"].as_str().unwrap_or(""))).map(Value::String).map_err(|e| e.to_string()),
            "run_scenario" => {
                // прогон целиком (как команда приложения): сценарий, seed, источники решений, поправки параметров и сценария
                let path = format!("{root}/{}", a["scenario"].as_str().unwrap_or(""));
                let params = if a["params"].is_object() { Some(&a["params"]) } else { None };
                let edits: Option<EditsIn> = opt("edits").map(serde_json::from_value).transpose().map_err(|e| format!("edits: {e}"))?;
                let (mut sim, meta) = scenario::load_with(&path, &format!("{root}/{DATA_DIR}"), &root, params, edits.as_ref())?;
                if let Some(s) = a["seed"].as_u64() { sim.seed = s; }
                sim.sources[1] = if a["de"] == "doctrine" { Source::Doctrine } else { Source::Script };
                sim.sources[0] = if a["su"] == "doctrine" { Source::Doctrine } else { Source::Script };
                if a["withoutFires"] == true { sim.fires.clear(); }
                if a["withoutWithdrawals"] == true { sim.withdrawals.clear(); }
                // советские штабы по ступеням (как у приложения): script / fronts / journals / agents; commanders, intent — у обеих сторон
                let mode = a["command"].as_str().unwrap_or("script").to_string();
                let sides: &[Side] = if matches!(mode.as_str(), "commanders" | "intent") { &[Side::Su, Side::De] } else { &[Side::Su] };
                let mut pending = Vec::new();
                for &sd in sides { pending.extend(agents_core::command::control::command_mode(&mut sim, &mode, sd)?); }
                let hours = meta.hours;
                Ok(agents_core::trace::run_fed(&mut sim, hours, &meta, pending, mode == "fronts" || mode == "journals"))
            }
            "game_start" => {
                let path = format!("{root}/{}", a["scenario"].as_str().unwrap_or(""));
                let edits: Option<EditsIn> = opt("edits").map(serde_json::from_value).transpose().map_err(|e| format!("edits: {e}"))?;
                let state: Option<TakeoverIn> = opt("takeoverState").map(serde_json::from_value).transpose().map_err(|e| format!("takeoverState: {e}"))?;
                let (mut sim, meta) = scenario::load_with(&path, &format!("{root}/{DATA_DIR}"), &root, None, edits.as_ref())?;
                if let Some(s) = a["seed"].as_u64() { sim.seed = s; }
                let player = if a["player"] == "de" { Side::De } else { Side::Su };
                let enemy = if player == Side::Su { Side::De } else { Side::Su };
                let mode: agents_core::game::Mode = opt("mode").map(serde_json::from_value).transpose().map_err(|e| format!("mode: {e}"))?.unwrap_or(agents_core::game::Mode::Legacy);
                // противник, допустимый при режиме своей стороны (недопустимый — ошибка, не подмена)
                let en = agents_core::game::enemy_for(mode, a["enemy"].as_str())?;
                sim.sources[agents_core::staff::side_idx(enemy)] = if en == "doctrine" { Source::Doctrine } else { Source::Script };
                let free = if en == "llm" { vec![player, enemy] } else { vec![player] };
                let mut g = Game::start_mode(sim, meta, a["takeover"].as_u64().unwrap_or(0) as u32, player, &free, state.as_ref(), mode);
                if let Some(u) = a["until"].as_u64() { g.limit = g.limit.max(u as u32); }
                if en == "agents" { g.enemy_agents(); }
                if en == "intent" { g.enemy_intent(); }
                let t = g.trace();
                game = Some(g);
                Ok(t)
            }
            "game_turn" => {
                let g = game.as_mut().ok_or("игра не начата")?;
                // ход как вход ядра (game::TurnIn): команды, распоряжения, приказы, часы; доктрина из базы знаний — doctrineText
                let mut t: agents_core::game::TurnIn = serde_json::from_value(a.clone()).map_err(|e| e.to_string())?;
                let text = |k: &str| a["doctrineText"][k].as_str().map(str::to_string).filter(|t| !t.trim().is_empty());
                if a["doctrineText"].is_object() { t.doctrine = Some([text("su"), text("de")]); }
                let r = g.play_turn(t);
                Ok(g.turn_trace(&r))
            }
            "game_stop" => { game = None; Ok(Value::Null) }
            // команды управления между ходами — в журнал следующего хода (повтор при возврате к ходу)
            "game_directive" => {
                let d: agents_core::game::PlayerDirective = serde_json::from_value(a["directive"].clone()).map_err(|e| e.to_string())?;
                between(&mut game, CommandOp::Directive { directive: d })
            }
            "game_historical" => between(&mut game, CommandOp::Historical { id: a["id"].as_str().unwrap_or("").into() }),
            "game_take" => between(&mut game, CommandOp::Take { hq: a["hq"].as_str().unwrap_or("").into() }),
            "game_permit" => between(&mut game, CommandOp::Permit { hq: a["hq"].as_str().unwrap_or("").into(), yes: a["yes"].as_bool().unwrap_or(false) }),
            // варианты решения по правилам для штаба игрока: чтение, мир не меняется, в журнал хода не идёт
            "game_variants" => {
                let g = game.as_ref().ok_or("игра не начата")?;
                g.variants(a["hq"].as_str().unwrap_or(""), a["n"].as_u64().unwrap_or(3) as usize)
            }
            "game_release" => between(&mut game, CommandOp::Release { id: a["id"].as_str().unwrap_or("").into() }),
            // возврат к ходу keep + 1 (оставить keep сыгранных ходов); команды идут по очереди — после хода, не во время
            "game_rewind" => {
                let g = game.as_mut().ok_or("игра не начата")?;
                let keep = a["keep"].as_u64().ok_or("game_rewind: нет keep")? as usize;
                g.rewind(keep)?;
                Ok(g.trace())
            }
            c => Err(format!("нет команды {c}")),
        })();
        let _ = writeln!(out, "{}", match r { Ok(v) => json!({ "ok": v }), Err(e) => json!({ "error": e }) });
        let _ = out.flush();
    }
}
