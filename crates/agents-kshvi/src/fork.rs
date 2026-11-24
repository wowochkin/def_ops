use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::rng::SeededModernRng;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OfficialState {
    pub forces: Vec<String>,
    pub resources: Vec<String>,
    pub events: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct OfficialWorld {
    pub state: OfficialState,
    pub rng_cursor: u64,
    pub outbox: Vec<String>,
}

impl OfficialWorld {
    pub fn hash(&self) -> String {
        hash_json(self)
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ForkState {
    id: String,
    purpose: String,
    state: OfficialState,
    simulated_events: Vec<String>,
    simulated_utility: f64,
    readiness: f64,
    supply: f64,
    local_rng_cursor: u64,
}

/// Изолированная копия не содержит ссылки на официальный мир, outbox или официальный RNG.
pub struct WorldFork {
    state: Option<ForkState>,
}

impl WorldFork {
    pub fn create(official: &OfficialWorld, id: String) -> Self {
        Self {
            state: Some(ForkState {
                id,
                purpose: "optionEvaluation".into(),
                readiness: official.state.forces.len().max(1) as f64,
                supply: official.state.resources.len() as f64,
                state: official.state.clone(),
                simulated_events: Vec::new(),
                simulated_utility: 0.0,
                local_rng_cursor: 0,
            }),
        }
    }

    pub fn evaluate(
        &mut self,
        choice_id: &str,
        horizon: u32,
        rng: &mut SeededModernRng,
    ) -> Result<f64, String> {
        let state = self.state.as_mut().ok_or("Оценочный форк уничтожен")?;
        if horizon == 0 {
            return Ok(0.0);
        }
        let mut total_utility = 0.0;
        for step in 0..horizon {
            let random = rng.next_u64();
            let noise = ((random >> 11) as f64 / ((1u64 << 53) as f64)) - 0.5;
            let (base, readiness_delta, supply_delta) = match choice_id {
                "advance" => (0.075, -0.035, -0.020),
                "defend" => (0.040, -0.010, -0.005),
                "withdraw" => (-0.005, -0.005, 0.0),
                "request-support" => (0.020, 0.0, 0.040),
                "continue-order" => (0.020, -0.002, -0.005),
                _ => (0.0, 0.0, 0.0),
            };
            let step_utility = base + state.readiness * 0.005 + state.supply * 0.010 + noise * 0.010;
            state.readiness = (state.readiness + readiness_delta).max(0.0);
            state.supply = (state.supply + supply_delta).max(0.0);
            total_utility += step_utility;
            state.simulated_events.push(format!(
                "{choice_id}:{step}:utility={step_utility:.6}:readiness={:.3}:supply={:.3}",
                state.readiness, state.supply
            ));
        }
        state.local_rng_cursor = rng.cursor();
        state.simulated_utility = total_utility / horizon as f64;
        Ok(state.simulated_utility)
    }

    pub fn hash(&self) -> Result<String, String> {
        self.state
            .as_ref()
            .map(hash_json)
            .ok_or_else(|| "Оценочный форк уничтожен".into())
    }

    pub fn publish_official(&mut self, _payload: &str) -> Result<(), String> {
        Err("Оценочный форк предназначен только для оценки и не имеет канала записи".into())
    }

    pub fn destroy(&mut self) {
        self.state = None;
    }
}

pub fn hash_json<T: Serialize>(value: &T) -> String {
    let bytes = serde_json::to_vec(value).expect("сериализация состояния");
    format!("{:x}", Sha256::digest(bytes))
}
