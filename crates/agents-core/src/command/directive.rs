//! Директива старшего штаба подчинённому (раздел 1 спецификации): общая для ступеней структура — получатель, форма,
//! задача, ось главного удара, ближайшая и последующая задачи рубежами, разграничительные линии с соседями, главный
//! удар и резерв. Исторические директивы Ставки и ОКХ приходят из поля `directives` сценария.

use crate::geo::XY;
use crate::geo::LngLat;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Форма документа: подготовленный приказ (директива, боевой приказ) или боевое распоряжение — быстрее, но со
/// штрафом слаженности.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Form { Order, #[default] Instruction }

/// Задача: наступать, оборонять, сдерживать (hinhaltender Widerstand), отходить, выдвигаться, резерв.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Task { Attack, #[default] Defend, Delay, Withdraw, Move, Reserve }

/// Получатель: штаб или дивизия (индексы мира).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Target { Hq(u32), Division(u32) }

/// Рубеж задачи и срок (час операции).
#[derive(Clone, Debug, PartialEq)]
pub struct Line { pub pts: Vec<XY>, pub by: Option<u32> }

#[derive(Clone, Debug, PartialEq)]
pub struct Directive {
    pub id: String,
    /// Отдающий штаб.
    pub from: u32,
    pub to: Target,
    pub form: Form,
    pub task: Task,
    /// Ось главного удара (может быть пустой).
    pub axis: Vec<XY>,
    pub immediate: Option<Line>,
    pub subsequent: Option<Line>,
    /// Разграничительные линии: сосед (штаб) и ломаная.
    pub boundaries: Vec<(Option<u32>, Vec<XY>)>,
    /// Подчинённые на главном ударе.
    pub main_blow: Vec<u32>,
    pub reserve: Vec<u32>,
    /// Кто отвечает за стык.
    pub junction: Option<u32>,
    /// По пути хотя бы одна ступень прошла распоряжением.
    pub hasty: bool,
    /// Отдана до начала операции: доходит и доводится до дивизий сразу (как приказы сценария на начало).
    pub ready: bool,
    /// Правило, по которому штаб принял решение (статья устава или id норматива) — в документ.
    pub rule: Option<String>,
    /// Час отдачи (ставит passing::issue): пришедшая позже, но отданная раньше директива того же штаба не действует.
    pub issued: u32,
    pub note: String,
}

/// Историческая директива в сценарии (сборщики: packages/sim/tools/agents/directives.ts).
#[derive(Deserialize)]
pub struct DirectiveIn {
    pub id: String,
    pub at: String,
    pub from: String,
    pub to: Vec<String>,
    pub form: Form,
    pub task: Task,
    #[serde(default)]
    pub axis: Vec<LngLat>,
    #[serde(default)]
    pub immediate: Option<LineIn>,
    #[serde(default)]
    pub subsequent: Option<LineIn>,
    #[serde(default)]
    pub boundaries: Vec<BoundaryIn>,
    #[serde(default, rename = "mainBlow")]
    pub main_blow: Vec<String>,
    #[serde(default)]
    pub reserves: Vec<String>,
    #[serde(default)]
    pub note: String,
}

#[derive(Deserialize)]
pub struct LineIn { pub line: Vec<LngLat>, #[serde(default)] pub by: Option<String> }

#[derive(Deserialize)]
pub struct BoundaryIn { #[serde(default)] pub with: Option<String>, pub line: Vec<LngLat> }

impl DirectiveIn {
    /// Директивы по получателям, с часом вступления: `hour` — час операции по дате, `xy` — проекция театра.
    pub fn resolve(&self, hqs: &HashMap<&str, u32>, hour: &dyn Fn(&str) -> Option<u32>, xy: &dyn Fn(LngLat) -> XY) -> Result<Vec<(u32, Directive)>, String> {
        let h = |id: &str| hqs.get(id).copied().ok_or_else(|| format!("директива {}: нет штаба {id}", self.id));
        let at = hour(&self.at).ok_or_else(|| format!("директива {}: неверная дата {}", self.id, self.at))?;
        let line = |l: &Option<LineIn>| l.as_ref().filter(|l| !l.line.is_empty()).map(|l| Line { pts: l.line.iter().map(|&p| xy(p)).collect(), by: l.by.as_deref().and_then(hour) });
        let from = h(&self.from)?;
        let boundaries = self.boundaries.iter().map(|b| Ok((match &b.with { Some(w) => Some(h(w)?), None => None }, b.line.iter().map(|&p| xy(p)).collect()))).collect::<Result<Vec<_>, String>>()?;
        let main_blow = self.main_blow.iter().map(|x| h(x)).collect::<Result<Vec<_>, _>>()?;
        let reserve = self.reserves.iter().map(|x| h(x)).collect::<Result<Vec<_>, _>>()?;
        self.to.iter().map(|t| Ok((at, Directive {
            id: self.id.clone(), from, to: Target::Hq(h(t)?), form: self.form, task: self.task,
            axis: self.axis.iter().map(|&p| xy(p)).collect(), immediate: line(&self.immediate), subsequent: line(&self.subsequent),
            boundaries: boundaries.clone(), main_blow: main_blow.clone(), reserve: reserve.clone(), junction: None, hasty: false, ready: false, rule: None, issued: 0, note: self.note.clone(),
        }))).collect()
    }
}
