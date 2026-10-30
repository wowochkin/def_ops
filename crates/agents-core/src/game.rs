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

pub use crate::game_rewind::{TurnIn, TurnResult};

/// Режим игры: «как сейчас» (приказы игрока размножаются по дивизиям штаба), «агенты» (игрок — верхняя инстанция,
/// ниже — штабы-агенты), «гибрид» (как «агенты», но исторические директивы, поданные без изменений, ведут приказы
/// сценария), «командующие» (как «агенты», плюс командующие у штабов с профилем обеих сторон; место командующего
/// игрок занимает командой `take` — тогда его штаб молчит).
#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode { Legacy, Agents, Hybrid, Commanders, Intent }

/// Противник при режиме игры своей стороны: script — приказы сценария (без штаба), doctrine — по доктрине, llm — штаб на
/// модели вне ядра, agents — штабы-агенты, intent — история как замысел. В «истории как замысле» противник — тоже
/// история (или штаб на модели), у «командующих» — командующие и штабы-агенты (или штаб на модели); в «как сейчас»
/// истории у противника нет. Недопустимое сочетание — ошибка, а не подмена молча; без выбора — умолчание режима.
pub fn enemy_for(mode: Mode, enemy: Option<&str>) -> Result<&'static str, String> {
    let ok: &[&'static str] = match mode {
        Mode::Intent => &["intent", "llm"],
        Mode::Commanders => &["agents", "llm"],
        Mode::Legacy => &["script", "doctrine", "llm", "agents"],
        Mode::Agents | Mode::Hybrid => &["script", "doctrine", "llm", "agents", "intent"],
    };
    let Some(e) = enemy else { return Ok(ok[0]) };
    ok.iter().copied().find(|&x| x == e).ok_or_else(|| {
        let names: Vec<&str> = ok.iter().map(|&x| enemy_title(x)).collect();
        format!("противник «{}» в этом режиме игры недопустим; допустимы: {}", enemy_title(e), names.join(", "))
    })
}

/// Название противника — как в окне «Принять командование» (id ядра → русское имя; неизвестный остаётся как есть).
fn enemy_title(id: &str) -> &str {
    match id {
        "script" => "без штаба",
        "llm" => "штаб на модели",
        "agents" => "штабы-агенты",
        "intent" => "история как замысел",
        "doctrine" => "по доктрине",
        other => other,
    }
}

fn other_side(s: Side) -> Side { if s == Side::Su { Side::De } else { Side::Su } }

/// Разграничительная линия директивы игрока: сосед (штаб, если назван) и ломаная.
#[derive(Clone, Debug, serde::Deserialize)]
pub struct BoundaryIn {
    #[serde(default)]
    pub neighbour: Option<String>,
    pub line: Vec<LngLat>,
}

