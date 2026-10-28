//! Общий штаб-агент (этап 2а): получив замысел старшего, делит свою полосу между действующими подчинёнными (на главном
//! ударе — уже) и отдаёт каждому директиву своей ступени — ближайшая и последующая задачи в пределах задачи старшего
//! (ПУ-39 ст. 89); дивизии директива становится приказом. Логика ступеней по уставам — этап 2б.

use crate::command::band::{band_of, center, clip_line, point_in_band, split};
use crate::command::control::{active_subs, Control, DocKind, Document};
use crate::command::directive::{Directive, Form, Line, Target, Task};
use crate::command::passing::{issue, target_id};
use crate::geo::XY;
use crate::model::{Echelon, Order, OrderKind};
use crate::world::{Event, Sim, World};

/// Ближе — цель достигнута, км.
const REACHED_KM: f64 = 2.0;

pub fn mid(ps: &[XY]) -> Option<XY> {
    if ps.is_empty() { return None; }
    let n = ps.len() as f64;
    Some(XY::new(ps.iter().map(|p| p.x).sum::<f64>() / n, ps.iter().map(|p| p.y).sum::<f64>() / n))
}

/// Положение подчинённого: дивизия — её место, штаб — центр его действующих дивизий (с подчинёнными штабами).
pub fn place(sim: &Sim, t: Target) -> XY {
    let w = &sim.world;
    match t {
        Target::Division(i) => w.divisions[i as usize].vars.pos,
        Target::Hq(h) => {
            let under = |mut k: usize| { for _ in 0..8 { if k == h as usize { return true; } match w.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
            mid(&w.divisions.iter().filter(|d| !d.state.out() && under(d.hq as usize)).map(|d| d.vars.pos).collect::<Vec<_>>()).unwrap_or(w.hqs[h as usize].pos)
        }
    }
}

/// Продвижение от исходного положения вдоль оси наступления, км (нет исходного — 0).
pub fn advance(start: Option<XY>, pos: XY, axis: &[XY]) -> f64 {
    let (Some(s), [a, .., b]) = (start, axis) else { return 0.0 };
    let l = a.dist(*b);
    if l < 1e-6 { return 0.0; }
    ((pos.x - s.x) * (b.x - a.x) + (pos.y - s.y) * (b.y - a.y)) / l
}

/// Действующие подчинённые штаба целями директив: штабы, затем дивизии.
pub fn subs_of(sim: &Sim, h: u32) -> Vec<Target> {
    let (hqs, divs) = active_subs(sim, h);
    hqs.into_iter().map(Target::Hq).chain(divs.into_iter().map(Target::Division)).collect()
}

/// Решение штаба по замыслу старшего: по стороне и ступени — логика ступени (command/su.rs, command/de.rs).
pub fn plan(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    match sim.world.hqs[h as usize].side {
        crate::model::Side::Su => crate::command::su::plan(sim, h, intent, replan),
        crate::model::Side::De => crate::command::de::plan(sim, h, intent, replan),
    }
}

/// Полоса штаба по замыслу: граница, ось и направление (единичный вектор).
pub struct Frame { pub band: crate::command::band::Band, pub axis: Vec<XY>, pub dir: XY }

/// Полоса штаба `h` по замыслу для подчинённых `subs`: ось — из замысла, иначе от центра подчинённых к середине
/// ближайшей задачи; ширина без разграничительных линий — по крайним дивизиям всего поддерева.
pub fn frame(sim: &Sim, h: u32, intent: &Directive, subs: &[Target]) -> Frame {
    let pos: Vec<XY> = subs.iter().map(|&t| place(sim, t)).collect();
    let axis = if intent.axis.len() >= 2 { intent.axis.clone() } else {
        match (mid(&pos), intent.immediate.as_ref().and_then(|l| mid(&l.pts))) { (Some(a), Some(b)) => vec![a, b], _ => Vec::new() }
    };
    let extent: Vec<XY> = { let w = &sim.world; let under = |mut k: usize| { for _ in 0..8 { if k == h as usize { return true; } match w.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
        w.divisions.iter().filter(|d| !d.state.out() && under(d.hq as usize)).map(|d| d.vars.pos).collect() };
    let band = band_of(&axis, &intent.boundaries, if extent.is_empty() { &pos } else { &extent }, 2.0 * subs.len() as f64);
    let dir = match axis.as_slice() { [a, .., b] if a.dist(*b) > 1e-6 => XY::new((b.x - a.x) / a.dist(*b), (b.y - a.y) / a.dist(*b)), _ => XY::new(-1.0, 0.0) };
    Frame { band, axis, dir }
}

/// Общий раздел полосы: подчинённым `subs` — полосы по весам (`weights` по порядку `subs`; нет — главный удар уже),
/// ближайшая и последующая задачи — части рубежей старшего. `replan` — по циклу (распоряжением).
pub fn generic(sim: &Sim, h: u32, intent: &Directive, replan: bool, subs: &[Target], weights: Option<&[f64]>) -> Vec<Directive> {
    let mut subs: Vec<Target> = subs.to_vec();
    if subs.is_empty() { return Vec::new(); }
    let given: Option<Vec<f64>> = weights.map(|w| w.to_vec());
    let pos: Vec<XY> = subs.iter().map(|&t| place(sim, t)).collect();
    let Frame { band, axis, dir } = frame(sim, h, intent, &subs);
    let base = axis.first().copied().or_else(|| mid(&pos)).unwrap_or_default();
    let side = |p: XY| -dir.y * (p.x - base.x) + dir.x * (p.y - base.y);
    let mut order: Vec<usize> = (0..subs.len()).collect();
    order.sort_by(|&a, &b| side(pos[b]).total_cmp(&side(pos[a])));
    subs = order.iter().map(|&k| subs[k]).collect();
    let pos: Vec<XY> = order.iter().map(|&k| pos[k]).collect();
    // главный удар — названные в замысле или ближайший к оси; там полоса уже
    let nearest = (0..pos.len()).min_by(|&a, &b| side(pos[a]).abs().total_cmp(&side(pos[b]).abs()));
    let weights: Vec<f64> = match &given {
        Some(w) => order.iter().map(|&k| w[k]).collect(),
        None => subs.iter().enumerate().map(|(k, t)| {
            let main = matches!(t, Target::Hq(x) if intent.main_blow.contains(x)) || (intent.main_blow.is_empty() && Some(k) == nearest);
            if main { 1.0 } else { 1.5 }
        }).collect(),
    };
    let form = if replan || intent.form == Form::Instruction { Form::Instruction } else { Form::Order };
    // главный удар назван в замысле — задача-точка подчинённому вне него на её глубине в своей полосе (вспомогательный
    // удар — в своей полосе; директива № 11059: 61 А и 69 А — в обход Берлина); не назван — к точке все
    let on_main: Vec<bool> = subs.iter().map(|t| intent.main_blow.is_empty() || matches!(t, Target::Hq(x) if intent.main_blow.contains(x))).collect();
    let part = |l: &Line, b: &crate::command::band::Band, main: bool| Line { pts: if l.pts.len() == 1 && !main && intent.task == Task::Attack { vec![point_in_band(l.pts[0], b)] } else { clip_line(&l.pts, b) }, by: l.by };
    split(&band, &weights).into_iter().zip(subs).zip(on_main).map(|((b, to), main)| {
        let ax = center(&b);
        Directive {
            id: format!("{}>{}", intent.id, target_id(sim, to)), from: h, to, form, task: intent.task,
            axis: vec![ax[0], *ax.last().unwrap()],
            immediate: intent.immediate.as_ref().map(|l| part(l, &b, main)),
            subsequent: intent.subsequent.as_ref().map(|l| part(l, &b, main)),
            boundaries: vec![(None, b.left.clone()), (None, b.right.clone())],
            main_blow: Vec::new(), reserve: Vec::new(), junction: None, hasty: intent.hasty, ready: intent.ready && !replan, rule: None, issued: 0, note: intent.note.clone(),
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
    // готовые к началу директивы доходят до дивизий в тот же час — по ступеням, не больше пяти проходов
    for _ in 0..5 {
        phase_once(sim, next, tick, journal);
        if !sim.command.in_transit.iter().any(|(at, _)| *at <= tick) { break; }
    }
}

fn phase_once(sim: &mut Sim, next: &mut World, tick: u32, journal: &mut Vec<Event>) {
    // директивы, дошедшие к этому часу
    let mut arrived = Vec::new();
    sim.command.in_transit.retain(|(at, d)| if *at <= tick { arrived.push(d.clone()); false } else { true });
    for d in arrived {
        match d.to {
            Target::Hq(h) => {
                let hu = h as usize;
                // отданная раньше уже действующей директивы того же штаба — устарела
                if sim.command.intent[hu].as_ref().is_some_and(|o| o.from == d.from && o.issued > d.issued) { continue; }
                // изъятый через голову штаб директива старшего больше не задаёт (кроме директивы игрока)
                if sim.command.led_hq[hu] && sim.command.control[d.from as usize] != Control::Player { continue; }
                // частное распоряжение (не директива: устное указание): при замысле штаба называет подчинённых на главном
                // ударе — доводится только до них
                if d.form == Form::Instruction && sim.command.intent[hu].is_some() && !d.main_blow.is_empty() && d.main_blow.iter().all(|&m| sim.world.hqs[m as usize].parent == Some(h)) {
                    for &m in &d.main_blow {
                        let mut x = d.clone();
                        x.id = format!("{}>{}", d.id, sim.world.hqs[m as usize].id);
                        x.from = h;
                        x.to = Target::Hq(m);
                        x.main_blow = Vec::new();
                        if x.axis.is_empty() { x.axis = sim.command.intent[hu].as_ref().map(|i| i.axis.clone()).unwrap_or_default(); }
                        x.rule = Some("частная директива: доводится до названных армий".into());
                        sim.command.named_hq[m as usize] = true;
                        issue(sim, x, tick);
                    }
                    continue;
                }
                // директива без оси не заменяет замысел с осью: без геометрии — только документ, с границами — новые границы
                let geo = !d.axis.is_empty() || d.immediate.is_some() || d.subsequent.is_some() || !d.boundaries.is_empty();
                if let Some(old) = sim.command.intent[hu].as_mut() {
                    if !geo { continue; }
                    if d.axis.is_empty() && !old.axis.is_empty() {
                        if !d.boundaries.is_empty() { old.boundaries = d.boundaries; }
                        continue;
                    }
                }
                // новая ось (сдвиг конца больше 10 км) — построение подчинённых заново
                let turned = match (sim.command.intent[hu].as_ref().and_then(|o| o.axis.last().copied()), d.axis.last().copied()) { (Some(a), Some(b)) => a.dist(b) > 10.0, _ => false };
                // роли эшелонов и время ожидания остаются (введённый второй эшелон не ждёт снова); продвижение — от нынешнего
                // положения, сменённые снова в строю
                if turned {
                    let (hs, ds) = crate::command::control::active_subs(sim, h);
                    for k in hs { let p = place(sim, Target::Hq(k)); sim.command.start_hq[k as usize] = Some(p); sim.command.replaced_hq[k as usize] = false; }
                    for i in ds { let p = place(sim, Target::Division(i)); sim.command.start_div[i as usize] = Some(p); sim.command.replaced[i as usize] = false; }
                }
                // новый замысел — названные через голову снова в разделе полосы
                for k in 0..sim.world.hqs.len() { if sim.world.hqs[k].parent == Some(h) { sim.command.named_hq[k] = false; } }
                sim.command.intent[hu] = Some(d);
                sim.command.fresh[hu] = true;
            }
            Target::Division(i) => {
                let iu = i as usize;
                // изъятую через голову дивизию директива старшего больше не задаёт (кроме директивы игрока ей самой)
                if sim.command.led_div.get(iu).copied().unwrap_or(false) && sim.command.control[d.from as usize] != Control::Player { continue; }
                if sim.command.div_task[iu].as_ref().is_some_and(|o| o.from == d.from && o.issued > d.issued) { continue; }
                // уже у последующей задачи, а она та же — к ближайшей не возвращаться
                let mut d = d;
                let same_sub = |a: &Option<Line>, b: &Option<Line>| match (a.as_ref().and_then(|l| mid(&l.pts)), b.as_ref().and_then(|l| mid(&l.pts))) { (Some(x), Some(y)) => x.dist(y) <= REACHED_KM, _ => false };
                if sim.command.div_task[iu].as_ref().is_some_and(|o| o.immediate.is_none() && same_sub(&o.subsequent, &d.subsequent)) { d.immediate = None; }
                let div = &mut next.divisions[iu];
                if d.hasty { div.vars.coord = div.vars.coord.min(sim.rules.command.hasty_coord); }
                let target = div_target(&d, div.vars.pos);
                next.in_transit.push((i, Order { kind: kind_of(d.task), target, forced: false, issued: tick, arrives: tick, from: d.from, note: d.note.clone() }));
                sim.command.div_task[iu] = Some(d);
            }
        }
    }
    // дивизия вышла на ближайшую задачу — к последующей; задача выполнена, когда рубеж занят: у него нет противника
    // (ПУ-39 ст. 89: ближайшая задача — овладеть рубежом; в городе, пока гарнизон держится, — не выполнена)
    let clear = sim.rules.contact_km + 4.0;
    for i in 0..sim.command.div_task.len() {
        let Some(d) = sim.command.div_task[i].as_ref() else { continue };
        let (Some(im), Some(sub)) = (d.immediate.as_ref().and_then(|l| mid(&l.pts)), d.subsequent.as_ref().and_then(|l| mid(&l.pts))) else { continue };
        if next.divisions[i].vars.pos.dist(im) > REACHED_KM { continue; }
        if crate::command::su::enemy_km_at(sim, im, next.divisions[i].side) <= clear { continue; }
        let mut d = d.clone();
        d.immediate = None;
        next.in_transit.push((i as u32, Order { kind: kind_of(d.task), target: sub, forced: false, issued: tick, arrives: tick, from: d.from, note: format!("{} — последующая задача", d.note) }));
        journal.push(Event { tick, agent: i as u32, text: "ближайшая задача выполнена — к последующей".into() });
        sim.command.div_task[i] = Some(d);
    }
    // немецкие штабы-агенты без директивы — оборона полосы (замысел по умолчанию); армии каждый час следят за
    // развёртыванием противника (оттяжка перед артподготовкой); верхняя инстанция не игрок — отвечает на запросы отхода
    for h in 0..sim.world.hqs.len() {
        if sim.command.control[h] != Control::Agent || sim.world.hqs[h].side != crate::model::Side::De { continue; }
        if sim.command.intent[h].is_none() {
            sim.command.intent[h] = Some(Directive { id: "оборона".into(), from: h as u32, to: Target::Hq(h as u32), form: Form::Order, task: Task::Defend, axis: Vec::new(), immediate: None, subsequent: None,
                boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(), junction: None, hasty: false, ready: true, rule: None, issued: tick, note: "оборона полосы".into() });
            sim.command.fresh[h] = true;
        }
        if sim.world.hqs[h].echelon == Echelon::Army { for d in crate::command::de::watch(sim, h as u32) { issue(sim, d, tick); } }
    }
    let wait = sim.rules.command.de.permission_hours as u32;
    // ответ действует permissionHours — затем корпус может спросить снова
    sim.command.requests.retain(|r| r.answer.is_none() || tick < r.answered_at + wait);
    for k in 0..sim.command.requests.len() {
        let r = sim.command.requests[k].clone();
        if r.answer.is_some() || tick < r.tick + wait { continue; }
        sim.command.requests[k].answered_at = tick;
        let side = sim.world.hqs[r.hq as usize].side;
        let top = sim.world.hqs.iter().position(|x| x.side == side && x.echelon == Echelon::HighCommand);
        if top.is_some_and(|t| sim.command.control[t] == Control::Player) { continue; }
        sim.command.requests[k].answer = Some(false);
        let name = sim.world.divisions[r.division as usize].name.clone();
        sim.documents.push(Document { tick, hq: top.unwrap_or(r.hq as usize) as u32, kind: DocKind::Notice, to: vec![sim.world.hqs[r.hq as usize].id.clone()], text: format!("на запрос об отходе ({name}): держать"), rule: Some("приказ Гитлера от 15.04.1945: держать".into()) });
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
        // «доведена до начала» — только в час подачи
        if let Some(i) = sim.command.intent[h].as_mut() { i.ready = false; }
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
