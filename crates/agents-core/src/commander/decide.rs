//! Цикл решений командующего: раз в час — ведомость расстояний, картина обстановки, шаг состояния и мотивы по
//! картине; раз в цикл своей ступени или сразу по резкой перемене обстановки — варианты, их польза по мотивам и
//! характеру, выбор и разбор. Исполнение выбранного — `apply.rs`.
//!
//! Польза варианта: `Σ мотив·вклад` (у мотивов «опередить соперника» и «разгромить противника» вес × (0,5 +
//! честолюбие)) − (1 − риск)·w·неопределённость − (1 − терпимость к потерям)·w·потери + настойчивость·w за
//! продолжение прежнего решения + послушание·w·вклад в задачу старшего. Черты — с поправкой на состояние.
//!
//! Перемены обстановки, по которым командующий решает вне цикла: армия впервые прорвала оборону; открылся новый
//! фланг; появился котёл противника; отрезаны свои дивизии (их стало больше); пришла новая директива старшего;
//! у верхней инстанции — запрос на отход дождался срока ответа (`permissionHours`, как прежний ответ «держать»);
//! на все дождавшиеся запросы она отвечает в том же часе, каждый ответ — отдельным решением.

use super::motives::{current, effective, mood_step, Mood};
use super::options::{Choice, Kind};
use super::options_de::{options_de, options_high};
use super::options_su::options_su;
use super::picture::{divisions_of, picture, DistLog, Picture};
use super::profile::{Motive, Motives, Trait, Traits, Weights};
use super::MindResult;
use crate::command::control::Control;
use crate::model::{Echelon, Side};
use crate::staff::side_idx;
use crate::world::Sim;

/// Снимок состояния командующего — раз в столько часов (и на каждом решении).
const SNAPSHOT_HOURS: u32 = 6;
/// Разница пользы, меньше которой варианты равны (ничья — продолжение прежнего).
const TIE: f64 = 1e-9;
/// Рубеж ближайшей задачи старшего достигнут, если своя дивизия ближе к его середине, км.
const LINE_REACHED_KM: f64 = 10.0;
/// Наименьший срок задачи старшего для отсчёта отставания, ч (короткий срок не делает отставание резким).
const BEHIND_MIN_H: f64 = 24.0;
/// Начало текста документа решения командующего: по нему документы командующего отличаются от документов штаба.
pub const DOC_PREFIX: &str = "Решение командующего";

/// Что командующий уже видел: директива старшего, число отрезанных своих дивизий, запросы на отход.
#[derive(Clone, Debug, Default)]
pub struct Seen {
    pub intent: Option<(String, u32)>,
    pub cut: usize,
    /// Запросы, дождавшиеся срока ответа: (штаб, дивизия, час).
    pub requests: Vec<(u32, u32, u32)>,
}

/// Запрос на отход (или прорыв), поднятый командующим за дивизию: исполняется только по разрешению верхней инстанции.
#[derive(Clone, Debug)]
pub struct Raised { pub hq: u32, pub division: u32, pub tick: u32, pub task: crate::command::directive::Task, pub at: crate::geo::XY }

#[derive(Clone, Debug)]
pub struct Snapshot {
    pub tick: u32,
    pub motives: Motives,
    pub mood: Mood,
    pub picture: Picture,
    /// Действующее решение (подпись варианта).
    pub intent: Option<String>,
}

/// Вариант с оценкой: слагаемые по мотивам (мотив × вклад), штраф (неопределённость и потери), прибавка
/// (продолжение и послушание), итог, результат проигрыша «в уме» (если был).
#[derive(Clone, Debug)]
pub struct Scored {
    pub choice: Choice,
    pub parts: Motives,
    pub penalty: f64,
    pub bonus: f64,
    pub total: f64,
    pub mind: Option<MindResult>,
}

/// Решение: когда, по какому поводу, все варианты с оценками, выбранный и обоснование.
#[derive(Clone, Debug)]
pub struct Decision {
    pub tick: u32,
    pub trigger: String,
    pub options: Vec<Scored>,
    pub chosen: usize,
    pub why: String,
}

