//! Журнал и счётчики выставочного стенда в папке данных приложения.
//!
//! Счётчики — `expo-stats.json`: по местному дню (`ГГГГ-ММ-ДД`, его присылает редактор) число начатых и завершённых
//! сеансов и сбоев; запись — через временный файл и переименование. Журнал — `expo-logs/<день>.log`, строка не длиннее
//! 4096 знаков и без переводов строк. Суммарный объём журнала — не больше `LOG_LIMIT`: сверх него удаляются файлы прошлых
//! дней, начиная со старых; сегодняшний файл не удаляется, а дорос до предела сам — новые строки дня отбрасываются.
//! День проверяется по формату, так что путь из него не собрать.

use std::{fs, io::Write, path::Path, sync::Mutex};
use tauri::Manager;

/// Одна запись за раз: счётчики и журнал из разных окон не перемешиваются.
static LOCK: Mutex<()> = Mutex::new(());

const LOG_LIMIT: u64 = 50 * 1024 * 1024;

fn blank_day() -> serde_json::Value {
    serde_json::json!({ "sessions": 0, "finished": 0, "failures": 0 })
}

fn valid_day(day: &str) -> bool {
    day.len() == 10 && day.bytes().enumerate().all(|(i, c)| if i == 4 || i == 7 { c == b'-' } else { c.is_ascii_digit() })
}

fn read_json(path: &Path) -> serde_json::Value {
    fs::read(path).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or_default()
}

fn add_stat(path: &Path, day: &str, kind: &str) -> Result<serde_json::Value, String> {
    if !valid_day(day) {
        return Err("Неверный день".into());
    }
    let field = match kind {
        "started" => "sessions",
        "finished" => "finished",
        "failure" => "failures",
        _ => return Err("Неизвестный счётчик".into()),
    };
    let mut data = read_json(path);
    if !data.is_object() {
        data = serde_json::json!({});
    }
    if !data[day].is_object() {
        data[day] = blank_day();
    }
    let n = data[day][field].as_u64().unwrap_or(0);
    data[day][field] = serde_json::json!(n.saturating_add(1));
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, serde_json::to_vec(&data).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    fs::rename(tmp, path).map_err(|e| e.to_string())?;
    Ok(data[day].clone())
}

fn append_log(dir: &Path, day: &str, line: &str, limit: u64) -> Result<(), String> {
    if !valid_day(day) {
        return Err("Неверный день".into());
    }
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let today = dir.join(format!("{day}.log"));
    if fs::metadata(&today).map(|m| m.len()).unwrap_or(0) < limit {
        let line: String = line.chars().take(4096).collect::<String>().replace(['\n', '\r'], " ");
        let mut f = fs::OpenOptions::new().create(true).append(true).open(&today).map_err(|e| e.to_string())?;
        writeln!(f, "{line}").map_err(|e| e.to_string())?;
    }
    let mut files: Vec<_> = fs::read_dir(dir)
        .map_err(|e| e.to_string())?
        .flatten()
        .filter_map(|e| e.metadata().ok().filter(|m| m.is_file()).map(|m| (e.path(), m.len())))
        .collect();
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let mut size: u64 = files.iter().map(|(_, n)| n).sum();
    for (path, n) in files {
        if size <= limit {
            break;
        }
        if path == today {
            continue;
        }
        fs::remove_file(path).map_err(|e| e.to_string())?;
        size = size.saturating_sub(n);
    }
    Ok(())
}

#[tauri::command]
pub fn expo_stats_add(app: tauri::AppHandle, day: String, kind: String) -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    add_stat(&dir.join("expo-stats.json"), &day, &kind).map(|_| ())
}

#[tauri::command]
pub fn expo_stats_today(app: tauri::AppHandle, day: String) -> Result<serde_json::Value, String> {
    if !valid_day(&day) {
        return Err("Неверный день".into());
    }
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let data = read_json(&app.path().app_data_dir().map_err(|e| e.to_string())?.join("expo-stats.json"));
    Ok(if data[&day].is_object() { data[&day].clone() } else { blank_day() })
}

#[tauri::command]
pub fn expo_log(app: tauri::AppHandle, day: String, line: String) -> Result<(), String> {
    let _lock = LOCK.lock().map_err(|e| e.to_string())?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("expo-logs");
    append_log(&dir, &day, &line, LOG_LIMIT)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stats_persist_and_reject_unknown_kind() {
        let dir = temp_dir("expo-stats-test");
        let p = dir.join("stats.json");
        assert_eq!(add_stat(&p, "2026-10-31", "started").unwrap()["sessions"], 1);
        assert_eq!(add_stat(&p, "2026-10-31", "finished").unwrap()["sessions"], 1);
        assert!(add_stat(&p, "../../evil", "started").is_err());
        assert!(add_stat(&p, "2026-10-31", "unknown").is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn log_drops_old_days_but_never_today() {
        let dir = temp_dir("expo-log-test");
        fs::write(dir.join("2026-10-29.log"), "x".repeat(60)).unwrap();
        fs::write(dir.join("2026-10-30.log"), "x".repeat(60)).unwrap();
        append_log(&dir, "2026-10-31", "первая", 100).unwrap();
        assert!(!dir.join("2026-10-29.log").exists());
        assert!(dir.join("2026-10-30.log").exists());
        for _ in 0..20 {
            append_log(&dir, "2026-10-31", "строка журнала", 100).unwrap();
        }
        assert!(!dir.join("2026-10-30.log").exists());
        let size = fs::metadata(dir.join("2026-10-31.log")).unwrap().len();
        assert!(size >= 100 && size < 100 + 4096 * 4 + 1, "сегодняшний файл остановился у предела: {size}");
        assert!(append_log(&dir, "../../evil", "x", 100).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
