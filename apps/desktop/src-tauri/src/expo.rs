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

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, RunEvent, WebviewUrl, WebviewWindow, WebviewWindowBuilder, Window, WindowEvent};

pub const MONITORS_EVENT: &str = "expo://monitors";
const PREFIX: &str = "expo-";
const POLL: Duration = Duration::from_secs(3);
/// Начало ошибки «главное окно ещё на странице запуска»: редактор повторяет `expo_open` (expo/windows.ts).
pub const NOT_READY: &str = "EXPO_NOT_READY";
#[cfg_attr(not(target_os = "macos"), allow(dead_code))]
const QUIT_ID: &str = "expo-quit";

#[derive(Serialize, Clone, PartialEq, Debug)]
pub struct MonitorInfo { pub id: String, pub name: String, pub x: i32, pub y: i32, pub width: u32, pub height: u32, pub scale: f64 }

#[derive(Deserialize, Clone, Debug, PartialEq)]
pub struct ExpoWindow { pub index: u32, pub monitor: String }

/// Состояние стенда: охрана, поколение опроса мониторов, окна `expo-*`, которые должны быть открыты (метка → монитор).
#[derive(Default)]
pub struct Expo {
    guard: AtomicBool,
    poll_gen: AtomicU64,
    wanted: Mutex<HashMap<String, String>>,
    /// Перестановка, закрытие и восстановление окна не исполняются одновременно.
    layout_lock: Mutex<()>,
    plan: Mutex<Vec<ExpoWindow>>,
    main_before: Mutex<Option<WindowPlacement>>,
}

/// Состояние главного окна до входа на стенд; физических пикселей достаточно при смешанном DPI.
struct WindowPlacement {
    position: PhysicalPosition<i32>,
    size: PhysicalSize<u32>,
    fullscreen: bool,
    maximized: bool,
    minimized: bool,
}

impl WindowPlacement {
    fn capture(w: &WebviewWindow) -> Result<Self, String> {
        Ok(Self {
            position: w.outer_position().map_err(|e| e.to_string())?,
            size: w.inner_size().map_err(|e| e.to_string())?,
            fullscreen: w.is_fullscreen().map_err(|e| e.to_string())?,
            maximized: w.is_maximized().map_err(|e| e.to_string())?,
            minimized: w.is_minimized().map_err(|e| e.to_string())?,
        })
    }

    fn restore(&self, w: &WebviewWindow) -> Result<(), String> {
        let e = |e: tauri::Error| e.to_string();
        let mut monitors = w.available_monitors().map_err(e)?;
        if let Some(primary) = w.primary_monitor().map_err(e)? { monitors.insert(0, primary); }
        let areas: Vec<_> = monitors.into_iter().map(|m| {
            let a = m.work_area();
            MonitorInfo { id: String::new(), name: String::new(), x: a.position.x, y: a.position.y, width: a.size.width, height: a.size.height, scale: m.scale_factor() }
        }).collect();
        let (position, size) = visible_restore(self.position, self.size, &areas);
        w.set_simple_fullscreen(false).map_err(e)?;
        w.unmaximize().map_err(e)?;
        // Перенос на другой DPI может изменить размер через WM_DPICHANGED:
        // восстанавливаем физический размер уже на целевом мониторе.
        w.set_position(position).map_err(e)?;
        w.set_size(size).map_err(e)?;
        if self.maximized { w.maximize().map_err(e)?; }
        if self.fullscreen { w.set_fullscreen(true).map_err(e)?; }
        if self.minimized { w.minimize().map_err(e)?; }
        Ok(())
    }
}

fn monitors_changed(before: &[MonitorInfo], after: &[MonitorInfo]) -> bool { before != after }