#[derive(Clone, Debug)]
pub struct Commander {
    pub hq: u32,
    /// Номер профиля в `rules.commanders.profiles`.
    pub profile: usize,
    /// Мотивы по последней картине.
    pub motives: Motives,
    pub mood: Mood,
    /// Действующее решение.
    pub intent: Option<Kind>,
    /// Подпись действующего решения.
    pub intent_label: Option<String>,
    /// Час последнего решения (или включения).
    pub last: u32,
    pub snapshots: Vec<Snapshot>,
    pub decisions: Vec<Decision>,
    /// Картина последнего часа: в этом часе — текущая; в следующем — прежняя для шага состояния (ровно на час старше).
    pub picture: Option<Picture>,
    pub seen: Seen,
    /// Рубеж отхода армии, пока действующее решение — её отход (не пересчитывается на каждом решении).
    pub withdraw_at: Vec<(u32, crate::geo::XY)>,
}

/// Командующие прогона: по сторонам включены ли, список, ведомость расстояний до объектов.
#[derive(Clone, Debug, Default)]
pub struct State {
    pub enabled: [bool; 2],
    pub list: Vec<Commander>,
    pub log: DistLog,
    /// Запросы, поднятые командующими, ждущие ответа или исполнения.
    pub raised: Vec<Raised>,
}

/// Включить командующих стороны: на каждый её штаб, у которого есть профиль; штаб без профиля решает по правилам штаба.
pub fn enable(sim: &mut Sim, side: Side) {
    let i = side_idx(side);
    if sim.commanders.enabled[i] { return; }
    sim.commanders.enabled[i] = true;
    let start = sim.rules.commanders.mood.start;
    let tick = sim.world.tick;
    for (h, x) in sim.world.hqs.iter().enumerate() {
        if x.side != side { continue; }
        let Some(profile) = sim.rules.commanders.profiles.iter().position(|p| p.hqs.contains(&x.id)) else { continue };
        sim.commanders.list.push(Commander {
            hq: h as u32, profile, motives: sim.rules.commanders.profiles[profile].motives, mood: start, intent: None, intent_label: None,
            last: tick, snapshots: Vec::new(), decisions: Vec::new(), picture: None, seen: Seen::default(), withdraw_at: Vec::new(),
        });
    }
}

/// У штаба действующий командующий: сторона включена, профиль есть, штаб ведёт агент (не игрок). Тогда штаб не
/// вводит подвижные группы сам, а верхняя инстанция отвечает на запросы своим решением, а не прежним «держать».
pub fn active(sim: &Sim, hq: u32) -> bool {
    sim.command.control.get(hq as usize) == Some(&Control::Agent)
        && sim.commanders.enabled[side_idx(sim.world.hqs[hq as usize].side)]
        && sim.commanders.list.iter().any(|c| c.hq == hq)
}

/// Польза варианта (см. начало модуля). `t` — черты с поправкой на состояние; `continuing` — вариант повторяет
/// действующее решение.
pub fn score(c: &Choice, m: &Motives, t: &Traits, w: &Weights, continuing: bool) -> Scored {
    let amb = 0.5 + t.get(Trait::Ambition);
    let mut parts = [0.0; 7];
    for (i, p) in parts.iter_mut().enumerate() {
        let k = if i == Motive::Rival as usize || i == Motive::Destroy as usize { amb } else { 1.0 };
        *p = m.0[i] * k * c.contrib.0[i];
    }
    let penalty = (1.0 - t.get(Trait::Risk)) * w.uncertainty * c.uncertainty + (1.0 - t.get(Trait::LossTolerance)) * w.losses * c.losses;
    let bonus = if continuing { t.get(Trait::Persistence) * w.persistence } else { 0.0 } + t.get(Trait::Obedience) * w.obedience * c.contrib.get(Motive::Task);
    let total = parts.iter().sum::<f64>() - penalty + bonus;
    Scored { choice: c.clone(), parts: Motives(parts), penalty, bonus, total, mind: None }
}

