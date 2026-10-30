//! Окна выставочного стенда на мониторах: открыть, стеречь, перестроить при потере экрана.
//!
//! Окно 0 — главное окно `main` (в нём режиссёр сеанса), окна 1 и 2 — `expo-1`, `expo-2` с адресом редактора
//! `?expo=<номер>`; все — во весь экран без рамки на своих мониторах. Какие окна на каких мониторах — решает редактор
//! (expo/windows.ts, `plan`), приложение только исполняет.
//!
//! Охрана (`expo_set_guard(true)`): закрытие любого окна отменяется; окно `expo-*`, уничтоженное иначе, открывается
//! снова на своём мониторе; выход приложения (Cmd+Q, меню, последнее окно) отменяется; раз в 3 с опрашиваются
//! мониторы — при смене списка всем окнам уходит событие `expo://monitors` с новым списком.
//!
//! Полный экран — без отдельного рабочего стола: окно ставится на свой монитор и разворачивается «простым» полным
//! экраном (macOS — simple fullscreen, без Space и анимации; Windows и Linux — полный экран без рамки на текущем
//! мониторе). Родной полный экран macOS (`fullscreen(true)`) не используется: свой Space, анимация, гонка с переездом.
//!
//! Меню приложения на macOS (`app_menu`) — как стандартное, но пункт «Выйти» свой: системный Quit шлёт terminate:,
//! мимо `RunEvent::ExitRequested`, и охрана его не остановила бы; свой пункт вызывает `app.exit(0)`, а он проходит
//! через `ExitRequested`. Без охраны выход как прежде.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent};

pub const MONITORS_EVENT: &str = "expo://monitors";
const PREFIX: &str = "expo-";
const POLL: Duration = Duration::from_secs(3);
/// Начало ошибки «главное окно ещё на странице запуска»: редактор повторяет `expo_open` (expo/windows.ts).
pub const NOT_READY: &str = "EXPO_NOT_READY";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const QUIT_ID: &str = "expo-quit";

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct MonitorInfo { pub id: String, pub name: String, pub x: i32, pub y: i32, pub width: u32, pub height: u32, pub scale: f64 }

#[derive(Deserialize, Clone, Debug)]
pub struct ExpoWindow { pub index: u32, pub monitor: String }

/// Состояние стенда: охрана, поколение опроса мониторов, окна `expo-*`, которые должны быть открыты (метка → монитор).
#[derive(Default)]
pub struct Expo { guard: AtomicBool, poll_gen: AtomicU64, wanted: Mutex<HashMap<String, String>> }

/// Мониторы слева направо (по x, затем по y). id — имя монитора; у одинаковых имён — «имя #2», «имя #3» слева направо;
/// безымянный — «монитор x,y».
fn monitor_list(monitors: Vec<Monitor>) -> Vec<(MonitorInfo, Monitor)> {
    let mut ms = monitors;
    ms.sort_by_key(|m| (m.position().x, m.position().y));
    let mut seen: HashMap<String, u32> = HashMap::new();
    ms.into_iter()
        .map(|m| {
            let (p, s) = (*m.position(), *m.size());
            let name = m.name().cloned().unwrap_or_else(|| format!("монитор {},{}", p.x, p.y));
            let n = seen.entry(name.clone()).or_insert(0);
            *n += 1;
            let id = if *n == 1 { name.clone() } else { format!("{name} #{n}") };
            (MonitorInfo { id, name, x: p.x, y: p.y, width: s.width, height: s.height, scale: m.scale_factor() }, m)
        })
        .collect()
}

fn monitors_of(app: &AppHandle) -> Vec<(MonitorInfo, Monitor)> { monitor_list(app.available_monitors().unwrap_or_default()) }

/// Монитор по id; нет такого (отключили) — основной, затем первый.
fn find_monitor(app: &AppHandle, id: &str) -> Option<Monitor> {
    let mut list = monitors_of(app);
    if let Some(i) = list.iter().position(|(info, _)| info.id == id) { return Some(list.swap_remove(i).1); }
    app.primary_monitor().ok().flatten().or_else(|| list.into_iter().next().map(|(_, m)| m))
}

/// Полный экран без отдельного рабочего стола на мониторе: выйти из полного экрана, встать на монитор, развернуться.
/// Монитор не найден — развернуться там, где окно стоит.
fn fit(w: &WebviewWindow, m: Option<&Monitor>) -> Result<(), String> {
    let e = |e: tauri::Error| e.to_string();
    if let Some(m) = m {
        w.set_simple_fullscreen(false).map_err(e)?;
        w.set_position(PhysicalPosition::new(m.position().x, m.position().y)).map_err(e)?;
    }
    w.set_simple_fullscreen(true).map_err(e)
}

