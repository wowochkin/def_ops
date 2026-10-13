//! Команды Tauri агентной модели — общие для приложения агентной модели (apps/agents) и настольного приложения
//! платформы (apps/desktop):
//! - run_scenario — прогон сценария с записью хода по часам (кадры, журнал, штабы, исходные данные); источники решений
//!   штабов обеих сторон (приказы сценария, доктрина, языковая модель), ход решений модели — событиями staff-progress
//!   и staff-stream;
//! - read_text — файл данных (сценарий, история, театр) только для чтения;
//! - list_models, llm_chat_stream, llm_cancel, probe_parallel — языковая модель по протоколу OpenAI (LM Studio): список
//!   моделей, разговор потоком с остановкой, замер параллельных запросов (через ядро, без CORS со стороны сервера модели).
//!
//! Подключение: `.invoke_handler(tauri::generate_handler![agents_tauri::commands::run_scenario, …])`.

use agents_core::{llm, repo_root, scenario, staff::Source, trace, DATA_DIR};
use tauri::Emitter;
use std::path::{Component, Path, PathBuf};

/// Корень данных (сценарии, театры, правила — packages/sim/data): задаёт приложение (`set_root`), иначе DEFOPS_ROOT,
/// иначе корень репозитория, из которого собрано ядро.
static ROOT: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();

pub fn set_root(p: PathBuf) { let _ = ROOT.set(p); }

fn root() -> PathBuf {
    ROOT.get().cloned().unwrap_or_else(|| std::env::var("DEFOPS_ROOT").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(repo_root())))
}

/// Путь внутри корня данных: относительный, без «..».
fn inside(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("путь вне данных: {rel}"));
    }
    Ok(root().join(p))
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmIn {
    url: String,
    model: String,
    /// default | off | low | medium | high
    #[serde(default)]
    reasoning: Option<String>,
    /// Потолок токенов ответа; 0 — без ограничения.
    #[serde(default)]
    max_tokens: u32,
    /// Одновременных запросов; 0 — замер.
    #[serde(default)]
    parallel: usize,
    #[serde(default)]
    sync: bool,
    #[serde(default)]
    by_army: bool,
}

impl LlmIn {
    fn config(&self) -> llm::LlmConfig {
        let mut c = llm::LlmConfig::new(&self.url, &self.model);
        c.reasoning = self.reasoning.as_deref().and_then(llm::Reasoning::parse).unwrap_or(llm::Reasoning::Default);
        c.max_tokens = self.max_tokens;
        c.parallel = self.parallel;
        c.sync = self.sync;
        c.by_army = self.by_army;
        c
    }
}

/// Команды (в подмодуле: макрос команды в корне библиотеки даёт двойные имена при подключении).
pub mod commands {
    use super::*;