/// Вариант продолжает действующее решение: тот же вариант; ответ на запрос — тот же ответ (номер запроса не важен:
/// запросы разные, линия та же); «продолжать по плану» — продолжение любого действующего решения.
pub fn same_line(a: &Kind, intent: Option<&Kind>) -> bool {
    match (a, intent) {
        (_, None) => false,
        (Kind::Continue, Some(_)) => true,
        (Kind::Permit { .. }, Some(Kind::Permit { .. })) | (Kind::Forbid { .. }, Some(Kind::Forbid { .. })) => true,
        (a, Some(b)) => a == b,
    }
}

/// Выбор: наибольшая польза; ничья — продолжение действующего решения, затем «продолжать» / «держаться», затем первый.
pub fn pick(v: &[Scored], intent: Option<&Kind>) -> usize {
    let top = v.iter().map(|s| s.total).fold(f64::NEG_INFINITY, f64::max);
    let tied: Vec<usize> = (0..v.len()).filter(|&i| v[i].total >= top - TIE).collect();
    tied.iter().copied().find(|&i| same_line(&v[i].choice.kind, intent))
        .or_else(|| tied.iter().copied().find(|&i| matches!(v[i].choice.kind, Kind::Continue | Kind::Hold)))
        .unwrap_or(tied[0])
}

const MOTIVE_NAMES: [&str; 7] = ["задача старшего", "опередить соперника", "сохранить армии", "не допустить окружения", "разгромить противника", "удержать рубеж", "спасти армию"];

fn num(x: f64) -> String { format!("{x:+.2}").replace('.', ",") }

/// Обоснование словами: два крупнейших по величине слагаемых выбранного варианта и перевес над следующим.
pub fn why(v: &[Scored], chosen: usize) -> String {
    let s = &v[chosen];
    let mut terms: Vec<(&str, f64)> = MOTIVE_NAMES.iter().zip(s.parts.0).map(|(n, x)| (*n, x)).collect();
    terms.push(("неопределённость и потери", -s.penalty));
    terms.push(("настойчивость и послушание", s.bonus));
    terms.retain(|t| t.1.abs() > TIE);
    terms.sort_by(|a, b| b.1.abs().total_cmp(&a.1.abs()));
    let main: Vec<String> = terms.iter().take(2).map(|(n, x)| format!("{n} {}", num(*x))).collect();
    let mut out = format!("«{}»: польза {}", s.choice.label, num(s.total));
    if !main.is_empty() { out += &format!("; главное — {}", main.join(", ")); }
    let runner = (0..v.len()).filter(|&i| i != chosen).max_by(|&a, &b| v[a].total.total_cmp(&v[b].total));
    match runner {
        Some(r) => out += &format!("; перевес над «{}» — {}", v[r].choice.label, format!("{:.2}", s.total - v[r].total).replace('.', ",")),
        None => out += "; другого варианта не было",
    }
    out
}

/// Цикл решения ступени, ч.
fn cycle_hours(sim: &Sim, hq: u32) -> u32 {
    let c = &sim.rules.commanders.cycle;
    match sim.world.hqs[hq as usize].echelon { Echelon::HighCommand => c.high, Echelon::Front => c.front, Echelon::Army | Echelon::Corps => c.army }.max(1)
}

/// Отставание от срока ближайшей задачи старшего: доля срока, прошедшая после него, пока рубеж не достигнут (0…1);
/// срок задачи — от отдачи директивы до часа рубежа, не меньше `BEHIND_MIN_H`. Нет срока — 0.
fn task_behind(sim: &Sim, hq: u32, tick: u32) -> f64 {
    let Some(d) = sim.command.intent.get(hq as usize).and_then(Option::as_ref) else { return 0.0 };
    let Some(line) = d.immediate.as_ref() else { return 0.0 };
    let (Some(by), Some(mid)) = (line.by, crate::command::agent::mid(&line.pts)) else { return 0.0 };
    if tick <= by { return 0.0; }
    let reached = divisions_of(sim, hq).into_iter().any(|i| sim.world.divisions[i].vars.pos.dist(mid) <= LINE_REACHED_KM);
    if reached { return 0.0; }
    let span = (by.saturating_sub(d.issued) as f64).max(BEHIND_MIN_H);
    ((tick - by) as f64 / span).min(1.0)
}

