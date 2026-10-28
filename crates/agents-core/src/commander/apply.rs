//! Исполнение решения командующего нынешними средствами командования: роль подвижной группы, директива своему штабу
//! (главный удар), частная директива армии через голову (`named_hq`: свой штаб её в раздел полосы не берёт до нового
//! замысла), распоряжение дивизиям резерва, ответ на запрос отхода. Каждое решение — документ командующего
//! (извещение) с обоснованием и правилом; директивы идут через `passing::issue` (своё время прохождения и документ).

use super::decide::{Commander, DOC_PREFIX};
use super::options::Kind;
use super::picture::divisions_of;
use crate::command::agent::place;
use crate::command::control::{DocKind, Document, Role};
use crate::command::directive::{Directive, Form, Line, Target, Task};
use crate::command::passing::{issue, target_id};
use crate::geo::XY;
use crate::model::State;
use crate::world::Sim;

/// Отход на рубеж в глубине: на столько километров от войск армии в сторону от ближайшего противника (допущение).
const WITHDRAW_KM: f64 = 15.0;

/// Директива командующего получателю `to`: задача к точке `goal` (ось — от нынешнего места получателя).
/// Себе — сразу (решение в своём штабе), подчинённым — боевым распоряжением со временем прохождения.
fn directive(sim: &Sim, c: &Commander, to: Target, task: Task, goal: XY, tick: u32) -> Directive {
    let d = c.decisions.last().expect("решение");
    let ch = &d.options[d.chosen].choice;
    let from = place(sim, to);
    Directive {
        id: format!("командующий:{}:{tick}", sim.world.hqs[c.hq as usize].id), from: c.hq, to, form: Form::Instruction, task,
        axis: if from.dist(goal) > 1.0 { vec![from, goal] } else { Vec::new() },
        immediate: Some(Line { pts: vec![goal], by: None }), subsequent: None, boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(),
        junction: None, hasty: false, ready: to == Target::Hq(c.hq), rule: Some(ch.rule.to_string()), issued: 0, note: ch.label.clone(),
    }
}

/// Частная директива армии через голову своего штаба (или себе).
fn to_army(sim: &mut Sim, c: &Commander, army: u32, task: Task, goal: XY, tick: u32, to: &mut Vec<String>) {
    let d = directive(sim, c, Target::Hq(army), task, goal, tick);
    if army != c.hq { sim.command.named_hq[army as usize] = true; }
    to.push(target_id(sim, d.to));
    issue(sim, d, tick);
}

/// Распоряжения дивизиям резерва штаба `h` (не отрезанным): задача к точке `goal`.
fn to_reserve(sim: &mut Sim, c: &Commander, h: u32, task: Task, goal: XY, tick: u32, to: &mut Vec<String>) {
    let ds: Vec<usize> = divisions_of(sim, h).into_iter().filter(|&i| sim.world.divisions[i].state == State::Reserve && sim.world.divisions[i].cut_since.is_none()).collect();
    for i in ds {
        let d = directive(sim, c, Target::Division(i as u32), task, goal, tick);
        to.push(target_id(sim, d.to));
        issue(sim, d, tick);
    }
}

/// Рубеж в глубине: от центра войск армии прочь от ближайшего противника.
fn rear_of(sim: &Sim, army: u32) -> Option<XY> {
    let c = place(sim, Target::Hq(army));
    let side = sim.world.hqs[army as usize].side;
    let e = sim.world.divisions.iter().filter(|d| d.side != side && !d.state.out()).map(|d| d.vars.pos).min_by(|a, b| a.dist(c).total_cmp(&b.dist(c)))?;
    let d = c.dist(e);
    if d < 1e-9 { return None; }
    Some(XY::new(c.x - (e.x - c.x) / d * WITHDRAW_KM, c.y - (e.y - c.y) / d * WITHDRAW_KM))
}

/// Цель задачи штаба по замыслу старшего: середина ближайшей задачи, иначе конец оси.
fn intent_goal(sim: &Sim, hq: u32) -> Option<XY> {
    let d = sim.command.intent.get(hq as usize)?.as_ref()?;
    d.immediate.as_ref().and_then(|l| crate::command::agent::mid(&l.pts)).or_else(|| d.axis.last().copied())
}

