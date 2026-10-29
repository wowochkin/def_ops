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
//! на все дождавшиеся запросы она отвечает в том же часе, каждый ответ — отдельным решением, и лишь потом решает
//! прочее (резерв, деблокирование). Повторное решение с той же целью директив заново не отдаёт.

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
/// Котёл (или цель резерва, деблокирования, контратаки) тот же, что в прежнем решении, если его центр сместился не
/// больше чем на столько, км (допущение: двойное удаление соприкосновения, по которому связываются котлы).
const SAME_TARGET_KM: f64 = 20.0;
/// Армия, потерявшая прорыв не меньше чем на столько часов, снова даёт повод «прорвала оборону».
const BROKE_LOST_H: u32 = 12;
/// Повод «запросы дождались срока ответа».
const REQUESTS_DUE: &str = "запросы на отход дождались ответа";
/// Начало текста документа решения командующего: по нему документы командующего отличаются от документов штаба.
pub const DOC_PREFIX: &str = "Решение командующего";

/// Что командующий уже видел: директива старшего, число отрезанных своих дивизий, запросы на отход.
#[derive(Clone, Debug, Default)]
pub struct Seen {
    pub intent: Option<(String, u32)>,
    pub cut: usize,
    /// Запросы, дождавшиеся срока ответа: (штаб, дивизия, час).
    pub requests: Vec<(u32, u32, u32)>,
    /// Армии, прорвавшие оборону: (штаб, последний час с прорывом) — повод «прорвала оборону» один раз на армию.
    pub broke: Vec<(u32, u32)>,
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
    /// Центр котла, который замыкает действующее решение «замкнуть кольцо» (котёл опознаётся по месту, не по номеру).
    pub encircle_at: Option<crate::geo::XY>,
}

/// Командующие прогона: по сторонам включены ли, список, ведомость расстояний до объектов.
#[derive(Clone, Debug, Default)]
pub struct State {
    pub enabled: [bool; 2],
    pub list: Vec<Commander>,
    pub log: DistLog,
    /// Запросы, поднятые командующими, ждущие ответа или исполнения.
    pub raised: Vec<Raised>,
    /// Сколько раз строился базовый проигрыш «в уме» (на командующего в час; для проверки).
    pub baselines: u32,
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
            last: tick, snapshots: Vec::new(), decisions: Vec::new(), picture: None, seen: Seen::default(), withdraw_at: Vec::new(), encircle_at: None,
        });
    }
}

/// У штаба действующий командующий: сторона включена, профиль есть, штаб ведёт агент (не игрок). Тогда штаб не
/// вводит подвижные группы сам, а верхняя инстанция отвечает на запросы своим решением, а не прежним «держать».
///
/// В «истории как замысле» советский фронт идёт по приказам сценария, а его командующий решает только за армии вне
/// истории (`for_strayed`).
pub fn active(sim: &Sim, hq: u32) -> bool {
    (sim.command.control.get(hq as usize) == Some(&Control::Agent) || for_strayed(sim, hq))
        && sim.commanders.enabled[side_idx(sim.world.hqs[hq as usize].side)]
        && sim.commanders.list.iter().any(|c| c.hq == hq)
}

