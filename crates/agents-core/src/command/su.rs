//! Советские штабы-агенты по ступеням (этап 2б). Корпус строит дивизии, армия — корпуса в два эшелона по ПУ-39 и
//! приказу НКО №306: первый эшелон — ближайшие к противнику (у корпуса — не шире участка прорыва на дивизию,
//! 1944–45 гг.: 1,5–2 км), второму — только направление (ПУ-39 ст. 103); второй эшелон вводится после прорыва главной
//! полосы или на 2–3-й день, на смену остановившемуся — сразу (№306). Фронт держит танковые армии подвижной группой
//! до прорыва тактической зоны (приказ НКО №325). Числа — doctrine.su и command.su правил.

use crate::command::agent::{advance, frame, generic, mid, place, subs_of};
use crate::command::control::Role;
use crate::command::directive::{Directive, Line, Target, Task};
use crate::geo::XY;
use crate::model::{Echelon, State};
use crate::world::Sim;

/// Подвижная часть: танки, механизированные, бригады, конница, САУ.
pub fn mobile(kind: &str) -> bool { matches!(kind, "tk" | "mk" | "brigade" | "kd" | "stug") }

/// Решение советского штаба по замыслу старшего.
pub fn plan(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    match (sim.world.hqs[h as usize].echelon, intent.task) {
        (Echelon::Corps, Task::Attack) => corps(sim, h, intent, replan),
        (Echelon::Army, Task::Attack) => army(sim, h, intent, replan),
        (Echelon::Front, Task::Attack) => front(sim, h, intent, replan),
        _ => generic(sim, h, intent, replan, &subs_of(sim, h), None),
    }
}

/// Дивизии поддерева штаба (действующие).
fn divs_under(sim: &Sim, h: u32) -> Vec<usize> {
    let w = &sim.world;
    (0..w.divisions.len()).filter(|&i| {
        let d = &w.divisions[i];
        if d.state.out() || d.state == State::Remnant { return false; }
        let mut k = d.hq;
        for _ in 0..8 { if k == h { return true; } match w.hqs[k as usize].parent { Some(p) => k = p, None => return false } }
        false
    }).collect()
}

fn enemy_km_at(sim: &Sim, p: XY, side: crate::model::Side) -> f64 {
    sim.world.divisions.iter().filter(|e| e.side != side && !e.state.out()).map(|e| e.vars.pos.dist(p)).fold(f64::INFINITY, f64::min)
}

/// Подвижна ли часть или штаб (больше половины дивизий поддерева подвижные).
fn is_mobile(sim: &Sim, t: Target) -> bool {
    match t {
        Target::Division(i) => mobile(&sim.world.divisions[i as usize].params.kind),
        Target::Hq(h) => { let ds = divs_under(sim, h); !ds.is_empty() && ds.iter().filter(|&&i| mobile(&sim.world.divisions[i].params.kind)).count() * 2 > ds.len() }
    }
}

/// Остановился: все его дивизии в обороне рядом с противником.
fn stalled(sim: &Sim, t: Target) -> bool {
    let ds = match t { Target::Division(i) => vec![i as usize], Target::Hq(h) => divs_under(sim, h) };
    let contact = sim.rules.contact_km + 4.0;
    !ds.is_empty() && ds.iter().all(|&i| { let d = &sim.world.divisions[i]; matches!(d.state, State::Defense(_)) && enemy_km_at(sim, d.vars.pos, d.side) <= contact })
}