/// Исполнить решение `k` командующего `c` (последнее в `c.decisions`).
pub fn apply(sim: &mut Sim, c: &Commander, k: &Kind, tick: u32) {
    let mut to: Vec<String> = Vec::new();
    match k {
        Kind::Continue | Kind::WaitMobile | Kind::Hold | Kind::ShiftForces { .. } => {}
        Kind::CommitMobile { hq } => {
            sim.command.role_hq[*hq as usize] = Role::Committed;
            // штаб фронта распределяет полосу заново в этот же час — с введённой группой
            sim.command.fresh[c.hq as usize] = true;
            to.push(sim.world.hqs[*hq as usize].id.clone());
        }
        Kind::ShiftMainBlow { to: armies } => {
            // своему штабу: прежний замысел с новым главным ударом
            if let Some(mut d) = sim.command.intent[c.hq as usize].clone() {
                let dec = c.decisions.last().expect("решение");
                let ch = &dec.options[dec.chosen].choice;
                d.id = format!("командующий:{}:{tick}", sim.world.hqs[c.hq as usize].id);
                d.from = c.hq;
                d.to = Target::Hq(c.hq);
                d.form = Form::Order;
                d.main_blow = armies.clone();
                d.ready = true;
                d.rule = Some(ch.rule.to_string());
                d.note = ch.label.clone();
                issue(sim, d, tick);
                to.extend(armies.iter().map(|&a| sim.world.hqs[a as usize].id.clone()));
            }
        }
        Kind::TurnToRival { hq, at } => to_army(sim, c, *hq, Task::Attack, *at, tick, &mut to),
        Kind::Encircle { pocket } => {
            if let Some(p) = c.picture.as_ref().and_then(|pic| pic.pockets.get(*pocket)).cloned() {
                let own: Vec<u32> = c.picture.as_ref().map(|pic| pic.armies.iter().map(|a| a.hq).filter(|h| p.by.contains(h)).collect()).unwrap_or_default();
                for a in own { to_army(sim, c, a, Task::Attack, p.center, tick, &mut to); }
            }
        }
        Kind::CommitSecond { hq } => {
            sim.command.role_hq[*hq as usize] = Role::Committed;
            match intent_goal(sim, c.hq) {
                Some(goal) => to_army(sim, c, *hq, Task::Attack, goal, tick, &mut to),
                None => sim.command.fresh[c.hq as usize] = true,
            }
        }
        Kind::Withdraw { hq } => { if let Some(goal) = rear_of(sim, *hq) { to_army(sim, c, *hq, Task::Withdraw, goal, tick, &mut to); } }
        Kind::Breakout { toward } => {
            let armies: Vec<u32> = c.picture.as_ref().map(|p| p.armies.iter().map(|a| a.hq).collect()).unwrap_or_default();
            if armies.is_empty() || armies.contains(&c.hq) { to_army(sim, c, c.hq, Task::Attack, *toward, tick, &mut to); }
            else { for a in armies { to_army(sim, c, a, Task::Attack, *toward, tick, &mut to); } }
        }
        Kind::Counterattack { from, at } => to_reserve(sim, c, *from, Task::Attack, *at, tick, &mut to),
        Kind::MoveReserve { hq, to: at } => to_reserve(sim, c, *hq, Task::Move, *at, tick, &mut to),
        Kind::Relief { army, toward } => {
            if let Some((a, _)) = super::options_de::outside_hq(sim, c.hq, *toward).filter(|x| x.0 != *army) { to_army(sim, c, a, Task::Attack, *toward, tick, &mut to); }
        }
        Kind::Permit { request } | Kind::Forbid { request } => {
            if let Some(r) = sim.command.requests.get_mut(*request) {
                r.answer = Some(matches!(k, Kind::Permit { .. }));
                r.answered_at = tick;
                let h = r.hq;
                to.push(sim.world.hqs[h as usize].id.clone());
            }
        }
    }
    let d = c.decisions.last().expect("решение");
    let ch = &d.options[d.chosen].choice;
    let text = format!("{DOC_PREFIX}: {}. Повод: {}. {}", ch.label, d.trigger, d.why);
    sim.documents.push(Document { tick, hq: c.hq, kind: DocKind::Notice, to, text, rule: Some(ch.rule.to_string()) });
}
