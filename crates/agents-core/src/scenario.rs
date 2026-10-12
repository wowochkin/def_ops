//! Сценарий агентной модели: штабы, дивизии, объекты, приказы. Загрузка из JSON и синтетический сценарий
//! для замера быстродействия (цели — docs/plans/agents.md, раздел 7.5).

use crate::geo::{LngLat, XY};
use crate::model::*;
use crate::rng::mix;
use crate::rules::Rules;
use crate::theatre::Theatre;
use crate::time::parse_hours;
use crate::world::{ScriptFire, ScriptOrder, ScriptWithdraw, Sim, World};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Arc;

#[derive(Deserialize)]
pub struct HqIn {
    pub id: String,
    pub name: String,
    pub side: Side,
    pub echelon: Echelon,
    #[serde(default)]
    pub parent: Option<String>,
    pub pos: LngLat,
}

#[derive(Deserialize)]
pub struct DivisionIn {
    pub id: String,
    pub name: String,
    pub side: Side,
    pub hq: String,
    pub kind: String,
    pub mobility: Mobility,
    pub size: SizeClass,
    #[serde(default = "one")]
    pub quality: f64,
    pub personnel: f64,
    #[serde(default)]
    pub tanks: f64,
    #[serde(default)]
    pub guns: f64,
    #[serde(default = "one")]
    pub ammo: f64,
    #[serde(default = "one")]
    pub fuel: f64,
    pub pos: LngLat,
    #[serde(default)]
    pub note: String,
    /// Ввод в операцию (время сценария); нет — с начала.
    #[serde(default, rename = "enterAt")]
    pub enter_at: Option<String>,
    /// К началу уже развёрнута в исходном районе для наступления (развёртывание не нужно).
    #[serde(default)]
    pub deployed: bool,
}
fn one() -> f64 { 1.0 }

#[derive(Deserialize)]
pub struct OrderIn {
    /// Дата и время («1945-04-16T05:00») или номер шага.
    pub at: serde_json::Value,
    pub hq: String,
    /// Кому: id дивизий; пусто — всем дивизиям штаба и его подчинённых штабов.
    #[serde(default)]
    pub to: Vec<String>,
    pub kind: OrderKind,
    /// Цель; null — на месте.
    #[serde(default)]
    pub target: Option<LngLat>,
    /// Цель — соединение (id штаба или дивизии): его место в момент приказа со сдвигом offsetKm.
    #[serde(default, rename = "targetFormation")]
    pub target_formation: Option<String>,
    #[serde(default, rename = "offsetKm")]
    pub offset_km: Option<[f64; 2]>,
    #[serde(default)]
    pub forced: bool,
    #[serde(default)]
    pub note: String,
}

#[derive(Deserialize)]
pub struct ScenarioIn {
    pub id: String,
    pub theatre: String,
    pub start: String,
    pub hours: u32,
    #[serde(default)]
    pub seed: u64,
    pub hqs: Vec<HqIn>,
    pub divisions: Vec<DivisionIn>,
    #[serde(default)]
    pub orders: Vec<OrderIn>,
    #[serde(default)]
    pub fires: Vec<FireIn>,
    /// Полосы подготовленной обороны за линиями театра (Theatre::mark_zone).
    #[serde(default, rename = "defenseZones")]
    pub defense_zones: Vec<ZoneIn>,
    #[serde(default)]
    pub withdrawals: Vec<WithdrawIn>,
}

/// Полоса подготовленной обороны: глубина за линией театра и уровень укрепления.
#[derive(Deserialize)]
pub struct ZoneIn {
    pub line: String,
    #[serde(rename = "depthKm")]
    pub depth_km: f64,
    pub level: u8,
    /// Сторона полосы: «west» или «east» от линии.
    pub towards: String,
    #[serde(default)]
    pub note: String,
}

/// Артподготовка армии.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FireIn {
    pub at: serde_json::Value,
    pub hq: String,
    pub duration_min: f64,
    /// Плотность, стволов на км; нет в источниках — норматив правил (combat.artillery.normDensityPerKm).
    #[serde(default)]
    pub density_per_km: Option<f64>,
    #[serde(default)]
    pub note: String,
}

