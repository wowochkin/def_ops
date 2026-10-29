//! Цепочки задач: у каждого получателя (армия; для директив Ставки — фронт) задачи по возрастанию исторического часа.

use crate::command::agent::mid;
use crate::command::directive::{Directive, Target, Task as DTask};
use crate::geo::XY;
use crate::model::{Echelon, OrderKind, Side};
use crate::world::{ScriptOrder, ScriptWithdraw, Sim};

/// Шаг истории: директива (Ставки, фронта, верхней инстанции немцев), исторический приказ или отвод сценария.
#[derive(Clone, Debug)]
pub enum Step { Dir(Directive), Order(ScriptOrder), Withdrawal(ScriptWithdraw) }

/// Вид задачи; «держать» и «сдерживать» — оборона.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Goal { Attack, Defend, Withdraw, Move }

#[derive(Clone, Debug)]
pub struct Task {
    pub at: u32,
    pub step: Step,
    /// Пункт или середина рубежа; нет — «на месте».
    pub goal: Option<XY>,
    pub kind: Goal,
    /// Задача подана (диспетчером или, немецкий приказ сценария, пропуском `admit` в свой час); пропущенная — нет.
    pub issued: bool,
}

#[derive(Clone, Debug)]
pub struct Chain {
    /// Штаб-получатель: армия (фронт — для директив Ставки; армия-владелец — для немецких приказов).
    pub owner: u32,
    pub tasks: Vec<Task>,
    /// Следующая к подаче задача.
    pub next: usize,
    /// Центр живых дивизий получателя при построении цепочки — точка отсчёта направления армии.
    pub start: Option<XY>,
}

fn dir_goal(d: &Directive) -> Option<XY> {
    [&d.immediate, &d.subsequent].into_iter().flatten().find_map(|l| mid(&l.pts)).or_else(|| d.axis.last().copied())
}

fn dir_kind(t: DTask) -> Goal {
    match t { DTask::Attack => Goal::Attack, DTask::Move => Goal::Move, DTask::Withdraw => Goal::Withdraw, DTask::Defend | DTask::Delay | DTask::Reserve => Goal::Defend }
}

fn order_kind(k: OrderKind) -> Goal {
    match k { OrderKind::Attack => Goal::Attack, OrderKind::Move => Goal::Move, OrderKind::Withdraw => Goal::Withdraw, OrderKind::Defend | OrderKind::Hold => Goal::Defend }
}

/// Армия над штабом (он сам, если он армия или выше армии нет).
pub(crate) fn army_of(sim: &Sim, hq: u32) -> u32 {
    let w = &sim.world;
    let mut k = hq as usize;
    for _ in 0..8 {
        if w.hqs[k].echelon == Echelon::Army { return k as u32; }
        match w.hqs[k].parent { Some(p) => k = p as usize, None => break }
    }
    hq
}

/// Цепочки стороны: по возрастанию номера штаба-получателя, задачи — по часу (при равном — как в сценарии).
/// Директивы (Ставки и фронтов; у немцев — верхней инстанции) — получателю-штабу; немецкие приказы и отводы сценария —
/// армии-владельцу получающих дивизий.
pub fn build(sim: &Sim, side: Side) -> Vec<Chain> {
    let w = &sim.world;
    let mut by: std::collections::BTreeMap<u32, Vec<Task>> = Default::default();
    for (at, d) in &sim.historical {
        if d.id.ends_with(":journal") || w.hqs[d.from as usize].side != side { continue; }
        let Target::Hq(h) = d.to else { continue };
        by.entry(h).or_default().push(Task { at: *at, step: Step::Dir(d.clone()), goal: dir_goal(d), kind: dir_kind(d.task), issued: false });
    }
    if side == Side::De {
        let owners = |to: &[u32], fallback: Option<u32>| -> Vec<u32> {
            let mut v: Vec<u32> = to.iter().map(|&i| army_of(sim, w.divisions[i as usize].hq)).collect();
            if v.is_empty() { v.extend(fallback.map(|h| army_of(sim, h))); }
            v.sort_unstable();
            v.dedup();
            v
        };
        for o in sim.script.iter().filter(|o| w.hqs[o.hq as usize].side == Side::De) {
            for ow in owners(&o.to, Some(o.hq)) {
                by.entry(ow).or_default().push(Task { at: o.at, step: Step::Order(o.clone()), goal: o.target, kind: order_kind(o.kind), issued: false });
            }
        }
        for wd in &sim.withdrawals {
            // у отвода нет пункта: только доли войск по позициям — цель «на месте»; без названных дивизий отвод пропускается
            for ow in owners(&wd.to, None) {
                by.entry(ow).or_default().push(Task { at: wd.at, step: Step::Withdrawal(wd.clone()), goal: None, kind: Goal::Withdraw, issued: false });
            }
        }
    }
    by.into_iter().map(|(owner, mut tasks)| {
        tasks.sort_by_key(|t| t.at);
        let start = mid(&super::sense::live(sim, owner).iter().map(|&i| w.divisions[i].vars.pos).collect::<Vec<_>>());
        Chain { owner, tasks, next: 0, start }
    }).collect()
}