/// Командующий советского фронта по приказам сценария при включённом `intent` стороны: решает за подчинённые армии
/// вне истории (варианты — только для них; таких нет — решения нет).
pub fn for_strayed(sim: &Sim, hq: u32) -> bool {
    let h = &sim.world.hqs[hq as usize];
    h.side == Side::Su && h.echelon == Echelon::Front && sim.intent.enabled[side_idx(h.side)]
        && sim.command.control.get(hq as usize) == Some(&Control::Script)
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

/// Вариант продолжает действующее решение командующего `c` по картине `pic`: как `same_line`, но котёл «замкнуть
/// кольцо» опознаётся по месту (ближайший к прежнему центру в пределах `SAME_TARGET_KM`), а не по номеру в картине.
pub fn continues(c: &Commander, pic: &Picture, k: &Kind) -> bool {
    same_line(k, c.intent.as_ref()) || same_target(c, pic, k)
}

/// Тот же вид решения, что действующее, и та же цель: котёл — по месту; контратака, резерв, деблокирование — тот же
/// исполнитель и точка в пределах `SAME_TARGET_KM` (центр выручаемой армии и вклинение смещаются от часа к часу).
fn same_target(c: &Commander, pic: &Picture, k: &Kind) -> bool {
    let near = |a: crate::geo::XY, b: crate::geo::XY| a.dist(b) <= SAME_TARGET_KM;
    match (k, c.intent.as_ref()) {
        (Kind::Encircle { pocket }, Some(Kind::Encircle { .. })) => same_pocket(c, pic, *pocket),
        (Kind::Counterattack { from, at }, Some(Kind::Counterattack { from: f0, at: a0 })) => from == f0 && near(*at, *a0),
        (Kind::MoveReserve { hq, to }, Some(Kind::MoveReserve { hq: h0, to: t0 })) => hq == h0 && near(*to, *t0),
        (Kind::Relief { army, by, toward }, Some(Kind::Relief { army: a0, by: b0, toward: t0 })) => army == a0 && by == b0 && near(*toward, *t0),
        _ => false,
    }
}

fn same_pocket(c: &Commander, pic: &Picture, pocket: usize) -> bool {
    match (c.encircle_at, pic.pockets.get(pocket)) { (Some(at), Some(p)) => at.dist(p.center) <= SAME_TARGET_KM, _ => false }
}

/// Решение повторяет действующее с той же целью: директивы заново не отдаются. Запросы (отход, прорыв из кольца)
/// поднимаются заново — за дивизии, за которые их ещё нет; ответы на запросы — каждый свой.
fn repeats(c: &Commander, pic: &Picture, k: &Kind) -> bool {
    match (k, c.intent.as_ref()) {
        (_, None) => false,
        (Kind::Withdraw { .. } | Kind::Breakout { .. } | Kind::Permit { .. } | Kind::Forbid { .. }, _) => false,
        (Kind::Encircle { .. } | Kind::Counterattack { .. } | Kind::MoveReserve { .. } | Kind::Relief { .. }, _) => same_target(c, pic, k),
        (k, Some(i)) => k == i,
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

/// Перемены обстановки с прошлого часа (повод решить вне цикла); заодно обновляет увиденное. Прорыв армии — повод
/// один раз, снова — только после потери прорыва не меньше чем на `BROKE_LOST_H` ч.
pub fn trigger(sim: &Sim, c: &mut Commander, pic: &Picture, tick: u32) -> Option<String> {
    let name = |h: u32| sim.world.hqs[h as usize].name.clone();
    let mut why: Vec<String> = Vec::new();
    if let Some(prev) = &c.picture {
        for a in pic.armies.iter().filter(|a| a.broke_through) {
            let fresh = match c.seen.broke.iter_mut().find(|x| x.0 == a.hq) {
                Some(x) => { let lost = tick.saturating_sub(x.1) > BROKE_LOST_H; x.1 = tick; lost }
                None => { c.seen.broke.push((a.hq, tick)); true }
            };
            if fresh && !prev.armies.iter().any(|b| b.hq == a.hq && b.broke_through) { why.push(format!("{} прорвала оборону", name(a.hq))); }
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
        if fresh > 0 { why.push(format!("{REQUESTS_DUE}: {fresh}")); }
    }
    if why.is_empty() { None } else { Some(why.join("; ")) }
}

/// Решение командующего: варианты, оценка, выбор, разбор, исполнение.
/// Решение командующего; `answers` — только ответы на запросы (`Some(true)`), только прочее (`Some(false)`), всё (`None`).
fn decide(sim: &mut Sim, c: &mut Commander, tick: u32, trigger: String, hourly: &mut super::mind::Hourly, answers: Option<bool>) {
    c.last = tick;
    let p = sim.rules.commanders.profiles[c.profile].clone();
    let Some(pic) = c.picture.as_ref() else { return };
    let opts = match (sim.world.hqs[c.hq as usize].side, sim.world.hqs[c.hq as usize].echelon) {
        (Side::Su, _) => options_su(sim, c.hq, &p, pic),
        (Side::De, Echelon::HighCommand) => options_high(sim, c.hq, &p),
        (Side::De, _) => options_de(sim, c.hq, &p, pic),
    };
    let answer = |k: &Kind| matches!(k, Kind::Permit { .. } | Kind::Forbid { .. });
    let opts: Vec<Choice> = opts.into_iter().filter(|ch| answers.is_none_or(|a| answer(&ch.kind) == a)).collect();
    if opts.is_empty() { return; }
    let t = effective(&p.traits, &c.mood, &sim.rules.commanders.mood);
    let w = &sim.rules.commanders.weights;
    let mut options: Vec<Scored> = opts.iter().map(|ch| score(ch, &c.motives, &t, w, continues(c, pic, &ch.kind))).collect();
    // «в уме»: лучшие варианты проигрываются на копии мира, польза пересчитывается
    let ahead = sim.rules.commanders.lookahead_hours;
    if ahead > 0 { super::mind::look(sim, c, pic, &mut options, &t, w, ahead, hourly, |k| continues(c, pic, k)); }
    let chosen = pick_for(&options, |k| continues(c, pic, k));
    adopt(sim, c, options, chosen, tick, trigger);
}

/// `pick` с проверкой продолжения по картине (`continues`).
fn pick_for(v: &[Scored], cont: impl Fn(&Kind) -> bool) -> usize {
    let top = v.iter().map(|s| s.total).fold(f64::NEG_INFINITY, f64::max);
    let tied: Vec<usize> = (0..v.len()).filter(|&i| v[i].total >= top - TIE).collect();
    tied.iter().copied().find(|&i| cont(&v[i].choice.kind))
        .or_else(|| tied.iter().copied().find(|&i| matches!(v[i].choice.kind, Kind::Continue | Kind::Hold)))
        .unwrap_or(tied[0])
}

/// Принять выбранный вариант: замысел, разбор, исполнение. «Продолжать по плану» действующий замысел не сбрасывает;
/// повтор действующего решения с той же целью директив заново не отдаёт — пишется только документ решения.
pub fn adopt(sim: &mut Sim, c: &mut Commander, options: Vec<Scored>, chosen: usize, tick: u32, trigger: String) {
    c.last = tick;
    let why = why(&options, chosen);
    let kind = options[chosen].choice.kind.clone();
    let repeat = c.picture.as_ref().is_some_and(|pic| repeats(c, pic, &kind));
    // рубеж отхода держится, пока решение — отход той же армии
    match &kind {
        Kind::Withdraw { hq } if c.intent.as_ref() == Some(&kind) && c.withdraw_at.iter().any(|x| x.0 == *hq) => {}
        Kind::Withdraw { hq } => { c.withdraw_at.clear(); if let Some(at) = super::apply::rear_of(sim, *hq) { c.withdraw_at.push((*hq, at)); } }
        Kind::Continue => {}
        _ => c.withdraw_at.clear(),
    }
    if let Kind::Encircle { pocket } = &kind { c.encircle_at = c.picture.as_ref().and_then(|p| p.pockets.get(*pocket)).map(|p| p.center); }
    let keep = matches!(kind, Kind::Continue) && c.intent.is_some();
    if !keep {
        if !matches!(kind, Kind::Encircle { .. }) { c.encircle_at = None; }
        c.intent = Some(kind.clone());
        c.intent_label = Some(options[chosen].choice.label.clone());
    }
    c.decisions.push(Decision { tick, trigger, options, chosen, why });
    if repeat { super::apply::record(sim, c, tick, Vec::new()); } else { super::apply::apply(sim, c, &kind, tick); }
}

/// Час командующего: состояние и мотивы по картине, решение по циклу или по перемене обстановки, снимок.
fn hour(sim: &mut Sim, c: &mut Commander, tick: u32, hourly: &mut super::mind::Hourly) {
    if !sim.commanders.enabled[side_idx(sim.world.hqs[c.hq as usize].side)] { return; }
    let pic = picture(sim, c.hq, &sim.commanders.log);
    let behind = task_behind(sim, c.hq, tick);
    // наступающий меряет успех продвижением, обороняющийся — удержанной землёй
    let attacking = sim.world.hqs[c.hq as usize].side == Side::Su || matches!(c.intent, Some(Kind::Counterattack { .. }));
    c.mood = mood_step(&c.mood, &pic, c.picture.as_ref(), behind, attacking, &sim.rules.commanders.mood);
    c.motives = current(&sim.rules.commanders.profiles[c.profile].motives, &pic, &sim.rules.commanders.gains);
    let trig = trigger(sim, c, &pic, tick);
    c.picture = Some(pic);
    // игрок или приказы сценария на месте штаба — командующий не решает (кроме армий вне истории в `intent`)
    let agent = sim.command.control.get(c.hq as usize) == Some(&Control::Agent) || for_strayed(sim, c.hq);
    let cycle = cycle_hours(sim, c.hq);
    let before = c.decisions.len();
    if agent && (trig.is_some() || tick >= c.last + cycle) {
        let reason = trig.clone().unwrap_or_else(|| format!("цикл решения {cycle} ч"));
        if sim.world.hqs[c.hq as usize].echelon == Echelon::HighCommand {
            // верхняя инстанция сначала отвечает на все ждущие запросы — каждый ответ отдельным решением, потом прочее
            let due = tick >= c.last + cycle;
            let side = sim.world.hqs[c.hq as usize].side;
            let wait = sim.rules.command.de.permission_hours as u32;
            let waiting = |sim: &Sim| sim.command.requests.iter().filter(|r| r.answer.is_none() && tick >= r.tick + wait && sim.world.hqs[r.hq as usize].side == side).count();
            let mut left = waiting(sim);
            let mut answered = 0;
            while left > 0 {
                decide(sim, c, tick, if answered == 0 { reason.clone() } else { format!("ещё запросы на отход: {left}") }, hourly, Some(true));
                answered += 1;
                let now = waiting(sim);
                if now >= left { break; }
                left = now;
            }
            // прочее — по циклу, по иной перемене обстановки, чем запросы, или когда отвечать было не на что
            let other = trig.as_deref().is_some_and(|t| t.split("; ").any(|p| !p.starts_with(REQUESTS_DUE)));
            if answered == 0 || due || other { decide(sim, c, tick, reason, hourly, Some(false)); }
        } else {
            decide(sim, c, tick, reason, hourly, None);
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
    let mut hourly = super::mind::Hourly::default();
    for c in list.iter_mut() { hour(sim, c, tick, &mut hourly); }
    sim.commanders.baselines += hourly.count;
    sim.commanders.list = list;
    super::apply::execute_permitted(sim, tick);
}
