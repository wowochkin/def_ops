// Команды агентной модели (crates/agents-tauri) объявлены в манифесте приложения: у каждой — право allow-<команда>.
// Редактор открыт с адреса шлюза или vite (для Tauri — удалённая страница), и вызвать команду он может, только если
// её право выдано в capabilities/default.json. Команды самого приложения (настройки и окна выставочного стенда) — там же.
const COMMANDS: &[&str] = &["run_scenario", "read_text", "list_models", "llm_chat_stream", "llm_cancel", "probe_parallel", "game_start", "game_turn", "game_stop", "game_directive", "game_historical", "game_take", "game_release", "game_permit", "game_rewind", "game_variants", "expo_settings_read", "expo_settings_write", "expo_monitors", "expo_open", "expo_close_all", "expo_set_guard", "expo_focus_main", "expo_log", "expo_stats_add", "expo_stats_today", "expo_voice_manifest", "expo_voice_clip"];

fn main() {
    // Dev запускает службы и модель из репозитория. Копирование release-runtime в
    // target/debug избыточно и при повторной сборке падает на read-only файлах весов.
    // Остальные настройки CLI (например, devUrl) сохраняем.
    if std::env::var("PROFILE").as_deref() == Ok("debug") {
        let mut config: serde_json::Value = serde_json::from_str(
            &std::env::var("TAURI_CONFIG").unwrap_or_else(|_| "{}".into()),
        ).expect("настройки Tauri из TAURI_CONFIG");
        config["bundle"]["resources"] = serde_json::json!([]);
        std::env::set_var("TAURI_CONFIG", config.to_string());
    }
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("сборка приложения Tauri");
}
