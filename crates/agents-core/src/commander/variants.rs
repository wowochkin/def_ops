//! Варианты решения для игрока (пункт управления, «Варианты советника» без модели): варианты командующего выбранного
//! штаба по правилам его стороны и ступени (`options_su`, `options_de`, `options_high`) и общие — «продолжать»,
//! «перейти к обороне», «перенести главный удар»; польза — `decide::score`. Каждый вариант раскладывается на всех
//! действующих подчинённых: замысел штаба с поправкой по виду делится между ними разделом полосы
//! (`command::agent::plan`) на копии мира, затем задача получателя поправляется по виду; подчинённому, которому раздел
//! полосы директивы не дал (подвижная группа до ввода, второй эшелон), её дополняет правило. Мир не меняется: всё —
//! на копии (`Sim::fork`), в расчёт хода варианты не входят.

use super::decide::{same_line, score};
use super::motives::{current, effective};
use super::options::{Choice, Kind};
use super::options_de::{options_de, options_high};
use super::options_su::options_su;
use super::picture::{divisions_of, picture, Picture};
use super::profile::{Common, Motive, Motives, Profile};
use crate::command::agent::{frame, mid, place, plan, subs_of};
use crate::command::control::Role;
use crate::command::directive::{Directive, Form, Line, Target, Task};
use crate::geo::XY;
use crate::model::{Echelon, OrderKind, Side};
use crate::world::Sim;

/// Сколько подчинённых-штабов, ближайших к противнику, дают общий вариант «перенести главный удар».
const SHIFT_CANDIDATES: usize = 2;
/// Ось задачи на месте (оборона у занятого рубежа): столько км по направлению к противнику.
const AXIS_STUB_KM: f64 = 5.0;
const RULE_CONTINUE: &str = "ПУ-43: командующий добивается выполнения поставленной задачи";
const RULE_HOLD: &str = "ПУ-43: переход к обороне на достигнутом рубеже";
const RULE_SHIFT: &str = "ПУ-43: главный удар переносится на направление, где обозначился успех";
const RULE_FILL: &str = "ПУ-39 ст. 103: второму эшелону и подвижной группе до ввода — только направление";

/// Вариант для игрока: вид, подпись, правило, польза, замысел штаба и директивы всем действующим подчинённым
/// (по порядку `subs_of`); `commit` — получатели, введённые вариантом; `roles` — место получателя в построении.
#[derive(Clone, Debug)]
pub struct Variant {
    pub kind: &'static str,
    pub label: String,
    pub rule: &'static str,
    pub score: f64,
    pub intent: Directive,
    pub orders: Vec<Directive>,
    pub commit: Vec<Target>,
    pub roles: Vec<Role>,
}

/// Вид варианта строкой; ответы на запросы, ожидание подвижной группы и передача сил игроку не предлагаются.
pub fn kind_name(k: &Kind) -> Option<&'static str> {
    Some(match k {
        Kind::Continue => "continue",
        Kind::Hold => "hold",
        Kind::ShiftMainBlow { .. } => "shift_main_blow",
        Kind::TurnToRival { .. } => "turn_to_rival",
        Kind::Encircle { .. } => "encircle",
        Kind::CommitSecond { .. } => "commit_second",
        Kind::CommitMobile { .. } => "commit_mobile",
        Kind::Withdraw { .. } => "withdraw",
        Kind::Counterattack { .. } => "counterattack",
        Kind::Breakout { .. } => "breakout",
        Kind::Relief { .. } => "relief",
        Kind::MoveReserve { .. } => "move_reserve",
        Kind::Assign { .. } => "assign",
        Kind::WaitMobile | Kind::ShiftForces { .. } | Kind::Permit { .. } | Kind::Forbid { .. } => return None,
    })
}

/// Профиль командующего штабом; нет профиля — нейтральный.
pub fn profile_of(sim: &Sim, hq: u32) -> Profile {
    let id = &sim.world.hqs[hq as usize].id;
    let r = &sim.rules.commanders;
    r.for_hq(id).cloned().unwrap_or_else(|| Profile::neutral(id, r.variants.neutral_trait))
}

