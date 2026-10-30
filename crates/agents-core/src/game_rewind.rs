//! Ход игры как вход ядра: всё, что игрок (и штаб противника на модели вне ядра) подаёт на ход, — одной записью
//! `TurnIn`. Сыгранные ходы копятся в `Game::log`: повтор журнала с того же начала даёт тот же мир (отмотка назад —
//! восстановить снимок и досчитать повтором). Отпечаток игры `state_digest` — поверх отпечатка мира `Sim::digest`:
//! документы, командование, «история как замысел», командующие и очередь директив игрока.

use crate::game::{CommandOp, Game, PlayerOrder, StaffIn};
use serde_json::{json, Value};

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
    pub fn play_turn(&mut self, t: TurnIn) -> TurnResult {
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
