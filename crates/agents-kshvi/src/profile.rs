use agents_core::commander::{Motives, Traits, Weights};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSource {
    pub era: String,
    pub kind: String,
    pub reference: String,
    pub version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModernMotives {
    pub task: f64,
    pub rival: f64,
    pub preserve: f64,
    pub no_encircle: f64,
    pub destroy: f64,
    pub hold: f64,
    pub save: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModernWeights {
    pub uncertainty: f64,
    pub losses: f64,
    pub persistence: f64,
    pub obedience: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModernAgentProfile {
    pub id: String,
    pub version: String,
    pub source: ProfileSource,
    pub risk: f64,
    pub persistence: f64,
    pub ambition: f64,
    pub loss_tolerance: f64,
    pub obedience: f64,
    pub motives: ModernMotives,
    pub weights: ModernWeights,
    pub search_depth: u32,
    pub option_count: usize,
    pub horizon_ticks: u32,
    pub review_cycle_ticks: u32,
    pub initiative: f64,
    pub on_insufficient_data: String,
    pub min_advance_confidence: f64,
    pub max_advance_stress: f64,
    pub max_advance_threat: f64,
    pub min_supply_fraction: f64,
    pub min_movement_factor: f64,
    pub communication_delay_ticks: u32,
}

impl ModernAgentProfile {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.is_empty() || self.version.is_empty() {
            return Err("Современный профиль должен иметь идентификатор и версию".into());
        }
        if self.source.era != "modern"
            || !["SOURCE", "ASSUMPTION"].contains(&self.source.kind.as_str())
        {
            return Err("Современный профиль требует источник или учебное допущение".into());
        }
        if self.source.reference.trim().is_empty() || self.source.version.trim().is_empty() {
            return Err("Источник современного профиля должен быть версионным и непустым".into());
        }
        if self.search_depth == 0
            || self.option_count < 2
            || self.horizon_ticks == 0
            || self.review_cycle_ticks == 0
        {
            return Err(
                "Глубина, число вариантов, горизонт и цикл пересмотра должны быть положительными"
                    .into(),
            );
        }
        let unit = [
            self.risk,
            self.persistence,
            self.ambition,
            self.loss_tolerance,
            self.obedience,
            self.initiative,
            self.min_advance_confidence,
            self.max_advance_stress,
            self.max_advance_threat,
            self.min_supply_fraction,
            self.min_movement_factor,
            self.weights.uncertainty,
            self.weights.losses,
            self.weights.persistence,
            self.weights.obedience,
        ];
        if unit
            .iter()
            .any(|value| !value.is_finite() || !(0.0..=2.0).contains(value))
        {
            return Err("Параметры современного профиля вне допустимой области".into());
        }
        if !["CONTINUE_ORDER", "HOLD", "ESCALATE"].contains(&self.on_insufficient_data.as_str()) {
            return Err("Неизвестное безопасное поведение профиля".into());
        }
        Ok(())
    }

    pub(crate) fn traits(&self) -> Traits {
        Traits([
            self.risk,
            self.persistence,
            self.ambition,
            self.loss_tolerance,
            self.obedience,
        ])
    }

    pub(crate) fn motives(&self) -> Motives {
        let m = &self.motives;
        Motives([
            m.task,
            m.rival,
            m.preserve,
            m.no_encircle,
            m.destroy,
            m.hold,
            m.save,
        ])
    }

    pub(crate) fn weights(&self) -> Weights {
        Weights {
            uncertainty: self.weights.uncertainty,
            losses: self.weights.losses,
            persistence: self.weights.persistence,
            obedience: self.weights.obedience,
        }
    }
}