    #[tauri::command]
    pub async fn run_scenario(app: tauri::AppHandle, scenario: String, seed: Option<u64>, de: Option<String>, su: Option<String>, llm: Option<LlmIn>, without_fires: Option<bool>, without_withdrawals: Option<bool>) -> Result<serde_json::Value, String> {
        // расчёт — в отдельном потоке, окно не замирает
        tauri::async_runtime::spawn_blocking(move || {
            let r = root();
            let path = inside(&scenario)?;
            let rs = r.to_string_lossy().to_string();
            let (mut sim, meta) = scenario::load(&path.to_string_lossy(), &format!("{rs}/{DATA_DIR}"), &rs)?;
            if let Some(s) = seed { sim.seed = s; }
            sim.sources[1] = match de.as_deref() { Some("doctrine") => Source::Doctrine, Some("llm") => Source::Llm, _ => Source::Script };
            // советские штабы: по доктрине (staff_su.rs), на модели (штаб армии) или исторические приказы
            sim.sources[0] = match su.as_deref() { Some("doctrine") => Source::Doctrine, Some("llm") => Source::Llm, _ => Source::Script };
            if let Some(l) = llm { sim.llm = Some(l.config()); }
            // варианты для сравнения: без артподготовки, без отвода с первой позиции
            if without_fires.unwrap_or(false) { sim.fires.clear(); }
            if without_withdrawals.unwrap_or(false) { sim.withdrawals.clear(); }
            let app2 = app.clone();
            sim.on_progress = Some(Box::new(move |m| { let _ = app2.emit("staff-progress", m); }));
            let app3 = app.clone();
            sim.on_stream = Some(Box::new(move |v| { let _ = app3.emit("staff-stream", v); }));
            let hours = meta.hours;
            Ok(trace::run(&mut sim, hours, &meta))
        }).await.map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub async fn list_models(url: String) -> Result<Vec<String>, String> {
        tauri::async_runtime::spawn_blocking(move || llm::list_models(&url)).await.map_err(|e| e.to_string())?
    }

    /// Остановка потоковых ответов по номеру запроса.
    static CANCEL: std::sync::Mutex<Vec<(u64, std::sync::Arc<std::sync::atomic::AtomicBool>)>> = std::sync::Mutex::new(Vec::new());

    /// Разговор с агентом потоком: размышления и ответ уходят в окно по мере прихода ({part: think|text, s}), в конце —
    /// весь ответ с размышлениями, токенами и временем.
    #[tauri::command]
    pub async fn llm_chat_stream(id: u64, llm: LlmIn, messages: Vec<(String, String)>, on_event: tauri::ipc::Channel<serde_json::Value>) -> Result<serde_json::Value, String> {
        let flag = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        if let Ok(mut c) = CANCEL.lock() { c.push((id, flag.clone())); }
        let r = tauri::async_runtime::spawn_blocking(move || {
            llm::complete_stream(&llm.config(), &messages, &mut |p, s| {
                let _ = on_event.send(serde_json::json!({ "part": if p == llm::Part::Think { "think" } else { "text" }, "s": s }));
            }, Some(&flag))
        }).await.map_err(|e| e.to_string())?;
        if let Ok(mut c) = CANCEL.lock() { c.retain(|x| x.0 != id); }
        r.map(|r| serde_json::json!({ "text": r.text, "reasoning": r.reasoning, "tokens": r.tokens, "secs": r.secs, "truncated": r.truncated }))
    }

    #[tauri::command]
    pub fn llm_cancel(id: u64) {
        if let Ok(c) = CANCEL.lock() { for (k, f) in c.iter() { if *k == id { f.store(true, std::sync::atomic::Ordering::Relaxed); } } }
    }

    /// Замер числа параллельных запросов к модели (llm::probe_parallel).
    #[tauri::command]
    pub async fn probe_parallel(llm: LlmIn) -> Result<serde_json::Value, String> {
        tauri::async_runtime::spawn_blocking(move || llm::probe_parallel(&llm.config(), 16).map(|p| p.to_json())).await.map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub fn read_text(path: String) -> Result<String, String> {
        let p = inside(&path)?;
        std::fs::read_to_string(&p).map_err(|e| format!("{path}: {e}"))
    }

    /// Игра на агентной модели: одна на приложение.
    static GAME: std::sync::Mutex<Option<agents_core::game::Game>> = std::sync::Mutex::new(None);

    /// Начать игру: прогон по сценарию до часа `takeover`, дальше стороной `player` командует игрок; противник —
    /// по сценарию (script) или по доктрине (doctrine). Возвращает ход до передачи командования.
    #[tauri::command]
    pub async fn game_start(scenario: String, seed: Option<u64>, takeover: u32, player: Option<String>, enemy: Option<String>) -> Result<serde_json::Value, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let r = root();
            let path = inside(&scenario)?;
            let rs = r.to_string_lossy().to_string();
            let (mut sim, meta) = scenario::load(&path.to_string_lossy(), &format!("{rs}/{DATA_DIR}"), &rs)?;
            if let Some(s) = seed { sim.seed = s; }
            let player = if player.as_deref() == Some("de") { agents_core::model::Side::De } else { agents_core::model::Side::Su };
            let other = 1 - agents_core::staff::side_idx(player);
            sim.sources[other] = if enemy.as_deref() == Some("doctrine") { Source::Doctrine } else { Source::Script };
            let g = agents_core::game::Game::start(sim, meta, takeover, player);
            let t = g.trace();
            *GAME.lock().map_err(|e| e.to_string())? = Some(g);
            Ok(t)
        }).await.map_err(|e| e.to_string())?
    }

    /// Ход игры: приказы игрока штабам, затем `hours` часов расчёта. Возвращает ход с начала сценария и итог по приказам.
    #[tauri::command]
    pub async fn game_turn(orders: Vec<agents_core::game::PlayerOrder>, hours: u32) -> Result<serde_json::Value, String> {
        tauri::async_runtime::spawn_blocking(move || {
            let mut lock = GAME.lock().map_err(|e| e.to_string())?;
            let g = lock.as_mut().ok_or("игра не начата")?;
            let applied: Vec<serde_json::Value> = orders.iter().map(|o| match g.order(o) {
                Ok(n) => serde_json::json!({ "hq": o.hq, "divisions": n }),
                Err(e) => serde_json::json!({ "hq": o.hq, "error": e }),
            }).collect();
            g.advance(hours);
            let mut t = g.trace();
            t["game"]["applied"] = serde_json::json!(applied);
            Ok(t)
        }).await.map_err(|e| e.to_string())?
    }

    #[tauri::command]
    pub fn game_stop() { if let Ok(mut g) = GAME.lock() { *g = None; } }
}
