//! Прохождение директивы (раздел 3 спецификации): подготовленный приказ — около суток на ступень, полная слаженность;
//! боевое распоряжение — 1–3 ч на ступень, слаженность дивизии падает (rules.command).

use crate::command::control::{DocKind, Document};
use crate::command::directive::{Directive, Form, Target};
use crate::model::Echelon;
use crate::rules::Command;
use crate::world::Sim;

/// Часы на ступень получателя: штаб (по ступени) или дивизия (`None`).
pub fn passing_hours(c: &Command, to: Option<Echelon>, form: Form) -> f64 {
    let i = match to { Some(Echelon::HighCommand | Echelon::Front) => 0, Some(Echelon::Army) => 1, Some(Echelon::Corps) => 2, None => 3 };
    match form { Form::Order => c.prepared_h[i], Form::Instruction => c.instruction_h[i] }
}

/// Название получателя (id штаба или дивизии).
pub fn target_id(sim: &Sim, t: Target) -> String {
    match t { Target::Hq(h) => sim.world.hqs[h as usize].id.clone(), Target::Division(i) => sim.world.divisions[i as usize].id.clone() }
}

/// Отдать директиву: в пути до часа прибытия; документ — директива (верхняя инстанция, фронт), боевой приказ (армия,
/// корпус) или распоряжение.
pub fn issue(sim: &mut Sim, mut d: Directive, tick: u32) {
    let to = match d.to { Target::Hq(h) => Some(sim.world.hqs[h as usize].echelon), Target::Division(_) => None };
    d.hasty |= d.form == Form::Instruction;
    let arrives = if d.ready { tick } else { tick + passing_hours(&sim.rules.command, to, d.form).round() as u32 };
    let kind = match (d.form, sim.world.hqs[d.from as usize].echelon) {
        (Form::Instruction, _) => DocKind::Instruction,
        (_, Echelon::HighCommand | Echelon::Front) => DocKind::Directive,
        _ => DocKind::Order,
    };
    let text = describe(sim, &d);
    sim.documents.push(Document { tick, hq: d.from, kind, to: vec![target_id(sim, d.to)], text, rule: None });
    sim.command.in_transit.push((arrives, d));
}

/// Текст документа: задача и рубежи.
pub fn describe(sim: &Sim, d: &Directive) -> String {
    let task = match d.task {
        crate::command::directive::Task::Attack => "наступать", crate::command::directive::Task::Defend => "оборонять",
        crate::command::directive::Task::Delay => "сдерживать", crate::command::directive::Task::Withdraw => "отходить",
        crate::command::directive::Task::Move => "выдвигаться", crate::command::directive::Task::Reserve => "в резерв",
    };
    let at = |l: &Option<crate::command::directive::Line>| l.as_ref().and_then(|l| l.pts.first()).map(|p| {
        let q = sim.theatre.proj.to_lnglat(*p);
        format!("{:.2}, {:.2}", q[1], q[0])
    });
    let mut s = format!("{task}");
    if let Some(p) = at(&d.immediate) { s += &format!("; ближайшая задача — рубеж у {p}"); }
    if let Some(p) = at(&d.subsequent) { s += &format!("; последующая — у {p}"); }
    if !d.note.is_empty() { s += &format!(" ({})", d.note); }
    s
}
