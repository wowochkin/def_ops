//! Командующие: субъектные агенты над верхними штабами (фронты, группы армий, немецкие армии, Ставка).
//! Здесь — профили характера и мотивов, загрузка из `packages/sim/data/rules/commanders.json`.

pub mod apply;
pub mod decide;
pub mod mind;
pub mod motives;
pub mod options;
pub mod options_de;
pub mod options_su;
pub mod picture;
pub mod profile;
pub mod trace;

pub use profile::{CommanderRules, Cycle, Fog, Gains, MoodRules, Motive, Motives, Opts, Profile, Trait, Traits, Weights};
pub use decide::{active, cycle, enable, Commander, Decision, Scored, Snapshot, State};

/// Итог проигрыша варианта «в уме»: за сколько часов, продвижение, потери (доля силы), охват противника (доля).
#[derive(Clone, Debug, PartialEq)]
pub struct MindResult { pub hours: u32, pub advance_km: f64, pub losses: f64, pub encircled: f64 }
