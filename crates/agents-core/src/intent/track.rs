//! След эталона: среднее по прогонам положение армий по часам (прогон `intent` без вмешательства). Файл
//! `<сценарий>.intent-track.json` рядом со сценарием; отпечаток — хеш текста файла сценария (правки «Редактора» в него не входят).

use crate::geo::LngLat;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    pub fingerprint: String,
    pub hours: u32,
    /// id штаба армии → центр её живых дивизий по часам (None — живых нет).
    pub armies: BTreeMap<String, Vec<Option<LngLat>>>,
}

/// FNV-1a 64 от текста → 16 hex-знаков.
pub fn fingerprint(scenario_text: &str) -> String {
    let mut h: u64 = 0xcbf29ce484222325;
    for b in scenario_text.bytes() { h ^= b as u64; h = h.wrapping_mul(0x100000001b3); }
    format!("{h:016x}")
}

pub fn track_path(scenario_path: &str) -> String {
    format!("{}.intent-track.json", scenario_path.strip_suffix(".json").unwrap_or(scenario_path))
}

/// Центры армий по часам одного хода (trace.json).
fn centers(trace: &Value) -> BTreeMap<String, Vec<Option<LngLat>>> {
    let arr = |k: &str| trace[k].as_array().cloned().unwrap_or_default();
    let fields = arr("fields");
    let fi = |name: &str| fields.iter().position(|f| f == name);
    let (Some(ilng), Some(ilat), Some(ist)) = (fi("lng"), fi("lat"), fi("state")) else { return BTreeMap::new() };
    let hqs = arr("hqs");
    let hq_pos = |id: &str| hqs.iter().position(|h| h["id"] == id);
    let army_of = |mut i: usize| -> Option<usize> {
        for _ in 0..16 {
            if hqs[i]["echelon"] == "army" { return Some(i); }
            i = hq_pos(hqs[i]["parent"].as_str()?)?;
        }
        None
    };
    let army_idx: Vec<Option<usize>> = arr("divisions").iter().map(|d| d["hq"].as_str().and_then(hq_pos).and_then(army_of)).collect();
    let dead = ["небоеспособна", "сведена в другую дивизию", "не введена в операцию"];
    let mut out: BTreeMap<String, Vec<Option<LngLat>>> = BTreeMap::new();
    for h in hqs.iter().filter(|h| h["echelon"] == "army") { out.insert(h["id"].as_str().unwrap_or_default().to_string(), Vec::new()); }
    for frame in arr("frames") {
        let rows = frame.as_array().cloned().unwrap_or_default();
        let mut acc: BTreeMap<usize, (f64, f64, u32)> = BTreeMap::new();
        for (d, row) in rows.iter().enumerate() {
            let Some(Some(a)) = army_idx.get(d) else { continue };
            if dead.contains(&row[ist].as_str().unwrap_or("")) { continue; }
            let (Some(x), Some(y)) = (row[ilng].as_f64(), row[ilat].as_f64()) else { continue };
            let e = acc.entry(*a).or_default();
            *e = (e.0 + x, e.1 + y, e.2 + 1);
        }
        for (id, v) in out.iter_mut() {
            let a = hq_pos(id).unwrap();
            v.push(acc.get(&a).map(|&(x, y, n)| [x / n as f64, y / n as f64]));
        }
    }
    out
}

/// Среднее по ходам центров армий; час без живых дивизий в ходе в среднее не входит (во всех — None).
pub fn record(traces: &[Value]) -> Track {
    let per: Vec<_> = traces.iter().map(centers).collect();
    let mut armies: BTreeMap<String, Vec<Option<LngLat>>> = BTreeMap::new();
    let mut hours = 0usize;
    for c in &per {
        for (id, v) in c {
            hours = hours.max(v.len());
            let e = armies.entry(id.clone()).or_default();
            if e.len() < v.len() { e.resize(v.len(), None); }
        }
    }
    for (id, v) in armies.iter_mut() {
        for (t, slot) in v.iter_mut().enumerate() {
            let pts: Vec<LngLat> = per.iter().filter_map(|c| c.get(id).and_then(|s| s.get(t).copied().flatten())).collect();
            *slot = (!pts.is_empty()).then(|| [pts.iter().map(|p| p[0]).sum::<f64>() / pts.len() as f64, pts.iter().map(|p| p[1]).sum::<f64>() / pts.len() as f64]);
        }
    }
    Track { fingerprint: String::new(), hours: hours.saturating_sub(1) as u32, armies }
}

/// След рядом со сценарием; Err — нет файла или отпечаток чужой (запись в журнал — на вызывающем, у кого есть Sim).
pub fn load(scenario_path: &str) -> Result<Track, String> {
    let text = std::fs::read_to_string(track_path(scenario_path)).map_err(|_| "нет следа эталона".to_string())?;
    let t: Track = serde_json::from_str(&text).map_err(|_| "нет следа эталона".to_string())?;
    let scen = std::fs::read_to_string(scenario_path).map_err(|_| "нет следа эталона".to_string())?;
    if t.fingerprint != fingerprint(&scen) { return Err("след эталона устарел — уход по расстоянию выключен".into()); }
    Ok(t)
}

impl Track {
    pub fn at(&self, hq_id: &str, tick: u32) -> Option<LngLat> {
        self.armies.get(hq_id)?.get(tick as usize).copied().flatten()
    }
}