/// Два эшелона из подчинённых `units`: распределение (один раз), ввод второго эшелона, полосы линии боя, направление
/// второму эшелону. `cap_by_band` — первый эшелон не шире участка прорыва на подчинённого (корпус).
fn echelons(sim: &mut Sim, h: u32, intent: &Directive, replan: bool, units: &[Target], cap_by_band: bool, unit_name: &str) -> Vec<Directive> {
    let all = subs_of(sim, h);
    let fr = frame(sim, h, intent, &all);
    let width = fr.band.left[0].dist(fr.band.right[0]);
    let tick = sim.world.tick;
    let side = sim.world.hqs[h as usize].side;
    let (share, depth, fallback) = (sim.rules.doctrine_su.first_echelon_share, sim.rules.doctrine_su.commit_depth_km, sim.rules.doctrine_su.second_echelon_fallback_hours);
    let su = sim.rules.command.su.clone();
    let unset: Vec<Target> = units.iter().copied().filter(|&t| sim.command.role(t) == Role::Unset).collect();
    if !unset.is_empty() {
        // танки непосредственной поддержки — с первым эшелоном; остальные — ближние к противнику в первый
        let (npp, mut rest): (Vec<Target>, Vec<Target>) = unset.iter().partition(|&&t| matches!(t, Target::Division(_)) && is_mobile(sim, t));
        rest.sort_by(|&a, &b| enemy_km_at(sim, place(sim, a), side).total_cmp(&enemy_km_at(sim, place(sim, b), side)));
        // «две трети» записаны 0,667: 3 · 0,667 = 2,001 — округление с допуском
        let by_share = ((rest.len() as f64) * share - 1e-2).ceil() as usize;
        let by_band = if cap_by_band { ((width / su.division_band_km).floor() as usize).max(1) } else { usize::MAX };
        let n1 = by_share.min(by_band).max(1).min(rest.len().max(1));
        for &t in &npp { sim.command.set_role(t, Role::First); }
        for (k, &t) in rest.iter().enumerate() { sim.command.set_role(t, if k < n1 { Role::First } else { Role::Second }); }
        for &t in &unset { let p = place(sim, t); sim.command.mark(t, p, tick); }
    }
    let first: Vec<Target> = units.iter().copied().filter(|&t| sim.command.role(t) == Role::First).collect();
    let mut second: Vec<Target> = units.iter().copied().filter(|&t| sim.command.role(t) == Role::Second).collect();
    let mut why: Option<String> = None;
    if !second.is_empty() {
        let mean = if first.is_empty() { depth } else { first.iter().map(|&t| advance(sim.command.start(t), place(sim, t), &fr.axis)).sum::<f64>() / first.len() as f64 };
        let waited = second.iter().map(|&t| tick.saturating_sub(sim.command.since(t))).min().unwrap_or(0) as f64;
        if mean >= depth || waited >= fallback {
            for &t in &second { sim.command.set_role(t, Role::Committed); }
            why = Some(if first.is_empty() { format!("первый эшелон {unit_name} выбыл — ввод второго эшелона") }
                else if mean >= depth { format!("первый эшелон продвинулся на {mean:.1} км — главная полоса прорвана, ввод второго эшелона (depth-objectives-1944-norm)") }
                else { format!("{waited:.0} ч в ожидании — ввод второго эшелона на 2–3-й день (stop-second-echelon-commit-day2)") });
            second.clear();
        } else {
            for &t in &first {
                if !stalled(sim, t) || sim.command.replaced_of(t) || second.is_empty() { continue; }
                let p = place(sim, t);
                let k = (0..second.len()).min_by(|&a, &b| place(sim, second[a]).dist(p).total_cmp(&place(sim, second[b]).dist(p))).unwrap();
                let j = second.remove(k);
                sim.command.set_replaced(t);
                sim.command.set_role(j, Role::Committed);
                why = Some(format!("{unit_name} первого эшелона остановился — смена вторым эшелоном (приказ НКО №306: на смену, а не на усиление)"));
            }
        }
    }
    let line: Vec<Target> = units.iter().copied().filter(|&t| matches!(sim.command.role(t), Role::First | Role::Committed) && !sim.command.replaced_of(t)).collect();
    let mut out = generic(sim, h, intent, replan, &line, None);
    if let Some(r) = why { for d in out.iter_mut() { d.rule = Some(r.clone()); } }
    // второй эшелон и сменённые — за центром линии боя по оси, через 1 км поперёк
    let rest: Vec<Target> = units.iter().copied().filter(|&t| sim.command.role(t) == Role::Second || sim.command.replaced_of(t)).collect();
    if let Some(c) = mid(&line.iter().map(|&t| place(sim, t)).collect::<Vec<_>>()) {
        let n = XY::new(-fr.dir.y, fr.dir.x);
        for (k, &t) in rest.iter().enumerate() {
            let off = k as f64 - (rest.len() as f64 - 1.0) / 2.0;
            let at = XY::new(c.x - fr.dir.x * su.second_echelon_behind_km + n.x * off, c.y - fr.dir.y * su.second_echelon_behind_km + n.y * off);
            out.push(follow(sim, h, intent, replan, t, at, "ПУ-39 ст. 103: второму эшелону — только направление", &format!("второй эшелон: за первым ({unit_name})")));
        }
    }
    out
}

/// Директива «выдвигаться к точке» без полосы — второму эшелону и подвижной группе.
fn follow(sim: &Sim, h: u32, intent: &Directive, replan: bool, to: Target, at: XY, rule: &str, note: &str) -> Directive {
    let id = match to { Target::Hq(k) => sim.world.hqs[k as usize].id.clone(), Target::Division(i) => sim.world.divisions[i as usize].id.clone() };
    Directive {
        id: format!("{}>{id}:за", intent.id), from: h, to, form: intent.form, task: Task::Move, axis: intent.axis.clone(),
        immediate: Some(Line { pts: vec![at], by: None }), subsequent: None, boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(),
        junction: None, hasty: intent.hasty, ready: intent.ready && !replan, rule: Some(rule.into()), issued: 0, note: note.into(),
    }
}

/// Корпус: эшелоны дивизий.
pub fn corps(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    let units = subs_of(sim, h);
    if units.is_empty() { return Vec::new(); }
    echelons(sim, h, intent, replan, &units, true, "дивизия")
}