/// Директива игрока штабу или дивизии (режимы «агенты» и «гибрид»).
#[derive(Clone, Debug, Default, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlayerDirective {
    /// Отдающий штаб (пункт управления): верхняя инстанция (нет — она) или штаб под управлением игрока.
    #[serde(default)]
    pub from: Option<String>,
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
    /// Сроки ближайшей и последующей задач (час операции).
    #[serde(default)]
    pub immediate_by: Option<u32>,
    #[serde(default)]
    pub subsequent_by: Option<u32>,
    #[serde(default)]
    pub boundaries: Vec<BoundaryIn>,
    /// Подчинённые получателя на главном ударе, резервы в его состав, ответственный за стык (id штабов).
    #[serde(default)]
    pub main_blow: Vec<String>,
    #[serde(default)]
    pub reserve: Vec<String>,
    #[serde(default)]
    pub junction: Option<String>,
    /// Место получателя в построении отдающего: first / second (эшелон).
    #[serde(default)]
    pub echelon: Option<String>,
    /// Ввод подвижной группы (получатель — введён).
    #[serde(default)]
    pub commit: bool,
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
    /// Директива игрока с полной структурой (пункт управления).
    Directive { directive: PlayerDirective },
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
    /// Противник — штабы-агенты (верхняя инстанция — агент).
    pub enemy_agents: bool,
    /// Сыгранные ходы по порядку (`play_turn`): повтор с того же начала даёт тот же мир.
    pub log: Vec<TurnIn>,
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
        // история как замысел: та же переигровка, что прогон `--command intent`, с часа 0 — управление ровно как в
        // прогоне (фронты и Ставка по сценарию, армии — агенты, командующие и цепочки) у стороны игрока и у противника,
        // если он не на модели вне ядра; к часу передачи у армий действующие распоряжения, игрок берёт штаб на этом часе
        if mode == Mode::Intent {
            for sd in [Side::Su, Side::De] {
                if sd != player && free.contains(&sd) { continue; }
                let _ = crate::command::control::command_mode(&mut sim, "intent", sd);
                if sd != player { sim.sources[crate::staff::side_idx(sd)] = crate::staff::Source::Script; }
            }
        }
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
            if mode == Mode::Intent {
                // история как замысел включена до прокрутки (выше); взятый игроком штаб с поддеревом уходит с истории (take)
            } else {
                crate::command::control::agents_side(&mut sim, player);
                if mode == Mode::Commanders { crate::commander::enable(&mut sim, player); }
                // полосы армий следуют за войсками — в играх «агенты» и «командующие» (гибрид — нет)
                if matches!(mode, Mode::Agents | Mode::Commanders) { sim.command.follow_bands = true; }
            }
            // противник под внешним управлением (штаб на модели): его приказы сценария и артподготовки сняты, как раньше
            let other = |hq: u32, sim: &Sim| { let s = sim.world.hqs[hq as usize].side; s != player && free.contains(&s) };
            let keep: Vec<bool> = sim.script.iter().map(|o| !other(o.hq, &sim)).collect();
            let mut k = keep.iter();
            sim.script.retain(|_| *k.next().unwrap());
            let keep: Vec<bool> = sim.fires.iter().map(|f| !other(f.hq, &sim)).collect();
            let mut k = keep.iter();
            sim.fires.retain(|_| *k.next().unwrap());
            for &sd in free { sim.sources[crate::staff::side_idx(sd)] = crate::staff::Source::Script; }
            let limit = meta.hours;
            let enemy_intent = mode == Mode::Intent && !free.contains(&other_side(player));
            let mut g = Game { mode, issued: Default::default(), pending: Vec::new(), sim, meta, frames, player, free: free.to_vec(), takeover, limit, reserves: BTreeMap::new(), enemy_agents: enemy_intent, log: Vec::new() };
            // командующие и у противника, если он не на модели вне ядра: его штабы — агенты, верхняя инстанция — Гитлер/Ставка
            if mode == Mode::Commanders && !g.free.contains(&other_side(player)) { g.enemy_agents(); }
            return g;
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
        Game { mode: Mode::Legacy, issued: Default::default(), pending: Vec::new(), sim, meta, frames, player, free: free.to_vec(), takeover, limit, reserves, enemy_agents: false, log: Vec::new() }
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
        // в режимах штабов-агентов приказ игрока — директива; штаб противника на модели (вне ядра) — как раньше
        if self.mode != Mode::Legacy && self.sim.world.hqs[hq as usize].side == self.player {
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
            self.directive(&PlayerDirective { to: o.hq.clone(), task, form: o.form.unwrap_or(Form::Instruction), axis, immediate, subsequent: None, note: o.note.clone(), ..Default::default() })?;
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
        // отдающий (пункт управления): верхняя инстанция или штаб, взятый игроком; получатель — в его подчинении
        let issuer = match p.from.as_deref() {
            None => top,
            Some(f) => {
                let k = w.hqs.iter().position(|h| h.id == f && h.side == self.player).ok_or_else(|| format!("нет штаба {f} стороны игрока"))? as u32;
                if k != top && self.sim.command.control[k as usize] != crate::command::control::Control::Player { return Err(format!("{} не под управлением игрока — сначала взять", w.hqs[k as usize].name)); }
                let mut x = match to { Target::Hq(h) => w.hqs[h as usize].parent, Target::Division(i) => Some(w.divisions[i as usize].hq) };
                let mut ok = false;
                for _ in 0..8 { match x { Some(q) if q == k => { ok = true; break; } Some(q) => x = w.hqs[q as usize].parent, None => break } }
                if !ok { return Err(format!("{} не в подчинении {}", p.to, w.hqs[k as usize].name)); }
                k
            }
        };
        let tick = self.hour();
        // история как замысел: директива штабу не под командованием игрока — он и его подчинённые с истории («под
        // командованием игрока»), решают его командующий и штаб по директиве игрока; диспетчер им больше не подаёт
        if let Target::Hq(h) = to {
            if self.mode == Mode::Intent && !crate::intent::player_over(&self.sim, h) {
                let n = self.sim.world.hqs.len();
                self.sim.intent.led.resize(n, false);
                self.sim.intent.led[h as usize] = true;
                crate::intent::take(&mut self.sim, h);
                let name = self.sim.world.hqs[h as usize].name.clone();
                self.sim.journal.push(crate::world::Event { tick, agent: u32::MAX, text: format!("{name} взят под управление игрока: директива вместо истории, решают его командующий и штаб") });
            }
        }
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
        // через голову: пропущенные штабы — от непосредственного начальника до штаба под отдающим
        let top = issuer;
        if parent != Some(top) {
            match to { Target::Hq(h) => self.sim.command.led_hq[h as usize] = true, Target::Division(i) => self.sim.command.led_div[i as usize] = true }
            let mut k = parent;
            let name = |sim: &Sim| match to { Target::Hq(h) => sim.world.hqs[h as usize].name.clone(), Target::Division(i) => sim.world.divisions[i as usize].name.clone() };
            let who = name(&self.sim);
            while let Some(h) = k {
                if h == top { break; }
                let boss = self.sim.world.hqs[top as usize].name.clone();
                self.sim.documents.push(Document { tick, hq: h, kind: DocKind::Notice, to: vec![p.to.clone()], text: format!("приказ через голову: {who} — ведёт {boss} (ПУ-39 ст. 93)"), rule: Some("ПУ-39 ст. 93".into()) });
                k = self.sim.world.hqs[h as usize].parent;
            }
            if let Some(b) = parent { self.sim.journal.push(crate::world::Event { tick, agent: u32::MAX, text: format!("{who} получил приказ через голову, доносит «{}»", self.sim.world.hqs[b as usize].name) }); }
        }
        let xy = |q: &LngLat| self.sim.theatre.proj.to_xy(*q);
        let hq_ix = |id: &str| self.sim.world.hqs.iter().position(|h| h.id == id && h.side == self.player).map(|k| k as u32).ok_or_else(|| format!("нет штаба {id} стороны игрока"));
        let main_blow = p.main_blow.iter().map(|x| hq_ix(x)).collect::<Result<Vec<_>, _>>()?;
        let reserve = p.reserve.iter().map(|x| hq_ix(x)).collect::<Result<Vec<_>, _>>()?;
        let junction = p.junction.as_deref().map(hq_ix).transpose()?;
        let boundaries = p.boundaries.iter().filter(|b| b.line.len() >= 2).map(|b| Ok((b.neighbour.as_deref().map(hq_ix).transpose()?, b.line.iter().map(xy).collect()))).collect::<Result<Vec<_>, String>>()?;
        let d = Directive {
            id: format!("игрок:{}:{}", p.to, tick), from: top, to, form: p.form, task: p.task,
            axis: p.axis.iter().map(xy).collect(),
            immediate: p.immediate.as_ref().map(|l| Line { pts: l.iter().map(xy).collect(), by: p.immediate_by }),
            subsequent: p.subsequent.as_ref().map(|l| Line { pts: l.iter().map(xy).collect(), by: p.subsequent_by }),
            boundaries, main_blow, reserve, junction, hasty: false, ready: false, rule: None, issued: 0,
            note: if p.note.is_empty() { "директива игрока".into() } else { p.note.clone() },
        };
        // место получателя в построении отдающего: эшелон (с исходным положением) или ввод подвижной группы
        use crate::command::control::Role;
        let role = if p.commit { Some(Role::Committed) } else { match p.echelon.as_deref() { Some("first") => Some(Role::First), Some("second") => Some(Role::Second), _ => None } };
        // та же роль повторно — без нового отсчёта (ввод второго эшелона по сроку не откладывается)
        if let Some(r) = role.filter(|&r| self.sim.command.role(to) != r) {
            self.sim.command.set_role(to, r);
            let at = crate::command::agent::place(&self.sim, to);
            match to { Target::Hq(h) => { self.sim.command.start_hq[h as usize] = Some(at); self.sim.command.since_hq[h as usize] = tick; } Target::Division(i) => { self.sim.command.start_div[i as usize] = Some(at); self.sim.command.since_div[i as usize] = tick; } }
        }
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

    /// Противник — штабы-агенты: его штабы решают по своей логике ступеней, верхняя инстанция — агент: подаёт
    /// исторические решения в их часы (уже наступившие — доведены, как приказы на начало) и отвечает на запросы отхода
    /// по правилу; его приказы сценария при доставке пропускаются (штабы не на сценарии).
    pub fn enemy_agents(&mut self) {
        use crate::command::control::Control;
        if self.enemy_agents { return; }
        let enemy = other_side(self.player);
        crate::command::control::agents_side(&mut self.sim, enemy);
        for (k, h) in self.sim.world.hqs.iter().enumerate() { if h.side == enemy && h.echelon == crate::model::Echelon::HighCommand { self.sim.command.control[k] = Control::Agent; } }
        self.sim.sources[crate::staff::side_idx(enemy)] = crate::staff::Source::Script;
        let now = self.hour();
        if self.mode == Mode::Commanders { crate::commander::enable(&mut self.sim, enemy); }
        for (at, mut d) in crate::command::control::historical_for(&mut self.sim, enemy, None, false) {
            // немецкие командующие: директивы Гитлера после начала не подаются (он — агент, решает сам)
            if self.mode == Mode::Commanders && enemy == Side::De && at > now { continue; }
            if at <= now { d.ready = true; crate::command::passing::issue(&mut self.sim, d, now); } else { self.pending.push((at, d)); }
        }
        self.enemy_agents = true;
    }

    /// Противник — на истории как замысле: штабы — агенты, верхняя инстанция — агент, командующие и цепочки его армий
    /// (исторические директивы подаёт `intent::step`, не игра); его приказы сценария при доставке пропускаются.
    pub fn enemy_intent(&mut self) {
        if self.enemy_agents { return; }
        if self.mode == Mode::Legacy {
            let tick = self.hour();
            self.sim.journal.push(crate::world::Event { tick, agent: u32::MAX, text: "история как замысел у противника — не в режиме «как сейчас»: пропущено".into() });
            return;
        }
        let enemy = other_side(self.player);
        // управление ровно как в прогоне: command_mode("intent") — командующие, цепочки, штабы по сценарию и армии-агенты
        let _ = crate::command::control::command_mode(&mut self.sim, "intent", enemy);
        self.sim.sources[crate::staff::side_idx(enemy)] = crate::staff::Source::Script;
        self.enemy_agents = true;
    }

    /// Команда управления на ход.
    pub fn command(&mut self, c: &CommandOp) -> Result<(), String> {
        if self.mode == Mode::Legacy { return Err("команды управления — в режимах «агенты» и «гибрид»".into()); }
        match c {
            CommandOp::Take { hq } => self.take(hq),
            CommandOp::Release { id } => self.release(id),
            CommandOp::Permit { hq, yes } => self.permit(hq, *yes),
            CommandOp::Historical { id } => self.issue_historical(id),
            CommandOp::Directive { directive } => self.directive(directive),
        }
    }

    /// Команда управления из JSON: неразборчивая — ошибка этой команды, а не всего хода.
    pub fn command_json(&mut self, v: &Value) -> Result<(), String> {
        let c: CommandOp = serde_json::from_value(v.clone()).map_err(|e| format!("команда {v}: {e}"))?;
        self.command(&c)
    }

    /// Взять штаб под своё управление: его замысел старшего остаётся, сам он больше не решает.
    pub fn take(&mut self, hq: &str) -> Result<(), String> {
        use crate::command::control::{Control, DocKind, Document};
        let h = self.sim.world.hqs.iter().position(|x| x.id == hq && x.side == self.player).ok_or_else(|| format!("нет штаба {hq} стороны игрока"))?;
        // в истории как замысле верхняя инстанция — по истории, её можно взять; в прочих режимах она и так у игрока
        if self.mode != Mode::Intent && self.sim.world.hqs[h].echelon == crate::model::Echelon::HighCommand { return Err("верхняя инстанция и так у игрока".into()); }
        self.sim.command.control[h] = Control::Player;
        // история как замысел: поддерево взятого штаба — «под командованием игрока»
        if self.sim.intent.enabled[crate::staff::side_idx(self.player)] { crate::intent::take(&mut self.sim, h as u32); }
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
            if let Some(x) = self.sim.intent.led.get_mut(h) { *x = false; }
            // старший снова отдаст ему задачу в свой следующий цикл
            self.sim.command.sent.retain(|k, _| k.1 != crate::command::directive::Target::Hq(h as u32));
            // в истории как замысле взятую верхнюю инстанцию можно и вернуть (в прочих режимах она всегда у игрока)
            if self.sim.command.control[h] == Control::Player && (self.mode == Mode::Intent || self.sim.world.hqs[h].echelon != crate::model::Echelon::HighCommand) {
                self.sim.command.control[h] = Control::Agent;
                // замысел, пришедший, пока штаб был у игрока, остаётся новым (fresh)
                self.sim.command.last_cycle[h] = tick;
            }
            // история как замысел: поддерево снова «по истории», управление — как в режиме (фронты — по сценарию)
            if self.sim.intent.enabled[crate::staff::side_idx(self.player)] { crate::intent::release(&mut self.sim, h as u32); }
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
            "takeover": self.takeover, "hour": self.hour(), "over": self.over(), "enemyAgents": self.enemy_agents,
            // сыгранных ходов и отпечаток игры (строкой: u64 не помещается в число JS)
            "turn": self.log.len(), "digest": format!("{:016x}", self.state_digest()),
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
        let mode = match self.mode { Mode::Legacy => "legacy", Mode::Agents => "agents", Mode::Hybrid => "hybrid", Mode::Commanders => "commanders", Mode::Intent => "intent" };
        let mine = |h: usize| w.hqs[h].side == self.player;
        let hqs: Vec<Value> = (0..w.hqs.len()).filter(|&h| mine(h) && c.control.len() > h)
            // ведомый: изъятый через голову или (история как замысел) взятый директивой игрока — у него есть «вернуть»
            .map(|h| serde_json::json!({ "id": w.hqs[h].id, "control": c.control[h], "led": c.led_hq[h] || self.sim.intent.led.get(h) == Some(&true) })).collect();
        let led: Vec<&str> = (0..w.divisions.len()).filter(|&i| c.led_div.get(i).copied().unwrap_or(false) && w.divisions[i].side == self.player).map(|i| w.divisions[i].id.as_str()).collect();
        let req = |r: &crate::command::control::Request| serde_json::json!({ "hq": w.hqs[r.hq as usize].id, "division": w.divisions[r.division as usize].id, "tick": r.tick, "answer": r.answer });
        let requests: Vec<Value> = c.requests.iter().filter(|r| mine(r.hq as usize)).map(req).collect();
        // запросы противника (журнал посредника): с часом ответа
        let enemy_requests: Vec<Value> = c.requests.iter().filter(|r| !mine(r.hq as usize))
            .map(|r| { let mut v = req(r); if r.answer.is_some() { v["answeredAt"] = serde_json::json!(r.answered_at); } v }).collect();
        let top = w.hqs.iter().position(|h| h.side == self.player && h.echelon == crate::model::Echelon::HighCommand);
        let target = |t: Target| match t { Target::Hq(h) => w.hqs[h as usize].id.clone(), Target::Division(i) => w.divisions[i as usize].id.clone() };
        let historical: Vec<Value> = self.sim.historical.iter().filter(|(_, d)| Some(d.from as usize) == top)
            .map(|(at, d)| serde_json::json!({ "id": d.id, "at": at, "to": target(d.to), "task": d.task, "form": d.form, "note": d.note, "issued": self.issued.contains(&d.id) })).collect();
        // директивы верховного командования противника (журнал посредника): от его штабов верхней инстанции
        let enemy_historical: Vec<Value> = self.sim.historical.iter()
            .filter(|(_, d)| !mine(d.from as usize) && w.hqs[d.from as usize].echelon == crate::model::Echelon::HighCommand)
            .map(|(at, d)| serde_json::json!({ "id": d.id, "at": at, "from": w.hqs[d.from as usize].id, "to": target(d.to), "task": d.task, "form": d.form, "note": d.note })).collect();
        serde_json::json!({ "mode": mode, "hqs": hqs, "led": led, "requests": requests, "enemyRequests": enemy_requests, "historical": historical, "enemyHistorical": enemy_historical })
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
