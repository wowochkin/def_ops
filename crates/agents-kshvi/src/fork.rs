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
                state: official.state.clone(),
                simulated_events: Vec::new(),
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
        let random = rng.next_u64();
        state.local_rng_cursor = rng.cursor();
        for step in 0..horizon {
            state
                .simulated_events
                .push(format!("{}:{step}:{random}", choice_id));
        }
        Ok(((random >> 11) as f64 / ((1u64 << 53) as f64)) * 0.000001)
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
