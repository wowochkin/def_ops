//! Сценарий агентной модели: штабы, дивизии, объекты, приказы. Загрузка из JSON и синтетический сценарий
//! для замера быстродействия (цели — docs/plans/agents.md, раздел 7.5).

use crate::geo::{LngLat, XY};
use crate::model::*;
use crate::rng::mix;
use crate::rules::Rules;
use crate::theatre::Theatre;
use crate::time::parse_hours;
use crate::world::{ChangeKind, Event, ScriptChange, ScriptFire, ScriptOrder, ScriptWithdraw, Sim, World};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
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
    /// Обводы обороны города (Theatre::mark_city).
    #[serde(default, rename = "cityRings")]
    pub city_rings: Vec<CityRingIn>,
    #[serde(default)]
    pub withdrawals: Vec<WithdrawIn>,
    /// Исторические директивы верхних инстанций (command::directive).
    #[serde(default)]
    pub directives: Vec<crate::command::directive::DirectiveIn>,
    /// Исторические распоряжения фронтов армиям (задачи армий по документам фронтов) — для прогона «фронты по истории».
    #[serde(default, rename = "frontDirectives")]
    pub front_directives: Vec<crate::command::directive::DirectiveIn>,
}

/// Обвод обороны города: многоугольник и уровень (1 — внешний, 2 — внутренний, 3 — центральный сектор).
#[derive(Deserialize)]
pub struct CityRingIn {
    pub name: String,
    pub level: u8,
    pub side: String,
    pub ring: Vec<LngLat>,
    #[serde(default)]
    pub note: String,
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

/// Поправки сценария из базы знаний: исходные цифры дивизий и изменения по датам. Всё необязательно; без поправок
/// сценарий загружается как есть.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditsIn {
    /// id дивизии → поправка исходных значений.
    #[serde(default)]
    pub divisions: BTreeMap<String, DivEdit>,
    #[serde(default)]
    pub changes: Vec<ChangeIn>,
}

/// Поправка исходных значений дивизии: заменяет значение сценария.
#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DivEdit {
    #[serde(default)]
    pub personnel: Option<f64>,
    #[serde(default)]
    pub tanks: Option<f64>,
    #[serde(default)]
    pub guns: Option<f64>,
    /// id штаба; неизвестный — поправка штаба пропускается (запись в журнале).
    #[serde(default)]
    pub hq: Option<String>,
    #[serde(default)]
    pub enter_at: Option<String>,
}

/// Изменение по дате: пополнение или переподчинение.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeIn {
    /// Дата и время («1945-04-16T05:00»); исполняется в первом часе не раньше неё.
    pub at: String,
    /// id дивизии или штаба (для штаба переподчинение меняет его вышестоящий штаб).
    pub formation: String,
    pub kind: ChangeKind,
    #[serde(default)]
    pub personnel: Option<f64>,
    #[serde(default)]
    pub tanks: Option<f64>,
    #[serde(default)]
    pub guns: Option<f64>,
    /// Для переподчинения — id нового вышестоящего штаба.
    #[serde(default)]
    pub parent: Option<String>,
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
        vars: Vars { personnel, tanks, guns, ammo, fuel, fatigue: 0.0, cohesion: 1.0, coord: 1.0, prepared_h: 0.0, march_h_today: 0.0, march_h_log: [0.0; 24], pos, strength0: 0.0, personnel0: personnel, positions: None, lost: [0.0; 3], captured: 0.0, reinforced: [0.0; 3] },
        state: State::Reserve, state_since: 0, order: None, route: None, note: String::new(), enter: 0, cut_since: None, relink_since: None,
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
    /// Путь файла сценария (след эталона «истории как замысла» — рядом с ним).
    pub path: String,
}

#[derive(Deserialize)]
struct NameOnly {
    #[serde(default)]
    name: String,
}

pub fn load(path: &str, data_dir: &str, root: &str) -> Result<(Sim, Meta), String> { load_with(path, data_dir, root, None, None) }

