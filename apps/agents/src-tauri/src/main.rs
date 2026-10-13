//! Приложение агентной модели (docs/plans/agents.md, раздел 7.4): окно с интерфейсом на веб-технологиях, расчёт —
//! ядро agents-core напрямую, без сервера. Команды:
//! - run_scenario — прогон сценария с записью хода по часам (кадры, журнал, штабы, исходные данные);
//! - read_text — файл данных репозитория (сценарий, история, театр) только для чтения;
//! - list_models, llm_chat_stream, llm_cancel, probe_parallel — языковая модель по протоколу OpenAI
//!   (LM Studio): список моделей, запрос к чату (целиком и потоком, с остановкой), замер параллельных запросов;
//!   ход ответов штабов на модели — событием staff-stream
//!   (через ядро, без CORS со стороны сервера модели);
//! - в run_scenario можно выбрать источник решений немецких штабов (приказы сценария, доктрина, языковая модель);
//!   ход решений модели приходит в окно событием staff-progress.
//!
//! Команды — crates/agents-tauri. Корень данных — переменная окружения DEFOPS_ROOT, иначе корень репозитория.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![agents_tauri::commands::run_scenario, agents_tauri::commands::read_text, agents_tauri::commands::list_models, agents_tauri::commands::llm_chat_stream, agents_tauri::commands::llm_cancel, agents_tauri::commands::probe_parallel, agents_tauri::commands::game_start, agents_tauri::commands::game_turn, agents_tauri::commands::game_stop])
        .run(tauri::generate_context!())
        .expect("ошибка запуска приложения");
}