/// Отвод с первой позиции: доли войск на позициях после отвода.
#[derive(Deserialize)]
pub struct WithdrawIn {
    pub at: serde_json::Value,
    pub to: Vec<String>,
    pub positions: [f64; 3],
    #[serde(default)]
    pub note: String,
}

/// Объекты из театра: мосты и населённые пункты (именованные районы).
pub fn theatre_objects(t: &Theatre) -> Vec<Object> {
    let mut out = Vec::new();
    for (i, b) in t.bridges.iter().enumerate() {
        out.push(Object { id: b.id.clone(), name: b.name.clone(), kind: ObjectKind::Bridge, pos: b.pos, control: None, bridge: Some(i as u16), intact: true, busy_until: 0 });
    }
    for a in &t.areas {
        let n = a.ring.len().max(1) as f64;
        let c = a.ring.iter().fold([0.0, 0.0], |s, p| [s[0] + p[0] / n, s[1] + p[1] / n]);
        out.push(Object { id: a.id.clone(), name: a.name.clone(), kind: ObjectKind::Settlement, pos: t.proj.to_xy(c), control: None, bridge: None, intact: true, busy_until: 0 });
    }
    out
}

fn new_division(id: String, name: String, side: Side, hq: u32, params: Params, personnel: f64, tanks: f64, guns: f64, ammo: f64, fuel: f64, pos: XY, rules: &Rules) -> Division {
    let mut d = Division {
        id, name, side, hq, params,
        vars: Vars { personnel, tanks, guns, ammo, fuel, fatigue: 0.0, cohesion: 1.0, prepared_h: 0.0, march_h_today: 0.0, pos, strength0: 0.0, personnel0: personnel, positions: None },
        state: State::Reserve, state_since: 0, order: None, route: None, note: String::new(), enter: 0,
    };
    let (wp, wt, wg) = rules.side(side).weights;
    d.vars.strength0 = (personnel / 1000.0 * wp + tanks * wt + guns * wg) * d.params.quality;
    d
}

/// Сведения о сценарии для прогона и отчёта.
pub struct Meta {
    pub id: String,
    pub name: String,
    pub hours: u32,
    pub start: String,
}

#[derive(Deserialize)]
struct NameOnly {
    #[serde(default)]
    name: String,
}