/// Армия: эшелоны корпусов; дивизии и бригады прямо под армией — с ближайшим корпусом первого эшелона.
pub fn army(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    let subs = subs_of(sim, h);
    let corps: Vec<Target> = subs.iter().copied().filter(|t| matches!(t, Target::Hq(_))).collect();
    let direct: Vec<Target> = subs.iter().copied().filter(|t| matches!(t, Target::Division(_))).collect();
    if corps.is_empty() { return echelons(sim, h, intent, replan, &direct, true, "дивизия"); }
    let mut out = echelons(sim, h, intent, replan, &corps, false, "корпус");
    // приданные: директива ближайшего корпуса линии боя
    let line: Vec<(XY, Directive)> = out.iter().filter(|d| d.task != Task::Move).filter_map(|d| match d.to { Target::Hq(_) => Some((place(sim, d.to), d.clone())), _ => None }).collect();
    for t in direct {
        let p = place(sim, t);
        if let Some((_, d)) = line.iter().min_by(|a, b| a.0.dist(p).total_cmp(&b.0.dist(p))) {
            let mut d = d.clone();
            d.to = t;
            d.rule = Some("приказ НКО №306: танки и части усиления — дивизиям первого эшелона".into());
            out.push(d);
        }
    }
    out
}

/// Фронт: стрелковые армии — главный удар уже, вспомогательные шире; танковые армии — подвижная группа до прорыва.
pub fn front(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    let subs = subs_of(sim, h);
    let tick = sim.world.tick;
    let (tank_depth, tank_fallback) = (sim.rules.doctrine_su.tank_commit_depth_km, sim.rules.doctrine_su.tank_commit_fallback_hours);
    let share = sim.rules.command.su.main_blow_share;
    let fr = frame(sim, h, intent, &subs);
    for &t in &subs {
        if sim.command.role(t) == Role::Unset {
            let r = if matches!(t, Target::Hq(_)) && is_mobile(sim, t) { Role::Mobile } else { Role::First };
            sim.command.set_role(t, r);
            let p = place(sim, t);
            sim.command.mark(t, p, tick);
        }
    }
    let rifle: Vec<Target> = subs.iter().copied().filter(|&t| sim.command.role(t) != Role::Mobile && sim.command.role(t) != Role::Committed).collect();
    // главный удар: названные в замысле, иначе ближайшие к оси
    let base = fr.axis.first().copied().unwrap_or_default();
    let off = |p: XY| (-fr.dir.y * (p.x - base.x) + fr.dir.x * (p.y - base.y)).abs();
    let mut by_axis = rifle.clone();
    by_axis.sort_by(|&a, &b| off(place(sim, a)).total_cmp(&off(place(sim, b))));
    let named: Vec<Target> = rifle.iter().copied().filter(|t| matches!(t, Target::Hq(x) if intent.main_blow.contains(x))).collect();
    let main: Vec<Target> = if named.is_empty() { by_axis.iter().copied().take(((rifle.len() as f64) * share).ceil() as usize).collect() } else { named };
    // ввод подвижной группы: армии главного удара продвинулись на глубину тактической зоны или срок
    let mean = if main.is_empty() { tank_depth } else { main.iter().map(|&t| advance(sim.command.start(t), place(sim, t), &fr.axis)).sum::<f64>() / main.len() as f64 };
    let mobiles: Vec<Target> = subs.iter().copied().filter(|&t| sim.command.role(t) == Role::Mobile).collect();
    let mut committed_now = Vec::new();
    for &t in &mobiles {
        let waited = tick.saturating_sub(sim.command.since(t)) as f64;
        if mean >= tank_depth || waited >= tank_fallback { sim.command.set_role(t, Role::Committed); committed_now.push((t, mean >= tank_depth, waited)); }
    }
    let line: Vec<Target> = subs.iter().copied().filter(|&t| sim.command.role(t) != Role::Mobile).collect();
    let weights: Vec<f64> = line.iter().map(|t| if main.contains(t) || sim.command.role(*t) == Role::Committed { 1.0 } else { 2.0 }).collect();
    let mut out = generic(sim, h, intent, replan, &line, Some(&weights));
    for d in out.iter_mut() {
        if let Some((_, broke, waited)) = committed_now.iter().find(|x| x.0 == d.to) {
            // введённой подвижной группе — на глубину: ближайшая задача — последующая задача фронта
            if let Some(s) = d.subsequent.clone() { d.immediate = Some(s); }
            d.rule = Some(if *broke { format!("армии главного удара продвинулись на {mean:.1} км — тактическая зона прорвана, ввод подвижной группы (приказ НКО №325)") }
                else { format!("за {waited:.0} ч тактическая зона не прорвана — ввод подвижной группы для завершения прорыва (приказ НКО №325)") });
        }
    }
    // подвижные группы до ввода — за главным ударом в 10 км
    if let Some(c) = mid(&main.iter().map(|&t| place(sim, t)).collect::<Vec<_>>()) {
        let at = XY::new(c.x - fr.dir.x * 10.0, c.y - fr.dir.y * 10.0);
        for t in subs.iter().copied().filter(|&t| sim.command.role(t) == Role::Mobile) {
            out.push(follow(sim, h, intent, replan, t, at, "приказ НКО №325: танковые и механизированные корпуса — эшелон развития успеха, ввод после прорыва главной полосы", "подвижная группа фронта: ждёт прорыва тактической зоны"));
        }
    }
    out
}
