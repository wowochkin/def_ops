//! Ход игры как вход ядра: всё, что игрок (и штаб противника на модели вне ядра) подаёт на ход, — одной записью
//! `TurnIn`. Сыгранные ходы копятся в `Game::log`: повтор журнала с того же начала даёт тот же мир (отмотка назад —
//! восстановить снимок и досчитать повтором). Отпечаток игры `state_digest` — поверх отпечатка мира `Sim::digest`:
//! документы, командование, «история как замысел», командующие и очередь директив игрока.

use crate::command::directive::Directive;
use crate::game::{CommandOp, Game, PlayerOrder, StaffIn};
use crate::world::Sim;
use serde_json::{json, Value};
use std::collections::{BTreeMap, HashSet};

/// Снимок игры — каждые столько ходов (худший возврат досчитывает `SNAP_EVERY − 1` ход).
pub const SNAP_EVERY: usize = 2;
/// Снимков не больше: при переполнении удаляется каждый второй, кроме снимка хода 0 (шаг между снимками удваивается).
pub const MAX_SNAPS: usize = 40;

/// Снимок игры перед ходом `turn + 1`: мир без потерь (`Sim::snapshot`), число кадров (кадры только дописываются —
/// при возврате обрезаются), управление игрой. Команды между ходами в снимок не входят — они в журнале хода.
pub struct GameSnap {
    /// Сыграно ходов.
    pub turn: usize,
    pub sim: Sim,
    pub frames: usize,
    pub issued: HashSet<String>,
    pub pending: Vec<(u32, Directive)>,
    pub reserves: BTreeMap<u32, u32>,
    pub enemy_agents: bool,
    pub limit: u32,
}

fn twelve() -> u32 { 12 }

/// Вход хода: команды управления, распоряжения штаба, приказы, длина хода в часах, доктрина из базы знаний на ход.
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TurnIn {
    /// Команды управления (взять, вернуть, разрешить отход, исторические директивы, директивы) — строками JSON, как
    /// их подаёт окно: неразборчивая — ошибка этой команды, а не всего хода.
    #[serde(default)]
    pub command: Vec<Value>,
    #[serde(default)]
    pub staff: Option<StaffIn>,
    #[serde(default)]
    pub orders: Vec<PlayerOrder>,
    #[serde(default = "twelve")]
    pub hours: u32,
    /// Доктрина из базы знаний на этот ход: [советская сторона, немецкая]; нет — прежняя.
    #[serde(skip)]
    pub doctrine: Option<[Option<String>; 2]>,
    /// Команды, поданные между ходами (до команд хода).
    #[serde(skip)]
    pub between: Vec<CommandOp>,
}

impl Default for TurnIn {
    /// Ход по умолчанию — 12 ч, как при разборе без `hours`.
    fn default() -> TurnIn { TurnIn { command: Vec::new(), staff: None, orders: Vec::new(), hours: twelve(), doctrine: None, between: Vec::new() } }
}

/// Итог хода: по приказам (дивизий или ошибка), неисполненные распоряжения, по командам (null — исполнена).
#[derive(Clone, Debug, Default)]
pub struct TurnResult {
    pub applied: Vec<Value>,
    pub staff_errors: Vec<String>,
    pub command_results: Vec<Option<String>>,
}

impl Game {
    /// Ход: доктрина → команды управления → распоряжения штаба → приказы → `hours` часов расчёта; ход — в журнал.
    /// Перед ходом — снимок (если ход кратен шагу снимков); при повторе журнала сначала исполняются команды, поданные
    /// тогда между ходами (`t.between`); поданные сейчас (`self.between`) уже исполнены — уходят в запись хода.
    pub fn play_turn(&mut self, mut t: TurnIn) -> TurnResult {
        self.snap_if_due();
        for c in &t.between { let _ = self.run_op(c); }
        t.between.extend(std::mem::take(&mut self.between));
        if let Some(d) = &t.doctrine { self.sim.doctrine_text = d.clone(); }
        let command_results: Vec<Option<String>> = t.command.iter().map(|c| self.command_json(c).err()).collect();
        let staff_errors = t.staff.as_ref().map(|s| self.staff(s)).unwrap_or_default();
        let applied: Vec<Value> = t.orders.iter().map(|o| match self.order(o) {
            Ok(n) => json!({ "hq": o.hq, "divisions": n }),
            Err(e) => json!({ "hq": o.hq, "error": e }),
        }).collect();
        self.advance(t.hours);
        self.log.push(t);
        TurnResult { applied, staff_errors, command_results }
    }

