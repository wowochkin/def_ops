//! Подача цепочек, уход с истории и возврат (спецификация, разделы 1.3–1.6 и 2.4–2.6).
//!
//! Правила приспособления действуют только там, где армия разошлась с историей; судья — след эталона. Армия у следа
//! (не дальше `intent.returnKm`) или без следа идёт как чистая история: все задачи в свой час. Отошла от следа (дальше `returnKm`, не дальше `leaveKm`) — «со сдвигом»: задача подаётся по
//! наступившему первым (свой час или выполнение предыдущей поданной); без смысла в свой час пропускается, и сразу
//! берётся следующая, если у неё смысл есть уже сейчас (история «догоняет» армию), нет — она ждёт своего часа.
//! Задача неспособной армии не пропускается, а ждёт её восстановления. Пропущена последняя задача или задачи кончились у
//! армии, отошедшей от следа, — цепочка кончилась (армия «сама», решает командующий). Армия дальше `intent.leaveKm` от следа эталона на этот час уходит с истории, ближе `intent.returnKm` при
//! задаче со смыслом на этот час — возвращается. Штаб игрока со всеми подчинёнными — всегда «сам».
//!
//! Подача: советская директива — `passing::issue` (с осью от места получателя, как в «фронтах по истории»), если
//! получателя ведёт штаб-агент; директива штабу по приказам сценария (Ставка — фронтам, немецкая верхняя инстанция)
//! только отмечается: её исполняют приказы сценария. Немецкий приказ сценария в свой час проходит через `admit` в шаге 0
//! мира; поданный раньше часа (по выполнению) — через очередь `queue` в том же шаге. Отвод сценария применяется к
//! дивизиям армии, у которой задача отвода подана.

use super::chain::{army_of, build, Step};
use super::sense::{done, live, reason_text, sense, Reason};
use super::track::Track;
use crate::command::agent::mid;
use crate::command::control::Control;
use crate::model::Side;
use crate::staff::side_idx;
use super::chain::Chain;
use crate::world::{Event, ScriptOrder, ScriptWithdraw, Sim};
use serde_json::{json, Value};

/// Состояние штаба: по истории; по истории со сдвигом (задача подана раньше часа или пропущены задачи); сам.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Status { History, Shifted, Own }

