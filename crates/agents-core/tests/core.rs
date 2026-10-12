//! Проверки ядра на настоящем театре «Одер — Берлин»: маршрут через Одер, воспроизводимость на разном числе потоков,
//! машина состояний (марш → развёртывание → атака).

use agents_core::model::{Mobility, Side, State};
use agents_core::route;
use agents_core::rules::Rules;
use agents_core::scenario::synthetic;
use agents_core::theatre::Theatre;
use agents_core::{repo_root, DATA_DIR};
use std::sync::Arc;

fn setup() -> (Arc<Theatre>, Rules) {
    let root = repo_root();
    let t = Theatre::load(&format!("{root}/packages/sim/data/theatres/oder-berlin-1945.json")).expect("театр");
    let r = Rules::load(&format!("{root}/{DATA_DIR}")).expect("правила");
    (Arc::new(t), r)
}

#[test]
fn route_across_oder_to_berlin() {
    let (t, r) = setup();
    // от Кюстрина (восточный берег) до Берлина
    let from = t.land_cell_near(t.proj.to_xy([14.70, 52.58])).unwrap();
    let to = t.land_cell_near(t.proj.to_xy([13.40, 52.52])).unwrap();
    let all_open = |_: u16| true;
    let (path, hours) = route::find(&t, &r, Side::Su, Mobility::Foot, from, to, &all_open).expect("пеший путь есть");
    assert!(path.len() > 50);
    // около 90 км по прямой: пешком по дорогам при 4 км/ч — не меньше суток чистого движения
    assert!(hours > 20.0 && hours < 80.0, "{hours}");
    // без мостов технике через Одер хода нет (в том числе в обход через побережье: проливы Свина, Дзивна и
    // Пенештром — большие реки театра), пехота форсирует с задержкой
    let none_open = |_: u16| false;
    assert!(route::find(&t, &r, Side::Su, Mobility::Tracked, from, to, &none_open).is_none());
    let (_, foot_h) = route::find(&t, &r, Side::Su, Mobility::Foot, from, to, &none_open).expect("пехота форсирует");
    assert!(foot_h >= hours);
}

fn run(threads: usize, hours: u32) -> (u64, usize) {
    let (t, r) = setup();
    let pool = rayon::ThreadPoolBuilder::new().num_threads(threads).build().unwrap();
    let mut sim = synthetic(t, r, 60, 300, 7, "1945-04-16T03:00");
    pool.install(|| for _ in 0..hours { sim.step(); });
    (sim.digest(), sim.journal.len())
}

#[test]
fn same_result_on_any_thread_count() {
    let a = run(1, 72);
    let b = run(3, 72);
    assert_eq!(a, b);
}

#[test]
fn attackers_march_deploy_and_attack() {
    let (t, r) = setup();
    let mut sim = synthetic(t, r, 40, 0, 3, "1945-04-16T03:00");
    let mut seen_deploy = false;
    let mut seen_attack = false;
    for _ in 0..48 {
        sim.step();
        for d in sim.world.divisions.iter().filter(|d| d.side == Side::Su) {
            seen_deploy |= matches!(d.state, State::Deploy { .. });
            seen_attack |= matches!(d.state, State::Attack(_));
        }
    }
    assert!(seen_deploy && seen_attack);
    // каждая смена состояния записана с причиной
    assert!(sim.journal.iter().any(|e| e.text.contains("развёртывается для атаки")));
}

#[test]
fn seelow_scenario_loads_and_runs() {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (mut sim, meta) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    assert_eq!(meta.hours, 96);
    assert!(sim.world.divisions.len() > 60);
    for _ in 0..24 { sim.step(); }
    // за первые сутки советские дивизии развернулись и атакуют, приказы дошли до всех
    let attacking = sim.world.divisions.iter().filter(|d| d.side == Side::Su && matches!(d.state, State::Attack(_) | State::Deploy { .. })).count();
    assert!(attacking > 20, "{attacking}");
    assert!(sim.world.divisions.iter().all(|d| d.order.is_some()));
}

