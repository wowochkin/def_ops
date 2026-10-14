//! Игра на агентной модели: с выбранного часа одной стороной командует игрок. Прогон идёт по сценарию до часа
//! передачи командования; дальше исторические приказы и артподготовки стороны игрока снимаются, игрок отдаёт приказы
//! штабам (армиям) — они доходят до всех дивизий штаба с задержкой его уровня, как приказы сценария, — и двигает
//! время ходом на N часов. Противник — по сценарию или по доктрине (Sim::sources).
//!
//! Распоряжения штаба игрока (`staff`) проверяет и ведёт штаб вне ядра; ядро их исполняет: подвоз по дивизиям,
//! наведённые переправы, подрыв мостов, ввод резервов (будущие вводы стороны игрока ждут его решения), полосы армий.

use crate::geo::LngLat;
use crate::model::{OrderKind, Side};
use crate::scenario::Meta;
use crate::trace;
use crate::world::{ScriptOrder, Sectors, Sim};
use std::collections::BTreeMap;
use serde_json::Value;

pub struct Game {
    pub sim: Sim,
    pub meta: Meta,
    pub frames: Vec<Vec<Value>>,
    pub player: Side,
    /// Стороны под внешним управлением (игрок и, если есть, штаб противника на языковой модели вне ядра): их
    /// исторические приказы сняты, приказы им отдаёт `order`.
    pub free: Vec<Side>,
    /// Час, с которого командует игрок.
    pub takeover: u32,
    /// До какого часа можно вести игру (по умолчанию — конец сценария; игра может идти и дольше, до своего срока).
    pub limit: u32,
    /// Резервы стороны игрока, ждущие ввода: индекс дивизии → с какого часа готов (ввод по сценарию).
    pub reserves: BTreeMap<u32, u32>,
}

/// Место и час (шаг) для распоряжения.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct AtHour { pub at: LngLat, pub from: u32 }

/// Подрыв моста театра: id моста и час.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Demolish { pub bridge: String, pub from: u32 }

/// Ввод резерва: дивизия, район сосредоточения, час.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct Commit { pub division: String, pub at: LngLat, pub from: u32 }

/// Полосы объединений (как sectorMap этой модели): сетка меток и объединение каждой дивизии.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct SectorsIn {
    pub step: usize,
    pub cols: usize,
    #[serde(default)]
    pub label: Vec<i16>,
    /// Метки строкой, по знаку на клетку ('0' + метка, '.' — вне полос) — компактнее label.
    #[serde(default)]
    pub codes: Option<String>,
    pub groups: Vec<(String, i16)>,
    pub foreign: f64,
}

/// Распоряжения штаба на ход.
#[derive(Clone, Debug, Default, serde::Deserialize)]
pub struct StaffIn {
    /// Множитель подвоза по дивизиям (на ход; весь набор заменяет прежний).
    #[serde(default)]
    pub supply: Vec<(String, f64)>,
    #[serde(default)]
    pub bridges: Vec<AtHour>,
    /// Подрыв мостов театра (по id моста) с часа; с часа 0 — мост снят (наводки стороны игрока после передачи командования).
    #[serde(default)]
    pub demolish: Vec<Demolish>,
    #[serde(default)]
    pub commit: Vec<Commit>,
    /// Полосы по уровням (фронты, армии); пусто — без полос.
    #[serde(default)]
    pub sectors: Vec<SectorsIn>,
}

/// Состояние дивизий на час передачи командования (из базы знаний): заменяет рассчитанное к этому часу.
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeoverIn {
    /// id дивизии → состояние; неизвестные id не учитываются.
    #[serde(default)]
    pub divisions: std::collections::HashMap<String, TakeoverDiv>,
}

/// Состояние дивизии при передаче: численность, танки, орудия (абсолютные), место, штаб (если такой есть).
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TakeoverDiv {
    #[serde(default)]
    pub personnel: Option<f64>,
    #[serde(default)]
    pub tanks: Option<f64>,
    #[serde(default)]
    pub guns: Option<f64>,
    #[serde(default)]
    pub pos: Option<LngLat>,
    #[serde(default)]
    pub hq: Option<String>,
}

/// Приказ штабу (всем его дивизиям) или одной дивизии.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct PlayerOrder {
    /// Штаб (фронт, армия, корпус) или дивизия.
    pub hq: String,
    pub kind: OrderKind,
    /// Цель; нет — на месте (у каждой дивизии своё).
    #[serde(default)]
    pub target: Option<LngLat>,
    #[serde(default)]
    pub note: String,
}

impl Game {
    /// Прогон до часа `takeover` по сценарию, затем сторона `player` переходит к игроку.
    pub fn start(sim: Sim, meta: Meta, takeover: u32, player: Side) -> Game { Game::start_free(sim, meta, takeover, player, &[player], None) }