fn common(c: &Common, kind: Kind, label: String, rule: &'static str) -> Choice {
    let mut m = [0.0; 7];
    m[Motive::Task as usize] = c.task;
    m[Motive::Hold as usize] = c.hold;
    m[Motive::Preserve as usize] = c.preserve;
    Choice { kind, label, contrib: Motives(m), uncertainty: c.uncertainty, losses: c.losses, rule }
}

fn options_with(sim: &Sim, hq: u32, p: &Profile, pic: &Picture) -> Vec<Choice> {
    let h = &sim.world.hqs[hq as usize];
    let own = match (h.side, h.echelon) {
        (Side::Su, _) => options_su(sim, hq, p, pic),
        (Side::De, Echelon::HighCommand) => options_high(sim, hq, p),
        (Side::De, _) => options_de(sim, hq, p, pic),
    };
    let mut v: Vec<Choice> = own.into_iter().filter(|c| kind_name(&c.kind).is_some()).collect();
    let r = &sim.rules.commanders.variants;
    if !v.iter().any(|c| c.kind == Kind::Continue) { v.push(common(&r.cont, Kind::Continue, "Продолжать выполнение задачи".into(), RULE_CONTINUE)); }
    if !v.iter().any(|c| c.kind == Kind::Hold) { v.push(common(&r.hold, Kind::Hold, "Перейти к обороне на занятых рубежах".into(), RULE_HOLD)); }
    // перенос главного удара — на подчинённых-штабов, ближайших к противнику (не на тех, кто уже на нём)
    let (hqs, _) = crate::command::control::active_subs(sim, hq);
    if hqs.len() >= 2 {
        let main = sim.command.intent.get(hq as usize).and_then(Option::as_ref).map(|d| d.main_blow.clone()).unwrap_or_default();
        let mut near: Vec<(u32, f64)> = hqs.iter().map(|&k| (k, crate::command::su::enemy_km_at(sim, place(sim, Target::Hq(k)), h.side))).collect();
        near.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        for (k, _) in near.into_iter().take(SHIFT_CANDIDATES) {
            if main == [k] { continue; }
            let kind = Kind::ShiftMainBlow { to: vec![k] };
            if v.iter().any(|c| c.kind == kind) { continue; }
            v.push(common(&r.shift, kind, format!("Перенести главный удар на {}", sim.world.hqs[k as usize].name), RULE_SHIFT));
        }
    }
    v
}

/// Варианты командующего штабом `hq` по стороне и ступени (профиль штаба, нет — нейтральный) и общие варианты.
pub fn options_for(sim: &Sim, hq: u32) -> Vec<Choice> {
    let pic = picture(sim, hq, &sim.commanders.log);
    options_with(sim, hq, &profile_of(sim, hq), &pic)
}

/// Прямой подчинённый штаба `hq` из `subs`, в поддереве которого штаб `x`; `x` — сам штаб — все подчинённые.
fn targets(sim: &Sim, hq: u32, subs: &[Target], x: u32) -> Vec<Target> {
    if x == hq { return subs.to_vec(); }
    let mut k = x;
    for _ in 0..8 {
        if sim.world.hqs[k as usize].parent == Some(hq) { return subs.iter().copied().filter(|&t| t == Target::Hq(k)).collect(); }
        match sim.world.hqs[k as usize].parent { Some(p) => k = p, None => break }
    }
    Vec::new()
}

/// Направление к ближайшему противнику от точки (нет — на запад, как `frame` без оси).
fn toward_enemy(sim: &Sim, c: XY, side: Side) -> XY {
    let e = sim.world.divisions.iter().filter(|d| d.side != side && !d.state.out()).map(|d| d.vars.pos).min_by(|a, b| a.dist(c).total_cmp(&b.dist(c)));
    match e { Some(e) if e.dist(c) > 1e-6 => XY::new((e.x - c.x) / e.dist(c), (e.y - c.y) / e.dist(c)), _ => XY::new(-1.0, 0.0) }
}

/// Рубеж из мест подчинённых: по фронту, поперёк направления `dir`.
fn line_of(sim: &Sim, subs: &[Target], dir: XY) -> Vec<XY> {
    let mut ps: Vec<XY> = subs.iter().map(|&t| place(sim, t)).collect();
    ps.sort_by(|a, b| (-dir.y * a.x + dir.x * a.y).total_cmp(&(-dir.y * b.x + dir.x * b.y)));
    ps
}

