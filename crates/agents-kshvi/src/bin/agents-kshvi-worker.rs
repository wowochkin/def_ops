use std::io::{self, BufRead, Write};

use agents_kshvi::choice::AgentProjection;
use agents_kshvi::fork::{OfficialState, OfficialWorld};
use agents_kshvi::profile::ModernAgentProfile;
use agents_kshvi::{evaluate_choices, HiddenTruth, ModernFixture};
use serde::Deserialize;
use serde_json::{json, Value};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope {
    id: Option<u64>,
    request: WorkerRequest,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkerRequest {
    profile: ModernAgentProfile,
    seed: String,
    projection: AgentProjection,
}

fn main() {
    let stdin = io::stdin();
    let mut stdout = io::stdout().lock();
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) if line.trim().is_empty() => continue,
            Ok(line) => handle(&line),
            Err(error) => json!({"ok": false, "error": format!("Ошибка чтения запроса: {error}")}),
        };
        if writeln!(
            stdout,
            "{}",
            serde_json::to_string(&response).expect("ответ сериализуется")
        )
        .and_then(|_| stdout.flush())
        .is_err()
        {
            break;
        }
    }
}

fn handle(line: &str) -> Value {
    let parsed = serde_json::from_str::<Envelope>(line);
    let envelope = match parsed {
        Ok(envelope) => envelope,
        Err(error) => {
            return json!({"ok": false, "error": format!("Некорректный запрос адаптера: {error}")})
        }
    };
    let id = envelope.id;
    let request = envelope.request;
    let result = (|| -> Result<_, String> {
        request.profile.validate()?;
        let seed = request
            .seed
            .strip_suffix('n')
            .unwrap_or(&request.seed)
            .parse::<u64>()
            .map_err(|_| "Зерно должно быть положительным целым u64".to_string())?;
        Ok(evaluate_choices(&ModernFixture {
            profile: request.profile,
            projection: request.projection,
            official: OfficialWorld {
                state: OfficialState::default(),
                rng_cursor: 0,
                outbox: Vec::new(),
            },
            hidden_truth: HiddenTruth {
                enemy_strength: 0.0,
                trainee_drafts: Vec::new(),
                future_inputs: Vec::new(),
            },
            seed,
        }))
    })();
    match result {
        Ok(evaluation) => json!({"id": id, "ok": true, "evaluation": evaluation}),
        Err(error) => json!({"id": id, "ok": false, "error": error}),
    }
}
