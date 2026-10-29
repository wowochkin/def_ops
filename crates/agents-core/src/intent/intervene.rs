//! Вмешательства (спецификация, раздел 4, мерило 2): заготовленные изменения обстановки или замысла до начала прогона —
//! штаб держит рубеж под «игроком» (`hold`), армия снята (`remove`), задач на объект нет (`drop`), немецкая армия
//! получает разрешение на отход (`permit`). Снятие и изменение замысла — сразу, удержание и разрешение — в свой час
//! (в шаге диспетчера, до подачи цепочек).

use super::dispatch::{leave, set, subtree, Status};
use super::sense::{live, Reason};
use crate::command::agent::place;
use crate::command::control::{Control, DocKind, Document, Request};
use crate::command::directive::{Directive, Form, Line, Target, Task};
use crate::geo::XY;
use crate::model::{Echelon, Side, State};
use crate::world::{Event, Sim};
use serde_json::Value;

/// Отход по разрешению без рубежа в цепочке: на столько километров в тыл (данные вмешательства, поле `km`; это — по
/// умолчанию).
pub const PERMIT_REAR_KM: f64 = 20.0;

/// Действие вмешательства, ждущее своего часа.
#[derive(Clone, Debug)]
pub enum Action {
    Hold { hq: u32, hours: u32 },
    /// Конец удержания: управление поддерева — как было до него.
    Release { hq: u32, saved: Vec<(usize, Control)> },
    Permit { army: u32, km: f64 },
}

fn hq_of(sim: &Sim, v: &Value, k: &str) -> Result<u32, String> {
    let id = v[k].as_str().ok_or_else(|| format!("вмешательство: нет поля {k}"))?;
    sim.world.hqs.iter().position(|h| h.id == id).map(|h| h as u32).ok_or_else(|| format!("вмешательство: нет штаба {id}"))
}

/// Час: число — шаг от начала, строка «ГГГГ-ММ-ДДTЧЧ:ММ» — по календарю сценария.
fn hour_of(sim: &Sim, v: &Value, k: &str) -> Result<u32, String> {
    match &v[k] {
        Value::Number(n) => n.as_u64().map(|n| n as u32).ok_or_else(|| format!("вмешательство: {k} — не час")),
        Value::String(s) => {
            let h = crate::time::parse_hours(s).ok_or_else(|| format!("вмешательство: {k} = {s} — не дата"))? - sim.start_hour;
            u32::try_from(h).map_err(|_| format!("вмешательство: {k} = {s} — раньше начала"))
        }
        _ => Err(format!("вмешательство: нет поля {k}")),
    }
}

fn defend(from: u32, to: Target, at: XY, rule: &str, note: &str) -> Directive {
    Directive {
        id: format!("вмешательство:держать:{}", match to { Target::Hq(h) => format!("h{h}"), Target::Division(i) => format!("d{i}") }),
        from, to, form: Form::Instruction, task: Task::Defend, axis: Vec::new(), immediate: Some(Line { pts: vec![at], by: None }), subsequent: None,
        boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(), junction: None, hasty: false, ready: true,
        rule: Some(rule.into()), issued: 0, note: note.into(),
    }
}

