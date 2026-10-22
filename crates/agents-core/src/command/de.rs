//! Немецкие штабы-агенты по ступеням (этап 2б), по практике обороны 1944–45 гг. Корпус решает по доктрине обороны
//! (staff.rs::doctrine_hq: держать, оборонять, контратаковать резервом — Gegenstoß, закрыть рубежом, прорыв из
//! окружения), но отход — только по разрешению верхней инстанции (приказ от 21.01.1945; ответ не раньше суток —
//! DA Pam 20-234); армия перед артподготовкой оттягивает первую линию к главной позиции (DA Pam 20-201).

use crate::command::agent::{generic, subs_of};
use crate::command::control::{DocKind, Document, Request};
use crate::command::directive::{Directive, Form, Line, Target, Task};
use crate::model::{Echelon, OrderKind, State};
use crate::world::Sim;

/// Решение немецкого штаба по замыслу старшего.
pub fn plan(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    match sim.world.hqs[h as usize].echelon {
        Echelon::Corps => corps(sim, h, intent, replan),
        _ => generic(sim, h, intent, replan, &subs_of(sim, h), None),
    }
}

fn to_div(h: u32, i: u32, task: Task, at: crate::geo::XY, form: Form, rule: &str, note: &str, id: &str) -> Directive {
    Directive {
        id: id.into(), from: h, to: Target::Division(i), form, task, axis: Vec::new(), immediate: Some(Line { pts: vec![at], by: None }), subsequent: None,
        boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(), junction: None, hasty: form == Form::Instruction, ready: false,
        rule: Some(rule.into()), issued: 0, note: note.into(),
    }
}

/// Корпус: полосы дивизиям (оборона), решения доктрины; отход — запрос наверх, до ответа — держаться.
pub fn corps(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    let subs = subs_of(sim, h);
    let divs: Vec<usize> = subs.iter().filter_map(|t| match t { Target::Division(i) => Some(*i as usize), _ => None }).collect();
    let tick = sim.world.tick;
    // общий приказ по полосе — только дивизиям без действующего решения доктрины (иначе приказы чередуются)
    let free: Vec<Target> = subs.iter().copied().filter(|t| match t { Target::Division(i) => tick >= sim.command.doc_until[*i as usize], _ => true }).collect();
    let mut out = generic(sim, h, intent, replan, &free, None);
    let dec = sim.doctrine_hq(&sim.world, tick, h as usize, &divs);
    let hold_h = sim.rules.command.de.permission_hours as u32;
    for o in dec.orders {
        let Some(&i) = o.to.first() else { continue };
        out.retain(|d| d.to != Target::Division(i));
        sim.command.doc_until[i as usize] = tick + 24;
        let at = o.target.unwrap_or(sim.world.divisions[i as usize].vars.pos);
        let here = sim.world.divisions[i as usize].vars.pos;
        if o.kind == OrderKind::Withdraw {
            match sim.command.requests.iter().find(|r| r.hq == h && r.division == i).map(|r| r.answer) {
                Some(Some(true)) => out.push(to_div(h, i, Task::Withdraw, sim.command.requests.iter().find(|r| r.hq == h && r.division == i).map_or(at, |r| r.at), Form::Instruction, "разрешение верхней инстанции на отход", &o.note, &format!("отход:{i}"))),
                // ждёт ответа или отказано — держаться на месте
                Some(_) => out.push(to_div(h, i, Task::Defend, here, Form::Instruction, "приказ от 21.01.1945: до разрешения — держать", &o.note, &format!("держать:{i}"))),
                None => {
                    out.push(to_div(h, i, Task::Defend, here, Form::Instruction, "приказ от 21.01.1945: до разрешения — держать", &o.note, &format!("держать:{i}")));
                    sim.command.doc_until[i as usize] = tick + hold_h;
                    sim.command.requests.push(Request { hq: h, tick, division: i, at, answer: None, answered_at: 0 });
                    let name = sim.world.divisions[i as usize].name.clone();
                    sim.documents.push(Document { tick, hq: h, kind: DocKind::Report, to: Vec::new(), text: format!("запрос на отход: {name} — {}; до ответа — держаться", o.note), rule: Some("приказ от 21.01.1945: о каждом отходе — доклад заранее".into()) });
                }
            }
            continue;
        }
        let task = match o.kind { OrderKind::Attack => Task::Attack, OrderKind::Move => Task::Move, _ => Task::Defend };
        out.push(to_div(h, i, task, at, Form::Instruction, "доктрина обороны (TM-E 30-451, DA Pam 20-233)", &o.note, &format!("доктрина:{i}")));
    }
    out
}

/// Ход часа немецкой армии: оттяжка перед артподготовкой — противник развёртывается у её полосы; один раз на угрозу.
pub fn watch(sim: &mut Sim, h: u32) -> Vec<Directive> {
    let tick = sim.world.tick;
    let r = sim.rules.command.de.clone();
    let near = sim.rules.contact_km + 6.0;
    let w = &sim.world;
    let under = |mut k: u32| { for _ in 0..8 { if k == h { return true; } match w.hqs[k as usize].parent { Some(p) => k = p, None => return false } } false };
    let own: Vec<usize> = (0..w.divisions.len()).filter(|&i| { let d = &w.divisions[i]; under(d.hq) && !d.state.out() && d.state != State::Remnant }).collect();
    let deploying: Vec<usize> = (0..w.divisions.len()).filter(|&j| { let e = &w.divisions[j]; e.side != w.hqs[h as usize].side && matches!(e.state, State::Deploy { .. }) && own.iter().any(|&i| w.divisions[i].vars.pos.dist(e.vars.pos) <= near) }).collect();
    if !deploying.is_empty() { sim.command.pull_seen[h as usize] = tick; }
    // снова — только после затишья 48 ч подряд (иначе в ходе наступления отход каждые сутки)
    if let Some(t) = sim.command.pulled[h as usize] { if tick >= t + 48 && tick >= sim.command.pull_seen[h as usize] + 48 { sim.command.pulled[h as usize] = None; } return Vec::new(); }
    if (deploying.len() as f64) < r.attack_sign_divisions { return Vec::new(); }
    sim.command.pulled[h as usize] = Some(tick);
    let first: Vec<usize> = own.iter().copied().filter(|&i| deploying.iter().any(|&j| w.divisions[i].vars.pos.dist(w.divisions[j].vars.pos) <= near)).collect();
    let out: Vec<Directive> = first.iter().map(|&i| {
        let at = sim.behind(&sim.world, i, r.pullback_km);
        to_div(h, i as u32, Task::Withdraw, at, Form::Instruction, "DA Pam 20-201: оттяжка с первой позиции перед артподготовкой", &format!("противник развёртывается для атаки ({} дивизий) — передний край к главной позиции", deploying.len()), &format!("оттяжка:{i}"))
    }).collect();
    out
}
