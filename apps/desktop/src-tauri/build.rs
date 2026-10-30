// Команды агентной модели (crates/agents-tauri) объявлены в манифесте приложения: у каждой — право allow-<команда>.
// Редактор открыт с адреса шлюза или vite (для Tauri — удалённая страница), и вызвать команду он может, только если
// её право выдано в capabilities/default.json.
const COMMANDS: &[&str] = &["run_scenario", "read_text", "list_models", "llm_chat_stream", "llm_cancel", "probe_parallel", "game_start", "game_turn", "game_stop", "game_directive", "game_historical", "game_take", "game_release", "game_permit", "game_rewind", "game_variants"];

fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)))
        .expect("сборка приложения Tauri");
}