/// Цели наступления подчинённого по нынешним приказам его дивизий: середина целей, если наступает не меньше половины.
fn attack_goal(sim: &Sim, t: Target) -> Option<XY> {
    let ds: Vec<usize> = match t { Target::Division(i) => vec![i as usize], Target::Hq(h) => divisions_of(sim, h) };
    let goals: Vec<XY> = ds.iter().filter_map(|&i| sim.world.divisions[i].order.as_ref()).filter(|o| o.kind == OrderKind::Attack).map(|o| o.target).collect();
    if goals.is_empty() || goals.len() * 2 < ds.len() { return None; }
    mid(&goals)
}

/// Замысел штаба для раздела полосы: действующий; нет — по обстановке: наступает не меньше половины подчинённых —
/// наступление к середине их нынешних целей (рубеж — их цели по фронту), иначе оборона на месте (рубеж — места
/// подчинённых).
fn base_intent(sim: &Sim, hq: u32, subs: &[Target]) -> Directive {
    let h = &sim.world.hqs[hq as usize];
    if let Some(d) = sim.command.intent.get(hq as usize).and_then(Option::as_ref) { return d.clone(); }
    let c = mid(&subs.iter().map(|&t| place(sim, t)).collect::<Vec<_>>()).unwrap_or(h.pos);
    let goals: Vec<XY> = subs.iter().filter_map(|&t| attack_goal(sim, t)).collect();
    let attack = !goals.is_empty() && goals.len() * 2 >= subs.len();
    let (task, axis, line, note) = if attack {
        let g = mid(&goals).unwrap_or(c);
        let dir = if g.dist(c) > 1e-6 { XY::new((g.x - c.x) / g.dist(c), (g.y - c.y) / g.dist(c)) } else { toward_enemy(sim, c, h.side) };
        let mut line = goals.clone();
        line.sort_by(|a, b| (-dir.y * a.x + dir.x * a.y).total_cmp(&(-dir.y * b.x + dir.x * b.y)));
        (Task::Attack, vec![c, g], line, "наступление по нынешним задачам подчинённых")
    } else {
        let dir = toward_enemy(sim, c, h.side);
        (Task::Defend, vec![c, XY::new(c.x + dir.x * AXIS_STUB_KM, c.y + dir.y * AXIS_STUB_KM)], line_of(sim, subs, dir), "оборона на занятых рубежах")
    };
    Directive {
        id: String::new(), from: h.parent.unwrap_or(hq), to: Target::Hq(hq), form: Form::Order, task, axis,
        immediate: Some(Line { pts: line, by: None }), subsequent: None, boundaries: Vec::new(), main_blow: Vec::new(),
        reserve: Vec::new(), junction: None, hasty: false, ready: false, rule: None, issued: 0, note: note.into(),
    }
}

fn to_point(sim: &Sim, o: &mut Directive, task: Task, at: XY) {
    o.task = task;
    o.immediate = Some(Line { pts: vec![at], by: None });
    o.subsequent = None;
    o.axis = vec![place(sim, o.to), at];
}

/// Замысел штаба `hq` с поправкой по виду `k` и директивы каждому действующему подчинённому (по порядку `subs_of`).
pub fn realize(sim: &Sim, hq: u32, k: &Kind) -> (Directive, Vec<Directive>) {
    let pic = picture(sim, hq, &sim.commanders.log);
    let r = realize_with(sim, hq, k, "", &pic);
    (r.intent, r.orders)
}

