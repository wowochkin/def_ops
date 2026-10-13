//! Игра на агентной модели: с выбранного часа одной стороной командует игрок. Прогон идёт по сценарию до часа
//! передачи командования; дальше исторические приказы и артподготовки стороны игрока снимаются, игрок отдаёт приказы
//! штабам (армиям) — они доходят до всех дивизий штаба с задержкой его уровня, как приказы сценария, — и двигает
//! время ходом на N часов. Противник — по сценарию или по доктрине (Sim::sources).

use crate::geo::LngLat;
use crate::model::{OrderKind, Side};
use crate::scenario::Meta;
use crate::trace;
use crate::world::{ScriptOrder, Sim};
use serde_json::Value;

pub struct Game {
    pub sim: Sim,
    pub meta: Meta,
    pub frames: Vec<Vec<Value>>,
    pub player: Side,
    /// Час, с которого командует игрок.
    pub takeover: u32,
}

/// Приказ игрока штабу.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct PlayerOrder {
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
    pub fn start(mut sim: Sim, meta: Meta, takeover: u32, player: Side) -> Game {
        let takeover = takeover.min(meta.hours);
        let mut frames = vec![trace::frame(&sim)];
        for _ in 0..takeover { sim.step(); frames.push(trace::frame(&sim)); }
        let mine = |hq: u32, sim: &Sim| sim.world.hqs[hq as usize].side == player;
        let keep: Vec<bool> = sim.script.iter().map(|o| !mine(o.hq, &sim)).collect();
        let mut k = keep.iter();
        sim.script.retain(|_| *k.next().unwrap());
        let keep: Vec<bool> = sim.fires.iter().map(|f| !mine(f.hq, &sim)).collect();
        let mut k = keep.iter();
        sim.fires.retain(|_| *k.next().unwrap());
        // штабы стороны игрока сами больше не решают
        sim.sources[crate::staff::side_idx(player)] = crate::staff::Source::Script;
        Game { sim, meta, frames, player, takeover }
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
        let hq = self.sim.world.hqs.iter().position(|h| h.id == o.hq).ok_or_else(|| format!("нет штаба {}", o.hq))? as u32;
        if self.sim.world.hqs[hq as usize].side != self.player { return Err(format!("{} — штаб противника", o.hq)); }
        let to = self.divisions_of(hq);
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

    /// Ход: `hours` шагов (не дальше конца сценария).
    pub fn advance(&mut self, hours: u32) {
        let left = self.meta.hours.saturating_sub(self.hour());
        for _ in 0..hours.min(left) { self.sim.step(); self.frames.push(trace::frame(&self.sim)); }
    }

    pub fn over(&self) -> bool { self.hour() >= self.meta.hours }

    /// Ход игры в формате trace.json (кадры с начала сценария) и сведения об игре.
    pub fn trace(&self) -> Value {
        let mut v = trace::describe(&self.sim, &self.meta, self.frames.clone());
        v["game"] = serde_json::json!({
            "player": self.player, "takeover": self.takeover, "hour": self.hour(), "over": self.over(),
        });
        v
    }
}