    /// Шаг снимков: `SNAP_EVERY`, после прореживания — расстояние между первыми снимками.
    fn snap_step(&self) -> usize {
        match self.snaps.as_slice() { [a, b, ..] => (b.turn - a.turn).max(1), _ => SNAP_EVERY }
    }

    /// Снимок перед первым действием хода (ход или команда между ходами), если ход кратен шагу и снимка ещё нет.
    fn snap_if_due(&mut self) {
        let turn = self.log.len();
        if turn % self.snap_step() != 0 || self.snaps.last().is_some_and(|s| s.turn >= turn) { return; }
        self.snaps.push(GameSnap {
            turn, sim: self.sim.snapshot(), frames: self.frames.len(), issued: self.issued.clone(), pending: self.pending.clone(),
            reserves: self.reserves.clone(), enemy_agents: self.enemy_agents, limit: self.limit,
        });
        if self.snaps.len() > MAX_SNAPS {
            // каждый второй, кроме снимка хода 0: остаются чётные по порядку (0, 2·шаг, 4·шаг, …)
            let mut k = 0;
            self.snaps.retain(|_| { k += 1; (k - 1) % 2 == 0 });
        }
    }

    /// Команда управления между ходами: исполняется сразу (те же действия, что у команд хода), при успехе — в `between`,
    /// с ходом — в журнал (при повторе исполняется первой).
    pub fn between_op(&mut self, c: CommandOp) -> Result<(), String> {
        self.snap_if_due();
        self.run_op(&c)?;
        self.between.push(c);
        Ok(())
    }

    /// Вернуться к ходу `keep + 1` (оставить `keep` сыгранных ходов): ближайший снимок не позже, досчёт повтором
    /// записанных входов; команды между ходами, поданные после последнего хода, снимаются.
    pub fn rewind(&mut self, keep: usize) -> Result<(), String> {
        let n = self.log.len();
        if keep > n { return Err(format!("сыграно ходов: {n}, к ходу {} вернуться нельзя", keep + 1)); }
        if keep == n && self.between.is_empty() { return Ok(()); }
        let at = self.snaps.iter().rposition(|s| s.turn <= keep).ok_or_else(|| format!("нет снимка игры до хода {}", keep + 1))?;
        self.snaps.truncate(at + 1);
        let s = &self.snaps[at];
        let mut sim = s.sim.snapshot();
        // связь с окном (ход расчёта, поток ответов модели) — у живого мира
        sim.on_progress = self.sim.on_progress.take();
        sim.on_stream = self.sim.on_stream.take();
        self.sim = sim;
        self.frames.truncate(s.frames);
        self.issued = s.issued.clone();
        self.pending = s.pending.clone();
        self.reserves = s.reserves.clone();
        self.enemy_agents = s.enemy_agents;
        self.limit = s.limit;
        let from = s.turn;
        let replay: Vec<TurnIn> = self.log.drain(from..).take(keep - from).collect();
        self.between.clear();
        for t in replay { self.play_turn(t); }
        Ok(())
    }

    /// Ход в формате trace.json с итогом хода: приказы, ошибки распоряжений и команд, итог по командам.
    pub fn turn_trace(&self, r: &TurnResult) -> Value {
        let mut t = self.trace();
        t["game"]["applied"] = json!(r.applied);
        t["game"]["staffErrors"] = json!(r.staff_errors);
        t["game"]["commandErrors"] = json!(r.command_results.iter().flatten().collect::<Vec<_>>());
        t["game"]["commandResults"] = json!(r.command_results);
        t
    }