fn realize_with(sim: &Sim, hq: u32, k: &Kind, label: &str, pic: &Picture) -> Variant {
    let subs = subs_of(sim, hq);
    let side = sim.world.hqs[hq as usize].side;
    let mut intent = base_intent(sim, hq, &subs);
    let name = kind_name(k).unwrap_or("continue");
    intent.id = format!("вариант:{}:{name}", sim.world.hqs[hq as usize].id);
    intent.to = Target::Hq(hq);
    intent.ready = false;
    match k {
        Kind::Hold => {
            let dir = frame(sim, hq, &intent, &subs).dir;
            intent.task = Task::Defend;
            intent.immediate = Some(Line { pts: line_of(sim, &subs, dir), by: None });
            intent.subsequent = None;
        }
        Kind::ShiftMainBlow { to } => intent.main_blow = to.clone(),
        _ => {}
    }
    // раздел полосы — на копии мира (роли эшелонов, ввод подвижной группы)
    let mut f = sim.fork();
    let mut commit = Vec::new();
    match k {
        Kind::CommitSecond { hq: x } => for t in targets(sim, hq, &subs, *x) { f.command.set_role(t, Role::Committed); commit.push(t); },
        Kind::CommitMobile { hq: x } => for t in targets(sim, hq, &subs, *x) { crate::command::su::commit_mobile(&mut f, t, label.to_string()); commit.push(t); },
        _ => {}
    }
    let planned = plan(&mut f, hq, &intent, false);
    let mut orders: Vec<Option<Directive>> = subs.iter().map(|t| planned.iter().find(|d| d.to == *t).cloned()).collect();
    let banded: Vec<bool> = orders.iter().map(|o| o.as_ref().is_some_and(|d| d.boundaries.len() >= 2)).collect();
    // поправка получателя по виду
    let at_sub = |orders: &mut Vec<Option<Directive>>, ts: Vec<Target>, task: Task, at: XY| {
        for t in ts { if let Some(Some(o)) = subs.iter().position(|&s| s == t).map(|i| orders[i].as_mut()) { to_point(sim, o, task, at); } }
    };
    match k {
        Kind::TurnToRival { hq: x, at } | Kind::Counterattack { from: x, at } | Kind::Assign { army: x, at, defend: false, .. } => at_sub(&mut orders, targets(sim, hq, &subs, *x), Task::Attack, *at),
        Kind::Assign { army: x, at, defend: true, .. } => at_sub(&mut orders, targets(sim, hq, &subs, *x), Task::Defend, *at),
        Kind::Relief { by, toward, .. } => at_sub(&mut orders, targets(sim, hq, &subs, *by), Task::Attack, *toward),
        Kind::Encircle { pocket } => if let Some(p) = pic.pockets.get(*pocket) {
            let ts: Vec<Target> = p.by.iter().flat_map(|&a| targets(sim, hq, &subs, a)).collect();
            at_sub(&mut orders, ts, Task::Attack, p.center);
        },
        Kind::Withdraw { hq: x } => for t in targets(sim, hq, &subs, *x) {
            let army = match t { Target::Hq(h) => h, Target::Division(_) => hq };
            if let Some(rear) = super::apply::rear_of(sim, army) { at_sub(&mut orders, vec![t], Task::Withdraw, rear); }
        },
        Kind::MoveReserve { hq: x, to } => at_sub(&mut orders, targets(sim, hq, &subs, *x), Task::Move, *to),
        Kind::Breakout { toward } => at_sub(&mut orders, subs.clone(), Task::Attack, *toward),
        _ => {}
    }
    // недостающим — правило: за центром линии боя по оси (второй эшелон, подвижная группа), иначе оборона на месте
    let fr = frame(sim, hq, &intent, &subs);
    let line_mid = mid(&subs.iter().zip(&banded).filter(|x| *x.1).map(|x| place(sim, *x.0)).collect::<Vec<_>>());
    let behind = sim.rules.command.su.second_echelon_behind_km;
    for (i, &t) in subs.iter().enumerate() {
        if orders[i].is_some() { continue; }
        let p = place(sim, t);
        let role = f.command.role(t);
        let (task, at, note) = match (role, line_mid) {
            (Role::Second | Role::Mobile, Some(c)) => (Task::Move, XY::new(c.x - fr.dir.x * behind, c.y - fr.dir.y * behind), "дополнено правилом: за первым эшелоном по оси"),
            _ => (Task::Defend, p, "дополнено правилом: оборона на занятом рубеже"),
        };
        orders[i] = Some(Directive {
            id: format!("{}>{}:правило", intent.id, crate::command::passing::target_id(sim, t)), from: hq, to: t, form: intent.form, task,
            axis: Vec::new(), immediate: Some(Line { pts: vec![at], by: None }), subsequent: None, boundaries: Vec::new(), main_blow: Vec::new(),
            reserve: Vec::new(), junction: None, hasty: false, ready: false, rule: Some(RULE_FILL.into()), issued: 0, note: note.into(),
        });
    }
    let mut orders: Vec<Directive> = orders.into_iter().map(|o| o.expect("приказ каждому")).collect();
    // ось — две точки: у приказа без своей полосы — от места получателя к цели (цель на месте — к противнику)
    for (i, o) in orders.iter_mut().enumerate() {
        if banded[i] && o.axis.len() >= 2 { o.axis = vec![o.axis[0], *o.axis.last().unwrap()]; continue; }
        let p = place(sim, o.to);
        let goal = o.immediate.as_ref().and_then(|l| mid(&l.pts)).or(o.axis.last().copied()).unwrap_or(p);
        let goal = if goal.dist(p) < 1.0 { let d = toward_enemy(sim, p, side); XY::new(p.x + d.x * AXIS_STUB_KM, p.y + d.y * AXIS_STUB_KM) } else { goal };
        o.axis = vec![p, goal];
    }
    // полоса — у получателя без своей: полоса ближайшего с полосой, нет таких — полоса штаба
    let bands: Vec<(Vec<XY>, Vec<XY>, XY)> = orders.iter().zip(&banded).filter(|x| *x.1).map(|(o, _)| (o.boundaries[0].1.clone(), o.boundaries[1].1.clone(), place(sim, o.to))).collect();
    for (i, o) in orders.iter_mut().enumerate() {
        if banded[i] { continue; }
        let p = place(sim, o.to);
        let (l, r) = bands.iter().min_by(|a, b| a.2.dist(p).total_cmp(&b.2.dist(p))).map(|b| (b.0.clone(), b.1.clone())).unwrap_or((fr.band.left.clone(), fr.band.right.clone()));
        o.boundaries = vec![(None, l), (None, r)];
    }
    if intent.axis.len() < 2 { intent.axis = fr.axis.clone(); }
    let roles = subs.iter().map(|&t| f.command.role(t)).collect();
    Variant { kind: name, label: label.to_string(), rule: "", score: 0.0, intent, orders, commit, roles }
}