/// Перемены обстановки с прошлого часа (повод решить вне цикла); заодно обновляет увиденное.
fn trigger(sim: &Sim, c: &mut Commander, pic: &Picture, tick: u32) -> Option<String> {
    let name = |h: u32| sim.world.hqs[h as usize].name.clone();
    let mut why: Vec<String> = Vec::new();
    if let Some(prev) = &c.picture {
        for a in pic.armies.iter().filter(|a| a.broke_through) {
            if !prev.armies.iter().any(|b| b.hq == a.hq && b.broke_through) { why.push(format!("{} прорвала оборону", name(a.hq))); }
        }
        for &f in &pic.open_flanks { if !prev.open_flanks.contains(&f) { why.push(format!("открыт фланг: {}", name(f))); } }
        if pic.pockets.len() > prev.pockets.len() { why.push("новый котёл противника".into()); }
    }
    let cut = divisions_of(sim, c.hq).into_iter().filter(|&i| sim.world.divisions[i].cut_since.is_some()).count();
    if cut > c.seen.cut { why.push(format!("отрезаны свои дивизии: {cut}")); }
    c.seen.cut = cut;
    if let Some(d) = sim.command.intent.get(c.hq as usize).and_then(Option::as_ref).filter(|d| d.from != c.hq) {
        let key = (d.id.clone(), d.issued);
        if c.seen.intent.as_ref() != Some(&key) {
            why.push(format!("новая директива старшего ({})", name(d.from)));
            c.seen.intent = Some(key);
        }
    }
    if sim.world.hqs[c.hq as usize].echelon == Echelon::HighCommand {
        // повод — только запрос, впервые дождавшийся срока ответа (а не каждый час, пока он ждёт)
        let wait = sim.rules.command.de.permission_hours as u32;
        let side = sim.world.hqs[c.hq as usize].side;
        let mut fresh = 0;
        for r in sim.command.requests.iter().filter(|r| r.answer.is_none() && tick >= r.tick + wait && sim.world.hqs[r.hq as usize].side == side) {
            let key = (r.hq, r.division, r.tick);
            if !c.seen.requests.contains(&key) { fresh += 1; c.seen.requests.push(key); }
        }
        c.seen.requests.retain(|k| sim.command.requests.iter().any(|r| (r.hq, r.division, r.tick) == *k));
        if fresh > 0 { why.push(format!("запросы на отход дождались ответа: {fresh}")); }
    }
    if why.is_empty() { None } else { Some(why.join("; ")) }
}

/// Решение командующего: варианты, оценка, выбор, разбор, исполнение.
fn decide(sim: &mut Sim, c: &mut Commander, tick: u32, trigger: String) {
    c.last = tick;
    let p = sim.rules.commanders.profiles[c.profile].clone();
    let Some(pic) = c.picture.as_ref() else { return };
    let opts = match (sim.world.hqs[c.hq as usize].side, sim.world.hqs[c.hq as usize].echelon) {
        (Side::Su, _) => options_su(sim, c.hq, &p, pic),
        (Side::De, Echelon::HighCommand) => options_high(sim, c.hq, &p),
        (Side::De, _) => options_de(sim, c.hq, &p, pic),
    };
    if opts.is_empty() { return; }
    let t = effective(&p.traits, &c.mood, &sim.rules.commanders.mood);
    let w = &sim.rules.commanders.weights;
    let mut options: Vec<Scored> = opts.iter().map(|ch| score(ch, &c.motives, &t, w, same_line(&ch.kind, c.intent.as_ref()))).collect();
    // «в уме»: лучшие варианты проигрываются на копии мира, польза пересчитывается
    let ahead = sim.rules.commanders.lookahead_hours;
    if ahead > 0 { super::mind::look(sim, c, pic, &mut options, &t, w, ahead, |k| same_line(k, c.intent.as_ref())); }
    let chosen = pick(&options, c.intent.as_ref());
    let why = why(&options, chosen);
    let kind = options[chosen].choice.kind.clone();
    // рубеж отхода держится, пока решение — отход той же армии
    match &kind {
        Kind::Withdraw { hq } if c.intent.as_ref() == Some(&kind) && c.withdraw_at.iter().any(|x| x.0 == *hq) => {}
        Kind::Withdraw { hq } => { c.withdraw_at.clear(); if let Some(at) = super::apply::rear_of(sim, *hq) { c.withdraw_at.push((*hq, at)); } }
        _ => c.withdraw_at.clear(),
    }
    c.intent = Some(kind.clone());
    c.intent_label = Some(options[chosen].choice.label.clone());
    c.decisions.push(Decision { tick, trigger, options, chosen, why });
    super::apply::apply(sim, c, &kind, tick);
}

