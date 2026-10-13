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

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

/// Процесс сервисов: остановить при выходе.
struct Services(Mutex<Option<Child>>);

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

/// Сообщение на странице запуска (ошибка запуска сервисов).
fn show_error(app: &tauri::AppHandle, msg: &str) {
    if let Some(w) = app.get_webview_window("main") {
        let text = serde_json::to_string(msg).unwrap_or_default();
        let _ = w.eval(&format!("document.querySelector('.box').innerHTML = '<b>Сервисы не запустились</b><div class=muted></div>'; document.querySelector('.muted').textContent = {text};"));
    }
}

fn main() {
    tauri::Builder::default()
        .manage(Services(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            agents_tauri::commands::run_scenario, agents_tauri::commands::read_text, agents_tauri::commands::list_models,
            agents_tauri::commands::llm_chat_stream, agents_tauri::commands::llm_cancel, agents_tauri::commands::probe_parallel, agents_tauri::commands::game_start, agents_tauri::commands::game_turn, agents_tauri::commands::game_stop
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
                        for line in BufReader::new(out).lines().map_while(Result::ok) {
                            if let (false, Some(url)) = (ready, line.strip_prefix("DEFOPS_READY ")) {
                                ready = true;
                                let target = if cfg!(debug_assertions) { DEV_EDITOR.to_string() } else { format!("{url}/") };
                                if let (Some(w), Ok(u)) = (handle.get_webview_window("main"), target.parse()) { let _ = w.navigate(u); }
                            }
                        }
                        if !ready { show_error(&handle, "запускатель сервисов завершился раньше готовности — подробности в журнале приложения"); }
                    });
                }
                Err(e) => show_error(&handle, &e),
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("приложение не собралось")
        .run(|app, ev| {
            if let RunEvent::Exit = ev {
                if let Some(mut c) = app.state::<Services>().0.lock().unwrap().take() {
                    drop(c.stdin.take()); // закрыть вход — запускатель остановит сервисы
                    std::thread::sleep(std::time::Duration::from_millis(700));
                    let _ = c.kill();
                }
            }
        });
}