    /// То же, со сторонами под внешним управлением `free` (игрок и штаб противника на модели вне ядра) и состоянием
    /// дивизий на час передачи `takeover_state` (заменяет рассчитанное; в последнем кадре до передачи — уже оно).
    pub fn start_free(mut sim: Sim, meta: Meta, takeover: u32, player: Side, free: &[Side], takeover_state: Option<&TakeoverIn>) -> Game {
        let takeover = takeover.min(meta.hours);
        let mut frames = vec![trace::frame(&sim)];
        for _ in 0..takeover { sim.step(); frames.push(trace::frame(&sim)); }
        if let Some(st) = takeover_state {
            let w = &mut sim.world;
            let proj = &sim.theatre.proj;
            for d in w.divisions.iter_mut() {
                let Some(s) = st.divisions.get(&d.id) else { continue };
                if let Some(p) = s.personnel { d.vars.personnel = p.max(0.0); }
                if let Some(t) = s.tanks { d.vars.tanks = t.max(0.0); }
                if let Some(g) = s.guns { d.vars.guns = g.max(0.0); }
                if let Some(p) = s.pos { d.vars.pos = proj.to_xy(p); d.route = None; }
                if let Some(h) = s.hq.as_deref().and_then(|h| w.hqs.iter().position(|x| x.id == h && x.side == d.side)) { d.hq = h as u32; }
            }
            if let Some(f) = frames.last_mut() { *f = trace::frame(&sim); }
        }
        let mine = |hq: u32, sim: &Sim| free.contains(&sim.world.hqs[hq as usize].side);
        let keep: Vec<bool> = sim.script.iter().map(|o| !mine(o.hq, &sim)).collect();
        let mut k = keep.iter();
        sim.script.retain(|_| *k.next().unwrap());
        let keep: Vec<bool> = sim.fires.iter().map(|f| !mine(f.hq, &sim)).collect();
        let mut k = keep.iter();
        sim.fires.retain(|_| *k.next().unwrap());
        // штабы сторон под внешним управлением сами больше не решают
        for &sd in free { sim.sources[crate::staff::side_idx(sd)] = crate::staff::Source::Script; }
        // резервы стороны игрока: ввод больше не по графику сценария — по его решению (commit)
        let mut reserves = BTreeMap::new();
        for (i, d) in sim.world.divisions.iter_mut().enumerate() {
            if d.side == player && d.state == crate::model::State::Pending && d.enter > takeover {
                reserves.insert(i as u32, d.enter);
                d.enter = u32::MAX;
            }
        }
        let limit = meta.hours;
        Game { sim, meta, frames, player, free: free.to_vec(), takeover, limit, reserves }
    }

    /// Час прогона (сколько шагов сделано).
    pub fn hour(&self) -> u32 { self.sim.world.tick }

    /// Дивизии штаба (и подчинённых ему штабов), ещё участвующие в операции.
    pub fn divisions_of(&self, hq: u32) -> Vec<u32> {
        let w = &self.sim.world;
        let under = |mut h: u32| -> bool {
            for _ in 0..8 {
                if h == hq { return true; }
                match w.hqs[h as usize].parent { Some(p) => h = p, None => return false }
            }
            false
        };
        w.divisions.iter().enumerate()
            .filter(|(_, d)| under(d.hq) && !matches!(d.state, crate::model::State::Destroyed | crate::model::State::Merged))
            .map(|(i, _)| i as u32).collect()
    }

    /// Приказ игрока: доходит до дивизий штаба на ближайшем шаге (с задержкой уровня штаба). Возвращает число дивизий.
    pub fn order(&mut self, o: &PlayerOrder) -> Result<usize, String> {
        let w = &self.sim.world;
        let (hq, to) = if let Some(h) = w.hqs.iter().position(|h| h.id == o.hq) {
            (h as u32, self.divisions_of(h as u32))
        } else if let Some(d) = w.divisions.iter().position(|d| d.id == o.hq) {
            if matches!(w.divisions[d].state, crate::model::State::Destroyed | crate::model::State::Merged) { return Err(format!("{} выбыла", w.divisions[d].name)); }
            (w.divisions[d].hq, vec![d as u32])
        } else {
            return Err(format!("нет штаба или дивизии {}", o.hq));
        };
        if !self.free.contains(&self.sim.world.hqs[hq as usize].side) { return Err(format!("{} — не под нашим управлением", o.hq)); }
        if to.is_empty() { return Err(format!("у штаба {} нет действующих дивизий", o.hq)); }
        let n = to.len();
        let target = o.target.map(|p| self.sim.theatre.proj.to_xy(p));
        let tick = self.hour();
        // в начало очереди: в очереди только приказы с часом не раньше текущего
        self.sim.script.insert(0, ScriptOrder {
            at: tick, hq, to, kind: o.kind, target, forced: false,
            note: if o.note.is_empty() { "приказ игрока".into() } else { o.note.clone() },
            follow: None, offset: Default::default(),
        });
        Ok(n)
    }

