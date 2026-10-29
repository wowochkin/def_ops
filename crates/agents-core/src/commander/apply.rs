//! Исполнение решения командующего нынешними средствами командования: роль подвижной группы, директива своему штабу
//! (главный удар), частная директива армии через голову (`named_hq`: свой штаб её в раздел полосы не берёт до нового
//! замысла), распоряжение дивизиям резерва, ответ на запрос отхода. Отход и прорыв из кольца немецкой армии —
//! только с разрешения верхней инстанции: командующий поднимает запросы за дивизии первой линии (тот же `Request`, что
//! у корпусов), исполняются они по разрешению (`execute_permitted`). Каждое решение — документ командующего
//! (извещение) с обоснованием и правилом; директивы идут через `passing::issue` (своё время прохождения и документ).

use super::decide::{Commander, Raised, DOC_PREFIX};
use super::options::Kind;
use super::picture::divisions_of;
use crate::command::agent::place;
use crate::command::control::{DocKind, Document, Request};
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
pub fn rear_of(sim: &Sim, army: u32) -> Option<XY> {
    let c = place(sim, Target::Hq(army));
    let side = sim.world.hqs[army as usize].side;
    let e = sim.world.divisions.iter().filter(|d| d.side != side && !d.state.out()).map(|d| d.vars.pos).min_by(|a, b| a.dist(c).total_cmp(&b.dist(c)))?;
    let d = c.dist(e);
    if d < 1e-9 { return None; }
    Some(XY::new(c.x - (e.x - c.x) / d * WITHDRAW_KM, c.y - (e.y - c.y) / d * WITHDRAW_KM))
}

/// Дивизии первой линии армии: в бою или с противником в пределах соприкосновения; нет таких — все.
fn front_line(sim: &Sim, army: u32) -> Vec<usize> {
    let all = divisions_of(sim, army);
    let side = sim.world.hqs[army as usize].side;
    let contact = sim.rules.contact_km;
    let near = |i: usize| sim.world.engaged.get(i).copied().unwrap_or(false)
        || sim.world.divisions.iter().any(|e| e.side != side && !e.state.out() && e.vars.pos.dist(sim.world.divisions[i].vars.pos) <= contact);
    let first: Vec<usize> = all.iter().copied().filter(|&i| near(i)).collect();
    if first.is_empty() { all } else { first }
}

/// Запросы верхней инстанции за дивизии `ds`: задача `task` к точке `at`, исполнение — по разрешению. Дивизия,
/// за которую запрос уже есть, второй раз не запрашивается.
fn raise(sim: &mut Sim, ds: &[usize], task: Task, at: XY, tick: u32, to: &mut Vec<String>) {
    for &i in ds {
        if sim.command.requests.iter().any(|r| r.division == i as u32) { continue; }
        let hq = sim.world.divisions[i].hq;
        sim.command.requests.push(Request { hq, tick, division: i as u32, at, answer: None, answered_at: 0 });
        sim.commanders.raised.push(Raised { hq, division: i as u32, tick, task, at });
        let id = sim.world.hqs[hq as usize].id.clone();
        if !to.contains(&id) { to.push(id); }
    }
}

