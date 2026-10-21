//! Советские штабы-агенты по ступеням (этап 2б): корпус строит дивизии в два эшелона по ПУ-39 и приказу НКО №306 —
//! первый эшелон не шире участка прорыва на дивизию (1944–45 гг.: 1,5–2 км), второму — только направление
//! (ПУ-39 ст. 103); второй эшелон вводится после прорыва главной полосы или на 2–3-й день, на смену остановившейся
//! дивизии — сразу (№306). Числа — doctrine.su и command.su правил.

use crate::command::agent::{advance, frame, generic, mid, subs_of};
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
        _ => generic(sim, h, intent, replan, &subs_of(sim, h), None),
    }
}

fn enemy_km(sim: &Sim, i: usize) -> f64 {
    let w = &sim.world;
    w.divisions.iter().filter(|e| e.side != w.divisions[i].side && !e.state.out()).map(|e| e.vars.pos.dist(w.divisions[i].vars.pos)).fold(f64::INFINITY, f64::min)
}

/// Корпус: эшелоны дивизий, полосы первому эшелону, направление второму, ввод второго эшелона.
pub fn corps(sim: &mut Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    let subs = subs_of(sim, h);
    let divs: Vec<usize> = subs.iter().filter_map(|t| match t { Target::Division(i) => Some(*i as usize), _ => None }).collect();
    if divs.is_empty() { return generic(sim, h, intent, replan, &subs, None); }
    let fr = frame(sim, h, intent, &subs);
    let width = fr.band.left[0].dist(fr.band.right[0]);
    let tick = sim.world.tick;
    let (share, depth, fallback) = (sim.rules.doctrine_su.first_echelon_share, sim.rules.doctrine_su.commit_depth_km, sim.rules.doctrine_su.second_echelon_fallback_hours);
    let su = sim.rules.command.su.clone();
    // распределение — один раз
    let unset: Vec<usize> = divs.iter().copied().filter(|&i| sim.command.role_div[i] == Role::Unset).collect();
    if !unset.is_empty() {
        let (npp, mut rifle): (Vec<usize>, Vec<usize>) = unset.iter().partition(|&&i| mobile(&sim.world.divisions[i].params.kind));
        rifle.sort_by(|&a, &b| enemy_km(sim, a).total_cmp(&enemy_km(sim, b)).then(a.cmp(&b)));
        let by_share = ((rifle.len() as f64) * share).ceil() as usize;
        let by_band = ((width / su.division_band_km).floor() as usize).max(1);
        let n1 = by_share.min(by_band).max(1).min(rifle.len().max(1));
        for &i in &npp { sim.command.role_div[i] = Role::First; }
        for (k, &i) in rifle.iter().enumerate() { sim.command.role_div[i] = if k < n1 { Role::First } else { Role::Second }; }
        for &i in &unset { sim.command.start_div[i] = Some(sim.world.divisions[i].vars.pos); sim.command.since_div[i] = tick; }
    }
    let role = |sim: &Sim, i: usize| sim.command.role_div[i];
    let first: Vec<usize> = divs.iter().copied().filter(|&i| role(sim, i) == Role::First).collect();
    let mut second: Vec<usize> = divs.iter().copied().filter(|&i| role(sim, i) == Role::Second).collect();
    let mut rule_commit: Option<String> = None;
    // ввод второго эшелона: главная полоса прорвана или ожидание на 2–3-й день; иначе смена остановившейся
    if !second.is_empty() {
        let mean = if first.is_empty() { depth } else { first.iter().map(|&i| advance(sim.command.start_div[i], sim.world.divisions[i].vars.pos, &fr.axis)).sum::<f64>() / first.len() as f64 };
        let waited = second.iter().map(|&i| tick.saturating_sub(sim.command.since_div[i])).min().unwrap_or(0) as f64;
        if mean >= depth || waited >= fallback {
            for &i in &second { sim.command.role_div[i] = Role::Committed; }
            rule_commit = Some(if mean >= depth { format!("первый эшелон продвинулся на {mean:.1} км — главная полоса прорвана, ввод второго эшелона (доктрина, depth-objectives-1944-norm)") }
                else { format!("{waited:.0} ч в ожидании — ввод второго эшелона на 2–3-й день (stop-second-echelon-commit-day2)") });
            second.clear();
        } else {
            let contact = sim.rules.contact_km + 4.0;
            for &i in &first {
                let stalled = matches!(sim.world.divisions[i].state, State::Defense(_)) && enemy_km(sim, i) <= contact;
                if !stalled || sim.command.replaced[i] || second.is_empty() { continue; }
                let p = sim.world.divisions[i].vars.pos;
                let k = (0..second.len()).min_by(|&a, &b| sim.world.divisions[second[a]].vars.pos.dist(p).total_cmp(&sim.world.divisions[second[b]].vars.pos.dist(p))).unwrap();
                let j = second.remove(k);
                sim.command.replaced[i] = true;
                sim.command.role_div[j] = Role::Committed;
                rule_commit = Some(format!("{} остановилась — смена вторым эшелоном (приказ НКО №306: второй эшелон — на смену, а не на усиление)", sim.world.divisions[i].name));
            }
        }
    }
    // линия боя: первый эшелон без сменённых и введённые
    let line: Vec<Target> = divs.iter().copied().filter(|&i| matches!(role(sim, i), Role::First | Role::Committed) && !sim.command.replaced[i]).map(|i| Target::Division(i as u32)).collect();
    let mut out = generic(sim, h, intent, replan, &line, None);
    if let Some(r) = rule_commit { for d in out.iter_mut() { d.rule = Some(r.clone()); } }
    // второй эшелон и сменённые — за центром линии боя по оси
    let lp: Vec<XY> = line.iter().map(|t| match t { Target::Division(i) => sim.world.divisions[*i as usize].vars.pos, _ => XY::default() }).collect();
    if let Some(c) = mid(&lp) {
        let at = XY::new(c.x - fr.dir.x * su.second_echelon_behind_km, c.y - fr.dir.y * su.second_echelon_behind_km);
        let rest: Vec<usize> = divs.iter().copied().filter(|&i| role(sim, i) == Role::Second || sim.command.replaced[i]).collect();
        let n = XY::new(-fr.dir.y, fr.dir.x);
        for (k, &i) in rest.iter().enumerate() {
            // несколько дивизий второго эшелона — через 1 км поперёк оси
            let off = k as f64 - (rest.len() as f64 - 1.0) / 2.0;
            let at = XY::new(at.x + n.x * off, at.y + n.y * off);
            out.push(Directive {
                id: format!("{}>{}:2", intent.id, sim.world.divisions[i].id), from: h, to: Target::Division(i as u32), form: intent.form, task: Task::Move,
                axis: fr.axis.clone(), immediate: Some(Line { pts: vec![at], by: None }), subsequent: None, boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(),
                junction: None, hasty: intent.hasty, ready: intent.ready && !replan, rule: Some("ПУ-39 ст. 103: второму эшелону — только направление".into()),
                note: "второй эшелон корпуса: за первым".into(),
            });
        }
    }
    out
}