/// Применить вмешательство `case` (`{ "actions": [ … ] }`) к миру до первого шага.
pub fn intervene(sim: &mut Sim, case: &Value) -> Result<(), String> {
    let actions = case["actions"].as_array().ok_or("вмешательство: нет списка actions")?;
    for a in actions {
        let (kind, v) = a.as_object().and_then(|o| o.iter().next()).ok_or("вмешательство: пустое действие")?;
        match kind.as_str() {
            "hold" => {
                let (hq, at, hours) = (hq_of(sim, v, "hq")?, hour_of(sim, v, "from")?, hour_of(sim, v, "hours")?);
                sim.intent.actions.push((at, Action::Hold { hq, hours }));
            }
            "remove" => remove(sim, hq_of(sim, v, "hq")?),
            "drop" => {
                let to = hq_of(sim, v, "to")?;
                let after = hour_of(sim, v, "after")?;
                let near = v["near"].as_array().and_then(|p| Some([p.first()?.as_f64()?, p.get(1)?.as_f64()?])).ok_or("вмешательство: near — [долгота, широта]")?;
                let km = v["km"].as_f64().ok_or("вмешательство: нет поля km")?;
                let p = sim.theatre.proj.to_xy(near);
                let ci = sim.intent.chains.iter().position(|c| c.owner == to).ok_or_else(|| format!("вмешательство: у {} нет цепочки задач", sim.world.hqs[to as usize].id))?;
                let c = &mut sim.intent.chains[ci];
                let hit = |t: &super::chain::Task| t.at >= after && t.goal.is_some_and(|g| g.dist(p) <= km);
                let before = c.tasks[..c.next].iter().filter(|t| hit(t)).count();
                c.tasks.retain(|t| !hit(t));
                c.next -= before;
            }
            "permit" => {
                let army = hq_of(sim, v, "army")?;
                let h = &sim.world.hqs[army as usize];
                if h.side != Side::De || h.echelon != Echelon::Army { return Err(format!("вмешательство: {} — не немецкая армия", h.id)); }
                sim.intent.actions.push((hour_of(sim, v, "at")?, Action::Permit { army, km: v["km"].as_f64().unwrap_or(PERMIT_REAR_KM) }));
            }
            x => return Err(format!("вмешательство: hold | remove | drop | permit, а не {x}")),
        }
    }
    Ok(())
}

/// Армия снята: её дивизии не введены в операцию (на карте их нет, в расчёте не участвуют), поддерево — «сам».
fn remove(sim: &mut Sim, hq: u32) {
    let tick = sim.world.tick;
    for i in live(sim, hq) {
        let d = &mut sim.world.divisions[i];
        d.state = State::Pending;
        d.enter = u32::MAX;
        let text = format!("{} выведена из операции (вмешательство: {} снята)", d.name, sim.world.hqs[hq as usize].name);
        sim.journal.push(Event { tick, agent: i as u32, text });
    }
    for k in subtree(sim, hq) { set(sim, k as u32, Status::Own, Some(Reason::Intervention("армия снята с операции".into())), tick); }
}

/// Действия, чей час настал (шаг диспетчера).
pub fn due(sim: &mut Sim, tick: u32) {
    let (now, rest): (Vec<_>, Vec<_>) = std::mem::take(&mut sim.intent.actions).into_iter().partition(|(at, _)| *at <= tick);
    sim.intent.actions = rest;
    for (_, a) in now {
        match a {
            Action::Hold { hq, hours } => hold(sim, hq, hours, tick),
            Action::Release { hq, saved } => release(sim, hq, saved, tick),
            Action::Permit { army, km } => permit(sim, army, km, tick),
        }
    }
}

fn hold(sim: &mut Sim, hq: u32, hours: u32, tick: u32) {
    let sub = subtree(sim, hq);
    let saved: Vec<(usize, Control)> = sub.iter().map(|&k| (k, sim.command.control[k])).collect();
    for &k in &sub { sim.command.control[k] = Control::Player; }
    super::take(sim, hq);
    let rule = format!("вмешательство: держать рубеж {hours} ч");
    let armies: Vec<usize> = sub.iter().copied().filter(|&k| sim.world.hqs[k].echelon == Echelon::Army).collect();
    for k in armies {
        let d = defend(hq, Target::Hq(k as u32), place(sim, Target::Hq(k as u32)), &rule, "на месте");
        crate::command::passing::issue(sim, d, tick);
    }
    for i in live(sim, hq) {
        let (h, at) = (sim.world.divisions[i].hq, sim.world.divisions[i].vars.pos);
        crate::command::passing::issue(sim, defend(h, Target::Division(i as u32), at, &rule, "на месте"), tick);
    }
    sim.journal.push(Event { tick, agent: u32::MAX, text: format!("вмешательство: {} держит рубеж {hours} ч", sim.world.hqs[hq as usize].name) });
    sim.intent.actions.push((tick + hours, Action::Release { hq, saved }));
}