/// Исполнить разрешённые запросы командующих: распоряжение дивизии от её штаба (отход или прорыв к точке запроса);
/// запрещённые и снятые — забыть, ждущие — оставить.
pub fn execute_permitted(sim: &mut Sim, tick: u32) {
    let raised = std::mem::take(&mut sim.commanders.raised);
    for r in raised {
        let answer = sim.command.requests.iter().find(|q| q.hq == r.hq && q.division == r.division && q.tick == r.tick).map(|q| q.answer);
        match answer {
            Some(None) => sim.commanders.raised.push(r),
            Some(Some(true)) => {
                let i = r.division as usize;
                let from = sim.world.divisions[i].vars.pos;
                let note = if r.task == Task::Withdraw { "отход по разрешению верхней инстанции" } else { "прорыв из окружения по разрешению верхней инстанции" };
                let d = Directive {
                    id: format!("разрешено:{i}:{}", r.tick), from: r.hq, to: Target::Division(r.division), form: Form::Instruction, task: r.task,
                    axis: if from.dist(r.at) > 1.0 { vec![from, r.at] } else { Vec::new() }, immediate: Some(Line { pts: vec![r.at], by: None }), subsequent: None,
                    boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(), junction: None, hasty: true, ready: false,
                    rule: Some("разрешение верхней инстанции на отход".into()), issued: 0, note: note.into(),
                };
                // решение доктрины корпуса сутки его не перебивает
                if let Some(u) = sim.command.doc_until.get_mut(i) { *u = tick + 24; }
                issue(sim, d, tick);
            }
            _ => {}
        }
    }
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
            // тот же путь, что у штаба фронта: задача на глубину в ближайшем распределении полосы
            let d = c.decisions.last().expect("решение");
            let rule = format!("{}; {}", d.options[d.chosen].choice.label, d.options[d.chosen].choice.rule);
            crate::command::su::commit_mobile(sim, Target::Hq(*hq), rule);
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
                // в «истории как замысле» — только армии вне истории (прочие идут по своим цепочкам)
                let mine = |h: u32| !super::decide::for_strayed(sim, c.hq) || crate::intent::off_history(sim, h);
                let own: Vec<u32> = c.picture.as_ref().map(|pic| pic.armies.iter().map(|a| a.hq).filter(|&h| p.by.contains(&h) && mine(h)).collect()).unwrap_or_default();
                for a in own { to_army(sim, c, a, Task::Attack, p.center, tick, &mut to); }
            }
        }
        Kind::CommitSecond { hq } => {
            sim.command.role_hq[*hq as usize] = crate::command::control::Role::Committed;
            match intent_goal(sim, c.hq) {
                Some(goal) => to_army(sim, c, *hq, Task::Attack, goal, tick, &mut to),
                None => sim.command.fresh[c.hq as usize] = true,
            }
        }
        Kind::Withdraw { hq } => {
            if let Some(&(_, at)) = c.withdraw_at.iter().find(|x| x.0 == *hq) {
                let ds = front_line(sim, *hq);
                raise(sim, &ds, Task::Withdraw, at, tick, &mut to);
            }
        }
        Kind::Breakout { toward } => {
            // отрезанные дивизии командующего (армии или группы армий) — прорываться по разрешению
            let ds: Vec<usize> = divisions_of(sim, c.hq).into_iter().filter(|&i| sim.world.divisions[i].cut_since.is_some()).collect();
            raise(sim, &ds, Task::Attack, *toward, tick, &mut to);
        }
        Kind::Counterattack { from, at } => to_reserve(sim, c, *from, Task::Attack, *at, tick, &mut to),
        Kind::MoveReserve { hq, to: at } => to_reserve(sim, c, *hq, Task::Move, *at, tick, &mut to),
        // армии вне истории — частная директива фронта: наступать к точке (ось — от места армии, как `with_axis`)
        Kind::Assign { army, at, defend, .. } => to_army(sim, c, *army, if *defend { Task::Defend } else { Task::Attack }, *at, tick, &mut to),
        Kind::Relief { army, by, toward } => {
            if by != army { to_army(sim, c, *by, Task::Attack, *toward, tick, &mut to); }
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
    record(sim, c, tick, to);
}

/// Документ последнего решения командующего `c` (извещение получателям `to`) с обоснованием и правилом.
pub fn record(sim: &mut Sim, c: &Commander, tick: u32, to: Vec<String>) {
    let d = c.decisions.last().expect("решение");
    let ch = &d.options[d.chosen].choice;
    let text = format!("{DOC_PREFIX}: {}. Повод: {}. {}", ch.label, d.trigger, d.why);
    sim.documents.push(Document { tick, hq: c.hq, kind: DocKind::Notice, to, text, rule: Some(ch.rule.to_string()) });
}
