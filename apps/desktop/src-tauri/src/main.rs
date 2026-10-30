//! Настольное приложение платформы: редактор, сервисы и (далее) агентная модель в одном окне, без Docker и СУБД.
//!
//! При старте окно показывает страницу запуска (ui/index.html), приложение поднимает сервисы — фоновый Node-процесс
//! apps/desktop/server/launch.mjs (документы, рендер, реестр, картография, шлюз на 127.0.0.1, данные — в папке
//! данных приложения) — и, когда шлюз готов («DEFOPS_READY <адрес>»), открывает в окне редактор:
//! - в разработке (`tauri dev`) — vite редактора (localhost:5173), сервисы из исходников на порту 8080, куда vite
//!   проводит /api; Node — из системы;
//! - в собранном приложении — собранный редактор с адреса шлюза; Node — рядом с приложением (externalBin), сервисы
//!   и редактор — в ресурсах (scripts/desktop-bundle.mjs).
//! Закрыли окно — закрылся вход запускателя, сервисы остановились.
//!
//! Агентная модель (дивизии) считается в самом приложении — команды crates/agents-tauri (run_scenario и др.), их
//! вызывает «Переигровка» редактора. Данные модели (packages/sim/data): в разработке — из репозитория, в собранном
//! приложении — из ресурсов (data/).
//!
//! Выставочный стенд (expo.rs): окна видов на мониторах, их охрана от закрытия и выхода, опрос мониторов.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

mod expo;
mod expo_storage;

/// Процесс сервисов: остановить при выходе.
struct Services(Mutex<Option<Child>>);

/// Адрес редактора, когда сервисы готовы: если окно вернулось на страницу запуска (Backspace или «Назад» в WebKit
/// листает историю), оно снова открывает редактор, а не ждёт готовности, которая уже была.
struct Ready(Mutex<Option<tauri::Url>>);

/// Адрес редактора в разработке (vite, npm run dev -w @def-ops/editor).
const DEV_EDITOR: &str = "http://localhost:5173/";

fn repo_root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../..") }

fn launch(app: &tauri::AppHandle) -> Result<Child, String> {
    let data = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let mut cmd = if cfg!(debug_assertions) {
        let root = repo_root();
        let mut c = Command::new(if cfg!(windows) { "node.exe" } else { "node" });
        c.arg(root.join("apps/desktop/server/launch.mjs")).args(["--dev", "--port", "8080"]).current_dir(&root);
        c
    } else {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let bin = exe.parent().ok_or("нет папки приложения")?.join(if cfg!(windows) { "node.exe" } else { "node" });
        let res = app.path().resource_dir().map_err(|e| e.to_string())?;
        let mut c = Command::new(bin);
        c.arg(res.join("server/launch.mjs")).arg("--static").arg(res.join("editor"));
        c
    };
    cmd.arg("--data").arg(&data).arg("--watch-stdin");
    cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::inherit());
    cmd.spawn().map_err(|e| format!("не запускается Node: {e}"))
}

/// Файл настроек выставочного стенда в папке данных приложения.
fn expo_settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("expo.json"))
}

/// Текст настроек стенда (expo.json) или None, если файла нет. Проверка значений — в редакторе (expo/settings.ts).
#[tauri::command]
fn expo_settings_read(app: tauri::AppHandle) -> Result<Option<String>, String> {
    match std::fs::read_to_string(expo_settings_path(&app)?) {
        Ok(t) => Ok(Some(t)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("не читается expo.json: {e}")),
    }
}

/// Записать настройки стенда: во временный файл рядом и переименованием, чтобы обрыв не оставил половину файла.
/// bad = true — сохранить испорченный текст как expo.json.bad (сам expo.json не трогается).
#[tauri::command]
fn expo_settings_write(app: tauri::AppHandle, text: String, bad: Option<bool>) -> Result<(), String> {
    let path = expo_settings_path(&app)?;
    let target = if bad.unwrap_or(false) { path.with_file_name("expo.json.bad") } else { path };
    if let Some(dir) = target.parent() { std::fs::create_dir_all(dir).map_err(|e| format!("нет папки данных: {e}"))?; }
    let tmp = target.with_extension("tmp");
    std::fs::write(&tmp, text).map_err(|e| format!("не пишется {}: {e}", tmp.display()))?;
    std::fs::rename(&tmp, &target).map_err(|e| { let _ = std::fs::remove_file(&tmp); format!("не переименовывается в {}: {e}", target.display()) })
}