/// До `n` (1…3) вариантов штаба `hq` по убыванию пользы, без повторов вида; «продолжать» есть всегда (последним,
/// если не попал в лучшие). Мир не меняется.
pub fn variants(sim: &Sim, hq: u32, n: usize) -> Vec<Variant> {
    let n = n.clamp(1, 3);
    let p = profile_of(sim, hq);
    let pic = picture(sim, hq, &sim.commanders.log);
    let opts = options_with(sim, hq, &p, &pic);
    let r = &sim.rules.commanders;
    // мотивы и черты — действующего командующего (с поправкой на его состояние); нет его — профиля по картине
    let cmd = sim.commanders.list.iter().find(|c| c.hq == hq);
    let motives = cmd.map(|c| c.motives).unwrap_or_else(|| current(&p.motives, &pic, &r.gains));
    let traits = cmd.map(|c| effective(&p.traits, &c.mood, &r.mood)).unwrap_or(p.traits);
    let intent = cmd.and_then(|c| c.intent.as_ref());
    let mut scored: Vec<(Choice, f64)> = opts.into_iter().map(|ch| { let s = score(&ch, &motives, &traits, &r.weights, same_line(&ch.kind, intent)).total; (ch, s) }).collect();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1));
    let mut best: Vec<(Choice, f64)> = Vec::new();
    for x in &scored {
        if best.len() == n { break; }
        if best.iter().any(|b| kind_name(&b.0.kind) == kind_name(&x.0.kind)) { continue; }
        best.push(x.clone());
    }
    if !best.iter().any(|b| b.0.kind == Kind::Continue) {
        if let Some(c) = scored.iter().find(|x| x.0.kind == Kind::Continue) {
            if best.len() == n { best.pop(); }
            best.push(c.clone());
        }
    }
    best.into_iter().map(|(ch, s)| {
        let mut v = realize_with(sim, hq, &ch.kind, &ch.label, &pic);
        v.rule = ch.rule;
        v.score = s;
        v
    }).collect()
}