/// Страница запуска (ресурсы приложения), а не редактор.
fn is_splash(u: &tauri::Url) -> bool { u.scheme() == "tauri" || u.host_str() == Some("tauri.localhost") }

/// Адрес редактора: текущий адрес главного окна; оно ещё на странице запуска — адрес готового редактора; редактора
/// ещё нет — ошибка `NOT_READY` (редактор повторит).
fn editor_url(app: &AppHandle) -> Result<tauri::Url, String> {
    let main = app.get_webview_window("main").ok_or("нет главного окна")?;
    let u = main.url().map_err(|e| e.to_string())?;
    if !is_splash(&u) { return Ok(u); }
    let ready = app.state::<crate::Ready>().0.lock().unwrap().clone();
    ready.ok_or_else(|| format!("{NOT_READY}: главное окно ещё на странице запуска"))
}

/// Адрес окна вида: адрес редактора с прежними параметрами, `expo` задан или заменён на номер окна.
fn view_url(editor: &tauri::Url, index: u32) -> tauri::Url {
    let mut u = editor.clone();
    let keep: Vec<(String, String)> = u.query_pairs().filter(|(k, _)| k != "expo").map(|(k, v)| (k.into_owned(), v.into_owned())).collect();
    u.set_fragment(None);
    u.query_pairs_mut().clear().extend_pairs(keep).append_pair("expo", &index.to_string());
    u
}

/// Открыть окно вида на мониторе или переставить уже открытое.
fn place(app: &AppHandle, editor: &tauri::Url, label: &str, index: u32, monitor: &str) -> Result<(), String> {
    let target = find_monitor(app, monitor);
    if let Some(w) = app.get_webview_window(label) { return fit(&w, target.as_ref()); }
    // без полного экрана при сборке: сначала на свой монитор и по его размеру, потом — полный экран без Space
    let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::External(view_url(editor, index)))
        .title(format!("Выставка — экран {}", index + 1))
        .decorations(false);
    if let Some(m) = &target {
        let (p, s) = (m.position().to_logical::<f64>(m.scale_factor()), m.size().to_logical::<f64>(m.scale_factor()));
        b = b.position(p.x, p.y).inner_size(s.width, s.height);
    }
    let w = b.build().map_err(|e| format!("окно {label} не открылось: {e}"))?;
    fit(&w, target.as_ref())
}

#[tauri::command]
pub async fn expo_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    Ok(monitors_of(&app).into_iter().map(|(i, _)| i).collect())
}

/// Открыть или переставить окна по плану; лишние `expo-*` закрыть.
#[tauri::command]
pub async fn expo_open(app: AppHandle, windows: Vec<ExpoWindow>) -> Result<(), String> {
    // редактора ещё нет — ничего не трогать: редактор повторит
    let editor = editor_url(&app)?;
    let wanted: HashMap<String, (u32, String)> = windows.iter().filter(|w| w.index > 0).map(|w| (format!("{PREFIX}{}", w.index), (w.index, w.monitor.clone()))).collect();
    // сначала — какие окна нужны: лишние, уничтоженные ниже, охрана не откроет снова
    *app.state::<Expo>().wanted.lock().unwrap() = wanted.iter().map(|(l, (_, m))| (l.clone(), m.clone())).collect();
    for (label, w) in app.webview_windows() {
        if label.starts_with(PREFIX) && !wanted.contains_key(&label) { let _ = w.destroy(); }
    }
    if let Some(w0) = windows.iter().find(|w| w.index == 0) {
        let main = app.get_webview_window("main").ok_or("нет главного окна")?;
        fit(&main, find_monitor(&app, &w0.monitor).as_ref())?;
    }
    for (label, (index, monitor)) in &wanted { place(&app, &editor, label, *index, monitor)?; }
    Ok(())
}

/// Закрыть окна видов; главное окно — обычный размер.
#[tauri::command]
pub async fn expo_close_all(app: AppHandle) -> Result<(), String> {
    app.state::<Expo>().wanted.lock().unwrap().clear();
    for (label, w) in app.webview_windows() { if label.starts_with(PREFIX) { let _ = w.destroy(); } }
    if let Some(main) = app.get_webview_window("main") { main.set_simple_fullscreen(false).map_err(|e| e.to_string())?; }
    Ok(())
}

