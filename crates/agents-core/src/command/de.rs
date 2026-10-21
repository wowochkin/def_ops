//! Немецкие штабы-агенты по ступеням (этап 2б).

use crate::command::agent::{generic, subs_of};
use crate::command::directive::Directive;
use crate::world::Sim;

/// Решение штаба немецкой стороны по замыслу старшего.
pub fn plan(sim: &Sim, h: u32, intent: &Directive, replan: bool) -> Vec<Directive> {
    generic(sim, h, intent, replan, &subs_of(sim, h), None)
}