    /// Отпечаток игры (FNV-1a, как `Sim::digest`): мир, кадры, документы, командование (с директивами в пути и
    /// замыслами штабов), распоряжения штаба, советские штабы по доктрине, «история как замысел», командующие,
    /// поданные и ждущие директивы игрока, резервы.
    pub fn state_digest(&self) -> u64 {
        let mut h = 0xcbf2_9ce4_8422_2325u64;
        let mut eat = |x: u64| { h ^= x; h = h.wrapping_mul(0x0100_0000_01b3); };
        // строка — байты и разделитель (соседние строки не сливаются)
        fn bytes(eat: &mut impl FnMut(u64), t: &str) { for b in t.bytes() { eat(b as u64); } eat(0x1ff); }
        let s = &self.sim;
        eat(s.digest());
        eat(self.frames.len() as u64);
        for d in &s.documents { eat(d.tick as u64); eat(d.hq as u64); eat(d.kind as u8 as u64); eat(d.text.len() as u64); }
        let c = &s.command;
        for &x in &c.control { eat(x as u8 as u64); }
        for &x in &c.led_hq { eat(x as u64); }
        for &x in &c.led_div { eat(x as u64); }
        for r in &c.requests { eat(r.tick as u64); eat(match r.answer { None => 0, Some(false) => 1, Some(true) => 2 }); }
        eat(c.sent.len() as u64);
        eat(s.historical.len() as u64);
        eat(c.in_transit.len() as u64);
        for (at, d) in &c.in_transit { eat(*at as u64); bytes(&mut eat, &d.id); }
        for x in &c.intent { match x { Some(d) => bytes(&mut eat, &d.id), None => eat(0) } }
        eat(s.staff.supply.len() as u64);
        eat(s.staff.pontoons.len() as u64);
        {
            let su = s.su_staff.lock().unwrap_or_else(|e| e.into_inner());
            eat(su.plan.iter().filter(|p| p.is_some()).count() as u64);
            for &e in &su.ech { eat(e as u8 as u64); }
            for &x in &su.since { eat(x as u64); }
            eat(su.replaced.iter().filter(|&&r| r).count() as u64);
        }
        let i = &s.intent;
        for x in &i.hq { eat(x.status as u8 as u64); eat(x.since as u64); }
        for ch in &i.chains { for t in &ch.tasks { eat(t.issued as u64); } }
        for &x in &i.led { eat(x as u64); }
        eat(i.log.len() as u64);
        eat(i.queue.len() as u64);
        eat(i.actions.len() as u64);
        eat(i.drops.len() as u64);
        for &e in &i.enabled { eat(e as u64); }
        for k in &s.commanders.list {
            eat(k.mood.confidence.to_bits());
            eat(k.mood.stress.to_bits());
            eat(k.intent_label.as_ref().map_or(0, |l| l.len() as u64));
            eat(k.decisions.len() as u64);
            eat(k.last as u64);
            match &k.intent { Some(x) => bytes(&mut eat, &format!("{x:?}")), None => eat(0) }
            eat(k.withdraw_at.len() as u64);
            eat(k.seen.intent.is_some() as u64);
            eat(k.seen.cut as u64);
            eat(k.seen.requests.len() as u64);
            eat(k.seen.broke.len() as u64);
            eat(k.seen.tasked.len() as u64);
        }
        eat(s.commanders.raised.len() as u64);
        for (at, d) in &self.pending { eat(*at as u64); bytes(&mut eat, &d.id); }
        let mut issued: Vec<&String> = self.issued.iter().collect();
        issued.sort();
        for id in issued { bytes(&mut eat, id); }
        for (&k, &v) in &self.reserves { eat(k as u64); eat(v as u64); }
        h
    }
}