/// Конец удержания: управление — как было, поддерево снова «по истории» (дальше — по обычным правилам); у цепочки, чья
/// последняя наступившая задача подана до удержания, она подаётся снова — замысел после паузы.
fn release(sim: &mut Sim, hq: u32, saved: Vec<(usize, Control)>, tick: u32) {
    let sub: Vec<usize> = saved.iter().map(|&(k, _)| k).collect();
    for (k, c) in saved {
        sim.command.control[k] = c;
        if c == Control::Agent { sim.command.last_cycle[k] = tick; }
    }
    sim.command.sent.retain(|key, _| !matches!(key.1, Target::Hq(h) if sub.contains(&(h as usize))));
    for &k in &sub { set(sim, k as u32, Status::History, None, tick); }
    for c in sim.intent.chains.iter_mut().filter(|c| sub.contains(&(c.owner as usize))) {
        if c.tasks[c.next.min(c.tasks.len())..].iter().any(|t| t.at <= tick) { continue; }
        if let Some(j) = (0..c.next.min(c.tasks.len())).rev().find(|&j| c.tasks[j].issued) { c.tasks[j].issued = false; c.next = j; }
    }
    sim.journal.push(Event { tick, agent: u32::MAX, text: format!("вмешательство: {} — снова по замыслу", sim.world.hqs[hq as usize].name) });
}

/// Разрешение на отход: дивизиям армии — отход к рубежу из её цепочки (следующая задача отвода с пунктом) или на
/// `km` в тыл; армии — тот же замысел от группы армий; запросы корпусов на отход — разрешены; армия — с
/// истории (дальше решают её штабы и командующий).
fn permit(sim: &mut Sim, army: u32, km: f64, tick: u32) {
    let goal = sim.intent.chains.iter().find(|c| c.owner == army)
        .and_then(|c| c.tasks[c.next.min(c.tasks.len())..].iter().find(|t| t.kind == super::chain::Goal::Withdraw && t.goal.is_some()).and_then(|t| t.goal));
    let rule = "вмешательство: разрешение верхней инстанции на отход";
    leave(sim, army, Reason::Intervention("разрешён отход".into()), tick);
    let divs = live(sim, army);
    let mut goals = Vec::new();
    for &i in &divs {
        let at = goal.unwrap_or_else(|| sim.behind(&sim.world, i, km));
        goals.push(at);
        let h = sim.world.divisions[i].hq;
        let d = Directive { id: format!("вмешательство:отход:{i}"), task: Task::Withdraw, ready: false, note: "отход по разрешению".into(), ..defend(army, Target::Division(i as u32), at, rule, "") };
        crate::command::passing::issue(sim, d, tick);
        sim.command.doc_until[i] = tick + 24;
        sim.command.requests.retain(|r| r.division != i as u32);
        sim.command.requests.push(Request { hq: h, tick, division: i as u32, at, answer: Some(true), answered_at: tick });
    }
    if let Some(c) = crate::command::agent::mid(&goals) {
        let from = sim.world.hqs[army as usize].parent.unwrap_or(army);
        let d = Directive { id: format!("вмешательство:отход:h{army}"), task: Task::Withdraw, note: "отход по разрешению".into(), ..defend(from, Target::Hq(army), c, rule, "") };
        crate::command::passing::issue(sim, d, tick);
    }
    let top = sim.world.hqs.iter().position(|h| h.side == Side::De && h.echelon == Echelon::HighCommand).unwrap_or(army as usize) as u32;
    sim.documents.push(Document { tick, hq: top, kind: DocKind::Notice, to: vec![sim.world.hqs[army as usize].id.clone()], text: "отход разрешён".into(), rule: Some(rule.into()) });
}
