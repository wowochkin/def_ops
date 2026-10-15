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
    let (path, hours) = route::find(&t, &r, Side::Su, Mobility::Foot, from, to, &route::plain(&all_open)).expect("пеший путь есть");
    assert!(path.len() > 50);
    // около 90 км по прямой: пешком по дорогам при 4 км/ч — не меньше суток чистого движения
    assert!(hours > 20.0 && hours < 80.0, "{hours}");
    // без мостов пехота форсирует с задержкой, технике наводят переправу (march.bridgingHours) — не обход:
    // путь техники без мостов дольше пути по мостам примерно на время наведения (место переправы может быть другим)
    let none_open = |_: u16| false;
    let (_, foot_h) = route::find(&t, &r, Side::Su, Mobility::Foot, from, to, &route::plain(&none_open)).expect("пехота форсирует");
    assert!(foot_h >= hours);
    let (_, tank_open) = route::find(&t, &r, Side::Su, Mobility::Tracked, from, to, &route::plain(&all_open)).expect("по мостам");
    let (_, tank_none) = route::find(&t, &r, Side::Su, Mobility::Tracked, from, to, &route::plain(&none_open)).expect("по наведённой переправе");
    assert!(tank_none > tank_open + 0.5 * r.bridging_hours && tank_none < tank_open + 3.0 * r.bridging_hours, "{tank_open} → {tank_none}");
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
            } else if req.contains("советской доктрине") {
                // советский штаб армии: первую дивизию — в наступление на цель замысла
                let id = req.split("\\\"id\\\":\\\"su_").nth(1).and_then(|r| r.split('\\').next()).map(|r| format!("su_{r}")).unwrap_or("x".into());
                let content = format!("{{\"orders\": [{{\"division\": \"{id}\", \"action\": \"attack\", \"target\": null, \"reason\": \"первый эшелон\"}}]}}");
                serde_json::json!({ "choices": [{ "message": { "content": content } }] }).to_string()
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

/// Поток ответа (text/event-stream): размышления полем reasoning_content и меткой <think> по частям, затем ответ.
#[test]
fn language_model_stream() {
    use std::io::{Read, Write};
    let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let addr = l.local_addr().unwrap();
    std::thread::spawn(move || {
        for s in l.incoming() {
            let Ok(mut s) = s else { continue };
            let mut buf = [0u8; 65536];
            let _ = s.read(&mut buf);
            let ev = |d: serde_json::Value| format!("data: {d}\n\n");
            let mut body = String::new();
            body += &ev(serde_json::json!({ "choices": [{ "delta": { "reasoning_content": "сначала " } }] }));
            for c in ["<thi", "nk>оцен", "ка</th", "ink>{\"orders\"", ": []}"] { body += &ev(serde_json::json!({ "choices": [{ "delta": { "content": c } }] })); }
            body += &ev(serde_json::json!({ "choices": [{ "delta": {}, "finish_reason": "stop" }] }));
            body += &ev(serde_json::json!({ "choices": [], "usage": { "completion_tokens": 42 } }));
            body += "data: [DONE]\n\n";
            let _ = write!(s, "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}", body.len(), body);
        }
    });
    let cfg = agents_core::llm::LlmConfig::new(&format!("http://{addr}/v1"), "m");
    let mut seen = Vec::new();
    let r = agents_core::llm::complete_stream(&cfg, &[("user".into(), "?".into())], &mut |p, s| seen.push((p, s.to_string())), None).unwrap();
    assert_eq!(r.reasoning, "сначала оценка");
    assert_eq!(r.text, "{\"orders\": []}");
    assert_eq!(r.tokens, Some(42));
    assert!(seen.len() >= 4 && seen[0].0 == agents_core::llm::Part::Think);
}

/// Остатки: немецкая дивизия ниже четверти исходной численности выходит из боя и через сутки сводится в соседнюю;
/// советская стрелковая ниже 2000 человек выводится в резерв и не сводится.
#[test]
fn remnants_withdraw_and_merge() {
    use agents_core::model::State;
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (mut sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    let de = sim.world.divisions.iter().position(|d| d.side == Side::De).unwrap();
    let su = sim.world.divisions.iter().position(|d| d.side == Side::Su && d.params.kind == "sd").unwrap();
    let p0 = sim.world.divisions[de].vars.personnel0;
    sim.world.divisions[de].vars.personnel = 0.2 * p0;
    sim.world.divisions[su].vars.personnel = 1500.0;
    sim.step();
    assert_eq!(sim.world.divisions[de].state, State::Remnant);
    assert_eq!(sim.world.divisions[su].state, State::Remnant);
    for _ in 0..26 { sim.step(); }
    assert_eq!(sim.world.divisions[de].state, State::Merged);
    assert_eq!(sim.world.divisions[su].state, State::Remnant);
    assert!(sim.journal.iter().any(|e| e.text.contains("приняла остатки")));
    assert!(sim.world.divisions[de].note.contains("сведена в"));
}

/// Вся операция: сценарий читается, соединения с поздним вводом ждут его, цель-соединение берётся по месту.
#[test]
fn berlin_scenario_loads_and_runs() {
    use agents_core::model::State;
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json");
    let (mut sim, meta) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    assert!(sim.world.divisions.len() > 300, "{}", sim.world.divisions.len());
    assert_eq!(meta.hours, 384);
    let pending: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| sim.world.divisions[i].state == State::Pending).collect();
    assert!(!pending.is_empty());
    for _ in 0..24 { sim.step(); }
    assert!(sim.world.divisions.iter().filter(|d| d.side == Side::Su).any(|d| matches!(d.state, State::Attack(_))));
    let still = pending.iter().filter(|&&i| sim.world.divisions[i].state == State::Pending).count();
    assert!(still > 0, "28 А вводится 20.04 — через сутки ещё не введена");
}

/// Советские штабы по доктрине: второй эшелон и танковые армии ждут, затем вводятся по правилам.
#[test]
fn soviet_doctrine_echelons() {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (mut sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    sim.sources[0] = agents_core::staff::Source::Doctrine;
    sim.step();
    assert!(sim.journal.iter().any(|e| e.text.contains("второй эшелон армии")));
    assert!(sim.journal.iter().any(|e| e.text.contains("подвижная группа: ждёт прорыва")));
    for _ in 0..60 { sim.step(); }
    assert!(sim.journal.iter().any(|e| e.text.contains("ввод подвижной группы") || e.text.contains("ввод для завершения прорыва")));
    assert!(sim.journal.iter().any(|e| e.text.contains("ввод второго эшелона") || e.text.contains("смена вторым эшелоном") || e.text.contains("2–3-й день")));
}

/// Город: обводы Берлина размечают клетки театра (внешний — 1, кольцо S-Bahn — 2, «Цитадель» — 3).
#[test]
fn berlin_city_rings() {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json");
    let (sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    let t = &sim.theatre;
    let at = |p: [f64; 2]| t.city[t.cell_of(p).unwrap()];
    assert_eq!(at([13.3761, 52.5187]), 3, "Рейхстаг — «Цитадель»");
    assert_eq!(at([13.4017, 52.4733]), 2, "Темпельхоф — внутри кольца S-Bahn");
    assert_eq!(at([13.55, 52.47]), 1, "Обершёневайде — внутри внешнего обвода");
    assert_eq!(at([14.38, 52.53]), 0, "Зеелов — не город");
}

/// Окружение и прорыв: к концу операции гарнизон Берлина окружён, дивизии 9 А из котла у Хальбе вышли с прорывом,
/// советские дивизии в городе не «окружены» немецкими секторами.
#[test]
fn pocket_and_breakout() {
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json");
    let (mut sim, meta) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    let mut berlin_cut = false;
    let reichstag = sim.theatre.proj.to_xy([13.3761, 52.5187]);
    let mut su_city = 0;
    for _ in 0..meta.hours {
        sim.step();
        let tick = sim.world.tick;
        su_city += sim.world.divisions.iter().filter(|d| d.side == Side::Su && d.vars.pos.dist(reichstag) < 10.0 && sim.encircled(d, tick)).count();
        if sim.world.tick == 300 {
            let tick = sim.world.tick;
            berlin_cut = sim.world.divisions.iter().filter(|d| d.id.starts_with("de_sector_")).any(|d| sim.encircled(d, tick));
        }
    }
    assert!(berlin_cut, "гарнизон Берлина к 28.04 окружён");
    assert!(sim.journal.iter().any(|e| e.text.contains("вышла с прорывом")), "есть вышедшие с прорывом");
    // советские дивизии в городе не «окружены» немецкими секторами гарнизона (свои рядом держат коридор)
    assert_eq!(su_city, 0, "часов советских дивизий в окружении в городе");
    // прорыв из котла — только у немецкой стороны
    assert!(!sim.journal.iter().any(|e| e.text.contains("вышла с прорывом") && sim.world.divisions[e.agent as usize].side == Side::Su));
}

/// Советские штабы на языковой модели: решает штаб армии за все её дивизии, наступление — на цель замысла.
#[test]
fn soviet_staff_on_language_model() {
    let url = mock_llm();
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (mut sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    sim.sources[0] = agents_core::staff::Source::Llm;
    sim.llm = Some(agents_core::llm::LlmConfig::new(&url, "qwen-test"));
    for _ in 0..6 { sim.step(); }
    let log = sim.llm_log.lock().unwrap().clone();
    assert!(!log.is_empty() && log.iter().all(|e| e["ok"] == true), "{log:?}");
    assert!(log.iter().all(|e| e["hq"].as_str().unwrap().starts_with("su_")));
    assert!(sim.journal.iter().any(|e| e.text.contains("решение штаба (модель)") && e.text.contains("наступать")));
}

/// Штабы на модели с доктриной из базы знаний: текст из окна заменяет зашитое предложение доктрины в промпте;
/// без текста — прежний промпт.
#[test]
fn staff_doctrine_text_from_kb() {
    let url = mock_llm();
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let run = |text: Option<&str>| {
        let (mut sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
        sim.sources[1] = agents_core::staff::Source::Llm;
        sim.doctrine_text[1] = text.map(String::from);
        sim.llm = Some(agents_core::llm::LlmConfig::new(&url, "qwen-test"));
        for _ in 0..2 { sim.step(); }
        let log = sim.llm_log.lock().unwrap().clone();
        log
    };
    let log = run(Some("ПРАВИЛО ИЗ БАЗЫ: контратака во фланг силами не меньше 1/3"));
    assert!(!log.is_empty() && log.iter().all(|e| e["ok"] == true), "{log:?}");
    for e in &log {
        let s = e["system"].as_str().expect("system в журнале");
        assert!(s.contains("ПРАВИЛО ИЗ БАЗЫ") && s.contains("правила из базы знаний"), "{s}");
        assert!(!s.contains("немедленная контратака резервом во фланг"), "{s}");
    }
    let log = run(None);
    assert!(!log.is_empty());
    for e in &log {
        let s = e["system"].as_str().expect("system в журнале");
        assert!(s.contains("немедленная контратака резервом во фланг") && !s.contains("правила из базы знаний"), "{s}");
    }
}

/// Советские штабы на модели с доктриной из базы: текст в промпте, слова «советской доктрине» остаются.
#[test]
fn soviet_staff_doctrine_text_from_kb() {
    let url = mock_llm();
    let root = repo_root();
    let path = format!("{root}/packages/sim/data/scenarios/agents/seelow-1945.json");
    let (mut sim, _) = agents_core::scenario::load(&path, &format!("{root}/{DATA_DIR}"), &root).expect("сценарий");
    sim.sources[0] = agents_core::staff::Source::Llm;
    sim.doctrine_text[0] = Some("ПРАВИЛО ИЗ БАЗЫ: второй эшелон — на третий день".into());
    sim.llm = Some(agents_core::llm::LlmConfig::new(&url, "qwen-test"));
    for _ in 0..6 { sim.step(); }
    let log = sim.llm_log.lock().unwrap().clone();
    assert!(!log.is_empty() && log.iter().all(|e| e["ok"] == true), "{log:?}");
    for e in &log {
        let s = e["system"].as_str().expect("system в журнале");
        assert!(s.contains("ПРАВИЛО ИЗ БАЗЫ: второй эшелон — на третий день") && s.contains("советской доктрине"), "{s}");
        assert!(!s.contains("стрелковые дивизии — в два эшелона"), "{s}");
    }
    assert!(sim.journal.iter().any(|e| e.text.contains("решение штаба (модель)") && e.text.contains("наступать")));
}

#[test]
fn staff_pontoon_and_sector_preference() {
    let (t, r) = setup();
    let from = t.land_cell_near(t.proj.to_xy([14.70, 52.58])).unwrap();
    let to = t.land_cell_near(t.proj.to_xy([13.40, 52.52])).unwrap();
    let none_open = |_: u16| false;
    let (_, tank_none) = route::find(&t, &r, Side::Su, Mobility::Tracked, from, to, &route::plain(&none_open)).unwrap();
    // наведённая переправа штаба: переход реки без задержки наведения — как по мосту
    let (_, tank_pont) = route::find(&t, &r, Side::Su, Mobility::Tracked, from, to, &route::Ways { bridge_open: &none_open, pontoon: &|_, _| true, prefer: &|_| 1.0 }).unwrap();
    assert!(tank_pont < tank_none - 0.5 * r.bridging_hours, "{tank_none} → {tank_pont}");
    // полоса соседа: клетки севернее 52.55° «дороже» — путь уходит южнее
    let north = |c: usize| t.centers[c].y > t.proj.to_xy([14.0, 52.55]).y;
    let plain_path = route::find(&t, &r, Side::Su, Mobility::Foot, from, to, &route::plain(&none_open)).unwrap().0;
    let pref = |c: usize| if north(c) { 5.0 } else { 1.0 };
    let pref_path = route::find(&t, &r, Side::Su, Mobility::Foot, from, to, &route::Ways { bridge_open: &none_open, pontoon: &|_, _| false, prefer: &pref }).unwrap().0;
    let n = |p: &Vec<u32>| p.iter().filter(|&&c| north(c as usize)).count();
    assert!(n(&pref_path) < n(&plain_path), "{} → {}", n(&plain_path), n(&pref_path));
}
