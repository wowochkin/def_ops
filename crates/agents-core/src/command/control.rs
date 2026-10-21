//! Управление штабами (раздел 4 спецификации): кто решает за штаб — приказы сценария, штаб-агент или игрок; кто изъят
//! из замысла своего старшего приказом через голову; журнал документов штабов.

use crate::command::directive::Directive;
use crate::model::State;
use crate::world::Sim;
use serde::Serialize;

/// Кто решает за штаб.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Control { Script, Agent, Player }

/// Состояние управления по штабам и дивизиям мира.
#[derive(Clone, Debug, Default)]
pub struct CommandState {
    pub control: Vec<Control>,
    /// Штаб изъят из замысла старшего приказом через голову (ведёт игрок).
    pub led_hq: Vec<bool>,
    /// Дивизия изъята из замысла старшего приказом через голову.
    pub led_div: Vec<bool>,
    /// Замысел старшего: последняя полученная директива штаба.
    pub intent: Vec<Option<Directive>>,
    /// Час последнего решения штаба-агента.
    pub last_cycle: Vec<u32>,
    /// Директивы в пути: (час прибытия, директива).
    pub in_transit: Vec<(u32, Directive)>,
    /// Замысел пришёл и ещё не разобран штабом.
    pub fresh: Vec<bool>,
    /// Задача дивизии по директиве: после выхода на ближайшую задачу — последующая.
    pub div_task: Vec<Option<Directive>>,
    /// Последняя задача, отданная подчинённому: (штаб, получатель) → (цель, задача).
    pub sent: std::collections::HashMap<(u32, crate::command::directive::Target), (crate::geo::XY, crate::command::directive::Task)>,
}

impl CommandState {
    /// Все штабы — по приказам сценария (как без командования по ступеням).
    pub fn new(hqs: usize, divisions: usize) -> CommandState {
        CommandState { control: vec![Control::Script; hqs], led_hq: vec![false; hqs], led_div: vec![false; divisions], intent: vec![None; hqs], last_cycle: vec![0; hqs], in_transit: Vec::new(), fresh: vec![false; hqs], div_task: vec![None; divisions], sent: Default::default() }
    }
}

/// Вид документа журнала штабов.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocKind { Directive, Order, Instruction, Notice, Report }

/// Документ штаба: директива, боевой приказ, распоряжение, извещение, донесение — с обоснованием.
#[derive(Clone, Debug)]
pub struct Document {
    pub tick: u32,
    /// Штаб, отдавший документ.
    pub hq: u32,
    pub kind: DocKind,
    /// Кому: id штабов и дивизий.
    pub to: Vec<String>,
    pub text: String,
    /// Правило (id норматива или статья устава), по которому принято решение.
    pub rule: Option<String>,
}

/// Действующие прямые подчинённые штаба: штабы и дивизии, кроме изъятых через голову, выбывших, ещё не введённых и
/// остатков.
pub fn active_subs(sim: &Sim, h: u32) -> (Vec<u32>, Vec<u32>) {
    let w = &sim.world;
    let c = &sim.command;
    let hqs = (0..w.hqs.len() as u32).filter(|&k| w.hqs[k as usize].parent == Some(h) && !c.led_hq.get(k as usize).copied().unwrap_or(false)).collect();
    let divs = (0..w.divisions.len() as u32).filter(|&i| {
        let d = &w.divisions[i as usize];
        d.hq == h && !c.led_div.get(i as usize).copied().unwrap_or(false) && !d.state.out() && d.state != State::Remnant
    }).collect();
    (hqs, divs)
}