/// Сохраняем исходную геометрию, пока верх окна доступен; исчезнувший экран заменяем доступным.
fn visible_restore(position: PhysicalPosition<i32>, size: PhysicalSize<u32>, areas: &[MonitorInfo]) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let x = i64::from(position.x) + i64::from(size.width.min(80)) / 2;
    let y = i64::from(position.y) + 20;
    let visible = areas.iter().any(|m| x >= i64::from(m.x) && x < i64::from(m.x) + i64::from(m.width) && y >= i64::from(m.y) && y < i64::from(m.y) + i64::from(m.height));
    if visible { return (position, size); }
    let Some(m) = areas.iter().find(|m| m.width > 0 && m.height > 0) else { return (position, size) };
    let size = PhysicalSize::new(size.width.min(m.width), size.height.min(m.height));
    (PhysicalPosition::new(m.x + ((m.width - size.width) / 2) as i32, m.y + ((m.height - size.height) / 2) as i32), size)
}

/// Центр в физических координатах: не лежит на общей границе двух мониторов.
#[cfg_attr(target_os = "macos", allow(dead_code))]
fn monitor_anchor(m: &MonitorInfo) -> PhysicalPosition<f64> {
    PhysicalPosition::new(f64::from(m.x) + f64::from(m.width) / 2.0, f64::from(m.y) + f64::from(m.height) / 2.0)
}

/// Пустой id допустим только для единственного главного окна, когда ОС не вернула ни одного монитора.
fn validate_plan(windows: &[ExpoWindow], monitors: &[MonitorInfo]) -> Result<(), String> {
    if windows.is_empty() || windows.len() > 3 { return Err("план должен содержать от одного до трёх экранов".into()); }
    let mut indices = HashSet::new();
    let mut targets = HashSet::new();
    for w in windows {
        if w.index as usize >= windows.len() || !indices.insert(w.index) { return Err("индексы экранов должны идти от 0 без повторов и пропусков".into()); }
        if !targets.insert(w.monitor.as_str()) { return Err("каждому экрану нужен отдельный монитор".into()); }
        if monitors.is_empty() && windows.len() == 1 && w.index == 0 && w.monitor.is_empty() { continue; }
        let m = monitors.iter().find(|m| m.id == w.monitor).ok_or_else(|| format!("EXPO_MONITORS_CHANGED: монитор «{}» недоступен", w.monitor))?;
        if m.width == 0 || m.height == 0 || !m.scale.is_finite() || m.scale <= 0.0 { return Err(format!("некорректная геометрия монитора «{}»", w.monitor)); }
    }
    Ok(())
}

enum LayoutAction { Place(ExpoWindow), Remove(u32), Verify }

/// Старые окна убираются только после размещения новых; при ошибке возвращается предыдущий план.
fn change_layout<F>(previous: &[ExpoWindow], next: &[ExpoWindow], mut apply: F) -> Result<(), String>
where F: FnMut(LayoutAction) -> Result<(), String> {
    let order = |plan: &[ExpoWindow]| {
        let mut p = plan.to_vec();
        p.sort_by_key(|w| (w.index == 0, w.index)); // главное окно переносим последним
        p
    };
    let run = (|| {
        for w in order(next) { apply(LayoutAction::Place(w))?; }
        for w in previous.iter().filter(|w| w.index > 0 && !next.iter().any(|n| n.index == w.index)) { apply(LayoutAction::Remove(w.index))?; }
        apply(LayoutAction::Verify)
    })();
    if let Err(error) = run {
        let mut failures = Vec::new();
        for w in order(previous) {
            if let Err(e) = apply(LayoutAction::Place(w)) { failures.push(e); }
        }
        for w in next.iter().filter(|w| w.index > 0 && !previous.iter().any(|p| p.index == w.index)) {
            if let Err(e) = apply(LayoutAction::Remove(w.index)) { failures.push(e); }
        }
        return Err(if failures.is_empty() { error } else { format!("{error}; не полностью восстановлен прежний план: {}", failures.join("; ")) });
    }
    Ok(())
}

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

