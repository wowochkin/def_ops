//! Командующие: субъектные агенты над верхними штабами (фронты, группы армий, немецкие армии, Ставка).
//! Здесь — профили характера и мотивов, загрузка из `packages/sim/data/rules/commanders.json`.

pub mod motives;
pub mod options;
pub mod options_su;
pub mod picture;
pub mod profile;

pub use profile::{CommanderRules, Cycle, Fog, Gains, MoodRules, Motive, Motives, Opts, Profile, Trait, Traits, Weights};
