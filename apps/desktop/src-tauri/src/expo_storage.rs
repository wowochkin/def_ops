//! Ограниченный журнал и счётчики выставочного стенда.
use std::{fs,io::Write,path::Path,sync::Mutex};
use tauri::Manager;
static LOCK: Mutex<()> = Mutex::new(());
fn valid_day(day:&str)->bool { day.len()==10 && day.bytes().enumerate().all(|(i,c)| if i==4||i==7 {c==b'-'}else{c.is_ascii_digit()}) }
fn add_stat(path:&Path,day:&str,kind:&str)->Result<serde_json::Value,String>{
 if !valid_day(day){return Err("Неверный день".into());}
 let field=match kind {"started"=>"sessions","finished"=>"finished","failure"=>"failures",_=>return Err("Неизвестный счётчик".into())};
 let mut data:serde_json::Value=fs::read(path).ok().and_then(|s|serde_json::from_slice(&s).ok()).unwrap_or_else(||serde_json::json!({}));
 if !data.is_object(){data=serde_json::json!({});}
 if !data[day].is_object(){data[day]=serde_json::json!({"sessions":0,"finished":0,"failures":0});}
 let n=data[day][field].as_u64().unwrap_or(0);data[day][field]=serde_json::json!(n.saturating_add(1));
 let tmp=path.with_extension("tmp");fs::write(&tmp,serde_json::to_vec(&data).map_err(|e|e.to_string())?).map_err(|e|e.to_string())?;
 fs::rename(tmp,path).map_err(|e|e.to_string())?;Ok(data[day].clone())
}
#[tauri::command]
pub fn expo_stats_add(app:tauri::AppHandle,day:String,kind:String)->Result<(),String>{
 let _lock=LOCK.lock().map_err(|e|e.to_string())?;let dir=app.path().app_data_dir().map_err(|e|e.to_string())?;fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 add_stat(&dir.join("expo-stats.json"),&day,&kind).map(|_|())
}
#[tauri::command]
pub fn expo_stats_today(app:tauri::AppHandle,day:String)->Result<serde_json::Value,String>{
 if !valid_day(&day){return Err("Неверный день".into());}
 let _lock=LOCK.lock().map_err(|e|e.to_string())?;let path=app.path().app_data_dir().map_err(|e|e.to_string())?.join("expo-stats.json");
 let data:serde_json::Value=fs::read(path).ok().and_then(|s|serde_json::from_slice(&s).ok()).unwrap_or_default();
 Ok(if data[&day].is_object(){data[&day].clone()}else{serde_json::json!({"sessions":0,"finished":0,"failures":0})})
}
#[tauri::command]
pub fn expo_log(app:tauri::AppHandle,day:String,line:String)->Result<(),String>{
 if !valid_day(&day){return Err("Неверный день".into());}
 let _lock=LOCK.lock().map_err(|e|e.to_string())?;
 let dir=app.path().app_data_dir().map_err(|e|e.to_string())?.join("expo-logs");fs::create_dir_all(&dir).map_err(|e|e.to_string())?;
 let file=dir.join(format!("{day}.log"));
 let mut f=fs::OpenOptions::new().create(true).append(true).open(&file).map_err(|e|e.to_string())?;
 writeln!(f,"{}",line.chars().take(4096).collect::<String>().replace(['\n','\r']," ")).map_err(|e|e.to_string())?;drop(f);
 let mut files:Vec<_>=fs::read_dir(&dir).map_err(|e|e.to_string())?.flatten().filter_map(|e|e.metadata().ok().filter(|m|m.is_file()).map(|m|(e.path(),m.len()))).collect();files.sort_by(|a,b|a.0.cmp(&b.0));
 let mut size:u64=files.iter().map(|(_,n)|n).sum();
 for (p,n) in files {if size<=50*1024*1024{break;}fs::remove_file(p).map_err(|e|e.to_string())?;size=size.saturating_sub(n);}Ok(())
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn stats_persist_and_reject_unknown_kind(){let dir=std::env::temp_dir().join(format!("expo-stats-test-{}",std::process::id()));fs::create_dir_all(&dir).unwrap();let p=dir.join("stats.json");let _=fs::remove_file(&p);
 assert_eq!(add_stat(&p,"2026-10-31","started").unwrap()["sessions"],1);
 assert_eq!(add_stat(&p,"2026-10-31","finished").unwrap()["sessions"],1);
 assert!(add_stat(&p,"../../evil","started").is_err());assert!(add_stat(&p,"2026-10-31","unknown").is_err());fs::remove_dir_all(dir).unwrap();}
}
