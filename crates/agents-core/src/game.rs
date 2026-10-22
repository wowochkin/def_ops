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

/// Режим игры: «как сейчас» (приказы игрока размножаются по дивизиям штаба), «агенты» (игрок — верхняя инстанция,
/// ниже — штабы-агенты), «гибрид» (как «агенты», но исторические директивы, поданные без изменений, ведут приказы
/// сценария).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Legacy, Agents, Hybrid }

/// Директива игрока штабу или дивизии (режимы «агенты» и «гибрид»).
#[derive(Clone, Debug, serde::Deserialize)]
pub struct PlayerDirective {
    /// Штаб или дивизия.
    pub to: String,
    pub task: crate::command::directive::Task,
    pub form: crate::command::directive::Form,
    #[serde(default)]
    pub axis: Vec<LngLat>,
    #[serde(default)]
    pub immediate: Option<Vec<LngLat>>,
    #[serde(default)]
    pub subsequent: Option<Vec<LngLat>>,
    #[serde(default)]
    pub note: String,
}

/// Команда управления игрока на ход (до распоряжений и приказов): взять штаб, вернуть, ответ на запросы отхода,
/// подать историческую директиву.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum CommandOp {
    Take { hq: String },
    Release { id: String },
    Permit { hq: String, yes: bool },
    Historical { id: String },
}

pub struct Game {
    pub mode: Mode,
    /// Поданные исторические директивы (id).
    pub issued: std::collections::HashSet<String>,
    /// Исторические директивы игрока, поданные на будущий час: (час, директива).
    pub pending: Vec<(u32, crate::command::directive::Directive)>,
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
    /// Форма (режимы штабов-агентов): приказ — сутки на ступень, полная слаженность; нет — боевое распоряжение.
    #[serde(default)]
    pub form: Option<crate::command::directive::Form>,
}

impl Game {
    /// Прогон до часа `takeover` по сценарию, затем сторона `player` переходит к игроку.
    pub fn start(sim: Sim, meta: Meta, takeover: u32, player: Side) -> Game { Game::start_free(sim, meta, takeover, player, &[player], None) }

    /// То же, со сторонами под внешним управлением `free` (игрок и штаб противника на модели вне ядра) и состоянием
    /// дивизий на час передачи `takeover_state` (заменяет рассчитанное; в последнем кадре до передачи — уже оно).
    pub fn start_free(sim: Sim, meta: Meta, takeover: u32, player: Side, free: &[Side], takeover_state: Option<&TakeoverIn>) -> Game {
        Game::start_mode(sim, meta, takeover, player, free, takeover_state, Mode::Legacy)
    }