/// Сценарий с поправками параметров агентной модели (rules::apply_overrides) и поправками сценария из базы знаний
/// (`edits`): исходные цифры дивизий — до расчёта начальной силы, изменения по датам — в Sim::changes. Пропущенные
/// поправки (неизвестная дивизия или штаб) — записи журнала на шаге 0 «поправка пропущена: …».
pub fn load_with(path: &str, data_dir: &str, root: &str, overrides: Option<&serde_json::Value>, edits: Option<&EditsIn>) -> Result<(Sim, Meta), String> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    let s: ScenarioIn = serde_json::from_str(&text).map_err(|e| format!("{path}: {e}"))?;
    let mut theatre = Theatre::load(&format!("{root}/{}", s.theatre))?;
    for z in &s.defense_zones { theatre.mark_zone(&z.line, z.depth_km, z.level, z.towards == "west"); }
    for r in &s.city_rings { let _ = &r.name; theatre.mark_city(&r.ring, r.level, &r.side); }
    let theatre = Arc::new(theatre);
    let rules = Rules::load_with(data_dir, overrides)?;
    let start = parse_hours(&s.start).ok_or("start: неверная дата")?;
    let hq_idx: HashMap<&str, u32> = s.hqs.iter().enumerate().map(|(i, h)| (h.id.as_str(), i as u32)).collect();
    let hqs: Vec<Hq> = s.hqs.iter().map(|h| Hq {
        id: h.id.clone(), name: h.name.clone(), side: h.side, echelon: h.echelon,
        parent: h.parent.as_deref().and_then(|p| hq_idx.get(p).copied()), pos: theatre.proj.to_xy(h.pos),
    }).collect();
    let mut divisions = Vec::new();
    let mut notes: Vec<Event> = Vec::new();
    if let Some(e) = edits {
        for id in e.divisions.keys().filter(|id| !s.divisions.iter().any(|d| &d.id == *id)) {
            notes.push(Event { tick: 0, agent: u32::MAX, text: format!("поправка пропущена: нет дивизии {id}") });
        }
    }
    for (i, d) in s.divisions.iter().enumerate() {
        let mut hq = *hq_idx.get(d.hq.as_str()).ok_or_else(|| format!("{}: нет штаба {}", d.id, d.hq))?;
        let ed = edits.and_then(|e| e.divisions.get(&d.id));
        if let Some(h) = ed.and_then(|e| e.hq.as_deref()) {
            match hq_idx.get(h) {
                Some(&k) if hqs[k as usize].side == d.side => hq = k,
                Some(_) => notes.push(Event { tick: 0, agent: i as u32, text: format!("поправка пропущена: {} — штаб {h} другой стороны", d.id) }),
                None => notes.push(Event { tick: 0, agent: i as u32, text: format!("поправка пропущена: {} — нет штаба {h}", d.id) }),
            }
        }
        // цифры поправки — не меньше 0
        let personnel = ed.and_then(|e| e.personnel).map_or(d.personnel, |x| x.max(0.0));
        let tanks = ed.and_then(|e| e.tanks).map_or(d.tanks, |x| x.max(0.0));
        let guns = ed.and_then(|e| e.guns).map_or(d.guns, |x| x.max(0.0));
        let enter_at = ed.and_then(|e| e.enter_at.as_ref()).or(d.enter_at.as_ref());
        let params = Params { kind: d.kind.clone(), mobility: d.mobility, size: d.size, quality: d.quality };
        let mut div = new_division(d.id.clone(), d.name.clone(), d.side, hq, params, personnel, tanks, guns, d.ammo, d.fuel, theatre.proj.to_xy(d.pos), &rules);
        div.note = d.note.clone();
        if d.deployed { div.state = State::Deploy { left_h: 0.0 }; }
        if let Some(t) = enter_at {
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
    let mut world = World { tick: 0, divisions, hqs, objects, in_transit: Vec::new(), control: Vec::new(), reach: [Vec::new(), Vec::new()], held: [Vec::new(), Vec::new()], engaged: Vec::new() };
    world.init_control(&theatre);
    let name = serde_json::from_str::<NameOnly>(&text).map(|n| n.name).unwrap_or_default();
    let meta = Meta { id: s.id.clone(), name, hours: s.hours, start: s.start.clone(), path: path.to_string() };
    let mut historical = Vec::new();
    {
        let hour = |t: &str| parse_hours(t).map(|h| (h - start).max(0) as u32);
        let xy = |p: crate::geo::LngLat| theatre.proj.to_xy(p);
        for d in s.directives.iter().chain(&s.front_directives) { historical.extend(d.resolve(&hq_idx, &hour, &xy)?); }
        historical.sort_by_key(|x: &(u32, crate::command::directive::Directive)| x.0);
    }
    let mut sim = Sim::new(theatre, rules, s.seed, start, world, script);
    sim.historical = historical;
    sim.intent.scenario = Some(path.to_string());
    sim.fires = fires;
    sim.withdrawals = withdrawals;
    if let Some(e) = edits {
        for c in &e.changes {
            let at = (parse_hours(&c.at).ok_or_else(|| format!("изменение {}: неверная дата {}", c.formation, c.at))? - start).max(0) as u32;
            sim.changes.push(ScriptChange { at, formation: c.formation.clone(), kind: c.kind, personnel: c.personnel.unwrap_or(0.0), tanks: c.tanks.unwrap_or(0.0), guns: c.guns.unwrap_or(0.0), parent: c.parent.clone() });
        }
        // по часу; в одном часе — в порядке входа
        sim.changes.sort_by_key(|c| c.at);
    }
    sim.journal = notes;
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
    let mut world = World { tick: 0, divisions, hqs, objects, in_transit: Vec::new(), control: Vec::new(), reach: [Vec::new(), Vec::new()], held: [Vec::new(), Vec::new()], engaged: Vec::new() };
    world.init_control(&theatre);
    let start_h = parse_hours(start).unwrap_or(0);
    Sim::new(theatre, rules, seed, start_h, world, script)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{repo_root, DATA_DIR};

    /// Маленький сценарий на театре «Одер — Берлин»: фронт с армией, немецкая армия; дивизии сторон далеко друг от друга
    /// (без соприкосновения), приказов нет. Файл — во временной папке под именем `name`.
    pub(crate) fn tiny(name: &str, edits: Option<&EditsIn>) -> (Sim, Meta) {
        let root = repo_root();
        let s = serde_json::json!({
            "id": name, "theatre": "packages/sim/data/theatres/oder-berlin-1945.json",
            "start": "1945-04-16T05:00", "hours": 24, "seed": 1,
            "hqs": [
                { "id": "su_f", "name": "фронт", "side": "su", "echelon": "front", "parent": null, "pos": [15.2, 52.5] },
                { "id": "su_a", "name": "армия А", "side": "su", "echelon": "army", "parent": "su_f", "pos": [15.1, 52.5] },
                { "id": "su_b", "name": "армия Б", "side": "su", "echelon": "army", "parent": "su_f", "pos": [15.1, 52.6] },
                { "id": "de_a", "name": "немецкая армия", "side": "de", "echelon": "army", "parent": null, "pos": [13.4, 52.5] }
            ],
            "divisions": [
                { "id": "su_1", "name": "1 сд", "side": "su", "hq": "su_a", "kind": "sd", "mobility": "foot", "size": "rifle", "personnel": 5000, "tanks": 0, "guns": 100, "pos": [15.1, 52.5] },
                { "id": "su_2", "name": "2 сд", "side": "su", "hq": "su_b", "kind": "sd", "mobility": "foot", "size": "rifle", "personnel": 6000, "tanks": 0, "guns": 120, "pos": [15.1, 52.6], "enterAt": "1945-04-16T10:00" },
                { "id": "de_1", "name": "1 пд", "side": "de", "hq": "de_a", "kind": "pd", "mobility": "foot", "size": "rifle", "personnel": 7000, "tanks": 10, "guns": 60, "pos": [13.4, 52.5] }
            ]
        });
        let path = std::env::temp_dir().join(format!("agents-core-{name}-{}.json", std::process::id()));
        std::fs::write(&path, s.to_string()).unwrap();
        load_with(&path.to_string_lossy(), &format!("{root}/{DATA_DIR}"), &root, None, edits).expect("сценарий")
    }

    fn edits(v: serde_json::Value) -> EditsIn { serde_json::from_value(v).expect("поправки") }

    fn div<'a>(sim: &'a Sim, id: &str) -> &'a Division { sim.world.divisions.iter().find(|d| d.id == id).unwrap() }

    #[test]
    fn edits_apply_initial() {
        let (base, _) = tiny("edits-base", None);
        let e = edits(serde_json::json!({ "divisions": {
            "su_1": { "personnel": 8000, "hq": "su_b" },
            "su_2": { "hq": "нет_штаба", "enterAt": "1945-04-16T07:00" },
            "нет_дивизии": { "personnel": 1 }
        } }));
        let (sim, _) = tiny("edits-initial", Some(&e));
        let d = div(&sim, "su_1");
        assert_eq!(d.vars.personnel, 8000.0);
        assert_eq!(d.vars.personnel0, 8000.0);
        assert_eq!(sim.world.hqs[d.hq as usize].id, "su_b");
        // боевая сила на начало — по поправленным цифрам
        assert!(d.vars.strength0 > div(&base, "su_1").vars.strength0);
        assert!((d.vars.strength0 - sim.material_strength(d)).abs() < 1e-9);
        // неизвестный штаб: поправка штаба пропущена (с записью), остальные поправки дивизии — исполнены
        let d2 = div(&sim, "su_2");
        assert_eq!(sim.world.hqs[d2.hq as usize].id, "su_b");
        assert_eq!(d2.enter, 2);
        assert!(sim.journal.iter().any(|e| e.text.contains("поправка пропущена") && e.text.contains("нет_штаба")));
        assert!(sim.journal.iter().any(|e| e.text.contains("поправка пропущена") && e.text.contains("нет_дивизии")));
        // без поправок — как раньше: журнал пуст
        assert!(base.journal.is_empty());
    }

    #[test]
    fn edits_initial_side_and_negative() {
        // штаб другой стороны — поправка штаба пропущена (с записью); отрицательные цифры — 0
        let e = edits(serde_json::json!({ "divisions": {
            "su_1": { "hq": "de_a", "personnel": -100, "tanks": -5, "guns": -1 }
        } }));
        let (sim, _) = tiny("edits-side", Some(&e));
        let d = div(&sim, "su_1");
        assert_eq!(sim.world.hqs[d.hq as usize].id, "su_a");
        assert_eq!((d.vars.personnel, d.vars.tanks, d.vars.guns), (0.0, 0.0, 0.0));
        assert!(sim.journal.iter().any(|e| e.text.contains("поправка пропущена") && e.text.contains("de_a") && e.text.contains("другой стороны")));
    }

    #[test]
    fn change_reinforce_at_hour() {
        let e = edits(serde_json::json!({ "changes": [
            { "at": "1945-04-16T08:00", "formation": "su_1", "kind": "reinforce", "personnel": 1000, "guns": 20 },
            // не введённая к часу изменения — пополняется при вводе (10:00, шаг 5)
            { "at": "1945-04-16T06:00", "formation": "su_2", "kind": "reinforce", "personnel": 500 }
        ] }));
        let (mut sim, _) = tiny("change-reinforce", Some(&e));
        for _ in 0..3 { sim.step(); }
        let before = div(&sim, "su_1").clone();
        assert_eq!(before.vars.personnel, 5000.0);
        sim.step(); // шаг 3 = 08:00
        let d = div(&sim, "su_1");
        assert!((d.vars.personnel - before.vars.personnel - 1000.0).abs() < 1e-6, "{}", d.vars.personnel);
        assert!((d.vars.guns - before.vars.guns - 20.0).abs() < 1e-6);
        assert_eq!(d.vars.personnel0, 6000.0);
        let (wp, _, wg) = sim.rules.side(d.side).weights;
        assert!((d.vars.strength0 - before.vars.strength0 - (1.0 * wp + 20.0 * wg) * d.params.quality).abs() < 1e-9);
        assert!(sim.journal.iter().any(|e| e.tick == 3 && e.text.contains("пополнение +1000 чел.")));
        // su_2 до ввода не пополнена, при вводе — пополнена
        assert_eq!(div(&sim, "su_2").vars.personnel, 6000.0);
        sim.step();
        assert_eq!(div(&sim, "su_2").vars.personnel, 6000.0);
        sim.step(); // шаг 5 — ввод
        let d2 = div(&sim, "su_2");
        assert_eq!(d2.vars.personnel, 6500.0);
        assert_eq!(d2.vars.personnel0, 6500.0);
    }

    #[test]
    fn change_resubordinate_bad() {
        let e = edits(serde_json::json!({ "changes": [
            { "at": "1945-04-16T06:00", "formation": "su_1", "kind": "resubordinate", "parent": "нет_штаба" },
            { "at": "1945-04-16T06:00", "formation": "su_f", "kind": "resubordinate", "parent": "su_a" },
            { "at": "1945-04-16T06:00", "formation": "su_a", "kind": "resubordinate", "parent": "su_a" },
            { "at": "1945-04-16T06:00", "formation": "нет_формирования", "kind": "resubordinate", "parent": "su_f" },
            { "at": "1945-04-16T07:00", "formation": "su_1", "kind": "resubordinate", "parent": "su_b" },
            { "at": "1945-04-16T07:00", "formation": "su_b", "kind": "resubordinate", "parent": "su_a" }
        ] }));
        let (mut sim, _) = tiny("change-resub", Some(&e));
        let hq_of = |sim: &Sim, id: &str| sim.world.hqs[div(sim, id).hq as usize].id.clone();
        let parent_of = |sim: &Sim, id: &str| sim.world.hqs.iter().find(|h| h.id == id).unwrap().parent.map(|p| sim.world.hqs[p as usize].id.clone());
        sim.step();
        sim.step(); // шаг 1 = 06:00
        assert_eq!(hq_of(&sim, "su_1"), "su_a");
        assert_eq!(parent_of(&sim, "su_f"), None);
        assert_eq!(parent_of(&sim, "su_a").as_deref(), Some("su_f"));
        let skipped = sim.journal.iter().filter(|e| e.tick == 1 && e.text.starts_with("изменение пропущено: ")).count();
        assert_eq!(skipped, 4);
        sim.step(); // шаг 2 = 07:00 — допустимые переподчинения исполнены
        assert_eq!(hq_of(&sim, "su_1"), "su_b");
        assert_eq!(parent_of(&sim, "su_b").as_deref(), Some("su_a"));
        assert!(sim.journal.iter().any(|e| e.tick == 2 && e.text == "переподчинение → армия Б"));
        assert!(sim.journal.iter().any(|e| e.tick == 2 && e.agent == u32::MAX && e.text == "армия Б: переподчинение → армия А"));
    }
}
