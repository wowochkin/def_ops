//! Общий штаб-агент (этап 2а): получив замысел старшего, делит свою полосу между действующими подчинёнными (на главном
//! ударе — уже) и отдаёт каждому директиву своей ступени — ближайшая и последующая задачи в пределах задачи старшего
//! (ПУ-39 ст. 89); дивизии директива становится приказом. Логика ступеней по уставам — этап 2б.

use crate::command::band::{band_of, center, clip_line, split};
use crate::command::control::{active_subs, Control, DocKind, Document};
use crate::command::directive::{Directive, Form, Line, Target, Task};
use crate::command::passing::{issue, target_id};
use crate::geo::XY;
use crate::model::{Echelon, Order, OrderKind};
use crate::world::{Event, Sim, World};

/// Ближе — цель достигнута, км.
const REACHED_KM: f64 = 2.0;

fn mid(ps: &[XY]) -> Option<XY> {
    if ps.is_empty() { return None; }
    let n = ps.len() as f64;
    Some(XY::new(ps.iter().map(|p| p.x).sum::<f64>() / n, ps.iter().map(|p| p.y).sum::<f64>() / n))
}

/// Положение подчинённого: дивизия — её место, штаб — центр его действующих дивизий (с подчинёнными штабами).
fn place(sim: &Sim, t: Target) -> XY {
    let w = &sim.world;
    match t {
        Target::Division(i) => w.divisions[i as usize].vars.pos,
        Target::Hq(h) => {
            let under = |mut k: usize| { for _ in 0..8 { if k == h as usize { return true; } match w.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
            mid(&w.divisions.iter().filter(|d| !d.state.out() && under(d.hq as usize)).map(|d| d.vars.pos).collect::<Vec<_>>()).unwrap_or(w.hqs[h as usize].pos)
        }
    }
}

/// Решение штаба по замыслу старшего: директивы подчинённым. `replan` — по циклу (распоряжением).
pub fn plan(sim: &Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    let (hqs, divs) = active_subs(sim, h);
    let mut subs: Vec<Target> = hqs.into_iter().map(Target::Hq).chain(divs.into_iter().map(Target::Division)).collect();
    if subs.is_empty() { return Vec::new(); }
    let pos: Vec<XY> = subs.iter().map(|&t| place(sim, t)).collect();
    // ось: из замысла, иначе от центра подчинённых к середине ближайшей задачи
    let axis = if intent.axis.len() >= 2 { intent.axis.clone() } else {
        match (mid(&pos), intent.immediate.as_ref().and_then(|l| mid(&l.pts))) { (Some(a), Some(b)) => vec![a, b], _ => Vec::new() }
    };
    // ширина полосы без разграничительных линий — по крайним дивизиям всего поддерева, а не по центрам подчинённых
    let extent: Vec<XY> = { let w = &sim.world; let under = |mut k: usize| { for _ in 0..8 { if k == h as usize { return true; } match w.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
        w.divisions.iter().filter(|d| !d.state.out() && under(d.hq as usize)).map(|d| d.vars.pos).collect() };
    let band = band_of(&axis, &intent.boundaries, if extent.is_empty() { &pos } else { &extent }, 2.0 * subs.len() as f64);
    // слева направо по оси
    let dir = match axis.as_slice() { [a, .., b] if a.dist(*b) > 1e-6 => XY::new((b.x - a.x) / a.dist(*b), (b.y - a.y) / a.dist(*b)), _ => XY::new(-1.0, 0.0) };
    let base = axis.first().copied().or_else(|| mid(&pos)).unwrap_or_default();
    let side = |p: XY| -dir.y * (p.x - base.x) + dir.x * (p.y - base.y);
    let mut order: Vec<usize> = (0..subs.len()).collect();
    order.sort_by(|&a, &b| side(pos[b]).total_cmp(&side(pos[a])));
    subs = order.iter().map(|&k| subs[k]).collect();
    let pos: Vec<XY> = order.iter().map(|&k| pos[k]).collect();
    // главный удар — названные в замысле или ближайший к оси; там полоса уже
    let nearest = (0..pos.len()).min_by(|&a, &b| side(pos[a]).abs().total_cmp(&side(pos[b]).abs()));
    let weights: Vec<f64> = subs.iter().enumerate().map(|(k, t)| {
        let main = matches!(t, Target::Hq(x) if intent.main_blow.contains(x)) || (intent.main_blow.is_empty() && Some(k) == nearest);
        if main { 1.0 } else { 1.5 }
    }).collect();
    let form = if replan || intent.form == Form::Instruction { Form::Instruction } else { Form::Order };
    split(&band, &weights).into_iter().zip(subs).map(|(b, to)| {
        let ax = center(&b);
        Directive {
            id: format!("{}>{}", intent.id, target_id(sim, to)), from: h, to, form, task: intent.task,
            axis: vec![ax[0], *ax.last().unwrap()],
            immediate: intent.immediate.as_ref().map(|l| Line { pts: clip_line(&l.pts, &b), by: l.by }),
            subsequent: intent.subsequent.as_ref().map(|l| Line { pts: clip_line(&l.pts, &b), by: l.by }),
            boundaries: vec![(None, b.left.clone()), (None, b.right.clone())],
            main_blow: Vec::new(), reserve: Vec::new(), junction: None, hasty: intent.hasty, note: intent.note.clone(),
        }
    }).collect()
}

fn kind_of(t: Task) -> OrderKind {
    match t { Task::Attack => OrderKind::Attack, Task::Defend | Task::Delay => OrderKind::Defend, Task::Withdraw => OrderKind::Withdraw, Task::Move | Task::Reserve => OrderKind::Move }
}

/// Цель задачи дивизии: середина ближайшей задачи, после выхода на неё — последующей; без рубежей — на месте.
fn div_target(d: &Directive, pos: XY) -> XY {
    d.immediate.as_ref().and_then(|l| mid(&l.pts)).or_else(|| d.subsequent.as_ref().and_then(|l| mid(&l.pts))).unwrap_or(pos)
}

/// Фаза командования шага: доставка директив, переход дивизий к последующей задаче, решения штабов-агентов.
pub fn phase(sim: &mut Sim, next: &mut World, tick: u32, journal: &mut Vec<Event>) {
    // директивы, дошедшие к этому часу
    let mut arrived = Vec::new();
    sim.command.in_transit.retain(|(at, d)| if *at <= tick { arrived.push(d.clone()); false } else { true });
    for d in arrived {
        match d.to {
            Target::Hq(h) => { sim.command.intent[h as usize] = Some(d); sim.command.fresh[h as usize] = true; }
            Target::Division(i) => {
                let iu = i as usize;
                // изъятую через голову дивизию директива старшего больше не задаёт (кроме директивы игрока ей самой)
                if sim.command.led_div.get(iu).copied().unwrap_or(false) && sim.command.control[d.from as usize] != Control::Player { continue; }
                let div = &mut next.divisions[iu];
                if d.hasty { div.vars.coord = div.vars.coord.min(sim.rules.command.hasty_coord); }
                let target = div_target(&d, div.vars.pos);
                next.in_transit.push((i, Order { kind: kind_of(d.task), target, forced: false, issued: tick, arrives: tick, from: d.from, note: d.note.clone() }));
                sim.command.div_task[iu] = Some(d);
            }
        }
    }
    // дивизия вышла на ближайшую задачу — к последующей
    for i in 0..sim.command.div_task.len() {
        let Some(d) = sim.command.div_task[i].as_ref() else { continue };
        let (Some(im), Some(sub)) = (d.immediate.as_ref().and_then(|l| mid(&l.pts)), d.subsequent.as_ref().and_then(|l| mid(&l.pts))) else { continue };
        if next.divisions[i].vars.pos.dist(im) > REACHED_KM { continue; }
        let mut d = d.clone();
        d.immediate = None;
        next.in_transit.push((i as u32, Order { kind: kind_of(d.task), target: sub, forced: false, issued: tick, arrives: tick, from: d.from, note: format!("{} — последующая задача", d.note) }));
        journal.push(Event { tick, agent: i as u32, text: "ближайшая задача выполнена — к последующей".into() });
        sim.command.div_task[i] = Some(d);
    }
    // решения штабов-агентов: новый замысел — сразу, иначе раз в цикл своей ступени
    for h in 0..sim.world.hqs.len() {
        if sim.command.control[h] != Control::Agent { continue; }
        let Some(intent) = sim.command.intent[h].clone() else { continue };
        let cycle = match sim.world.hqs[h].echelon { Echelon::HighCommand | Echelon::Front => sim.rules.command.cycle_h[0], Echelon::Army => sim.rules.command.cycle_h[1], Echelon::Corps => sim.rules.command.cycle_h[2] } as u32;
        let fresh = sim.command.fresh[h];
        if !fresh && tick < sim.command.last_cycle[h] + cycle.max(1) { continue; }
        sim.command.fresh[h] = false;
        sim.command.last_cycle[h] = tick;
        let ds = plan(sim, h as u32, &intent, !fresh);
        if ds.is_empty() {
            if fresh { sim.documents.push(Document { tick, hq: h as u32, kind: DocKind::Notice, to: Vec::new(), text: "нет подчинённых для задачи".into(), rule: None }); }
            continue;
        }
        for d in ds {
            // по циклу — только тем, чья задача изменилась
            let goal = div_target(&d, XY::default());
            let key = (h as u32, d.to);
            if !fresh { if let Some((g, t)) = sim.command.sent.get(&key) { if *t == d.task && g.dist(goal) <= REACHED_KM { continue; } } }
            sim.command.sent.insert(key, (goal, d.task));
            issue(sim, d, tick);
        }
    }
}