pub fn load(path: &str, data_dir: &str, root: &str) -> Result<(Sim, Meta), String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let s: ScenarioIn = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    let mut theatre = Theatre::load(&format!("{root}/{}", s.theatre))?;
    for z in &s.defense_zones { theatre.mark_zone(&z.line, z.depth_km, z.level, z.towards == "west"); }
    let theatre = Arc::new(theatre);
    let rules = Rules::load(data_dir)?;
    let start = parse_hours(&s.start).ok_or("start: неверная дата")?;
    let hq_idx: HashMap<&str, u32> = s.hqs.iter().enumerate().map(|(i, h)| (h.id.as_str(), i as u32)).collect();
    let hqs: Vec<Hq> = s.hqs.iter().map(|h| Hq {
        id: h.id.clone(), name: h.name.clone(), side: h.side, echelon: h.echelon,
        parent: h.parent.as_deref().and_then(|p| hq_idx.get(p).copied()), pos: theatre.proj.to_xy(h.pos),
    }).collect();
    let mut divisions = Vec::new();
    for d in &s.divisions {
        let hq = *hq_idx.get(d.hq.as_str()).ok_or_else(|| format!("{}: нет штаба {}", d.id, d.hq))?;
        let params = Params { kind: d.kind.clone(), mobility: d.mobility, size: d.size, quality: d.quality };
        let mut div = new_division(d.id.clone(), d.name.clone(), d.side, hq, params, d.personnel, d.tanks, d.guns, d.ammo, d.fuel, theatre.proj.to_xy(d.pos), &rules);
        div.note = d.note.clone();
        if d.deployed { div.state = State::Deploy { left_h: 0.0 }; }
        if let Some(t) = &d.enter_at {
            let h = (parse_hours(t).ok_or("ввод: неверная дата")? - start).max(0) as u32;
            if h > 0 { div.enter = h; div.state = State::Pending; }
        }
        divisions.push(div);
    }
    let div_idx: HashMap<&str, u32> = s.divisions.iter().enumerate().map(|(i, d)| (d.id.as_str(), i as u32)).collect();
    let mut script = Vec::new();
    for o in &s.orders {
        let at = match &o.at {
            serde_json::Value::Number(n) => n.as_u64().unwrap_or(0) as u32,
            serde_json::Value::String(t) => (parse_hours(t).ok_or("приказ: неверная дата")? - start).max(0) as u32,
            _ => return Err("приказ: at — дата или номер шага".into()),
        };
        let hq = *hq_idx.get(o.hq.as_str()).ok_or_else(|| format!("приказ: нет штаба {}", o.hq))?;
        let to: Vec<u32> = if o.to.is_empty() {
            (0..divisions.len() as u32).filter(|&i| subordinate(&hqs, divisions[i as usize].hq, hq)).collect()
        } else {
            o.to.iter().map(|id| div_idx.get(id.as_str()).copied().ok_or_else(|| format!("приказ: нет дивизии {id}"))).collect::<Result<_, _>>()?
        };
        let off = o.offset_km.unwrap_or([0.0, 0.0]);
        script.push(ScriptOrder { at, hq, to, kind: o.kind, target: o.target.map(|p| theatre.proj.to_xy(p)), forced: o.forced, note: o.note.clone(), follow: o.target_formation.clone(), offset: XY::new(off[0], off[1]) });
    }
    let tick_of = |v: &serde_json::Value| -> Result<u32, String> {
        match v {
            serde_json::Value::Number(n) => Ok(n.as_u64().unwrap_or(0) as u32),
            serde_json::Value::String(t) => Ok((parse_hours(t).ok_or("неверная дата")? - start).max(0) as u32),
            _ => Err("время — дата или номер шага".into()),
        }
    };
    let mut fires = Vec::new();
    for f in &s.fires {
        let hq = *hq_idx.get(f.hq.as_str()).ok_or_else(|| format!("артподготовка: нет штаба {}", f.hq))?;
        fires.push(ScriptFire { at: tick_of(&f.at)?, hq, duration_min: f.duration_min, density_per_km: f.density_per_km.unwrap_or(rules.combat.artillery.norm_density), note: f.note.clone() });
    }
    let mut withdrawals = Vec::new();
    for w in &s.withdrawals {
        let to = w.to.iter().map(|id| div_idx.get(id.as_str()).copied().ok_or_else(|| format!("отвод: нет дивизии {id}"))).collect::<Result<Vec<_>, _>>()?;
        withdrawals.push(ScriptWithdraw { at: tick_of(&w.at)?, to, positions: w.positions, note: w.note.clone() });
    }
    let objects = theatre_objects(&theatre);
    let mut world = World { tick: 0, divisions, hqs, objects, in_transit: Vec::new(), control: Vec::new() };
    world.init_control(&theatre);
    let name = serde_json::from_str::<NameOnly>(&text).map(|n| n.name).unwrap_or_default();
    let meta = Meta { id: s.id.clone(), name, hours: s.hours, start: s.start.clone() };
    let mut sim = Sim::new(theatre, rules, s.seed, start, world, script);
    sim.fires = fires;
    sim.withdrawals = withdrawals;
    Ok((sim, meta))
}

/// Штаб `h` подчинён штабу `top` (или совпадает с ним).
fn subordinate(hqs: &[Hq], mut h: u32, top: u32) -> bool {
    loop {
        if h == top { return true; }
        match hqs[h as usize].parent { Some(p) => h = p, None => return false }
    }
}

