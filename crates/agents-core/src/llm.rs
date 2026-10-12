//! Языковая модель по протоколу OpenAI (LM Studio, Ollama и любой совместимый сервер): список моделей, запрос к чату,
//! уровень размышлений и потолок токенов, замер числа параллельных запросов. Нужна штабам на языковой модели
//! (staff.rs) и разговору с агентом в приложении.

use serde_json::{json, Value};
use std::io::BufRead;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

/// Уровень размышлений модели. Серверы понимают его по-разному, поэтому отправляется всё, что распространено:
/// `reasoning_effort` (OpenAI, LM Studio, Ollama), а для «выкл» ещё `chat_template_kwargs.enable_thinking = false`
/// (vLLM, llama.cpp), `think = false` (Ollama) и метка `/no_think` (Qwen3). Незнакомые поля серверы пропускают;
/// если сервер отверг запрос, он повторяется без этих полей.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Reasoning { Default, Off, Low, Medium, High }

impl Reasoning {
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s { "default" | "" => Self::Default, "off" => Self::Off, "low" => Self::Low, "medium" => Self::Medium, "high" => Self::High, _ => return None })
    }
    pub fn id(self) -> &'static str {
        match self { Self::Default => "default", Self::Off => "off", Self::Low => "low", Self::Medium => "medium", Self::High => "high" }
    }
}

#[derive(Clone, Debug)]
pub struct LlmConfig {
    /// Адрес сервера с /v1, например http://localhost:1234/v1.
    pub url: String,
    /// Модель (id из /v1/models).
    pub model: String,
    /// Сколько ждать очередной части ответа (поток) или всего ответа (без потока), с.
    pub timeout_s: u64,
    pub temperature: f64,
    pub reasoning: Reasoning,
    /// Потолок токенов ответа (вместе с размышлениями); 0 — без ограничения.
    pub max_tokens: u32,
    /// Одновременных запросов к серверу; 0 — определить замером (probe_parallel).
    pub parallel: usize,
    /// Штабы на модели решают в один час (иначе — вразнобой по часам, как штабы по доктрине): запросы одного часа
    /// уходят параллельно.
    pub sync: bool,
    /// Один запрос на армию: штаб армии решает за свои корпуса (быстрее, но корпус — уже не отдельный агент).
    pub by_army: bool,
}

impl LlmConfig {
    pub fn new(url: &str, model: &str) -> Self {
        LlmConfig {
            url: url.trim_end_matches('/').to_string(), model: model.to_string(), timeout_s: 300, temperature: 0.2,
            reasoning: Reasoning::Default, max_tokens: 0, parallel: 1, sync: false, by_army: false,
        }
    }
    pub fn describe(&self) -> Value {
        json!({ "url": self.url, "model": self.model, "reasoning": self.reasoning.id(), "maxTokens": self.max_tokens, "parallel": self.parallel, "sync": self.sync, "byArmy": self.by_army })
    }
}

