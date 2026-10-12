//! Приложение агентной модели (docs/plans/agents.md, раздел 7.4): окно с интерфейсом на веб-технологиях, расчёт —
//! ядро agents-core напрямую, без сервера. Команды:
//! - run_scenario — прогон сценария с записью хода по часам (кадры, журнал, штабы, исходные данные);
//! - read_text — файл данных репозитория (сценарий, история, театр) только для чтения.
//!
//! Корень данных — переменная окружения DEFOPS_ROOT, иначе корень репозитория, из которого собрано приложение.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use agents_core::{repo_root, scenario, trace, DATA_DIR};
use std::path::{Component, Path, PathBuf};

fn root() -> PathBuf {
    std::env::var("DEFOPS_ROOT").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from(repo_root()))
}

/// Путь внутри корня данных: относительный, без «..».
fn inside(rel: &str) -> Result<PathBuf, String> {
    let p = Path::new(rel);
    if p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(format!("путь вне данных: {rel}"));
    }
    Ok(root().join(p))
}

#[tauri::command]
async fn run_scenario(scenario: String, seed: Option<u64>) -> Result<serde_json::Value, String> {
    // расчёт — в отдельном потоке, окно не замирает
    tauri::async_runtime::spawn_blocking(move || {
        let r = root();
        let path = inside(&scenario)?;
        let rs = r.to_string_lossy().to_string();
        let (mut sim, meta) = scenario::load(&path.to_string_lossy(), &format!("{rs}/{DATA_DIR}"), &rs)?;
        if let Some(s) = seed { sim.seed = s; }
        let hours = meta.hours;
        Ok(trace::run(&mut sim, hours, &meta))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn read_text(path: String) -> Result<String, String> {
    let p = inside(&path)?;
    std::fs::read_to_string(&p).map_err(|e| format!("{path}: {e}"))
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_scenario, read_text])
        .run(tauri::generate_context!())
        .expect("ошибка запуска приложения");
}