    /// То же, в режиме игры `mode`. В режимах «агенты» и «гибрид» приказы сценария и артподготовки стороны игрока
    /// остаются (приказы штабов-агентов и игрока при доставке пропускаются), резервы вводятся по сценарию.
    pub fn start_mode(mut sim: Sim, meta: Meta, takeover: u32, player: Side, free: &[Side], takeover_state: Option<&TakeoverIn>, mode: Mode) -> Game {
        let takeover = takeover.min(meta.hours);
        let mut frames = vec![trace::frame(&sim)];
        for _ in 0..takeover { sim.step(); frames.push(trace::frame(&sim)); }
        if let Some(st) = takeover_state {
            let w = &mut sim.world;
            let proj = &sim.theatre.proj;
            for d in w.divisions.iter_mut() {
                let Some(s) = st.divisions.get(&d.id) else { continue };
                // выбывшая (рассеяна, сведена) — факт о численности её не возвращает
                if matches!(d.state, crate::model::State::Destroyed | crate::model::State::Merged) { continue; }
                if let Some(p) = s.personnel { d.vars.personnel = p.max(0.0); }
                if let Some(t) = s.tanks { d.vars.tanks = t.max(0.0); }
                if let Some(g) = s.guns { d.vars.guns = g.max(0.0); }
                if let Some(p) = s.pos { d.vars.pos = proj.to_xy(p); d.route = None; }
                if let Some(h) = s.hq.as_deref().and_then(|h| w.hqs.iter().position(|x| x.id == h && x.side == d.side)) { d.hq = h as u32; }
            }
            if let Some(f) = frames.last_mut() { *f = trace::frame(&sim); }
        }
        // штабы-агенты: игрок — верхняя инстанция своей стороны, ниже — агенты; приказы сценария стороны остаются
        if mode != Mode::Legacy {
            crate::command::control::agents_side(&mut sim, player);
            for &sd in free { sim.sources[crate::staff::side_idx(sd)] = crate::staff::Source::Script; }
            let limit = meta.hours;
            return Game { mode, issued: Default::default(), pending: Vec::new(), sim, meta, frames, player, free: free.to_vec(), takeover, limit, reserves: BTreeMap::new() };
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
        Game { mode: Mode::Legacy, issued: Default::default(), pending: Vec::new(), sim, meta, frames, player, free: free.to_vec(), takeover, limit, reserves }
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
        if w.hqs.iter().any(|h| h.id == o.hq && h.echelon == crate::model::Echelon::HighCommand) { return Err("верхней инстанции приказов не отдают".into()); }
        // в режимах штабов-агентов приказ — директива игрока
        if self.mode != Mode::Legacy {
            use crate::command::directive::{Form, Task};
            let task = match o.kind { OrderKind::Attack => Task::Attack, OrderKind::Defend | OrderKind::Hold => Task::Defend, OrderKind::Withdraw => Task::Withdraw, OrderKind::Move => Task::Move };
            let n = to.len();
            let (axis, immediate) = match o.target {
                None if matches!(task, Task::Attack | Task::Move | Task::Withdraw) => return Err("наступать, выдвигаться и отходить — с целью".into()),
                None => (vec![], None),
                Some(t) => {
                    // рубеж через цель поперёк направления от центра войск — шириной их фронта, не меньше 6 км
                    let pr = &self.sim.theatre.proj;
                    let ps: Vec<crate::geo::XY> = to.iter().map(|&i| self.sim.world.divisions[i as usize].vars.pos).collect();
                    let c = crate::geo::XY::new(ps.iter().map(|p| p.x).sum::<f64>() / ps.len() as f64, ps.iter().map(|p| p.y).sum::<f64>() / ps.len() as f64);
                    let tx = pr.to_xy(t);
                    let l = c.dist(tx).max(1e-6);
                    let (ux, uy) = ((tx.x - c.x) / l, (tx.y - c.y) / l);
                    let hw = ps.iter().map(|p| ((p.x - c.x) * -uy + (p.y - c.y) * ux).abs()).fold(3.0, f64::max);
                    let a = pr.to_lnglat(crate::geo::XY::new(tx.x - uy * hw, tx.y + ux * hw));
                    let b = pr.to_lnglat(crate::geo::XY::new(tx.x + uy * hw, tx.y - ux * hw));
                    (vec![pr.to_lnglat(c), t], if to.len() > 1 { Some(vec![a, b]) } else { Some(vec![t]) })
                }
            };
            self.directive(&PlayerDirective { to: o.hq.clone(), task, form: o.form.unwrap_or(Form::Instruction), axis, immediate, subsequent: None, note: o.note.clone() })?;
            return Ok(n);
        }
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
        for _ in 0..hours.min(left) {
            let now = self.hour();
            let due: Vec<_> = { let (d, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut self.pending).into_iter().partition(|(at, _)| *at <= now); self.pending = rest; d };
            for (_, d) in due { crate::command::passing::issue(&mut self.sim, d, now); }
            self.sim.step();
            self.frames.push(trace::frame(&self.sim));
        }
    }

    pub fn over(&self) -> bool { self.hour() >= self.limit }

    /// Верхняя инстанция стороны игрока.
    fn top(&self) -> Result<u32, String> {
        self.sim.world.hqs.iter().position(|h| h.side == self.player && h.echelon == crate::model::Echelon::HighCommand).map(|k| k as u32).ok_or_else(|| "у стороны нет верхней инстанции".into())
    }

    /// Директива игрока штабу или дивизии. Получатель ниже прямых подчинённых верхней инстанции — приказ через голову
    /// (ПУ-39 ст. 93): он изъят из замысла старшего, каждый пропущенный штаб получает извещение.
    pub fn directive(&mut self, p: &PlayerDirective) -> Result<(), String> {
        use crate::command::control::{DocKind, Document};
        use crate::command::directive::{Directive, Line, Target};
        if self.mode == Mode::Legacy { return Err("директивы — в режимах «агенты» и «гибрид»".into()); }
        let top = self.top()?;
        let w = &self.sim.world;
        let (to, parent) = if let Some(h) = w.hqs.iter().position(|h| h.id == p.to) {
            if w.hqs[h].side != self.player { return Err(format!("{} — не под нашим управлением", p.to)); }
            if h as u32 == top { return Err("верхней инстанции приказов не отдают".into()); }
            (Target::Hq(h as u32), w.hqs[h].parent)
        } else if let Some(i) = w.divisions.iter().position(|d| d.id == p.to) {
            if w.divisions[i].side != self.player { return Err(format!("{} — не под нашим управлением", p.to)); }
            if w.divisions[i].state.out() && w.divisions[i].state != crate::model::State::Pending { return Err(format!("{} выбыла", w.divisions[i].name)); }
            (Target::Division(i as u32), Some(w.divisions[i].hq))
        } else { return Err(format!("нет штаба или дивизии {}", p.to)); };
        let tick = self.hour();
        // «гибрид»: своя директива штабу, которого ведёт сценарий, — история кончилась: его поддерево решают агенты
        if let Target::Hq(h) = to {
            use crate::command::control::Control;
            if self.sim.command.control[h as usize] == Control::Script {
                let w = &self.sim.world;
                let under = |mut k: usize| { for _ in 0..8 { if k == h as usize { return true; } match w.hqs[k].parent { Some(q) => k = q as usize, None => return false } } false };
                let sub: Vec<usize> = (0..w.hqs.len()).filter(|&k| under(k)).collect();
                for k in sub { if self.sim.command.control[k] == Control::Script { self.sim.command.control[k] = Control::Agent; self.sim.command.last_cycle[k] = tick; } }
                self.sim.documents.push(Document { tick, hq: h, kind: DocKind::Notice, to: Vec::new(), text: "директива игрока вместо исторической: штаб и его подчинённые сходят со сценария, решают агенты".into(), rule: None });
            }
        }
        // через голову: пропущенные штабы — от непосредственного начальника до штаба под верхней инстанцией
        if parent != Some(top) {
            match to { Target::Hq(h) => self.sim.command.led_hq[h as usize] = true, Target::Division(i) => self.sim.command.led_div[i as usize] = true }
            let mut k = parent;
            let name = |sim: &Sim| match to { Target::Hq(h) => sim.world.hqs[h as usize].name.clone(), Target::Division(i) => sim.world.divisions[i as usize].name.clone() };
            let who = name(&self.sim);
            while let Some(h) = k {
                if h == top { break; }
                self.sim.documents.push(Document { tick, hq: h, kind: DocKind::Notice, to: vec![p.to.clone()], text: format!("приказ через голову: {who} — ведёт Ставка (ПУ-39 ст. 93)"), rule: Some("ПУ-39 ст. 93".into()) });
                k = self.sim.world.hqs[h as usize].parent;
            }
            if let Some(b) = parent { self.sim.journal.push(crate::world::Event { tick, agent: u32::MAX, text: format!("{who} получил приказ через голову, доносит «{}»", self.sim.world.hqs[b as usize].name) }); }
        }
        let xy = |q: &LngLat| self.sim.theatre.proj.to_xy(*q);
        let d = Directive {
            id: format!("игрок:{}:{}", p.to, tick), from: top, to, form: p.form, task: p.task,
            axis: p.axis.iter().map(xy).collect(),
            immediate: p.immediate.as_ref().map(|l| Line { pts: l.iter().map(xy).collect(), by: None }),
            subsequent: p.subsequent.as_ref().map(|l| Line { pts: l.iter().map(xy).collect(), by: None }),
            boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(), junction: None, hasty: false, ready: false, rule: None, issued: 0,
            note: if p.note.is_empty() { "директива игрока".into() } else { p.note.clone() },
        };
        crate::command::passing::issue(&mut self.sim, d, tick);
        Ok(())
    }

    /// Историческая директива сценария от имени игрока: в свой час (не раньше текущего). До начала операции — уже
    /// доведена до дивизий. В «гибриде» поддерево получателя ведут приказы сценария.
    pub fn issue_historical(&mut self, id: &str) -> Result<(), String> {
        self.top()?;
        if !self.sim.historical.iter().any(|(_, d)| d.id == id) { return Err(format!("нет исторической директивы {id} стороны игрока")); }
        // приказы сценария, прошедшие до перевода поддерева на сценарий, не вернуть — в «гибриде» только до первого хода
        if self.mode == Mode::Hybrid && self.hour() > self.takeover { return Err("в «гибриде» исторические директивы подаются до первого хода".into()); }
        if !self.issued.insert(id.to_string()) { return Err(format!("директива {id} уже подана")); }
        let now = self.hour();
        let at_takeover = now == self.takeover;
        for (at, mut d) in crate::command::control::historical_for(&mut self.sim, self.player, Some(id), self.mode == Mode::Hybrid) {
            // поданная при передаче командования, уже действовавшая к этому часу — доведена (как приказы на начало сценария)
            if at_takeover && at <= now { d.ready = true; }
            if at <= now { crate::command::passing::issue(&mut self.sim, d, now); } else { self.pending.push((at, d)); }
        }
        Ok(())
    }

    /// Ответ игрока (верхней инстанции) на запросы отхода корпуса `hq`: да — дивизии отходят на следующий рубеж.
    pub fn permit(&mut self, hq: &str, yes: bool) -> Result<(), String> {
        use crate::command::directive::{Directive, Form, Line, Target, Task};
        let h = self.sim.world.hqs.iter().position(|x| x.id == hq && x.side == self.player).ok_or_else(|| format!("нет штаба {hq} стороны игрока"))? as u32;
        let tick = self.hour();
        let open: Vec<usize> = (0..self.sim.command.requests.len()).filter(|&k| self.sim.command.requests[k].hq == h && self.sim.command.requests[k].answer.is_none()).collect();
        if open.is_empty() { return Err(format!("у {hq} нет запросов на отход")); }
        for k in open {
            self.sim.command.requests[k].answer = Some(yes);
            self.sim.command.requests[k].answered_at = tick;
            if !yes { continue; }
            let i = self.sim.command.requests[k].division;
            // рубеж, названный при запросе (доктрина), а не от нынешнего места
            let at = self.sim.command.requests[k].at;
            let d = Directive { id: format!("отход:{i}"), from: h, to: Target::Division(i), form: Form::Instruction, task: Task::Withdraw, axis: Vec::new(),
                immediate: Some(Line { pts: vec![at], by: None }), subsequent: None, boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(), junction: None,
                hasty: true, ready: false, rule: Some("разрешение верхней инстанции на отход".into()), issued: 0, note: "отход разрешён".into() };
            crate::command::passing::issue(&mut self.sim, d, tick);
        }
        Ok(())
    }

    /// Команда управления на ход.
    pub fn command(&mut self, c: &CommandOp) -> Result<(), String> {
        if self.mode == Mode::Legacy { return Err("команды управления — в режимах «агенты» и «гибрид»".into()); }
        match c {
            CommandOp::Take { hq } => self.take(hq),
            CommandOp::Release { id } => self.release(id),
            CommandOp::Permit { hq, yes } => self.permit(hq, *yes),
            CommandOp::Historical { id } => self.issue_historical(id),
        }
    }

    /// Взять штаб под своё управление: его замысел старшего остаётся, сам он больше не решает.
    pub fn take(&mut self, hq: &str) -> Result<(), String> {
        use crate::command::control::{Control, DocKind, Document};
        let h = self.sim.world.hqs.iter().position(|x| x.id == hq && x.side == self.player).ok_or_else(|| format!("нет штаба {hq} стороны игрока"))?;
        if self.sim.world.hqs[h].echelon == crate::model::Echelon::HighCommand { return Err("верхняя инстанция и так у игрока".into()); }
        self.sim.command.control[h] = Control::Player;
        let tick = self.hour();
        self.sim.documents.push(Document { tick, hq: h as u32, kind: DocKind::Notice, to: Vec::new(), text: "штаб взят под управление игрока".into(), rule: None });
        Ok(())
    }

    /// Вернуть: изъятого через голову — в замысел старшего, взятый штаб — агенту (решает в свой следующий цикл).
    pub fn release(&mut self, id: &str) -> Result<(), String> {
        use crate::command::control::{Control, DocKind, Document};
        let tick = self.hour();
        if let Some(h) = self.sim.world.hqs.iter().position(|x| x.id == id && x.side == self.player) {
            self.sim.command.led_hq[h] = false;
            // старший снова отдаст ему задачу в свой следующий цикл
            self.sim.command.sent.retain(|k, _| k.1 != crate::command::directive::Target::Hq(h as u32));
            if self.sim.command.control[h] == Control::Player && self.sim.world.hqs[h].echelon != crate::model::Echelon::HighCommand {
                self.sim.command.control[h] = Control::Agent;
                // замысел, пришедший, пока штаб был у игрока, остаётся новым (fresh)
                self.sim.command.last_cycle[h] = tick;
            }
            self.sim.documents.push(Document { tick, hq: h as u32, kind: DocKind::Notice, to: Vec::new(), text: "штаб возвращён: решает агент по замыслу старшего".into(), rule: None });
            return Ok(());
        }
        if let Some(i) = self.sim.world.divisions.iter().position(|d| d.id == id && d.side == self.player) {
            self.sim.command.led_div[i] = false;
            self.sim.command.sent.retain(|k, _| k.1 != crate::command::directive::Target::Division(i as u32));
            return Ok(());
        }
        Err(format!("нет штаба или дивизии {id} стороны игрока"))
    }

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
        v["command"] = self.command_state();
        v
    }

