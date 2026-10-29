//! «История как замысел»: исторические директивы и приказы сценария как цепочки задач получателей (армий) и условия
//! смысла — подаётся ли задача в обстановке, сложившейся к её часу (docs/superpowers/specs/2026-10-29-history-intent-design.md,
//! раздел 1). Модуль ничего не меняет в ходе расчёта: старые режимы идут как шли.

pub mod chain;
pub mod sense;
pub mod track;

pub use chain::{build, Chain, Goal, Step, Task};
pub use sense::{done, reason_text, sense, Reason};