/// Синтетический сценарий для замера: `n` дивизий поровну по сторонам вдоль главной полосы на Одере
/// (`lines` театра), советские — восточнее, немецкие — западнее; советские наступают на Берлин, немецкие
/// держатся. Объекты — мосты и пункты театра, добранные до `n_objects` складами.
pub fn synthetic(theatre: Arc<Theatre>, rules: Rules, n: usize, n_objects: usize, seed: u64, start: &str) -> Sim {
    let t = &*theatre;
    let front: Vec<XY> = t.lines.iter().find(|l| l.id == "de_oder_hkl").or(t.lines.first())
        .map(|l| l.line.iter().map(|p| t.proj.to_xy(*p)).collect()).unwrap_or_else(|| vec![XY::new(30.0, 60.0), XY::new(40.0, -60.0)]);
    let along = |u: f64| -> (XY, XY) {
        // точка на ломаной по доле длины и нормаль на восток
        let lens: Vec<f64> = front.windows(2).map(|w| w[0].dist(w[1])).collect();
        let total: f64 = lens.iter().sum();
        let mut s = u * total;
        for (k, w) in front.windows(2).enumerate() {
            if s <= lens[k] || k == lens.len() - 1 {
                let p = w[0].toward(w[1], s);
                let (dx, dy) = (w[1].x - w[0].x, w[1].y - w[0].y);
                let l = (dx * dx + dy * dy).sqrt().max(1e-9);
                let mut nrm = XY::new(dy / l, -dx / l);
                if nrm.x < 0.0 { nrm = XY::new(-nrm.x, -nrm.y); }
                return (p, nrm);
            }
            s -= lens[k];
        }
        (front[0], XY::new(1.0, 0.0))
    };
    let hqs = vec![
        Hq { id: "su_front".into(), name: "фронт (синтетический)".into(), side: Side::Su, echelon: Echelon::Front, parent: None, pos: XY::new(60.0, 0.0) },
        Hq { id: "de_army".into(), name: "армия (синтетическая)".into(), side: Side::De, echelon: Echelon::Army, parent: None, pos: XY::new(-20.0, 0.0) },
    ];
    let berlin = t.proj.to_xy([13.40, 52.52]);
    let mut divisions = Vec::with_capacity(n);
    let mut script = Vec::new();
    let r01 = |k: u64| (mix(seed ^ mix(k)) >> 11) as f64 / (1u64 << 53) as f64;
    for i in 0..n {
        let side = if i % 2 == 0 { Side::Su } else { Side::De };
        let u = (i / 2) as f64 / ((n / 2).max(1)) as f64 + r01(i as u64) * 0.01;
        let (p, nrm) = along(u.min(1.0));
        let off = 4.0 + 12.0 * r01(i as u64 + 1_000_000);
        let q = if side == Side::Su { XY::new(p.x + nrm.x * off, p.y + nrm.y * off) } else { XY::new(p.x - nrm.x * off, p.y - nrm.y * off) };
        let pos = t.land_cell_near(q).map(|c| t.centers[c]).unwrap_or(q);
        let tank = i % 10 == 0;
        let params = Params {
            kind: if tank { "tk".into() } else if side == Side::Su { "sd".into() } else { "pd".into() },
            mobility: if tank { Mobility::Tracked } else { Mobility::Foot },
            size: if tank { SizeClass::Tank } else { SizeClass::Rifle },
            quality: 1.0,
        };
        let (pers, tanks, guns) = if tank { (10_000.0, 200.0, 60.0) } else if side == Side::Su { (5_000.0, 10.0, 120.0) } else { (6_000.0, 15.0, 60.0) };
        divisions.push(new_division(format!("syn_{i}"), format!("синтетическая {i}"), side, if side == Side::Su { 0 } else { 1 }, params, pers, tanks, guns, 1.0, 1.0, pos, &rules));
        let (kind, target) = if side == Side::Su {
            let j = XY::new(berlin.x + 20.0 * (r01(i as u64 + 7) - 0.5), berlin.y + 20.0 * (r01(i as u64 + 9) - 0.5));
            (OrderKind::Attack, j)
        } else { (OrderKind::Hold, pos) };
        script.push(ScriptOrder { at: 0, hq: if side == Side::Su { 0 } else { 1 }, to: vec![i as u32], kind, target: Some(target), forced: false, note: "синтетический приказ".into(), follow: None, offset: XY::default() });
    }
    let mut objects = theatre_objects(t);
    let mut k = 0u64;
    while objects.len() < n_objects {
        let c = (mix(seed ^ mix(0xDEAD_0000 + k)) % (t.cols * t.rows) as u64) as usize;
        k += 1;
        if t.terrain[c] == crate::theatre::WATER { continue; }
        objects.push(Object { id: format!("depot_{k}"), name: format!("склад {k}"), kind: ObjectKind::Depot, pos: t.centers[c], control: None, bridge: None, intact: true, busy_until: 0 });
    }
    let mut world = World { tick: 0, divisions, hqs, objects, in_transit: Vec::new(), control: Vec::new() };
    world.init_control(&theatre);
    let start_h = parse_hours(start).unwrap_or(0);
    Sim::new(theatre, rules, seed, start_h, world, script)
}