    /// Состояние управления стороны игрока: режим, кто решает за штабы, изъятые через голову дивизии, запросы на
    /// отход, исторические директивы верхней инстанции (поданные — `issued`).
    fn command_state(&self) -> Value {
        use crate::command::directive::Target;
        let w = &self.sim.world;
        let c = &self.sim.command;
        let mode = match self.mode { Mode::Legacy => "legacy", Mode::Agents => "agents", Mode::Hybrid => "hybrid" };
        let mine = |h: usize| w.hqs[h].side == self.player;
        let hqs: Vec<Value> = (0..w.hqs.len()).filter(|&h| mine(h) && c.control.len() > h)
            .map(|h| serde_json::json!({ "id": w.hqs[h].id, "control": c.control[h], "led": c.led_hq[h] })).collect();
        let led: Vec<&str> = (0..w.divisions.len()).filter(|&i| c.led_div.get(i).copied().unwrap_or(false) && w.divisions[i].side == self.player).map(|i| w.divisions[i].id.as_str()).collect();
        let requests: Vec<Value> = c.requests.iter().filter(|r| mine(r.hq as usize))
            .map(|r| serde_json::json!({ "hq": w.hqs[r.hq as usize].id, "division": w.divisions[r.division as usize].id, "tick": r.tick, "answer": r.answer })).collect();
        let top = w.hqs.iter().position(|h| h.side == self.player && h.echelon == crate::model::Echelon::HighCommand);
        let target = |t: Target| match t { Target::Hq(h) => w.hqs[h as usize].id.clone(), Target::Division(i) => w.divisions[i as usize].id.clone() };
        let historical: Vec<Value> = self.sim.historical.iter().filter(|(_, d)| Some(d.from as usize) == top)
            .map(|(at, d)| serde_json::json!({ "id": d.id, "at": at, "to": target(d.to), "task": d.task, "form": d.form, "note": d.note, "issued": self.issued.contains(&d.id) })).collect();
        serde_json::json!({ "mode": mode, "hqs": hqs, "led": led, "requests": requests, "historical": historical })
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

    #[test]
    fn takeover_state_skips_out() {
        // выбывшей дивизии (рассеяна, сведена) факт о численности не возвращает её в строй
        let (mut sim, meta) = crate::scenario::tests::tiny("takeover-out", None);
        let i = sim.world.divisions.iter().position(|d| d.id == "su_1").unwrap();
        sim.world.divisions[i].state = crate::model::State::Destroyed;
        sim.world.divisions[i].vars.personnel = 0.0;
        let pos = sim.world.divisions[i].vars.pos;
        let st: TakeoverIn = serde_json::from_value(serde_json::json!({ "divisions": {
            "su_1": { "personnel": 4321, "tanks": 3, "pos": [15.0, 52.45], "hq": "su_b" }
        } })).unwrap();
        let g = Game::start_free(sim, meta, 2, Side::Su, &[Side::Su], Some(&st));
        let d = g.sim.world.divisions.iter().find(|d| d.id == "su_1").unwrap();
        assert_eq!(d.state, crate::model::State::Destroyed);
        assert_eq!(d.vars.personnel, 0.0);
        assert!(d.vars.pos.dist(pos) < 1e-9);
        assert_eq!(g.sim.world.hqs[d.hq as usize].id, "su_a");
    }
}