/// Заглушка сервера модели по протоколу OpenAI: на любой запрос к чату отвечает приказом «держаться» первой дивизии
/// из обстановки; /models — список из двух моделей; при потолке 7 токенов — оборванный ответ.
fn mock_llm() -> String {
    use std::io::{Read, Write};
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    std::thread::spawn(move || {
        for s in l.incoming() {
            let Ok(mut s) = s else { continue };
            let mut buf = vec![0u8; 1 << 20];
            let mut n = 0;
            // заголовки и тело (по Content-Length)
            loop {
                let k = s.read(&mut buf[n..]).unwrap_or(0);
                if k == 0 { break; }
                n += k;
                let text = String::from_utf8_lossy(&buf[..n]);
                if let Some(h) = text.find("\r\n\r\n") {
                    let len = text.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0))).unwrap_or(0);
                    if n >= h + 4 + len { break; }
                }
            }
            let req = String::from_utf8_lossy(&buf[..n]).to_string();
            let body = if req.starts_with("GET") {
                r#"{"data":[{"id":"qwen-test"},{"id":"other"}]}"#.to_string()
            } else if req.contains("\"max_tokens\":7") {
                // потолок токенов: ответ оборван на размышлениях
                r#"{"choices":[{"message":{"content":"<think>оцениваю обстановку"},"finish_reason":"length"}],"usage":{"completion_tokens":7}}"#.to_string()
            } else {
                let id = req.split("\\\"id\\\":\\\"de_").nth(1).and_then(|r| r.split('\\').next()).map(|r| format!("de_{r}")).unwrap_or("x".into());
                let content = format!("<think>оцениваю</think>{{\"orders\": [{{\"division\": \"{id}\", \"action\": \"hold\", \"target\": null, \"reason\": \"держать рубеж по приказу\"}}]}}");
                serde_json::json!({ "choices": [{ "message": { "content": content } }] }).to_string()
            };
            let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        }
    });
    format!("http://{addr}/v1")
}

#[test]
fn staff_on_language_model() {
    let url = mock_llm();
    assert_eq!(agents_core::llm::list_models(&url).unwrap(), vec!["other".to_string(), "qwen-test".to_string()]);
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (mut sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    sim.sources[1] = agents_core::staff::Source::Llm;
    sim.llm = Some(agents_core::llm::LlmConfig::new(&url, "qwen-test"));
    for _ in 0..2 { sim.step(); }
    let log = sim.llm_log.lock().unwrap().clone();
    assert!(!log.is_empty() && log.iter().all(|e| e["ok"] == true));
    assert!(sim.journal.iter().any(|e| e.text.contains("языковая модель qwen-test") && e.text.contains("держаться")));
    // сервер недоступен — решает доктрина, и это видно в журнале
    let (mut sim2, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).unwrap();
    sim2.sources[1] = agents_core::staff::Source::Llm;
    sim2.llm = Some(agents_core::llm::LlmConfig::new("http://127.0.0.1:9/v1", "нет"));
    sim2.step();
    assert!(sim2.journal.iter().any(|e| e.text.contains("по доктрине: модель не дала решения")));
}

#[test]
fn staff_on_language_model_options() {
    let url = mock_llm();
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let load = || {
        let (mut sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
        sim.sources[1] = agents_core::staff::Source::Llm;
        sim
    };
    // корпуса в один час, три запроса одновременно
    let mut sim = load();
    let mut c = agents_core::llm::LlmConfig::new(&url, "qwen-test");
    c.sync = true;
    c.parallel = 3;
    sim.llm = Some(c.clone());
    sim.step();
    let log = sim.llm_log.lock().unwrap().clone();
    assert_eq!(log.len(), 3, "по запросу на корпус");
    // один запрос на армию за все корпуса
    let mut sim = load();
    c.by_army = true;
    sim.llm = Some(c.clone());
    sim.step();
    assert_eq!(sim.llm_log.lock().unwrap().len(), 1);
    assert!(sim.journal.iter().any(|e| e.text.contains("за корпуса") && e.text.contains("держаться")));
    // ответ оборван потолком токенов — решает доктрина, причина в журнале
    let mut sim = load();
    c.by_army = false;
    c.max_tokens = 7;
    c.reasoning = agents_core::llm::Reasoning::Off;
    sim.llm = Some(c);
    sim.step();
    assert!(sim.journal.iter().any(|e| e.text.contains("ответ оборван потолком токенов (7)")));
}
