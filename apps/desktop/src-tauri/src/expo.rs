//! Окна выставочного стенда на мониторах: открыть, стеречь, перестроить при потере экрана.
//!
//! Окно 0 — главное окно `main` (в нём режиссёр сеанса), окна 1 и 2 — `expo-1`, `expo-2` с адресом редактора
//! `?expo=<номер>`; все — во весь экран без рамки на своих мониторах. Какие окна на каких мониторах — решает редактор
//! (expo/windows.ts, `plan`), приложение только исполняет.
//!
//! Охрана (`expo_set_guard(true)`): закрытие любого окна отменяется; окно `expo-*`, уничтоженное иначе, открывается
//! снова на своём мониторе; выход приложения (Cmd+Q, меню, последнее окно) отменяется; раз в 3 с опрашиваются
//! мониторы — при смене списка всем окнам уходит событие `expo://monitors` с новым списком.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, RunEvent, WebviewUrl, WebviewWindowBuilder, Window, WindowEvent};

pub const MONITORS_EVENT: &str = "expo://monitors";
const PREFIX: &str = "expo-";
const POLL: Duration = Duration::from_secs(3);

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

/// Середина монитора в физических точках — по ней приложение выбирает монитор для полного экрана.
fn center(m: &Monitor) -> PhysicalPosition<f64> {
    let (p, s) = (m.position(), m.size());
    PhysicalPosition::new(p.x as f64 + s.width as f64 / 2.0, p.y as f64 + s.height as f64 / 2.0)
}

/// Адрес окна вида: адрес редактора в главном окне с `?expo=<номер>`.
fn view_url(app: &AppHandle, index: u32) -> Result<tauri::Url, String> {
    let main = app.get_webview_window("main").ok_or("нет главного окна")?;
    let mut u = main.url().map_err(|e| e.to_string())?;
    u.set_fragment(None);
    u.set_query(Some(&format!("expo={index}")));
    Ok(u)
}

/// Открыть окно вида на мониторе или переставить уже открытое.
fn place(app: &AppHandle, label: &str, index: u32, monitor: &str) -> Result<(), String> {
    let target = find_monitor(app, monitor);
    if let Some(w) = app.get_webview_window(label) {
        if let Some(m) = &target { w.set_fullscreen_on_monitor(center(m)).map_err(|e| e.to_string())?; }
        else { w.set_fullscreen(true).map_err(|e| e.to_string())?; }
        return Ok(());
    }
    let url = view_url(app, index)?;
    let mut b = WebviewWindowBuilder::new(app, label, WebviewUrl::External(url))
        .title(format!("Выставка — экран {}", index + 1))
        .decorations(false)
        .fullscreen(true);
    if let Some(m) = &target {
        let p = m.position().to_logical::<f64>(m.scale_factor());
        b = b.position(p.x, p.y);
    }
    let w = b.build().map_err(|e| format!("окно {label} не открылось: {e}"))?;
    // на Windows монитор по начальному положению не выбирается — полный экран на нужном мониторе явно
    if let Some(m) = &target { let _ = w.set_fullscreen_on_monitor(center(m)); }
    Ok(())
}

#[tauri::command]
pub async fn expo_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    Ok(monitors_of(&app).into_iter().map(|(i, _)| i).collect())
}

/// Открыть или переставить окна по плану; лишние `expo-*` закрыть.
#[tauri::command]
pub async fn expo_open(app: AppHandle, windows: Vec<ExpoWindow>) -> Result<(), String> {
    let wanted: HashMap<String, (u32, String)> = windows.iter().filter(|w| w.index > 0).map(|w| (format!("{PREFIX}{}", w.index), (w.index, w.monitor.clone()))).collect();
    // сначала — какие окна нужны: лишние, уничтоженные ниже, охрана не откроет снова
    *app.state::<Expo>().wanted.lock().unwrap() = wanted.iter().map(|(l, (_, m))| (l.clone(), m.clone())).collect();
    for (label, w) in app.webview_windows() {
        if label.starts_with(PREFIX) && !wanted.contains_key(&label) { let _ = w.destroy(); }
    }
    if let Some(w0) = windows.iter().find(|w| w.index == 0) {
        let main = app.get_webview_window("main").ok_or("нет главного окна")?;
        match find_monitor(&app, &w0.monitor) {
            Some(m) => main.set_fullscreen_on_monitor(center(&m)),
            None => main.set_fullscreen(true),
        }
        .map_err(|e| e.to_string())?;
    }
    for (label, (index, monitor)) in &wanted { place(&app, label, *index, monitor)?; }
    Ok(())
}

/// Закрыть окна видов; главное окно — обычный размер.
#[tauri::command]
pub async fn expo_close_all(app: AppHandle) -> Result<(), String> {
    app.state::<Expo>().wanted.lock().unwrap().clear();
    for (label, w) in app.webview_windows() { if label.starts_with(PREFIX) { let _ = w.destroy(); } }
    if let Some(main) = app.get_webview_window("main") { main.set_fullscreen(false).map_err(|e| e.to_string())?; }
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

/// События окон: при охране закрытие отменяется, уничтоженное окно вида открывается снова.
pub fn on_window_event(w: &Window, ev: &WindowEvent) {
    let app = w.app_handle();
    let st = app.state::<Expo>();
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
                    if let Err(e) = place(&app, &label, index, &monitor) { eprintln!("выставка: {e}"); }
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