/// Час командующего: состояние и мотивы по картине, решение по циклу или по перемене обстановки, снимок.
fn hour(sim: &mut Sim, c: &mut Commander, tick: u32) {
    if !sim.commanders.enabled[side_idx(sim.world.hqs[c.hq as usize].side)] { return; }
    let pic = picture(sim, c.hq, &sim.commanders.log);
    let behind = task_behind(sim, c.hq, tick);
    // наступающий меряет успех продвижением, обороняющийся — удержанной землёй
    let attacking = sim.world.hqs[c.hq as usize].side == Side::Su || matches!(c.intent, Some(Kind::Counterattack { .. }));
    c.mood = mood_step(&c.mood, &pic, c.picture.as_ref(), behind, attacking, &sim.rules.commanders.mood);
    c.motives = current(&sim.rules.commanders.profiles[c.profile].motives, &pic, &sim.rules.commanders.gains);
    let trig = trigger(sim, c, &pic, tick);
    c.picture = Some(pic);
    // игрок или приказы сценария на месте штаба — командующий не решает
    let agent = sim.command.control.get(c.hq as usize) == Some(&Control::Agent);
    let cycle = cycle_hours(sim, c.hq);
    let before = c.decisions.len();
    if agent && (trig.is_some() || tick >= c.last + cycle) {
        decide(sim, c, tick, trig.unwrap_or_else(|| format!("цикл решения {cycle} ч")));
        // верхняя инстанция отвечает на все ждущие запросы в этот же час — каждый ответ отдельным решением
        let side = sim.world.hqs[c.hq as usize].side;
        let wait = sim.rules.command.de.permission_hours as u32;
        let waiting = |sim: &Sim| sim.command.requests.iter().filter(|r| r.answer.is_none() && tick >= r.tick + wait && sim.world.hqs[r.hq as usize].side == side).count();
        let mut left = waiting(sim);
        while left > 0 && c.decisions.len() > before && matches!(c.intent, Some(Kind::Permit { .. } | Kind::Forbid { .. })) {
            decide(sim, c, tick, format!("ещё запросы на отход: {left}"));
            let now = waiting(sim);
            if now >= left { break; }
            left = now;
        }
    }
    if c.decisions.len() > before || tick.is_multiple_of(SNAPSHOT_HOURS) {
        let picture = c.picture.clone().expect("картина часа");
        c.snapshots.push(Snapshot { tick, motives: c.motives, mood: c.mood, picture, intent: c.intent_label.clone() });
    }
}

/// Командующие в фазе командования шага (до решений штабов): раз в час каждому; выключены — ничего.
pub fn cycle(sim: &mut Sim, tick: u32) {
    if !sim.commanders.enabled.iter().any(|&e| e) { return; }
    let mut log = std::mem::take(&mut sim.commanders.log);
    log.record(sim);
    sim.commanders.log = log;
    let mut list = std::mem::take(&mut sim.commanders.list);
    for c in list.iter_mut() { hour(sim, c, tick); }
    sim.commanders.list = list;
    super::apply::execute_permitted(sim, tick);
}