impl Status {
    pub fn label(self) -> &'static str { match self { Status::History => "history", Status::Shifted => "shifted", Status::Own => "own" } }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HqState { pub status: Status, pub reason: Option<Reason>, pub since: u32 }

#[derive(Clone, Debug, Default)]
pub struct State {
    /// Режим включён: [советская сторона, немецкая].
    pub enabled: [bool; 2],
    pub chains: Vec<Chain>,
    /// По штабам мира.
    pub hq: Vec<HqState>,
    /// След эталона; нет — ухода и возврата по расстоянию нет.
    pub track: Option<Track>,
    /// Смены состояния: (час, штаб, состояние, причина).
    pub log: Vec<(u32, u32, Status, Option<Reason>)>,
    /// Файл сценария (след эталона — рядом с ним): задаёт `scenario::load_with`.
    pub scenario: Option<String>,
    /// Немецкие приказы сценария, поданные диспетчером не в свой час: в этом же шаге — в путь к дивизиям.
    pub queue: Vec<ScriptOrder>,
    /// Чистая история (запись следа эталона): все задачи — в свой час, без условий смысла, ухода и возврата.
    pub pure: bool,
    /// Действия вмешательства, ждущие своего часа (intervene.rs).
    pub actions: Vec<(u32, super::intervene::Action)>,
    /// Зоны изменённого замысла (`drop`).
    pub drops: Vec<super::intervene::DropZone>,
}

impl State {
    pub fn any(&self) -> bool { self.enabled.iter().any(|&e| e) }
}

pub(super) fn set(sim: &mut Sim, h: u32, status: Status, reason: Option<Reason>, tick: u32) {
    let s = &mut sim.intent.hq[h as usize];
    if s.status == status && s.reason == reason { return; }
    // «армия в N км»: расстояние меняется каждый час — смена записывается, только если сменилась причина
    if s.status == status && matches!((&s.reason, &reason), (Some(Reason::Strayed { .. }), Some(Reason::Strayed { .. }))) { s.reason = reason; return; }
    *s = HqState { status, reason: reason.clone(), since: tick };
    sim.intent.log.push((tick, h, status, reason));
}

/// Штаб `h` и все его подчинённые.
pub(super) fn subtree(sim: &Sim, h: u32) -> Vec<usize> {
    let w = &sim.world;
    (0..w.hqs.len()).filter(|&k| { let mut x = k; for _ in 0..8 { if x == h as usize { return true; } match w.hqs[x].parent { Some(p) => x = p as usize, None => return false } } false }).collect()
}

/// Штаб или кто-то над ним — под командованием игрока.
fn player_over(sim: &Sim, h: u32) -> bool {
    let w = &sim.world;
    let mut k = h as usize;
    for _ in 0..8 {
        if sim.command.control.get(k) == Some(&Control::Player) { return true; }
        match w.hqs[k].parent { Some(p) => k = p as usize, None => return false }
    }
    false
}

/// Штаб не на истории: сам он или его старший — «сам», или его (или старшего) ведёт игрок.
pub fn off_history(sim: &Sim, hq: u32) -> bool {
    if !sim.intent.any() { return false; }
    if player_over(sim, hq) { return true; }
    let mut k = hq as usize;
    for _ in 0..8 {
        if sim.intent.hq.get(k).is_some_and(|s| s.status == Status::Own) { return true; }
        match sim.world.hqs[k].parent { Some(p) => k = p as usize, None => return false }
    }
    false
}

/// Включить режим у стороны: цепочки, след эталона (один раз), всем штабам — «по истории». Задачи до нынешнего часа
/// считаются отданными (принятие командования посреди операции: прежнее не подаётся повторно).
pub fn enable(sim: &mut Sim, side: Side) {
    let i = side_idx(side);
    if sim.intent.enabled[i] { return; }
    let tick = sim.world.tick;
    if !sim.intent.any() {
        sim.intent.hq = vec![HqState { status: Status::History, reason: None, since: tick }; sim.world.hqs.len()];
        let loaded = match sim.intent.scenario.as_deref() { Some(p) => super::track::load(p), None => Err("нет следа эталона".to_string()) };
        match loaded {
            Ok(t) => sim.intent.track = Some(t),
            Err(e) => sim.journal.push(Event { tick, agent: u32::MAX, text: format!("история как замысел: {e}") }),
        }
    }
    sim.intent.enabled[i] = true;
    let mut chains = build(sim, side);
    for c in chains.iter_mut() {
        for t in c.tasks.iter_mut().filter(|t| t.at < tick) { t.issued = true; }
        c.next = c.tasks.iter().take_while(|t| t.at < tick).count();
        sim.intent.log.push((tick, c.owner, Status::History, None));
    }
    sim.intent.chains.extend(chains);
}

/// Штаб игрока со всеми подчинёнными — с истории («под командованием игрока»).
pub fn take(sim: &mut Sim, hq: u32) {
    let tick = sim.world.tick;
    for k in subtree(sim, hq) { set(sim, k as u32, Status::Own, Some(Reason::Player), tick); }
}

/// Расстояние центра живых дивизий армии от следа эталона на этот час; нет следа, армии в нём или живых — None.
fn stray_km(sim: &Sim, owner: u32, tick: u32) -> Option<f64> {
    let p = sim.intent.track.as_ref()?.at(&sim.world.hqs[owner as usize].id, tick)?;
    let c = mid(&live(sim, owner).iter().map(|&i| sim.world.divisions[i].vars.pos).collect::<Vec<_>>())?;
    Some(c.dist(sim.theatre.proj.to_xy(p)))
}

/// Армия у следа эталона (не дальше `returnKm`) или следа для неё нет — правила приспособления не действуют.
fn on_track(sim: &Sim, owner: u32) -> bool {
    sim.intent.pure || stray_km(sim, owner, sim.world.tick).is_none_or(|km| km <= sim.rules.intent.return_km)
}

/// Смысл задачи для подачи: в чистой истории и у армии у следа — всегда (что дивизии смогут, решает их состояние);
/// отошла от следа — все условия.
fn sense_now(sim: &Sim, c: &Chain, t: &super::chain::Task, on_track: bool) -> Result<(), Reason> {
    if sim.intent.pure || on_track { return Ok(()); }
    sense(sim, c, t)
}

pub(super) fn leave(sim: &mut Sim, owner: u32, reason: Reason, tick: u32) {
    set(sim, owner, Status::Own, Some(reason), tick);
    // немецкая армия — штабам-агентам (и командующим)
    if sim.world.hqs[owner as usize].side == Side::De {
        for k in subtree(sim, owner) { if sim.command.control[k] == Control::Script { sim.command.control[k] = Control::Agent; } }
    }
}

fn back(sim: &mut Sim, owner: u32, tick: u32) {
    set(sim, owner, Status::History, None, tick);
    if sim.world.hqs[owner as usize].side == Side::De {
        for k in subtree(sim, owner) { if sim.command.control[k] == Control::Agent { sim.command.control[k] = Control::Script; } }
    }
}

/// Шаг диспетчера (фаза командования, до решений командующих и штабов).
pub fn step(sim: &mut Sim, tick: u32) {
    if !sim.intent.any() { return; }
    if !sim.intent.actions.is_empty() { super::intervene::due(sim, tick); }
    let r = sim.rules.intent.clone();
    for ci in 0..sim.intent.chains.len() {
        let owner = sim.intent.chains[ci].owner;
        if player_over(sim, owner) { set(sim, owner, Status::Own, Some(Reason::Player), tick); continue; }
        if sim.intent.pure { dispatch(sim, ci, tick, true, None); continue; }
        let km = stray_km(sim, owner, tick);
        if sim.intent.hq[owner as usize].status == Status::Own {
            if km.is_some_and(|km| km < r.return_km) { try_return(sim, ci, tick); }
            continue;
        }
        if let Some(km) = km.filter(|&km| km > r.leave_km) { leave(sim, owner, Reason::Strayed { km }, tick); continue; }
        let near = km.is_none_or(|km| km <= r.return_km);
        dispatch(sim, ci, tick, near, km);
    }
}

/// Возврат: задача на этот час (последняя с часом не позже нынешнего, не раньше курсора) имеет смысл — цепочка
/// продолжается с неё; задачи между курсором и ею не подаются.
fn try_return(sim: &mut Sim, ci: usize, tick: u32) {
    let c = &sim.intent.chains[ci];
    if c.next >= c.tasks.len() { return; }
    let k = (c.next..c.tasks.len()).take_while(|&j| c.tasks[j].at <= tick).last().unwrap_or(c.next);
    if sense_now(sim, c, &c.tasks[k], true).is_err() { return; }
    let owner = c.owner;
    sim.intent.chains[ci].next = k;
    back(sim, owner, tick);
    dispatch(sim, ci, tick, true, None);
}

/// Подать наступившие задачи цепочки. Армия у следа (`near`) идёт как чистая история: задачи в свой час, без подачи
/// по выполнению и без пропусков; отошла от следа — подача по выполнению и пропуски, состояние
/// «со сдвигом» (причина — пропуск или задержка этого часа, иначе «армия в N км»).
fn dispatch(sim: &mut Sim, ci: usize, tick: u32, near: bool, km: Option<f64>) {
    let owner = sim.intent.chains[ci].owner;
    supersede(sim, ci, tick, near);
    let mut skipped: Option<Reason> = None;
    let mut why: Option<Reason> = None;
    let mut shifted = false;
    let mut issued_now = false;
    loop {
        let c = &sim.intent.chains[ci];
        let i = c.next;
        if i >= c.tasks.len() {
            // цепочка кончилась пропуском или (в час без новой задачи) у армии, отошедшей от следа, — решает
            // командующий; у следа — чистая история (новых задач нет, как в истории)
            if skipped.is_some() || (!near && !issued_now) { leave(sim, owner, Reason::ChainEnd, tick); return; }
            break;
        }
        let t = &c.tasks[i];
        // немецкий приказ, пропущенный в свой час в шаге 0 (`admit`)
        if t.issued { sim.intent.chains[ci].next += 1; continue; }
        let by_hour = t.at <= tick;
        let prev_done = !near && (0..i).rev().find(|&j| c.tasks[j].issued).is_some_and(|j| done(sim, owner, &c.tasks[j]));
        let catch_up = !near && skipped.is_some();
        if !(by_hour || prev_done || catch_up) { break; }
        // отвод с позиций — только в свой час
        if matches!(t.step, Step::Withdrawal(_)) && !by_hour { break; }
        match sense_now(sim, c, t, near) {
            // задача не в свой час (по выполнению или вдогонку) без смысла сейчас — ждёт своего часа: смысл будущей
            // задачи меряют по обстановке её часа (иначе «дальше двух переходов» отбросило бы всю цепочку)
            Err(_) if !by_hour => break,
            // неспособность задачу не отменяет: она ждёт, пока армия придёт в себя (или в свой час её отбросят прочие условия)
            Err(Reason::Unfit) => { why = Some(Reason::Unfit); shifted = true; break; }
            Err(r) => { sim.intent.chains[ci].next += 1; why = Some(r.clone()); skipped = Some(r); shifted = true; }
            Ok(()) => {
                issue(sim, ci, i, tick);
                issued_now = true;
                sim.intent.chains[ci].next += 1;
                if !by_hour || catch_up { shifted = true; }
                skipped = None;
            }
        }
    }
    if shifted || !near {
        let why = why.or_else(|| km.filter(|_| !near).map(|km| Reason::Strayed { km }));
        set(sim, owner, Status::Shifted, why, tick);
    } else {
        set(sim, owner, Status::History, None, tick);
    }
}

/// Час более поздней задачи цепочки настал — прежние неподанные (задержанные) задачи устарели: курсор за ними, смена
/// «со сдвигом» с причиной устаревшей задачи записывается всегда (отвод, оставшийся за задержанной задачей, не пропадает
/// молча). Иначе задержанная задача, поданная позже, перебила бы более позднюю.
fn supersede(sim: &mut Sim, ci: usize, tick: u32, near: bool) {
    let c = &sim.intent.chains[ci];
    let Some(h) = c.tasks[c.next.min(c.tasks.len())..].iter().map(|t| t.at).filter(|&at| at <= tick).max() else { return };
    let owner = c.owner;
    let mut k = c.next;
    let mut last = None;
    while k < c.tasks.len() && c.tasks[k].at < h {
        if !c.tasks[k].issued {
            let why = sense_now(sim, c, &c.tasks[k], near).err().or_else(|| sim.intent.hq[owner as usize].reason.clone());
            last = Some(why);
        }
        k += 1;
    }
    sim.intent.chains[ci].next = k;
    if let Some(why) = last {
        let s = &mut sim.intent.hq[owner as usize];
        *s = HqState { status: Status::Shifted, reason: why.clone(), since: tick };
        sim.intent.log.push((tick, owner, Status::Shifted, why));
    }
}

/// Задачу `ti` цепочки сменила более поздняя, чей час уже настал.
fn superseded(sim: &Sim, ci: usize, ti: usize) -> bool {
    let c = &sim.intent.chains[ci];
    let at = c.tasks[ti].at;
    c.tasks[ti + 1..].iter().any(|t| t.at > at && t.at <= sim.world.tick)
}

fn issue(sim: &mut Sim, ci: usize, i: usize, tick: u32) {
    let owner = sim.intent.chains[ci].owner;
    sim.intent.chains[ci].tasks[i].issued = true;
    let t = sim.intent.chains[ci].tasks[i].clone();
    match t.step {
        Step::Dir(mut d) => {
            let crate::command::directive::Target::Hq(h) = d.to else { return };
            // штаб по приказам сценария директиву не разбирает — её исполняют приказы сценария
            if sim.command.control[h as usize] != Control::Agent { return; }
            d.ready = t.at == 0 && tick == 0;
            let d = crate::command::control::with_axis(sim, d);
            crate::command::passing::issue(sim, d, tick);
        }
        Step::Order(mut o) => {
            if !o.to.is_empty() { o.to.retain(|&d| army_of(sim, sim.world.divisions[d as usize].hq) == owner); }
            o.at = tick;
            sim.intent.queue.push(o);
        }
        Step::Withdrawal(_) => {}
    }
}

fn same_order(a: &ScriptOrder, b: &ScriptOrder) -> bool { a.at == b.at && a.hq == b.hq && a.to == b.to && a.kind == b.kind && a.note == b.note }

/// Задачи цепочек с этим приказом сценария: (цепочка, задача).
fn order_tasks(sim: &Sim, o: &ScriptOrder) -> Vec<(usize, usize)> {
    let mut v = Vec::new();
    for (ci, c) in sim.intent.chains.iter().enumerate() {
        for (ti, t) in c.tasks.iter().enumerate() { if matches!(&t.step, Step::Order(x) if same_order(x, o)) { v.push((ci, ti)); } }
    }
    v
}

fn passes(sim: &Sim, ci: usize, ti: usize) -> bool {
    let c = &sim.intent.chains[ci];
    !c.tasks[ti].issued && !superseded(sim, ci, ti) && !off_history(sim, c.owner) && sense_now(sim, c, &c.tasks[ti], on_track(sim, c.owner)).is_ok()
}

/// Немецкий приказ сценария проходит, только если его армия на истории и задача имеет смысл (иначе отбрасывается —
/// его заменяет цепочка или командующий). Приказ вне цепочек (сторона без режима) проходит.
pub fn gate(sim: &Sim, o: &ScriptOrder) -> bool {
    if !sim.intent.enabled[side_idx(sim.world.hqs[o.hq as usize].side)] { return true; }
    let hits = order_tasks(sim, o);
    hits.is_empty() || hits.iter().any(|&(ci, ti)| passes(sim, ci, ti))
}

/// Приказ сценария в свой час (шаг 0 мира): проходит к дивизиям армий, у которых он проходит `gate`; задача отмечается
/// поданной. None — не проходит никому.
pub fn admit(sim: &mut Sim, mut o: ScriptOrder) -> Option<ScriptOrder> {
    if !sim.intent.enabled[side_idx(sim.world.hqs[o.hq as usize].side)] { return Some(o); }
    let hits = order_tasks(sim, &o);
    if hits.is_empty() { return Some(o); }
    let mut owners = Vec::new();
    for (ci, ti) in hits {
        if passes(sim, ci, ti) { sim.intent.chains[ci].tasks[ti].issued = true; owners.push(sim.intent.chains[ci].owner); }
    }
    if owners.is_empty() { return None; }
    if !o.to.is_empty() { o.to.retain(|&d| owners.contains(&army_of(sim, sim.world.divisions[d as usize].hq))); }
    Some(o)
}

/// Отвод сценария дивизии `d`: применяется, если у её армии задача отвода подана (или отвод вне цепочек).
pub fn withdrawal_ok(sim: &Sim, ev: &ScriptWithdraw, d: u32) -> bool {
    if !sim.intent.enabled[side_idx(sim.world.divisions[d as usize].side)] { return true; }
    let owner = army_of(sim, sim.world.divisions[d as usize].hq);
    let same = |w: &ScriptWithdraw| w.at == ev.at && w.to == ev.to && w.note == ev.note;
    match sim.intent.chains.iter().filter(|c| c.owner == owner).flat_map(|c| &c.tasks).find(|t| matches!(&t.step, Step::Withdrawal(w) if same(w))) {
        Some(t) => t.issued,
        None => true,
    }
}

/// Поле `intent` хода прогона: по штабу смены состояния с причиной; режим выключен — None.
pub fn describe(sim: &Sim) -> Option<Value> {
    if !sim.intent.any() { return None; }
    let mut by: std::collections::BTreeMap<u32, Vec<Value>> = Default::default();
    for (tick, h, s, r) in &sim.intent.log {
        by.entry(*h).or_default().push(json!({ "tick": tick, "status": s.label(), "reason": r.as_ref().map(reason_text) }));
    }
    Some(Value::Array(by.into_iter().map(|(h, changes)| json!({ "hq": sim.world.hqs[h as usize].id, "changes": changes })).collect()))
}
