use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnOrder {
    pub id: String,
    pub kind: String,
    pub issued_tick: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Observation {
    pub id: String,
    pub observed_tick: u32,
    pub strength: Option<f64>,
    pub confidence: Option<f64>,
    pub source: Option<String>,
    pub uncertainty: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModernReport {
    pub id: String,
    pub sender: String,
    #[serde(default)]
    pub recipient: String,
    pub tick: u32,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MpsState {
    pub confidence: Option<f64>,
    pub stress: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OwnForce {
    pub id: String,
    pub hq_id: String,
    pub mps: MpsState,
    pub operational_equipment: Option<u32>,
    pub total_equipment: Option<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Resources {
    pub supply_fraction: Option<f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Terrain {
    pub route_open: Option<bool>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Weather {
    pub movement_factor: Option<f64>,
}

/// Серверная проекция: здесь намеренно нет полей истинного мира, черновиков и будущих вводных.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProjection {
    pub instance_id: String,
    pub revision: u64,
    pub agent_id: String,
    pub tick: u32,
    pub own_orders: Vec<OwnOrder>,
    pub observations: Vec<Observation>,
    pub reports: Vec<ModernReport>,
    pub own_forces: Vec<OwnForce>,
    pub resources: Resources,
    pub terrain: Terrain,
    pub weather: Weather,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModernChoice {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub contrib: [f64; 7],
    pub uncertainty: f64,
    pub losses: f64,
    pub command_type: Option<String>,
}

impl ModernChoice {
    pub fn new(id: &str, kind: &str, label: &str, command_type: Option<&str>) -> Self {
        Self {
            id: id.into(),
            kind: kind.into(),
            label: label.into(),
            contrib: [0.0; 7],
            uncertainty: 0.0,
            losses: 0.0,
            command_type: command_type.map(str::to_string),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ScoredModernChoice {
    pub id: String,
    pub utility: f64,
    pub uncertainty: f64,
    pub losses: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModernOrder {
    pub id: String,
    pub recipient: String,
    pub channel: String,
    pub issued_tick: u32,
    pub delivery_tick: u32,
    pub choice_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModernCommand {
    #[serde(rename = "type")]
    pub command_type: String,
    pub instance_id: String,
    pub expected_revision: u64,
    pub idempotency_key: String,
    pub choice_id: String,
}