/// Сообщение на странице запуска (ошибка запуска сервисов).
fn show_error(app: &tauri::AppHandle, msg: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let text = serde_json::to_string(msg).unwrap_or_default();
        let _ = w.eval(&format!("document.querySelector('.box').innerHTML = '<b>Сервисы не запустились</b><div class=muted></div>'; document.querySelector('.muted').textContent = {text};"));
    }
}

fn main() {
    let builder = tauri::Builder::default();
    // macOS: своё меню приложения — системный Quit не проходит через ExitRequested (expo.rs, app_menu)
    #[cfg(target_os = "macos")]
    let builder = builder.menu(|app| expo::app_menu(app)).on_menu_event(expo::on_menu_event);
    builder
        .manage(Services(Mutex::new(None)))
        .manage(Ready(Mutex::new(None)))
        .manage(expo::Expo::default())
        .on_window_event(expo::on_window_event)
        .on_page_load(|webview, payload| {
            // страница запуска — из ресурсов приложения (tauri://localhost, на Windows — http://tauri.localhost)
            let u = payload.url();
            let splash = u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost");
            if splash && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) {
                // адрес — копией, блокировка снята до перехода (переход сам вызывает загрузку страницы)
                let url = webview.app_handle().state::<Ready>().0.lock().unwrap().clone();
                if let Some(url) = url { let _ = webview.navigate(url); }
            }
        })
        .invoke_handler(tauri::generate_handler![
            agents_tauri::commands::run_scenario, agents_tauri::commands::read_text, agents_tauri::commands::list_models,
            agents_tauri::commands::llm_chat_stream, agents_tauri::commands::llm_cancel, agents_tauri::commands::probe_parallel, agents_tauri::commands::game_start, agents_tauri::commands::game_turn, agents_tauri::commands::game_stop, agents_tauri::commands::game_directive, agents_tauri::commands::game_historical, agents_tauri::commands::game_take, agents_tauri::commands::game_release, agents_tauri::commands::game_permit, agents_tauri::commands::game_rewind, agents_tauri::commands::game_variants,
            expo_settings_read, expo_settings_write,
            expo::expo_monitors, expo::expo_open, expo::expo_close_all, expo::expo_set_guard,
            expo_storage::expo_log, expo_storage::expo_stats_add, expo_storage::expo_stats_today
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            // корень данных агентной модели
            if cfg!(debug_assertions) { agents_tauri::set_root(repo_root()); }
            else if let Ok(res) = handle.path().resource_dir() { agents_tauri::set_root(res.join("data")); }
            match launch(&handle) {
                Ok(mut child) => {
                    let out = child.stdout.take();
                    *app.state::<Services>().0.lock().unwrap() = Some(child);
                    // stdout запускателя читаем до конца (иначе труба переполнится): первая строка DEFOPS_READY — адрес
                    std::thread::spawn(move || {
                        let Some(out) = out else { return };
                        let mut ready = false;
                        let mut failed = false;
                        for line in BufReader::new(out).lines().map_while(Result::ok) {
                            if let (false, false, Some(msg)) = (ready, failed, line.strip_prefix("DEFOPS_ERROR ")) { failed = true; show_error(&handle, msg); }
                            if let (false, Some(url)) = (ready, line.strip_prefix("DEFOPS_READY ")) {
                                ready = true;
                                let target = if cfg!(debug_assertions) { DEV_EDITOR.to_string() } else { format!("{url}/") };
                                if let Ok(u) = target.parse::<tauri::Url>() {
                                    *handle.state::<Ready>().0.lock().unwrap() = Some(u.clone());
                                    if let Some(w) = handle.get_webview_window("main") { let _ = w.navigate(u); }
                                }
                            }
                        }
                        if !ready && !failed { show_error(&handle, "запускатель сервисов завершился раньше готовности — подробности в терминале"); }
                    });
                }
                Err(e) => show_error(&handle, &e),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("приложение не собралось")
        .run(|app, ev| {
            expo::on_run_event(app, &ev);
            if let RunEvent::Exit = ev {
                if let Some(mut c) = app.state::<Services>().0.lock().unwrap().take() {
                    drop(c.stdin.take()); // закрыть вход — запускатель остановит сервисы
                    std::thread::sleep(std::time::Duration::from_millis(700));
                    let _ = c.kill();
                }
            }
        });
}
