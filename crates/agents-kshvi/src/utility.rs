use agents_core::commander::decide::score;
use agents_core::commander::options::{Choice, Kind};
use agents_core::commander::Motives;

use crate::choice::ModernChoice;
use crate::profile::ModernAgentProfile;

/// Современный вариант преобразуется только на время расчёта. Возвращаемый исторический Kind и rule наружу не попадают.
pub fn modern_utility(
    choice: &ModernChoice,
    profile: &ModernAgentProfile,
    continuing: bool,
) -> f64 {
    let core_choice = Choice {
        kind: Kind::Continue,
        label: choice.label.clone(),
        contrib: Motives(choice.contrib),
        uncertainty: choice.uncertainty,
        losses: choice.losses,
        rule: "версионный современный профиль КШВИ",
    };
    score(
        &core_choice,
        &profile.motives(),
        &profile.traits(),
        &profile.weights(),
        continuing,
    )
    .total
}