/// Ответ модели.
#[derive(Clone, Debug)]
pub struct Reply {
    /// Ответ без размышлений.
    pub text: String,
    /// Размышления модели (поле reasoning_content / reasoning или <think>…</think> в тексте).
    pub reasoning: String,
    /// Ответ оборван потолком токенов (finish_reason = length).
    pub truncated: bool,
    /// Токенов ответа (по usage сервера, вместе с размышлениями), если сервер их сообщил.
    pub tokens: Option<u64>,
    pub secs: f64,
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

fn body(cfg: &LlmConfig, messages: &[(String, String)], extras: bool) -> Value {
    let mut msgs: Vec<Value> = messages.iter().map(|(r, c)| json!({ "role": r, "content": c })).collect();
    let mut b = json!({ "model": cfg.model, "temperature": cfg.temperature, "stream": true });
    if cfg.max_tokens > 0 { b["max_tokens"] = json!(cfg.max_tokens); }
    if extras {
        b["stream_options"] = json!({ "include_usage": true });
        match cfg.reasoning {
            Reasoning::Default => {}
            Reasoning::Off => {
                b["reasoning_effort"] = json!("low");
                b["chat_template_kwargs"] = json!({ "enable_thinking": false });
                b["think"] = json!(false);
                if let Some(last) = msgs.iter_mut().rev().find(|m| m["role"] == "user") {
                    last["content"] = json!(format!("{} /no_think", last["content"].as_str().unwrap_or("")));
                }
            }
            r => b["reasoning_effort"] = json!(r.id()),
        }
    }
    b["messages"] = json!(msgs);
    b
}

/// Часть ответа по мере прихода: размышления или сам ответ.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Part { Think, Text }

/// Разделение текста на размышления и ответ по меткам <think>…</think>, которые могут прийти по частям.
#[derive(Default)]
pub struct ThinkSplit { pending: String, inside: bool }

impl ThinkSplit {
    pub fn push(&mut self, s: &str, out: &mut Vec<(Part, String)>) {
        self.pending.push_str(s);
        loop {
            let tag = if self.inside { "</think>" } else { "<think>" };
            let part = if self.inside { Part::Think } else { Part::Text };
            if let Some(k) = self.pending.find(tag) {
                if k > 0 { out.push((part, self.pending[..k].to_string())); }
                self.pending = self.pending[k + tag.len()..].to_string();
                self.inside = !self.inside;
                continue;
            }
            // хвост, который может оказаться началом метки, ждёт следующей части (метка — латиница, граница символа цела)
            let keep = (1..tag.len()).rev().find(|&n| self.pending.ends_with(&tag[..n])).unwrap_or(0);
            let cut = self.pending.len() - keep;
            if cut > 0 { out.push((part, self.pending[..cut].to_string())); self.pending = self.pending[cut..].to_string(); }
            break;
        }
    }
    pub fn finish(&mut self, out: &mut Vec<(Part, String)>) {
        if !self.pending.is_empty() { out.push((if self.inside { Part::Think } else { Part::Text }, std::mem::take(&mut self.pending))); }
    }
}

/// Запрос к чату с уровнем размышлений и потолком токенов из настроек.
pub fn complete(cfg: &LlmConfig, messages: &[(String, String)]) -> Result<Reply, String> {
    complete_stream(cfg, messages, &mut |_, _| {}, None)
}

/// Запрос к чату потоком: `on` получает размышления и ответ по мере прихода; `cancel` — остановка. Если сервер
/// ответил не потоком, а целиком, ответ разбирается так же. Ожидание каждой части — не дольше `timeout_s`.
pub fn complete_stream(cfg: &LlmConfig, messages: &[(String, String)], on: &mut dyn FnMut(Part, &str), cancel: Option<&AtomicBool>) -> Result<Reply, String> {
    let u = format!("{}/chat/completions", cfg.url);
    let t0 = Instant::now();
    let ag = ureq::AgentBuilder::new().timeout_connect(Duration::from_secs(15)).timeout_read(Duration::from_secs(cfg.timeout_s)).build();
    let send = |extras: bool| ag.post(&u).send_json(body(cfg, messages, extras));
    let resp = match send(true) {
        // сервер отверг незнакомые поля (размышления, учёт токенов в потоке) — без них
        Err(ureq::Error::Status(400 | 422, _)) => send(false),
        r => r,
    };
    let resp = resp.map_err(|e| format!("{u}: {e}"))?;
    let (mut text, mut reasoning) = (String::new(), String::new());
    let mut split = ThinkSplit::default();
    let mut parts: Vec<(Part, String)> = Vec::new();
    let mut emit = |parts: &mut Vec<(Part, String)>, text: &mut String, reasoning: &mut String| {
        for (p, s) in parts.drain(..) {
            match p { Part::Think => reasoning.push_str(&s), Part::Text => text.push_str(&s) }
            on(p, &s);
        }
    };
    let mut truncated = false;
    let mut tokens: Option<u64> = None;
    let mut chunks = 0u64;
    if resp.content_type() == "text/event-stream" {
        let rd = std::io::BufReader::new(resp.into_reader());
        for line in rd.lines() {
            if cancel.is_some_and(|c| c.load(Ordering::Relaxed)) { return Err("остановлено".into()); }
            let line = line.map_err(|e| format!("{u}: {e}"))?;
            let Some(data) = line.strip_prefix("data:").map(str::trim) else { continue };
            if data == "[DONE]" { break; }
            let Ok(v) = serde_json::from_str::<Value>(data) else { continue };
            if let Some(t) = v.pointer("/usage/completion_tokens").and_then(Value::as_u64) { tokens = Some(t); }
            let Some(c) = v.pointer("/choices/0") else { continue };
            if c.get("finish_reason").and_then(Value::as_str) == Some("length") { truncated = true; }
            let d = &c["delta"];
            for key in ["reasoning_content", "reasoning"] {
                if let Some(r) = d.get(key).and_then(Value::as_str).filter(|r| !r.is_empty()) { parts.push((Part::Think, r.to_string())); chunks += 1; }
            }
            if let Some(t) = d.get("content").and_then(Value::as_str).filter(|t| !t.is_empty()) { split.push(t, &mut parts); chunks += 1; }
            emit(&mut parts, &mut text, &mut reasoning);
        }
    } else {
        let v: Value = resp.into_json().map_err(|e| format!("{u}: {e}"))?;
        let c = &v["choices"][0];
        truncated = c.get("finish_reason").and_then(Value::as_str) == Some("length");
        tokens = v.pointer("/usage/completion_tokens").and_then(Value::as_u64);
        for key in ["reasoning_content", "reasoning"] {
            if let Some(r) = c["message"].get(key).and_then(Value::as_str).filter(|r| !r.is_empty()) { parts.push((Part::Think, r.to_string())); }
        }
        split.push(c["message"]["content"].as_str().unwrap_or(""), &mut parts);
    }
    split.finish(&mut parts);
    emit(&mut parts, &mut text, &mut reasoning);
    // шаблон уже открыл <think> в запросе: в ответе только закрывающая метка — всё до неё размышления
    if let Some(k) = text.find("</think>") { reasoning.push_str(&text[..k]); text = text[k + 8..].to_string(); }
    if text.trim().is_empty() && reasoning.is_empty() && !truncated { return Err("в ответе модели нет текста".into()); }
    Ok(Reply { text: text.trim().to_string(), reasoning, truncated, tokens: tokens.or((chunks > 0).then_some(chunks)), secs: t0.elapsed().as_secs_f64() })
}

/// Запрос к чату: сообщения (роль, текст) → текст ответа.
pub fn chat(cfg: &LlmConfig, messages: &[(String, String)]) -> Result<String, String> {
    complete(cfg, messages).map(|r| r.text)
}

/// Замер: сколько запросов сервер с этой моделью обслуживает одновременно с выгодой.
#[derive(Clone, Debug)]
pub struct Probe {
    pub best: usize,
    /// (одновременных запросов, токенов в секунду всего, секунд на ступень).
    pub rows: Vec<(usize, f64, f64)>,
}

impl Probe {
    pub fn to_json(&self) -> Value {
        json!({ "best": self.best, "rows": self.rows.iter().map(|r| json!({ "parallel": r.0, "tokensPerSec": (r.1 * 10.0).round() / 10.0, "secs": (r.2 * 10.0).round() / 10.0 })).collect::<Vec<_>>() })
    }
}

/// Определение числа параллельных запросов замером: короткие одинаковые ответы на 1, 2, 4, 8… одновременных
/// запросах; суммарная скорость (токенов в секунду) растёт, пока сервер и чип справляются. Берётся ступень, после
/// которой прибавка меньше 20 %, или последняя без ошибок. Сначала — один запрос на разогрев (загрузка модели).
pub fn probe_parallel(cfg: &LlmConfig, max: usize) -> Result<Probe, String> {
    let mut c = cfg.clone();
    c.reasoning = Reasoning::Off;
    c.max_tokens = 96;
    c.temperature = 0.0;
    let msgs = vec![("user".to_string(), "Перечисли через запятую словами числа от одного до шестидесяти, без пояснений.".to_string())];
    complete(&c, &msgs)?;
    let mut rows: Vec<(usize, f64, f64)> = Vec::new();
    let mut n = 1;
    while n <= max.max(1) {
        let t0 = Instant::now();
        let res: Vec<Result<Reply, String>> = std::thread::scope(|s| {
            let hs: Vec<_> = (0..n).map(|_| s.spawn(|| complete(&c, &msgs))).collect();
            hs.into_iter().map(|h| h.join().unwrap_or_else(|_| Err("поток упал".into()))).collect()
        });
        let secs = t0.elapsed().as_secs_f64();
        if res.iter().any(|r| r.is_err()) { break; }
        let toks: f64 = res.iter().flatten().map(|r| r.tokens.map(|t| t as f64).unwrap_or(r.text.chars().count() as f64 / 3.0)).sum();
        let tps = toks / secs.max(1e-6);
        let gain = rows.last().map(|r| tps / r.1.max(1e-9));
        rows.push((n, tps, secs));
        if matches!(gain, Some(g) if g < 1.2) { break; }
        n *= 2;
    }
    if rows.is_empty() { return Err("сервер не ответил на замер".into()); }
    // лучшая ступень — последняя, давшая прибавку не меньше 20 % к предыдущей
    let mut best = rows[0].0;
    for w in rows.windows(2) { if w[1].1 >= w[0].1 * 1.2 { best = w[1].0; } else { break; } }
    Ok(Probe { best, rows })
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
    #[test]
    fn reasoning_fields() {
        let mut c = LlmConfig::new("http://x/v1", "m");
        let m = vec![("user".to_string(), "вопрос".to_string())];
        assert!(body(&c, &m, true).get("max_tokens").is_none());
        c.max_tokens = 500;
        c.reasoning = Reasoning::Off;
        let b = body(&c, &m, true);
        assert_eq!(b["max_tokens"], 500);
        assert_eq!(b["chat_template_kwargs"]["enable_thinking"], false);
        assert!(b["messages"][0]["content"].as_str().unwrap().ends_with("/no_think"));
        c.reasoning = Reasoning::High;
        assert_eq!(body(&c, &m, true)["reasoning_effort"], "high");
        assert!(body(&c, &m, false).get("reasoning_effort").is_none());
    }
    #[test]
    fn think_split_by_parts() {
        let mut sp = ThinkSplit::default();
        let mut out = Vec::new();
        for p in ["<th", "ink>опен", "ка</th", "ink>{\"orders\"", ": []}"] { sp.push(p, &mut out); }
        sp.finish(&mut out);
        let think: String = out.iter().filter(|x| x.0 == Part::Think).map(|x| x.1.as_str()).collect();
        let text: String = out.iter().filter(|x| x.0 == Part::Text).map(|x| x.1.as_str()).collect();
        assert_eq!(think, "опенка");
        assert_eq!(text, "{\"orders\": []}");
    }
}