fn monitors_of(app: &AppHandle) -> Result<Vec<(MonitorInfo, Monitor)>, String> {
    app.available_monitors().map(monitor_list).map_err(|e| format!("не удалось прочитать мониторы: {e}"))
}

/// Никакого молчаливого переноса на primary: исчезнувшую цель должен заменить новый план редактора.
fn find_monitor<'a>(list: &'a [(MonitorInfo, Monitor)], id: &str) -> Result<Option<&'a Monitor>, String> {
    if list.is_empty() && id.is_empty() { return Ok(None); }
    list.iter().find(|(info, _)| info.id == id).map(|(_, m)| Some(m))
        .ok_or_else(|| format!("EXPO_MONITORS_CHANGED: монитор «{id}» недоступен"))
}

/// Полный экран без отдельного рабочего стола на мониторе: выйти из полного экрана, встать на монитор, развернуться.
/// Монитор не найден — развернуться там, где окно стоит.
fn fit(w: &WebviewWindow, m: Option<&Monitor>) -> Result<(), String> {
    let e = |e: tauri::Error| e.to_string();
    w.unminimize().map_err(e)?;
    w.set_simple_fullscreen(false).map_err(e)?;
    w.unmaximize().map_err(e)?;
    if let Some(m) = m {
        w.set_position(PhysicalPosition::new(m.position().x, m.position().y)).map_err(e)?;
        w.set_size(*m.size()).map_err(e)?;
        #[cfg(not(target_os = "macos"))]
        {
            let info = MonitorInfo { id: String::new(), name: String::new(), x: m.position().x, y: m.position().y, width: m.size().width, height: m.size().height, scale: m.scale_factor() };
            return w.set_fullscreen_on_monitor(monitor_anchor(&info)).map_err(e);
        }
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
fn place(app: &AppHandle, editor: &tauri::Url, index: u32, target: Option<&Monitor>) -> Result<(), String> {
    let label = if index == 0 { "main".to_string() } else { format!("{PREFIX}{index}") };
    if let Some(w) = app.get_webview_window(&label) { fit(&w, target)?; return w.show().map_err(|e| e.to_string()); }
    if index == 0 { return Err("нет главного окна".into()); }
    // Builder принимает logical px: чтобы не вычислить чужой DPI при создании, сначала скрытое окно,
    // затем точные physical position/size и fullscreen на явном мониторе, и только после этого show.
    let w = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(view_url(editor, index)))
        .title(format!("Выставка — экран {}", index + 1))
        .decorations(false).visible(false).focused(false)
        .build().map_err(|e| format!("окно {label} не открылось: {e}"))?;
    fit(&w, target)?;
    w.show().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn expo_monitors(app: AppHandle) -> Result<Vec<MonitorInfo>, String> {
    Ok(monitors_of(&app)?.into_iter().map(|(i, _)| i).collect())
}

/// Открыть или переставить окна по плану; лишние `expo-*` закрыть.
#[tauri::command]
pub async fn expo_open(app: AppHandle, windows: Vec<ExpoWindow>) -> Result<(), String> {
    let st = app.state::<Expo>();
    let _layout = st.layout_lock.lock().map_err(|e| e.to_string())?;
    // редактора ещё нет — ничего не трогать: редактор повторит
    let editor = editor_url(&app)?;
    let monitors = monitors_of(&app)?;
    let infos: Vec<_> = monitors.iter().map(|(info, _)| info.clone()).collect();
    validate_plan(&windows, &infos)?;
    let previous = st.plan.lock().unwrap().clone();
    let main = app.get_webview_window("main").ok_or("нет главного окна")?;
    let before = if st.main_before.lock().unwrap().is_none() { Some(WindowPlacement::capture(&main)?) } else { None };
    let result = change_layout(&previous, &windows, |action| match action {
        LayoutAction::Place(w) => {
            let current = monitors_of(&app)?;
            place(&app, &editor, w.index, find_monitor(&current, &w.monitor)?)
        },
        LayoutAction::Remove(index) => match app.get_webview_window(&format!("{PREFIX}{index}")) {
            Some(w) => w.destroy().map_err(|e| e.to_string()), None => Ok(()),
        },
        LayoutAction::Verify => {
            let current: Vec<_> = monitors_of(&app)?.into_iter().map(|(info, _)| info).collect();
            if monitors_changed(&infos, &current) {
                let _ = app.emit(MONITORS_EVENT, &current);
                Err("EXPO_MONITORS_CHANGED: состав или геометрия экранов изменились во время размещения".into())
            } else { Ok(()) }
        }
    });
    if let Err(error) = result {
        if previous.is_empty() {
            if let Some(before) = before {
                if let Err(e) = before.restore(&main) { return Err(format!("{error}; главное окно не восстановлено: {e}")); }
            }
        }
        return Err(error);
    }
    if let Some(before) = before { *st.main_before.lock().unwrap() = Some(before); }
    *st.wanted.lock().unwrap() = windows.iter().filter(|w| w.index > 0).map(|w| (format!("{PREFIX}{}", w.index), w.monitor.clone())).collect();
    *st.plan.lock().unwrap() = windows;
    Ok(())
}

/// Закрыть окна видов; главное окно — обычный размер.
#[tauri::command]
pub async fn expo_close_all(app: AppHandle) -> Result<(), String> {
    let st = app.state::<Expo>();
    let _layout = st.layout_lock.lock().map_err(|e| e.to_string())?;
    st.wanted.lock().unwrap().clear();
    st.plan.lock().unwrap().clear();
    let mut failures = Vec::new();
    for (label, w) in app.webview_windows() {
        if label.starts_with(PREFIX) { if let Err(e) = w.destroy() { failures.push(e.to_string()); } }
    }
    if let Some(main) = app.get_webview_window("main") {
        let mut before = st.main_before.lock().unwrap();
        let result = if let Some(saved) = before.as_ref() { saved.restore(&main) } else { main.set_simple_fullscreen(false).map_err(|e| e.to_string()) };
        match result { Ok(()) => { *before = None; }, Err(e) => failures.push(e) }
    }
    if failures.is_empty() { Ok(()) } else { Err(failures.join("; ")) }
}

/// Меню оператора открывается в host: из любого экрана возвращаем туда клавиатурный фокус.
#[tauri::command]
pub async fn expo_focus_main(app: AppHandle) -> Result<(), String> {
    let main = app.get_webview_window("main").ok_or("нет главного окна")?;
    main.unminimize().map_err(|e| e.to_string())?;
    main.show().map_err(|e| e.to_string())?;
    main.set_focus().map_err(|e| e.to_string())
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
            let mut last: Option<Vec<MonitorInfo>> = monitors_of(&app).ok().map(|list| list.into_iter().map(|(i, _)| i).collect());
            loop {
                std::thread::sleep(POLL);
                let st = app.state::<Expo>();
                if !st.guard.load(Ordering::SeqCst) || st.poll_gen.load(Ordering::SeqCst) != gen { return; }
                // Ошибка ОС не означает отключение всех мониторов: сохраняем последний удачный список.
                let Ok(list) = monitors_of(&app) else { continue };
                let now: Vec<MonitorInfo> = list.into_iter().map(|(i, _)| i).collect();
                if last.as_ref().map_or(true, |old| monitors_changed(old, &now)) {
                    let _ = app.emit(MONITORS_EVENT, &now);
                    last = Some(now);
                }
            }
        });
    }
    Ok(())
}