    /// Распоряжения штаба на ход; возвращает неисполненные с причиной.
    pub fn staff(&mut self, s: &StaffIn) -> Vec<String> {
        let mut bad = Vec::new();
        let ix: std::collections::HashMap<String, u32> = self.sim.world.divisions.iter().enumerate().map(|(i, d)| (d.id.clone(), i as u32)).collect();
        self.sim.staff.supply = s.supply.iter().filter_map(|(id, k)| ix.get(id).map(|&i| (i, k.max(0.0)))).collect();
        let theatre = self.sim.theatre.clone();
        let proj = &theatre.proj;
        for b in &s.bridges { self.sim.staff.pontoons.push((proj.to_xy(b.at), self.player, b.from)); }
        for b in &s.demolish {
            match theatre.bridges.iter().position(|x| x.id == b.bridge) {
                Some(k) => { self.sim.staff.demolished.insert(k as u16, b.from); }
                None => bad.push(format!("подрыв: моста {} в театре нет", b.bridge)),
            }
        }
        for c in &s.commit {
            let Some(&i) = ix.get(&c.division) else { bad.push(format!("резерв {}: нет такой дивизии", c.division)); continue };
            if self.reserves.remove(&i).is_none() { bad.push(format!("резерв {}: не ждёт ввода", c.division)); continue; }
            let d = &mut self.sim.world.divisions[i as usize];
            d.enter = c.from.max(self.sim.world.tick);
            d.vars.pos = proj.to_xy(c.at);
        }
        self.sim.staff.sectors = s.sectors.iter().map(|x| Sectors {
            step: x.step.max(1), cols: x.cols, foreign: x.foreign,
            label: match &x.codes { Some(c) => c.bytes().map(|b| if b == b'.' { -1 } else { b as i16 - b'0' as i16 }).collect(), None => x.label.clone() },
            group: x.groups.iter().filter_map(|(id, g)| ix.get(id).map(|&i| (i, *g))).collect(),
        }).collect();
        bad
    }

    /// Ход: `hours` шагов (не дальше `limit`).
    pub fn advance(&mut self, hours: u32) {
        let left = self.limit.saturating_sub(self.hour());
        for _ in 0..hours.min(left) { self.sim.step(); self.frames.push(trace::frame(&self.sim)); }
    }

    pub fn over(&self) -> bool { self.hour() >= self.limit }

    /// Ход игры в формате trace.json (кадры с начала сценария) и сведения об игре.
    pub fn trace(&self) -> Value {
        let mut v = trace::describe(&self.sim, &self.meta, self.frames.clone());
        // территория сторон по клеткам театра (0 — ничья, 1 — советская, 2 — немецкая): для путей подвоза от баз
        v["control"] = serde_json::json!(self.sim.world.control.iter().map(|&c| (b'0' + c.min(9)) as char).collect::<String>());
        v["game"] = serde_json::json!({
            "player": self.player, "free": self.free,
            "reserves": self.reserves.iter().map(|(&i, &h)| serde_json::json!({ "id": self.sim.world.divisions[i as usize].id, "from": h })).collect::<Vec<_>>(),
            "takeover": self.takeover, "hour": self.hour(), "over": self.over(),
        });
        v
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn takeover_state_sets() {
        let (sim, meta) = crate::scenario::tests::tiny("takeover-state", None);
        let st: TakeoverIn = serde_json::from_value(serde_json::json!({ "divisions": {
            "su_1": { "personnel": 4321, "tanks": 3, "guns": 77, "pos": [15.0, 52.45], "hq": "su_b" },
            "de_1": { "personnel": 1500, "hq": "нет_штаба" },
            "нет_дивизии": { "personnel": 1 }
        } })).unwrap();
        let g = Game::start_free(sim, meta, 2, Side::Su, &[Side::Su], Some(&st));
        assert_eq!(g.hour(), 2);
        let w = &g.sim.world;
        let d = w.divisions.iter().find(|d| d.id == "su_1").unwrap();
        assert_eq!((d.vars.personnel, d.vars.tanks, d.vars.guns), (4321.0, 3.0, 77.0));
        let p = g.sim.theatre.proj.to_xy([15.0, 52.45]);
        assert!(d.vars.pos.dist(p) < 1e-9);
        assert_eq!(w.hqs[d.hq as usize].id, "su_b");
        let e = w.divisions.iter().find(|d| d.id == "de_1").unwrap();
        assert_eq!(e.vars.personnel, 1500.0);
        assert_eq!(w.hqs[e.hq as usize].id, "de_a");
    }
}
