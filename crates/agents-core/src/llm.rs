//! Языковая модель по протоколу OpenAI (LM Studio и любой совместимый сервер): список моделей и запрос к чату.
//! Нужна штабам на языковой модели (staff.rs) и разговору с агентом в приложении.

use serde_json::{json, Value};
use std::time::Duration;

#[derive(Clone, Debug)]
pub struct LlmConfig {
    /// Адрес сервера с /v1, например http://localhost:1234/v1.
    pub url: String,
    /// Модель (id из /v1/models).
    pub model: String,
    pub timeout_s: u64,
    pub temperature: f64,
}

impl LlmConfig {
    pub fn new(url: &str, model: &str) -> Self {
        LlmConfig { url: url.trim_end_matches('/').to_string(), model: model.to_string(), timeout_s: 600, temperature: 0.2 }
    }
}

fn agent(timeout_s: u64) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(Duration::from_secs(timeout_s)).build()
}

/// Модели сервера: id из /v1/models.
pub fn list_models(url: &str) -> Result<Vec<String>, String> {
    let u = format!("{}/models", url.trim_end_matches('/'));
    let v: Value = agent(15).get(&u).call().map_err(|e| format!("{u}: {e}"))?.into_json().map_err(|e| format!("{u}: {e}"))?;
    let mut ids: Vec<String> = v.get("data").and_then(Value::as_array).map(|a| a.iter().filter_map(|m| m.get("id").and_then(Value::as_str).map(String::from)).collect()).unwrap_or_default();
    ids.sort();
    Ok(ids)
}

/// Запрос к чату: сообщения (роль, текст) → ответ модели.
pub fn chat(cfg: &LlmConfig, messages: &[(String, String)]) -> Result<String, String> {
    let u = format!("{}/chat/completions", cfg.url);
    let body = json!({
        "model": cfg.model,
        "temperature": cfg.temperature,
        "messages": messages.iter().map(|(r, c)| json!({ "role": r, "content": c })).collect::<Vec<_>>(),
    });
    let v: Value = agent(cfg.timeout_s).post(&u).send_json(body).map_err(|e| format!("{u}: {e}"))?.into_json().map_err(|e| format!("{u}: {e}"))?;
    v.pointer("/choices/0/message/content").and_then(Value::as_str).map(String::from).ok_or_else(|| "в ответе модели нет текста".into())
}

/// JSON из ответа модели: без рассуждений <think>…</think> и обрамления ```json, от первой «{» до последней «}».
pub fn extract_json(s: &str) -> Option<Value> {
    let s = match (s.find("<think>"), s.rfind("</think>")) { (Some(_), Some(b)) => &s[b + 8..], _ => s };
    let (a, b) = (s.find('{')?, s.rfind('}')?);
    if b <= a { return None; }
    serde_json::from_str(&s[a..=b]).ok()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn json_from_reply() {
        let v = extract_json("<think>думаю</think>\n```json\n{\"orders\": [{\"division\": \"de_5jd\"}]}\n```").unwrap();
        assert_eq!(v["orders"][0]["division"], "de_5jd");
        assert!(extract_json("нет json").is_none());
    }
}