/// Включить или снять охрану окон; пока она включена — опрос мониторов.
#[tauri::command]
pub async fn expo_set_guard(app: AppHandle, on: bool) -> Result<(), String> {
    let st = app.state::<Expo>();
    let was = st.guard.swap(on, Ordering::SeqCst);
    if on && !was {
        let gen = st.poll_gen.fetch_add(1, Ordering::SeqCst) + 1;
        let app = app.clone();
        std::thread::spawn(move || {
            let mut last: Vec<MonitorInfo> = monitors_of(&app).into_iter().map(|(i, _)| i).collect();
            loop {
                std::thread::sleep(POLL);
                let st = app.state::<Expo>();
                if !st.guard.load(Ordering::SeqCst) || st.poll_gen.load(Ordering::SeqCst) != gen { return; }
                let now: Vec<MonitorInfo> = monitors_of(&app).into_iter().map(|(i, _)| i).collect();
                let ids = |v: &[MonitorInfo]| v.iter().map(|m| m.id.clone()).collect::<Vec<_>>();
                if ids(&now) != ids(&last) {
                    let _ = app.emit(MONITORS_EVENT, &now);
                    last = now;
                }
            }
        });
    }
    Ok(())
}

/// События окон: при охране закрытие отменяется, уничтоженное окно вида открывается снова. Главное окно уничтожено —
/// окна видов закрываются (без режиссёра они — пустые рамки).
pub fn on_window_event(w: &Window, ev: &WindowEvent) {
    let app = w.app_handle();
    let st = app.state::<Expo>();
    if w.label() == "main" && matches!(ev, WindowEvent::Destroyed) {
        st.wanted.lock().unwrap().clear();
        for (label, v) in app.webview_windows() { if label.starts_with(PREFIX) { let _ = v.destroy(); } }
        return;
    }
    if !st.guard.load(Ordering::SeqCst) { return; }
    match ev {
        WindowEvent::CloseRequested { api, .. } => api.prevent_close(),
        WindowEvent::Destroyed => {
            let label = w.label().to_string();
            let Some(monitor) = st.wanted.lock().unwrap().get(&label).cloned() else { return };
            let Some(index) = label.strip_prefix(PREFIX).and_then(|n| n.parse::<u32>().ok()) else { return };
            let app = app.clone();
            // не из обработчика события: окно открывается с отдельного потока, когда старое уже снято
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                let st = app.state::<Expo>();
                let still = st.guard.load(Ordering::SeqCst) && st.wanted.lock().unwrap().get(&label) == Some(&monitor);
                if still && app.get_webview_window(&label).is_none() {
                    if let Err(e) = editor_url(&app).and_then(|u| place(&app, &u, &label, index, &monitor)) { eprintln!("выставка: {e}"); }
                }
            });
        }
        _ => {}
    }
}

/// События приложения: при охране выход отменяется (выход стенда — только из меню оператора, оно снимает охрану).
pub fn on_run_event(app: &AppHandle, ev: &RunEvent) {
    if let RunEvent::ExitRequested { api, .. } = ev {
        if app.state::<Expo>().guard.load(Ordering::SeqCst) { api.prevent_exit(); }
    }
}

/// Меню приложения на macOS: стандартное, но «Выйти» — свой пункт (Cmd+Q), он проходит через `ExitRequested`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn app_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let name = app.package_info().name.clone();
    Menu::with_items(app, &[
        &Submenu::with_items(app, &name, true, &[
            &PredefinedMenuItem::about(app, None, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::services(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(app, QUIT_ID, format!("Выйти из {name}"), true, Some("CmdOrCtrl+Q"))?,
        ])?,
        &Submenu::with_items(app, "File", true, &[&PredefinedMenuItem::close_window(app, None)?])?,
        &Submenu::with_items(app, "Edit", true, &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
        ])?,
        &Submenu::with_items(app, "View", true, &[&PredefinedMenuItem::fullscreen(app, None)?])?,
        &Submenu::with_items(app, "Window", true, &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::close_window(app, None)?,
        ])?,
    ])
}

/// Пункты меню: «Выйти» — `app.exit(0)`; при охране его остановит `on_run_event`.
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
pub fn on_menu_event(app: &AppHandle, ev: MenuEvent) {
    if ev.id() == QUIT_ID { app.exit(0); }
}