/// Оборвать голос заставки до того, как страница исчезнет: иначе уже поставленная фраза доигрывает без окна.
fn hush(w: &WebviewWindow) { let _ = w.eval("window.__expoHush?.()"); }

/// События окон: при охране закрытие отменяется, уничтоженное окно вида открывается снова. Главное окно уничтожено —
/// окна видов закрываются (без режиссёра они — пустые рамки).
pub fn on_window_event(w: &Window, ev: &WindowEvent) {
    let app = w.app_handle();
    let st = app.state::<Expo>();
    if w.label() == "main" && matches!(ev, WindowEvent::Destroyed) {
        // Без host некому снять охрану: не оставляем невидимое приложение, запрещающее выход.
        st.guard.store(false, Ordering::SeqCst);
        st.wanted.lock().unwrap().clear();
        for (label, v) in app.webview_windows() {
            if label.starts_with(PREFIX) { hush(&v); let _ = v.destroy(); }
        }
        return;
    }
    if let WindowEvent::CloseRequested { api, .. } = ev {
        if st.guard.load(Ordering::SeqCst) { api.prevent_close(); }
        else if let Some(view) = app.get_webview_window(w.label()) { hush(&view); }
        return;
    }
    if !st.guard.load(Ordering::SeqCst) { return; }
    match ev {
        WindowEvent::Destroyed => {
            let label = w.label().to_string();
            let Some(monitor) = st.wanted.lock().unwrap().get(&label).cloned() else { return };
            let Some(index) = label.strip_prefix(PREFIX).and_then(|n| n.parse::<u32>().ok()) else { return };
            let app = app.clone();
            // не из обработчика события: окно открывается с отдельного потока, когда старое уже снято
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(300));
                let st = app.state::<Expo>();
                let Ok(_layout) = st.layout_lock.lock() else { return };
                let still = st.guard.load(Ordering::SeqCst) && st.wanted.lock().unwrap().get(&label) == Some(&monitor);
                if still && app.get_webview_window(&label).is_none() {
                    let restore = (|| {
                        let list = monitors_of(&app)?;
                        place(&app, &editor_url(&app)?, index, find_monitor(&list, &monitor)?)
                    })();
                    if let Err(e) = restore { eprintln!("выставка: {e}"); }
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
        else { for (_, w) in app.webview_windows() { hush(&w); } }
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

#[cfg(test)]
mod tests {
    use super::*;

    fn monitor(id: &str, x: i32, scale: f64) -> MonitorInfo {
        MonitorInfo { id: id.into(), name: id.into(), x, y: 0, width: 1920, height: 1080, scale }
    }
    fn slots(ids: &[&str]) -> Vec<ExpoWindow> {
        ids.iter().enumerate().map(|(index, id)| ExpoWindow { index: index as u32, monitor: (*id).into() }).collect()
    }

    #[test]
    fn validates_complete_unique_existing_monitor_plan() {
        let monitors = vec![monitor("A", -1920, 1.0), monitor("B", 0, 1.5), monitor("C", 1920, 2.0)];
        assert!(validate_plan(&slots(&["C", "A", "B"]), &monitors).is_ok());
        for plan in [slots(&[]), slots(&["A", "A"]), slots(&["A", "missing"]), vec![ExpoWindow { index: 1, monitor: "A".into() }]] {
            assert!(validate_plan(&plan, &monitors).is_err(), "{plan:?}");
        }
        assert!(validate_plan(&[ExpoWindow { index: 0, monitor: "".into() }], &[]).is_ok());
        assert!(validate_plan(&slots(&[""]), &monitors).is_err());
    }

    #[test]
    fn detects_geometry_and_scale_changes_with_same_ids() {
        let before = vec![monitor("A", -1920, 1.0), monitor("B", 0, 1.5)];
        for field in 0..4 {
            let mut after = before.clone();
            match field { 0 => after[1].x = 100, 1 => after[1].width = 2560, 2 => after[1].height = 1440, _ => after[1].scale = 2.0 }
            assert!(monitors_changed(&before, &after));
        }
        assert!(!monitors_changed(&before, &before));
    }

    #[test]
    fn fullscreen_anchor_stays_in_physical_coordinates_at_any_dpi() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            let m = monitor("left", -1920, scale);
            assert_eq!(monitor_anchor(&m), PhysicalPosition::new(-960.0, 540.0));
        }
    }

    #[test]
    fn restore_keeps_connected_screen_and_recovers_an_unplugged_original_screen() {
        let screens = vec![monitor("primary", 0, 1.0), monitor("left", -1920, 2.0)];
        let at = PhysicalPosition::new(-1800, 100);
        let size = PhysicalSize::new(1440, 900);
        assert_eq!(visible_restore(at, size, &screens), (at, size));
        let (restored, restored_size) = visible_restore(at, size, &screens[..1]);
        assert_eq!(restored_size, size);
        assert!(restored.x >= 0 && restored.y >= 0);
        let (_, small) = visible_restore(at, PhysicalSize::new(3840, 2160), &screens[..1]);
        assert_eq!(small, PhysicalSize::new(1920, 1080));
    }

    #[test]
    fn failed_reassignment_restores_previous_plan_and_removes_new_windows() {
        let previous = slots(&["A", "B"]);
        let next = slots(&["C", "A", "B"]);
        let mut state: HashMap<u32, String> = previous.iter().map(|w| (w.index, w.monitor.clone())).collect();
        let mut failed = false;
        let result = change_layout(&previous, &next, |action| {
            match action {
                LayoutAction::Place(w) => { state.insert(w.index, w.monitor); }
                LayoutAction::Remove(index) => { state.remove(&index); }
                LayoutAction::Verify if !failed => { failed = true; return Err("тестовый сбой размещения".into()); }
                LayoutAction::Verify => {}
            }
            Ok(())
        });
        assert!(result.is_err());
        assert_eq!(state, HashMap::from([(0, "A".into()), (1, "B".into())]));
    }

    #[test]
    fn partially_created_window_is_removed_when_placement_fails() {
        let previous = slots(&["A", "B"]);
        let next = slots(&["C", "A", "B"]);
        let mut state: HashMap<u32, String> = previous.iter().map(|w| (w.index, w.monitor.clone())).collect();
        let result = change_layout(&previous, &next, |action| {
            match action {
                LayoutAction::Place(w) => {
                    state.insert(w.index, w.monitor);
                    if w.index == 2 { return Err("создано окно, но fit не удался".into()); }
                }
                LayoutAction::Remove(index) => { state.remove(&index); }
                LayoutAction::Verify => panic!("после сбоя размещения проверка не запускается"),
            }
            Ok(())
        });
        assert!(result.unwrap_err().contains("fit не удался"));
        assert_eq!(state, HashMap::from([(0, "A".into()), (1, "B".into())]));
    }

    #[test]
    fn reports_rollback_failure_instead_of_claiming_the_previous_plan_was_restored() {
        let result = change_layout(&slots(&["A", "B"]), &slots(&["B", "A"]), |action| {
            match action {
                LayoutAction::Place(w) => Err(format!("недоступен {}", w.monitor)),
                _ => Ok(()),
            }
        });
        let error = result.unwrap_err();
        assert!(error.contains("не полностью восстановлен прежний план"));
        assert!(error.contains("недоступен A") && error.contains("недоступен B"));
    }

    #[test]
    fn rejects_bad_targets_before_any_window_operation() {
        let monitors = vec![monitor("A", 0, 1.0)];
        assert!(validate_plan(&slots(&["A", "A"]), &monitors).is_err());
        let mut calls = vec![];
        change_layout(&slots(&["A", "B", "C"]), &slots(&["B", "A"]), |action| {
            calls.push(match action { LayoutAction::Place(w) => format!("place:{}", w.index), LayoutAction::Remove(index) => format!("remove:{index}"), LayoutAction::Verify => "verify".into() });
            Ok(())
        }).unwrap();
        assert_eq!(calls.last().map(String::as_str), Some("verify"));
        assert!(calls.iter().position(|x| x == "remove:2").unwrap() > calls.iter().position(|x| x == "place:0").unwrap());
    }
}
