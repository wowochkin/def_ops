//! Командующие: профили характера и мотивов, загрузка, поправки, защита от подсказки.

use agents_core::commander::{Motive, Trait};
use agents_core::rules::Rules;
use agents_core::{repo_root, DATA_DIR};
use serde_json::json;

fn data() -> String { format!("{}/{DATA_DIR}", repo_root()) }

#[test]
fn profiles_load() {
    let rules = Rules::load(&data()).expect("правила");
    let c = &rules.commanders;
    assert_eq!(c.for_hq("su_1bf").unwrap().id, "zhukov");
    assert_eq!(c.for_hq("su_1bf_vo").unwrap().id, "zhukov");
    assert_eq!(c.for_hq("su_1uf").unwrap().rival.as_deref(), Some("zhukov"));
    assert!(c.for_hq("нет_такого").is_none());
    assert_eq!(c.profiles.len(), 15);
    for p in &c.profiles {
        for t in [Trait::Risk, Trait::Persistence, Trait::Ambition, Trait::LossTolerance, Trait::Obedience] {
            let v = p.traits.get(t);
            assert!((0.0..=1.0).contains(&v), "{} {:?} = {v}", p.id, t);
        }
        for m in p.motives.0 { assert!((0.0..=1.0).contains(&m), "{} мотив {m}", p.id); }
    }
    assert!(c.profiles.iter().any(|p| p.motives.0[Motive::Rival as usize] > 0.0));
    assert_eq!(c.cycle.front, 12);
    assert_eq!(c.cycle.army, 6);
    assert_eq!(c.cycle.high, 24);
    assert_eq!(c.lookahead_hours, 0);
}

#[test]
fn override_trait() {
    let o = json!({"commanders.profiles.zhukov.traits.risk": 0.3});
    let rules = Rules::load_with(&data(), Some(&o)).expect("правила");
    assert_eq!(rules.commanders.for_hq("su_1bf").unwrap().traits.get(Trait::Risk), 0.3);
}

#[test]
fn override_outside_range_fails() {
    let o = json!({"commanders.profiles.zhukov.traits.risk": 1.5});
    let e = Rules::load_with(&data(), Some(&o)).unwrap_err();
    assert!(e.contains("commanders.profiles.zhukov.traits.risk"), "{e}");
    let o = json!({"commanders.profiles.nobody.traits.risk": 0.3});
    let e = Rules::load_with(&data(), Some(&o)).unwrap_err();
    assert!(e.contains("нет параметра"), "{e}");
}

/// Совпадение с шаблоном «<слово на prefix…> 1945» или «<знак> <пробелы> цифра» без регулярных выражений.
fn hint(t: &str) -> Option<String> {
    let plain = ["1945-04", "1945-05", ".04.1945", ".05.1945", "11059", "11060", "11062", "Зеелов"];
    for p in plain { if t.contains(p) { return Some(p.into()); } }
    // (апрел|мая)\w* 1945
    for stem in ["апрел", "мая"] {
        for (i, _) in t.match_indices(stem) {
            let rest = &t[i + stem.len()..];
            let tail = rest.trim_start_matches(|c: char| c.is_alphanumeric() || c == '_');
            if tail.starts_with(" 1945") { return Some(format!("{stem}… 1945")); }
        }
    }
    // №\s*\d
    for (i, _) in t.match_indices('№') {
        if t[i + '№'.len_utf8()..].trim_start().chars().next().is_some_and(|c| c.is_ascii_digit()) { return Some("№ цифра".into()); }
    }
    // поворот\w* на Берлин
    for (i, _) in t.match_indices("поворот") {
        let tail = t[i + "поворот".len()..].trim_start_matches(|c: char| c.is_alphanumeric() || c == '_');
        if tail.starts_with(" на Берлин") { return Some("поворот… на Берлин".into()); }
    }
    None
}

/// В профилях и правилах командующих нет дат операции, номеров её приказов и названий её решений.
#[test]
fn no_operation_hints() {
    assert!(hint("в апреле 1945").is_some() && hint("№ 11").is_some() && hint("поворота на Берлин").is_some());
    assert!(hint("мемуары, 1969").is_none());
    let mut files = vec![format!("{}/rules/commanders.json", data())];
    let src = format!("{}/src/commander", env!("CARGO_MANIFEST_DIR"));
    for e in std::fs::read_dir(&src).unwrap() {
        let p = e.unwrap().path();
        if p.extension().is_some_and(|x| x == "rs") { files.push(p.to_string_lossy().into_owned()); }
    }
    for f in files {
        let t = std::fs::read_to_string(&f).unwrap();
        if let Some(h) = hint(&t) { panic!("{f}: {h}"); }
    }
}

/// Каждый штаб из `hqs` профилей есть хотя бы в одном сценарии agents/*.json (профили общие для операций, поэтому
/// при загрузке одной операции отсутствие штаба — не ошибка; опечатку ловит эта проверка).
#[test]
fn profile_hqs_exist_in_scenarios() {
    let root = repo_root();
    let dir = format!("{root}/packages/sim/data/scenarios/agents");
    let mut ids = std::collections::BTreeSet::new();
    let mut rules = None;
    for e in std::fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path().to_string_lossy().into_owned();
        if !p.ends_with(".json") || p.ends_with(".history.json") { continue; }
        let (sim, _) = agents_core::scenario::load_with(&p, &data(), &root, None, None).expect(&p);
        ids.extend(sim.world.hqs.iter().map(|h| h.id.clone()));
        rules = Some(sim.rules.commanders.clone());
    }
    let rules = rules.expect("сценарии");
    let missing: Vec<String> = rules.profiles.iter().flat_map(|p| p.hqs.iter().filter(|h| !ids.contains(*h)).map(move |h| format!("{}: {h}", p.id))).collect();
    assert!(missing.is_empty(), "штабов нет ни в одном сценарии: {missing:?}");
    let reserve: Vec<&String> = rules.okw_reserve_hqs.iter().filter(|h| !ids.contains(*h)).collect();
    assert!(reserve.is_empty(), "okwReserve.hqs: {reserve:?}");
}

/// Достоверность — из набора high | medium | low | assumption.
#[test]
fn confidence_in_allowed_set() {
    fn walk(v: &serde_json::Value, path: &str, n: &mut usize) {
        match v {
            serde_json::Value::Object(m) => for (k, x) in m {
                if k == "confidence" { *n += 1; assert!(matches!(x.as_str(), Some("high" | "medium" | "low" | "assumption")), "{path}: {x}"); }
                else { walk(x, &format!("{path}.{k}"), n); }
            },
            serde_json::Value::Array(a) => for x in a { walk(x, path, n); },
            _ => {}
        }
    }
    let t = std::fs::read_to_string(format!("{}/rules/commanders.json", data())).unwrap();
    let mut n = 0;
    walk(&serde_json::from_str(&t).unwrap(), "", &mut n);
    assert!(n > 100, "{n}");
}

/// Штаб в двух профилях и штаб не строкой — ошибки загрузки.
#[test]
fn bad_hqs_rejected() {
    let o = json!({"commanders.profiles.konev.hqs": ["su_1uf", "su_1bf"]});
    let e = Rules::load_with(&data(), Some(&o)).unwrap_err();
    assert!(e.contains("su_1bf") && e.contains("zhukov") && e.contains("konev"), "{e}");
    let o = json!({"commanders.profiles.konev.hqs": ["su_1uf", 5]});
    let e = Rules::load_with(&data(), Some(&o)).unwrap_err();
    assert!(e.contains("не строка"), "{e}");
}

/// Цель профиля — объект из раздела objectives; неизвестный объект — ошибка загрузки.
#[test]
fn objectives_load_and_unknown_rejected() {
    let rules = Rules::load(&data()).expect("правила");
    let c = &rules.commanders;
    assert_eq!(c.for_hq("su_1bf").unwrap().objective.as_deref(), Some("berlin"));
    assert_eq!(c.for_hq("su_1uf").unwrap().objective.as_deref(), Some("berlin"));
    assert_eq!(c.objectives.len(), 1);
    assert_eq!(c.objectives[0].0, "berlin");
    let o = json!({"commanders.profiles.konev.objective": "нет_такого"});
    let e = Rules::load_with(&data(), Some(&o)).unwrap_err();
    assert!(e.contains("нет_такого") && e.contains("konev"), "{e}");
}

mod picture {
    use super::*;
    use agents_core::commander::picture::{picture, DistLog};
    use agents_core::world::Sim;

    fn load(over: Option<&serde_json::Value>) -> Sim {
        let root = repo_root();
        let (sim, _) = agents_core::scenario::load_with(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &format!("{root}/{DATA_DIR}"), &root, over, None).expect("сценарий");
        sim
    }
    fn hq(sim: &Sim, id: &str) -> u32 { sim.world.hqs.iter().position(|h| h.id == id).expect(id) as u32 }
    fn run(sim: &mut Sim, hours: u32, log: &mut DistLog) { for _ in 0..hours { sim.step(); log.record(sim); } }

    #[test]
    fn picture_error_bounded() {
        for err in [None, Some(0.0)] {
            let o = err.map(|e| json!({"commanders.fog.strengthError": e}));
            let mut sim = load(o.as_ref());
            let mut log = DistLog::default();
            run(&mut sim, 24, &mut log);
            let e = sim.rules.commanders.fog.strength_error;
            let h = hq(&sim, "su_1bf");
            let p = picture(&sim, h, &log);
            assert!(!p.armies.is_empty());
            let mut checked = 0;
            for a in p.armies.iter().filter(|a| a.enemy_true > 0.0) {
                checked += 1;
                let r = (a.enemy_est / a.enemy_true - 1.0).abs();
                assert!(r <= e + 1e-9, "армия {} ошибка {r} > {e}", a.hq);
                if err == Some(0.0) { assert!(r < 1e-12); }
            }
            assert!(checked > 0);
        }
    }

    #[test]
    fn picture_same_seed_same() {
        let (mut a, mut b) = (load(None), load(None));
        let (mut la, mut lb) = (DistLog::default(), DistLog::default());
        run(&mut a, 12, &mut la);
        run(&mut b, 12, &mut lb);
        for id in ["su_1bf", "su_1uf"] {
            let h = hq(&a, id);
            assert_eq!(format!("{:?}", picture(&a, h, &la)), format!("{:?}", picture(&b, h, &lb)));
        }
    }

    #[test]
    fn rival_delayed() {
        let mut sim = load(None);
        let mut log = DistLog::default();
        run(&mut sim, 24, &mut log);
        let d = sim.rules.commanders.fog.report_delay_hours;
        let p = picture(&sim, hq(&sim, "su_1uf"), &log);
        let r = p.rival.expect("соперник");
        assert_eq!(r.as_of, sim.world.tick - d);
        assert!(r.to_objective_km > 0.0);
        // у Рокоссовского соперника нет — и сводки о нём нет
        assert!(sim.rules.commanders.for_hq("su_2bf").unwrap().rival.is_none());
        assert!(picture(&sim, hq(&sim, "su_2bf"), &log).rival.is_none());
    }

    #[test]
    fn rival_none_before_delay() {
        let mut sim = load(None);
        let mut log = DistLog::default();
        log.record(&sim);
        assert!(sim.rules.commanders.fog.report_delay_hours > 0);
        assert!(picture(&sim, hq(&sim, "su_1uf"), &log).rival.is_none());
        run(&mut sim, 2, &mut log);
        assert!(picture(&sim, hq(&sim, "su_1uf"), &log).rival.is_none());
    }

    /// Все дивизии, кроме названных армий, уносятся далеко: остаётся только расставленное руками.
    const FAR: f64 = 800.0;
    fn clear(sim: &mut Sim, keep: &[u32]) {
        for i in 0..sim.world.divisions.len() {
            let h = sim.world.divisions[i].hq;
            let mut x = h;
            let mut kept = keep.contains(&x);
            while !kept { match sim.world.hqs[x as usize].parent { Some(p) => { x = p; kept = keep.contains(&x); } None => break } }
            if !kept { sim.world.divisions[i].vars.pos = agents_core::geo::XY::new(FAR + i as f64 * 50.0, FAR); }
        }
    }
    fn set_army(sim: &mut Sim, a: u32, at: agents_core::geo::XY) {
        for d in sim.world.divisions.iter_mut() {
            if d.state.out() { continue; }
            let mut x = d.hq;
            loop { if x == a { d.vars.pos = at; break; } match sim.world.hqs[x as usize].parent { Some(p) => x = p, None => break } }
        }
    }
    /// Первая живая дивизия противника — для расстановки руками; остальные противники уносятся.
    fn lone_enemy(sim: &mut Sim) -> usize {
        let me = agents_core::model::Side::De;
        let live: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| sim.world.divisions[i].side == me && !sim.world.divisions[i].state.out()).collect();
        for &i in &live[1..] { sim.world.divisions[i].vars.pos = agents_core::geo::XY::new(FAR + i as f64 * 50.0, -FAR); }
        live[0]
    }
    fn army_view(sim: &Sim, log: &DistLog, a: u32) -> agents_core::commander::picture::ArmyView {
        picture(sim, hq(sim, "su_1bf"), log).armies.into_iter().find(|v| v.hq == a).expect("армия")
    }

    #[test]
    fn advance_and_breakthrough() {
        use agents_core::geo::XY;
        let mut sim = load(None);
        let a = hq(&sim, "su_8gva");
        let (contact, depth) = (sim.rules.contact_km, sim.rules.doctrine_su.tank_commit_depth_km);
        let e = lone_enemy(&mut sim);
        clear(&mut sim, &[a]);
        set_army(&mut sim, a, XY::new(0.0, 0.0));
        sim.world.divisions[e].vars.pos = XY::new(-FAR, FAR);
        let mut log = DistLog::default();
        log.record(&sim);
        assert_eq!(army_view(&sim, &log, a).advance_km, 0.0);
        assert!(!army_view(&sim, &log, a).broke_through);
        // прошла глубину ввода подвижных групп, обороняющегося впереди нет
        set_army(&mut sim, a, XY::new(depth + 10.0, 0.0));
        let v = army_view(&sim, &log, a);
        assert!((v.advance_km - (depth + 10.0)).abs() < 1e-6, "{}", v.advance_km);
        assert!(v.broke_through);
        // обороняющийся противник впереди в пределах соприкосновения — прорыва нет
        sim.world.divisions[e].vars.pos = XY::new(depth + 10.0 + contact * 0.5, 0.0);
        sim.world.divisions[e].state = agents_core::model::State::Defense(agents_core::model::DefenseSub::Prepared);
        assert!(!army_view(&sim, &log, a).broke_through);
        // продвинулась меньше — прорыва нет и без противника
        sim.world.divisions[e].vars.pos = XY::new(-FAR, FAR);
        set_army(&mut sim, a, XY::new(depth - 5.0, 0.0));
        assert!(!army_view(&sim, &log, a).broke_through);
    }

    /// Продвижение — вдоль оси замысла фронта: смещение поперёк оси продвижением не считается.
    #[test]
    fn advance_along_front_axis() {
        use agents_core::command::directive::{Directive, Form, Target, Task};
        use agents_core::geo::XY;
        let mut sim = load(None);
        let (f, a) = (hq(&sim, "su_1bf"), hq(&sim, "su_8gva"));
        let e = lone_enemy(&mut sim);
        clear(&mut sim, &[a]);
        set_army(&mut sim, a, XY::new(0.0, 0.0));
        sim.world.divisions[e].vars.pos = XY::new(-FAR, FAR);
        sim.command.intent[f as usize] = Some(Directive { id: "т".into(), from: 0, to: Target::Hq(f), form: Form::Order, task: Task::Attack, axis: vec![XY::new(0.0, 0.0), XY::new(100.0, 0.0)],
            immediate: None, subsequent: None, boundaries: vec![], main_blow: vec![], reserve: vec![], junction: None, hasty: false, ready: true, rule: None, issued: 0, note: String::new() });
        let mut log = DistLog::default();
        log.record(&sim);
        set_army(&mut sim, a, XY::new(0.0, 30.0));
        assert!(army_view(&sim, &log, a).advance_km.abs() < 1e-6, "{}", army_view(&sim, &log, a).advance_km);
        set_army(&mut sim, a, XY::new(30.0, 30.0));
        assert!((army_view(&sim, &log, a).advance_km - 30.0).abs() < 1e-6);
    }

    /// Подвижная группа (до ввода и введённая) обороны не прорывает: её марш — не прорыв.
    #[test]
    fn mobile_army_not_broke_through() {
        use agents_core::command::control::Role;
        use agents_core::geo::XY;
        let mut sim = load(None);
        let a = hq(&sim, "su_1gta");
        let depth = sim.rules.doctrine_su.tank_commit_depth_km;
        let e = lone_enemy(&mut sim);
        clear(&mut sim, &[a]);
        set_army(&mut sim, a, XY::new(0.0, 0.0));
        sim.world.divisions[e].vars.pos = XY::new(-FAR, FAR);
        let mut log = DistLog::default();
        log.record(&sim);
        set_army(&mut sim, a, XY::new(depth + 10.0, 0.0));
        assert!(army_view(&sim, &log, a).broke_through);
        for r in [Role::Mobile, Role::Committed] {
            sim.command.role_hq[a as usize] = r;
            assert!(!army_view(&sim, &log, a).broke_through, "{r:?}");
        }
    }

    #[test]
    fn open_flank_detected() {
        use agents_core::geo::XY;
        let mut sim = load(None);
        let a = hq(&sim, "su_8gva");
        let b = hq(&sim, "su_5ua");
        let contact = sim.rules.contact_km;
        let e = lone_enemy(&mut sim);
        clear(&mut sim, &[a, b]);
        set_army(&mut sim, a, XY::new(0.0, 0.0));
        set_army(&mut sim, b, XY::new(-FAR, -FAR));
        sim.world.divisions[e].vars.pos = XY::new(-FAR, FAR);
        let mut log = DistLog::default();
        log.record(&sim);
        set_army(&mut sim, a, XY::new(10.0, 0.0));
        // противник сбоку от оси (ось — вдоль x), соседей рядом нет
        sim.world.divisions[e].vars.pos = XY::new(10.0, contact * 1.5);
        assert!(picture(&sim, hq(&sim, "su_1bf"), &log).open_flanks.contains(&a));
        // дивизия соседней армии рядом с ним — фланг прикрыт
        set_army(&mut sim, b, XY::new(10.0, contact * 1.5 + 1.0));
        assert!(!picture(&sim, hq(&sim, "su_1bf"), &log).open_flanks.contains(&a));
        // противник впереди — не фланг
        set_army(&mut sim, b, XY::new(-FAR, -FAR));
        sim.world.divisions[e].vars.pos = XY::new(10.0 + contact * 1.5, 0.0);
        assert!(!picture(&sim, hq(&sim, "su_1bf"), &log).open_flanks.contains(&a));
        // противник сбоку, но дальше разведки — не виден
        sim.world.divisions[e].vars.pos = XY::new(10.0, contact * 3.0 + 5.0);
        assert!(!picture(&sim, hq(&sim, "su_1bf"), &log).open_flanks.contains(&a));
    }

    #[test]
    fn pocket_detected() {
        use agents_core::geo::XY;
        let mut sim = load(None);
        let a = hq(&sim, "su_8gva");
        let b = hq(&sim, "su_5ua");
        let contact = sim.rules.contact_km;
        let e = lone_enemy(&mut sim);
        clear(&mut sim, &[a, b]);
        let d = contact * 1.5;
        set_army(&mut sim, a, XY::new(-d, 0.0));
        set_army(&mut sim, b, XY::new(d, 0.0));
        sim.world.divisions[e].vars.pos = XY::new(0.0, 0.0);
        sim.world.divisions[e].cut_since = Some(0);
        let log = DistLog::default();
        let p = picture(&sim, hq(&sim, "su_1bf"), &log);
        assert_eq!(p.pockets.len(), 1, "{:?}", p.pockets);
        let k = &p.pockets[0];
        assert!(k.enemy_est > 0.0);
        assert_eq!(k.by.len(), 2);
        assert!(k.by.contains(&a) && k.by.contains(&b));
        assert!((k.gap_km - 2.0 * d).abs() < 1e-6 && k.gap_km < 20.0, "{}", k.gap_km);
        // не отрезан от своих — котла нет
        sim.world.divisions[e].cut_since = None;
        assert!(picture(&sim, hq(&sim, "su_1bf"), &log).pockets.is_empty());
    }

    #[test]
    fn fog_window() {
        let mut sim = load(None);
        let log = DistLog::default();
        let h = hq(&sim, "su_1bf");
        let ratios = |sim: &Sim| -> Vec<f64> {
            picture(sim, h, &log).armies.iter().filter(|a| a.enemy_true > 0.0).map(|a| a.enemy_est / a.enemy_true).collect()
        };
        sim.world.tick = 12;
        let base = ratios(&sim);
        assert!(!base.is_empty());
        sim.world.tick = 17;
        assert_eq!(ratios(&sim), base, "одна сводка — одна ошибка");
        sim.world.tick = 18;
        assert_ne!(ratios(&sim), base, "другая сводка — другая ошибка");
        sim.world.tick = 12;
        sim.seed ^= 0x5555;
        assert_ne!(ratios(&sim), base, "другое зерно — другая ошибка");
    }
}

// ---- Мотивы и состояние по обстановке ----

use agents_core::commander::motives::{current, effective, mood_step, Mood};
use agents_core::commander::picture::{ArmyView, Picture, RivalView};
use agents_core::commander::{Motives, Traits};

fn army(hq: u32, advance_km: f64, strength: f64) -> ArmyView {
    ArmyView { hq, advance_km, strength, enemy_est: 0.0, enemy_true: 0.0, to_objective_km: None, broke_through: false }
}
fn pic(tick: u32, armies: Vec<ArmyView>) -> Picture {
    Picture { tick, armies, enemy_reserves: vec![], rival: None, open_flanks: vec![], pockets: vec![], to_objective_km: Some(100.0) }
}

#[test]
fn confidence_grows_on_success() {
    let m = &Rules::load(&data()).unwrap().commanders.mood;
    let prev = pic(0, vec![army(1, 0.0, 1.0), army(2, 0.0, 1.0)]);
    let now = pic(1, vec![army(1, 5.0, 1.0), army(2, 5.0, 1.0)]); // 5 км/ч — намного выше темпа
    // от состояния на начало: возврат к нему не мешает знаку сигнала
    let s = m.start;
    let next = mood_step(&s, &now, Some(&prev), 0.0, true, m);
    assert!(next.confidence > s.confidence, "{next:?}");
    let slow = pic(1, vec![army(1, 0.0, 1.0), army(2, 0.0, 1.0)]);
    assert!(mood_step(&s, &slow, Some(&prev), 0.0, true, m).confidence < s.confidence);
}

#[test]
fn stress_grows_on_threat() {
    let m = &Rules::load(&data()).unwrap().commanders.mood;
    let calm = pic(1, vec![army(1, 0.0, 1.0), army(2, 0.0, 1.0)]);
    let mut threat = calm.clone();
    threat.open_flanks = vec![1, 2];
    let s = Mood { confidence: 0.5, stress: 0.2 };
    assert!(mood_step(&s, &threat, None, 0.0, true, m).stress > mood_step(&s, &calm, None, 0.0, true, m).stress);
    let weak = pic(1, vec![army(1, 0.0, 0.3), army(2, 0.0, 0.3)]);
    assert!(mood_step(&s, &weak, None, 0.0, true, m).stress > mood_step(&s, &calm, None, 0.0, true, m).stress);
    // отставание от срока задачи тоже давит
    assert!(mood_step(&s, &calm, None, 0.8, true, m).stress > mood_step(&s, &calm, None, 0.0, true, m).stress);
}

#[test]
fn mood_decays_to_start() {
    let m = &Rules::load(&data()).unwrap().commanders.mood;
    let calm = pic(1, vec![army(1, 0.0, 1.0)]);
    let mut s = Mood { confidence: 0.95, stress: 0.9 };
    let d0 = (s.confidence - m.start.confidence).abs() + (s.stress - m.start.stress).abs();
    for _ in 0..24 { s = mood_step(&s, &calm, None, 0.0, true, m); }
    let d1 = (s.confidence - m.start.confidence).abs() + (s.stress - m.start.stress).abs();
    assert!(d1 < d0 * 0.5, "{d0} -> {d1}");
    for v in [s.confidence, s.stress] { assert!((0.0..=1.0).contains(&v)); }
}

#[test]
fn effective_rigid_vs_cautious() {
    let m = &Rules::load(&data()).unwrap().commanders.mood;
    let mood = Mood { confidence: 0.5, stress: 0.9 };
    // [risk, persistence, ambition, lossTolerance, obedience]
    let rigid = Traits([0.6, 0.7, 0.5, 0.5, 0.8]);
    let e = effective(&rigid, &mood, m);
    assert!(e.get(Trait::Persistence) > rigid.get(Trait::Persistence));
    assert!(e.get(Trait::Risk) < rigid.get(Trait::Risk));
    let cautious = Traits([0.4, 0.3, 0.5, 0.5, 0.4]);
    let e = effective(&cautious, &mood, m);
    assert!(e.get(Trait::LossTolerance) < cautious.get(Trait::LossTolerance));
    assert_eq!(e.get(Trait::Persistence), cautious.get(Trait::Persistence));
    // уверенность сдвигает риск и честолюбие, обрезка в [0, 1]
    let bold = effective(&Traits([0.99, 0.5, 0.99, 0.5, 0.5]), &Mood { confidence: 1.0, stress: 0.0 }, m);
    assert!(bold.get(Trait::Risk) <= 1.0 && bold.get(Trait::Ambition) <= 1.0);
}

#[test]
fn rival_grows_when_rival_closer() {
    let g = &Rules::load(&data()).unwrap().commanders.gains;
    let base = Motives([0.5, 0.4, 0.3, 0.2, 0.1, 0.0, 0.0]);
    let mut p = pic(1, vec![army(1, 0.0, 1.0)]);
    p.rival = Some(RivalView { hq: 9, to_objective_km: 80.0, as_of: 0 }); // свой — 100 км, соперник ближе на 20
    assert!(current(&base, &p, g).get(Motive::Rival) > base.get(Motive::Rival));
    p.rival = Some(RivalView { hq: 9, to_objective_km: 120.0, as_of: 0 });
    assert_eq!(current(&base, &p, g).get(Motive::Rival), base.get(Motive::Rival));
}

#[test]
fn preserve_grows_with_losses() {
    let g = &Rules::load(&data()).unwrap().commanders.gains;
    let base = Motives([0.5, 0.4, 0.3, 0.2, 0.1, 0.0, 0.0]);
    let whole = current(&base, &pic(1, vec![army(1, 0.0, 1.0)]), g);
    assert_eq!(whole.get(Motive::Preserve), base.get(Motive::Preserve));
    let hurt = current(&base, &pic(1, vec![army(1, 0.0, 0.5), army(2, 0.0, 0.7)]), g);
    assert!(hurt.get(Motive::Preserve) > base.get(Motive::Preserve));
    let mut open = pic(1, vec![army(1, 0.0, 1.0), army(2, 0.0, 1.0)]);
    open.open_flanks = vec![1];
    let o = current(&base, &open, g);
    assert!((o.get(Motive::NoEncircle) - (base.get(Motive::NoEncircle) + g.flank * 0.5)).abs() < 1e-9);
    assert_eq!(o.get(Motive::Task), base.get(Motive::Task));
}

#[test]
fn no_rival_zero() {
    let g = &Rules::load(&data()).unwrap().commanders.gains;
    let base = Motives([0.5, 0.4, 0.3, 0.2, 0.1, 0.0, 0.0]);
    let p = pic(1, vec![army(1, 0.0, 1.0)]); // соперника в сводке нет
    assert_eq!(current(&base, &p, g).get(Motive::Rival), 0.0);
}

/// Варианты советских фронтов: картина собирается руками, роли армий — в состоянии управления.
mod options_su {
    use super::*;
    use agents_core::command::control::Role;
    use agents_core::commander::options::{Choice, Kind};
    use agents_core::commander::options_su::options_su;
    use agents_core::commander::picture::{ArmyView, PocketView, Picture};
    use agents_core::geo::XY;
    use agents_core::world::Sim;

    fn load() -> Sim {
        let root = repo_root();
        let (sim, _) = agents_core::scenario::load_with(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &format!("{root}/{DATA_DIR}"), &root, None, None).expect("сценарий");
        sim
    }
    fn hq(sim: &Sim, id: &str) -> u32 { sim.world.hqs.iter().position(|h| h.id == id).expect(id) as u32 }
    fn view(h: u32, advance_km: f64, broke: bool) -> ArmyView {
        ArmyView { hq: h, advance_km, strength: 1.0, enemy_est: 1.0, enemy_true: 1.0, to_objective_km: Some(80.0), broke_through: broke }
    }
    fn pic(armies: Vec<ArmyView>) -> Picture {
        Picture { tick: 10, armies, enemy_reserves: vec![], rival: None, open_flanks: vec![], pockets: vec![], to_objective_km: Some(80.0) }
    }
    fn has(v: &[Choice], f: impl Fn(&Kind) -> bool) -> bool { v.iter().any(|c| f(&c.kind)) }
    fn opts(sim: &Sim, front: &str, pic: &Picture) -> Vec<Choice> {
        let h = hq(sim, front);
        let p = sim.rules.commanders.for_hq(front).unwrap().clone();
        check_ranges(&options_su(sim, h, &p, pic))
    }
    /// Вклады в мотивы −1…1, неопределённость и потери 0…1 у каждого варианта.
    fn check_ranges(v: &[Choice]) -> Vec<Choice> {
        for ch in v {
            assert!((0.0..=1.0).contains(&ch.uncertainty) && (0.0..=1.0).contains(&ch.losses), "{}", ch.label);
            assert!(ch.contrib.0.iter().all(|x| (-1.0..=1.0).contains(x)), "{}", ch.label);
        }
        v.to_vec()
    }
    fn set_intent(sim: &mut Sim, front: &str, axis: Vec<XY>) {
        use agents_core::command::directive::{Directive, Form, Target, Task};
        let top = hq(sim, front) as usize;
        sim.command.intent[top] = Some(Directive { id: "т".into(), from: 0, to: Target::Hq(top as u32), form: Form::Order, task: Task::Attack, axis, immediate: None, subsequent: None,
            boundaries: vec![], main_blow: vec![], reserve: vec![], junction: None, hasty: false, ready: true, rule: None, issued: 0, note: String::new() });
    }

    /// Подвижная группа вводится только после пройденной глубины ввода.
    #[test]
    fn commit_mobile_only_after_depth() {
        let mut sim = load();
        let (rifle, tank) = (hq(&sim, "su_8gva"), hq(&sim, "su_1gta"));
        sim.command.role_hq[rifle as usize] = Role::First;
        sim.command.role_hq[tank as usize] = Role::Mobile;
        // с глубины ввода вторых эшелонов (главная полоса прорвана), не дожидаясь прорыва тактической зоны
        let depth = sim.rules.doctrine_su.commit_depth_km;
        assert!(depth < sim.rules.doctrine_su.tank_commit_depth_km);
        let shallow = opts(&sim, "su_1bf", &pic(vec![view(rifle, depth - 1.0, false), view(tank, 0.0, false)]));
        assert!(!has(&shallow, |k| matches!(k, Kind::CommitMobile { .. })));
        let deep = opts(&sim, "su_1bf", &pic(vec![view(rifle, depth + 1.0, false), view(tank, 0.0, false)]));
        let c = deep.iter().find(|c| matches!(c.kind, Kind::CommitMobile { hq } if hq == tank)).expect("ввод");
        assert!(has(&deep, |k| matches!(k, Kind::WaitMobile)));
        // без прорыва неопределённость выше, чем с прорывом
        let brk = opts(&sim, "su_1bf", &pic(vec![view(rifle, depth + 1.0, true), view(tank, 0.0, false)]));
        assert!(!has(&brk, |k| matches!(k, Kind::WaitMobile)));
        let cb = brk.iter().find(|c| matches!(c.kind, Kind::CommitMobile { .. })).unwrap();
        assert!(c.uncertainty > cb.uncertainty);
    }

    /// Главный удар — по замыслу старшего, если он есть, иначе армии первого эшелона.
    #[test]
    fn main_blow_from_intent() {
        let mut sim = load();
        let (a, b, tank) = (hq(&sim, "su_8gva"), hq(&sim, "su_69a"), hq(&sim, "su_1gta"));
        sim.command.role_hq[a as usize] = Role::First;
        sim.command.role_hq[tank as usize] = Role::Mobile;
        let depth = sim.rules.doctrine_su.tank_commit_depth_km;
        // продвинулась только b, которая в роли First не стоит: без замысла главного удара ввода нет
        let p = pic(vec![view(a, 0.0, false), view(b, depth + 1.0, false), view(tank, 0.0, false)]);
        assert!(!has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::CommitMobile { .. })));
        use agents_core::command::directive::{Directive, Form, Target, Task};
        let top = hq(&sim, "su_1bf") as usize;
        let d = Directive { id: "т".into(), from: 0, to: Target::Hq(top as u32), form: Form::Order, task: Task::Attack, axis: vec![], immediate: None, subsequent: None,
            boundaries: vec![], main_blow: vec![b], reserve: vec![], junction: None, hasty: false, ready: true, rule: None, issued: 0, note: String::new() };
        sim.command.intent[top] = Some(d);
        assert!(has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::CommitMobile { .. })));
    }

    /// Танковые армии в главном ударе Ставки: их собственный марш не открывает ввод подвижной группы, и главный
    /// удар на подвижную группу не переносится.
    #[test]
    fn mobile_march_not_main_blow() {
        let mut sim = load();
        let (rifle, tank, tank2) = (hq(&sim, "su_8gva"), hq(&sim, "su_1gta"), hq(&sim, "su_2gta"));
        sim.command.role_hq[rifle as usize] = Role::First;
        sim.command.role_hq[tank as usize] = Role::Mobile;
        sim.command.role_hq[tank2 as usize] = Role::Committed;
        set_intent(&mut sim, "su_1bf", vec![]);
        let top = hq(&sim, "su_1bf") as usize;
        sim.command.intent[top].as_mut().unwrap().main_blow = vec![rifle, tank, tank2];
        let p = pic(vec![view(rifle, 1.0, false), view(tank, 8.4, false), view(tank2, 30.0, false)]);
        let o = opts(&sim, "su_1bf", &p);
        assert!(!has(&o, |k| matches!(k, Kind::CommitMobile { .. } | Kind::WaitMobile)), "{:?}", o.iter().map(|c| &c.label).collect::<Vec<_>>());
        assert!(!has(&o, |k| matches!(k, Kind::ShiftMainBlow { to } if to.contains(&tank) || to.contains(&tank2))));
        // стрелковая армия прошла глубину — ввод есть
        let p = pic(vec![view(rifle, sim.rules.doctrine_su.commit_depth_km + 1.0, false), view(tank, 8.4, false)]);
        assert!(has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::CommitMobile { hq } if *hq == tank)));
    }

    /// Фронт без продвижения: после срока ввода (`tankCommitFallbackHours`, как у штаба) ввод в меню есть, с малой
    /// неопределённостью; до срока — нет.
    #[test]
    fn commit_mobile_after_fallback_hours() {
        use agents_core::command::directive::Target;
        let mut sim = load();
        let (rifle, tank) = (hq(&sim, "su_8gva"), hq(&sim, "su_1gta"));
        sim.command.role_hq[rifle as usize] = Role::First;
        sim.command.role_hq[tank as usize] = Role::Mobile;
        sim.command.mark(Target::Hq(tank), XY::new(0.0, 0.0), 0);
        let p = pic(vec![view(rifle, 0.0, false), view(tank, 0.0, false)]);
        let late = sim.rules.doctrine_su.tank_commit_fallback_hours.ceil() as u32;
        sim.world.tick = late - 1;
        assert!(!has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::CommitMobile { .. })));
        sim.world.tick = late;
        let o = opts(&sim, "su_1bf", &p);
        let c = o.iter().find(|c| matches!(c.kind, Kind::CommitMobile { hq } if hq == tank)).expect("ввод по сроку");
        assert!(c.uncertainty <= 0.2 + 1e-9, "{}", c.uncertainty);
        assert!(c.rule.contains("НКО"), "{}", c.rule);
    }

    #[test]
    fn shift_main_blow_when_other_army_runs_ahead() {
        let mut sim = load();
        let (a, b) = (hq(&sim, "su_8gva"), hq(&sim, "su_69a"));
        sim.command.role_hq[a as usize] = Role::First;
        let p = pic(vec![view(a, 20.0, false), view(b, 31.0, false)]);
        assert!(opts(&sim, "su_1bf", &p).iter().any(|c| matches!(&c.kind, Kind::ShiftMainBlow { to } if to == &vec![b])));
        let p = pic(vec![view(a, 20.0, false), view(b, 29.0, false)]);
        assert!(!has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::ShiftMainBlow { .. })));
        // главный удар на месте: малый отрыв — не повод, большой — повод
        let p = pic(vec![view(a, 0.0, false), view(b, 1.0, false)]);
        assert!(!has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::ShiftMainBlow { .. })));
        let p = pic(vec![view(a, 0.0, false), view(b, 8.0, false)]);
        assert!(has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::ShiftMainBlow { .. })));
    }

    /// Поворот к объекту соперника — только когда есть соперник, его объект и своя армия ближе порога.
    #[test]
    fn turn_option_needs_rival_and_objective() {
        let mut sim = load();
        let tank = hq(&sim, "su_1gta");
        sim.command.role_hq[tank as usize] = Role::Committed;
        let p = pic(vec![view(tank, 10.0, true)]);
        // 1УФ — соперник у Конева есть (Жуков), объект общий; по умолчанию армии далеко от объекта
        sim.rules.commanders.options.turn_km = 0.0;
        assert!(!has(&opts(&sim, "su_1uf", &p), |k| matches!(k, Kind::TurnToRival { .. })));
        sim.rules.commanders.options.turn_km = 1.0e6;
        // без замысла старшего поворота нет
        assert!(!has(&opts(&sim, "su_1uf", &p), |k| matches!(k, Kind::TurnToRival { .. })));
        let berlin = sim.theatre.proj.to_xy(sim.rules.commanders.objective_at("berlin").unwrap());
        // задача нацелена на сам объект — поворачивать некуда
        sim.rules.commanders.options.turn_km = 1.0e6;
        set_intent(&mut sim, "su_1uf", vec![berlin]);
        assert!(!has(&opts(&sim, "su_1uf", &p), |k| matches!(k, Kind::TurnToRival { .. })));
        // задача далеко от объекта соперника
        // порог один на оба условия: берём такой, что армия от объекта ближе его, а задача дальше
        sim.rules.commanders.options.turn_km = 300.0;
        set_intent(&mut sim, "su_1uf", vec![XY::new(berlin.x - 2000.0, berlin.y)]);
        let o = opts(&sim, "su_1uf", &p);
        let t = o.iter().find(|c| matches!(c.kind, Kind::TurnToRival { .. })).expect("поворот");
        assert!(t.contrib.get(Motive::Rival) > 0.0 && t.contrib.get(Motive::Task) < 0.0);
    }

    /// Подвижная армия предпочтительнее обычной независимо от удаления.
    #[test]
    fn turn_prefers_mobile() {
        let mut sim = load();
        let (tank, rifle) = (hq(&sim, "su_1gta"), hq(&sim, "su_8gva"));
        let berlin = sim.theatre.proj.to_xy(sim.rules.commanders.objective_at("berlin").unwrap());
        set_intent(&mut sim, "su_1uf", vec![XY::new(berlin.x - 2000.0, berlin.y)]);
        sim.rules.commanders.options.turn_km = 300.0;
        let p = pic(vec![view(tank, 10.0, true), view(rifle, 10.0, true)]);
        for (mobile, role) in [(tank, Role::Mobile), (rifle, Role::Committed)] {
            sim.command.role_hq[tank as usize] = Role::Unset;
            sim.command.role_hq[rifle as usize] = Role::Unset;
            sim.command.role_hq[mobile as usize] = role;
            let o = opts(&sim, "su_1uf", &p);
            assert!(o.iter().any(|c| matches!(c.kind, Kind::TurnToRival { hq, .. } if hq == mobile)));
        }
    }

    #[test]
    fn no_rival_no_turn_option() {
        let mut sim = load();
        sim.rules.commanders.options.turn_km = 1.0e6;
        let tank = hq(&sim, "su_1gta");
        let p = pic(vec![view(tank, 10.0, true)]);
        // у Рокоссовского соперника нет
        assert!(sim.rules.commanders.for_hq("su_2bf").unwrap().rival.is_none());
        assert!(!has(&opts(&sim, "su_2bf", &p), |k| matches!(k, Kind::TurnToRival { .. })));
        // и соперник есть, но объекта у профиля нет
        let mut prof = sim.rules.commanders.for_hq("su_1uf").unwrap().clone();
        prof.objective = None;
        assert!(!has(&options_su(&sim, hq(&sim, "su_1uf"), &prof, &p), |k| matches!(k, Kind::TurnToRival { .. })));
    }

    #[test]
    fn encircle_needs_small_gap() {
        let sim = load();
        let (a, b) = (hq(&sim, "su_8gva"), hq(&sim, "su_69a"));
        let gap = sim.rules.commanders.options.encircle_gap_km;
        let mut p = pic(vec![view(a, 5.0, false)]);
        p.pockets = vec![PocketView { center: XY::new(0.0, 0.0), enemy_est: 2.0, gap_km: gap + 1.0, by: vec![a, b] }];
        assert!(!has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::Encircle { .. })));
        p.pockets[0].gap_km = gap - 1.0;
        let o = opts(&sim, "su_1bf", &p);
        let e = o.iter().find(|c| matches!(c.kind, Kind::Encircle { pocket: 0 })).expect("замыкание");
        assert!(e.contrib.get(Motive::Destroy) > 0.0);
    }

    #[test]
    fn commit_second_needs_second_role() {
        let mut sim = load();
        let s = hq(&sim, "su_33a");
        let p = pic(vec![view(s, 0.0, false)]);
        assert!(!has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::CommitSecond { .. })));
        sim.command.role_hq[s as usize] = Role::Second;
        assert!(has(&opts(&sim, "su_1bf", &p), |k| matches!(k, Kind::CommitSecond { hq } if *hq == s)));
    }

    #[test]
    fn continue_always_present() {
        let sim = load();
        for f in ["su_1bf", "su_1uf", "su_2bf"] {
            let o = opts(&sim, f, &pic(vec![]));
            assert!(has(&o, |k| matches!(k, Kind::Continue)), "{f}");
            assert!(!o.is_empty());
        }
    }
}

/// Варианты немецкой стороны и Ставки: картина собирается руками, окружение — через `cut_since` дивизий.
mod options_de {
    use super::*;
    use agents_core::command::control::Request;
    use agents_core::commander::options::{Choice, Kind};
    use agents_core::commander::options_de::{options_de, options_high};
    use agents_core::commander::picture::{ArmyView, Picture};
    use agents_core::geo::XY;
    use agents_core::model::State;
    use agents_core::world::Sim;

    fn load() -> Sim {
        let root = repo_root();
        let (mut sim, _) = agents_core::scenario::load_with(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &format!("{root}/{DATA_DIR}"), &root, None, None).expect("сценарий");
        for d in &mut sim.world.divisions { d.cut_since = None; }
        sim
    }
    fn hq(sim: &Sim, id: &str) -> u32 { sim.world.hqs.iter().position(|h| h.id == id).expect(id) as u32 }
    fn view(h: u32) -> ArmyView {
        ArmyView { hq: h, advance_km: 0.0, strength: 1.0, enemy_est: 1.0, enemy_true: 1.0, to_objective_km: None, broke_through: false }
    }
    fn pic(armies: Vec<ArmyView>, open: Vec<u32>) -> Picture {
        Picture { tick: 30, armies, enemy_reserves: vec![], rival: None, open_flanks: open, pockets: vec![], to_objective_km: None }
    }
    fn has(v: &[Choice], f: impl Fn(&Kind) -> bool) -> bool { v.iter().any(|c| f(&c.kind)) }
    fn check_ranges(v: Vec<Choice>) -> Vec<Choice> {
        for ch in &v {
            assert!((0.0..=1.0).contains(&ch.uncertainty) && (0.0..=1.0).contains(&ch.losses), "{}", ch.label);
            assert!(ch.contrib.0.iter().all(|x| (-1.0..=1.0).contains(x)), "{}", ch.label);
            assert!(!ch.rule.is_empty());
        }
        v
    }
    fn opts(sim: &Sim, id: &str, pic: &Picture) -> Vec<Choice> {
        let p = sim.rules.commanders.for_hq(id).unwrap().clone();
        check_ranges(options_de(sim, hq(sim, id), &p, pic))
    }
    fn high(sim: &Sim) -> Vec<Choice> {
        let p = sim.rules.commanders.for_hq("de_hc").unwrap().clone();
        check_ranges(options_high(sim, hq(sim, "de_hc"), &p))
    }
    /// Живые дивизии штаба и его подчинённых.
    fn divs(sim: &Sim, id: &str) -> Vec<usize> {
        let h = hq(sim, id);
        (0..sim.world.divisions.len()).filter(|&i| {
            let mut k = sim.world.divisions[i].hq;
            loop { if k == h { return !sim.world.divisions[i].state.out(); } match sim.world.hqs[k as usize].parent { Some(p) => k = p, None => return false } }
        }).collect()
    }
    fn cut(sim: &mut Sim, id: &str, share: f64) {
        let v = divs(sim, id);
        let n = ((v.len() as f64) * share).ceil() as usize;
        for &i in v.iter().take(n) { sim.world.divisions[i].cut_since = Some(0); }
    }

    #[test]
    fn hold_always_present() {
        let sim = load();
        let o = opts(&sim, "de_9a", &pic(vec![view(hq(&sim, "de_9a"))], vec![]));
        let h = o.iter().find(|c| matches!(c.kind, Kind::Hold)).expect("держаться");
        assert!(h.contrib.get(Motive::Hold) > 0.0 && h.contrib.get(Motive::Task) > 0.0);
    }

    /// Отход появляется при открытом фланге или охвате своих и несёт вклад в сохранение и против окружения.
    #[test]
    fn withdraw_needs_threat() {
        let mut sim = load();
        let a = hq(&sim, "de_9a");
        let calm = opts(&sim, "de_9a", &pic(vec![view(a)], vec![]));
        assert!(!has(&calm, |k| matches!(k, Kind::Withdraw { .. })));
        let flank = opts(&sim, "de_9a", &pic(vec![view(a)], vec![a]));
        let w = flank.iter().find(|c| matches!(c.kind, Kind::Withdraw { hq } if hq == a)).expect("отход");
        assert!(w.contrib.get(Motive::Save) > 0.0 && w.contrib.get(Motive::NoEncircle) > 0.0);
        assert!(w.contrib.get(Motive::Hold) < 0.0 && w.contrib.get(Motive::Task) < 0.0);
        // часть дивизий отрезана — охват своих
        cut(&mut sim, "de_9a", 0.25);
        assert!(has(&opts(&sim, "de_9a", &pic(vec![view(a)], vec![])), |k| matches!(k, Kind::Withdraw { .. })));
        // угроза гасит вклад «держаться» в сохранение сильнее
        let h0 = calm.iter().find(|c| matches!(c.kind, Kind::Hold)).unwrap().contrib.get(Motive::Save);
        let h1 = opts(&sim, "de_9a", &pic(vec![view(a)], vec![a])).into_iter().find(|c| matches!(c.kind, Kind::Hold)).unwrap().contrib.get(Motive::Save);
        assert!(h1 < h0);
    }

    #[test]
    fn breakout_only_in_pocket() {
        let mut sim = load();
        let a = hq(&sim, "de_9a");
        let p = pic(vec![view(a)], vec![]);
        assert!(!has(&opts(&sim, "de_9a", &p), |k| matches!(k, Kind::Breakout { .. })));
        cut(&mut sim, "de_9a", 0.3);
        assert!(!has(&opts(&sim, "de_9a", &p), |k| matches!(k, Kind::Breakout { .. })), "меньшинство окружено — не котёл");
        cut(&mut sim, "de_9a", 1.0);
        let o = opts(&sim, "de_9a", &p);
        let b = o.iter().find(|c| matches!(c.kind, Kind::Breakout { .. })).expect("прорыв");
        let Kind::Breakout { toward } = b.kind else { unreachable!() };
        // цель — центр войск одной из армий снаружи
        let centers: Vec<XY> = ["de_3pza", "de_4pza", "de_12a"].iter().map(|id| {
            let ds = divs(&sim, id);
            XY::new(ds.iter().map(|&i| sim.world.divisions[i].vars.pos.x).sum::<f64>() / ds.len() as f64, ds.iter().map(|&i| sim.world.divisions[i].vars.pos.y).sum::<f64>() / ds.len() as f64)
        }).collect();
        assert!(centers.iter().any(|c| toward.dist(*c) < 1e-6), "{toward:?}");
        assert!(b.contrib.get(Motive::Save) > 0.0 && b.contrib.get(Motive::Preserve) > 0.0 && b.contrib.get(Motive::Hold) < 0.0);
        // своих снаружи нет — прорываться некуда
        for id in ["de_3pza", "de_4pza", "de_12a"] { cut(&mut sim, id, 1.0); }
        assert!(!has(&opts(&sim, "de_9a", &p), |k| matches!(k, Kind::Breakout { .. })));
    }

    /// Контратака — резерв армии в пределах 40 км от вклинения противника.
    #[test]
    fn counterattack_needs_reserve_near_wedge() {
        let mut sim = load();
        let a = hq(&sim, "de_9a");
        let ds = divs(&sim, "de_9a");
        let enemy = (0..sim.world.divisions.len()).find(|&i| sim.world.divisions[i].side != sim.world.hqs[a as usize].side && !sim.world.divisions[i].state.out()).unwrap();
        let at = sim.world.divisions[ds[0]].vars.pos;
        sim.world.divisions[enemy].vars.pos = XY::new(at.x + 3.0, at.y);
        sim.world.divisions[enemy].state = State::Attack(agents_core::model::AttackSub::Assault);
        for &i in &ds { sim.world.divisions[i].state = State::Defense(agents_core::model::DefenseSub::Prepared); }
        let p = pic(vec![view(a)], vec![]);
        assert!(!has(&opts(&sim, "de_9a", &p), |k| matches!(k, Kind::Counterattack { .. })), "резерва нет");
        sim.world.divisions[ds[1]].state = State::Reserve;
        sim.world.divisions[ds[1]].vars.pos = XY::new(at.x - 10.0, at.y);
        let o = opts(&sim, "de_9a", &p);
        let c = o.iter().find(|c| matches!(c.kind, Kind::Counterattack { from, .. } if from == a)).expect("контратака");
        assert!(c.contrib.get(Motive::Destroy) > 0.0 && c.contrib.get(Motive::Preserve) < 0.0);
        // окружённый резерв не контратакует
        sim.world.divisions[ds[1]].cut_since = Some(0);
        assert!(!has(&opts(&sim, "de_9a", &p), |k| matches!(k, Kind::Counterattack { .. })), "резерв окружён");
        sim.world.divisions[ds[1]].cut_since = None;
        sim.world.divisions[ds[1]].vars.pos = XY::new(at.x - 100.0, at.y);
        assert!(!has(&opts(&sim, "de_9a", &p), |k| matches!(k, Kind::Counterattack { .. })), "резерв далеко");
    }

    /// Перегруппировка — с тихого участка на угрожаемый.
    #[test]
    fn shift_forces_quiet_to_threatened() {
        let mut sim = load();
        let (a, b) = (hq(&sim, "de_9a"), hq(&sim, "de_3pza"));
        // убираем противника из соприкосновения
        for d in &mut sim.world.divisions { if d.side != sim.world.hqs[a as usize].side { d.vars.pos = XY::new(1.0e5, 1.0e5); } }
        for id in ["de_9a", "de_3pza"] { for i in divs(&sim, id) { sim.world.divisions[i].state = State::Reserve; } }
        let calm = opts(&sim, "de_hgr_weichsel", &pic(vec![view(a), view(b)], vec![]));
        assert!(!has(&calm, |k| matches!(k, Kind::ShiftForces { .. })), "угрожаемого нет");
        let o = opts(&sim, "de_hgr_weichsel", &pic(vec![view(a), view(b)], vec![a]));
        let s = o.iter().find(|c| matches!(c.kind, Kind::ShiftForces { from, to } if from == b && to == a)).expect("перегруппировка");
        assert!(s.contrib.get(Motive::Hold) > 0.0);
        // участок откуда берём — не тихий: рядом противник в бою
        let e = (0..sim.world.divisions.len()).find(|&i| sim.world.divisions[i].side != sim.world.hqs[a as usize].side && !sim.world.divisions[i].state.out()).unwrap();
        let at = sim.world.divisions[divs(&sim, "de_3pza")[0]].vars.pos;
        sim.world.divisions[e].vars.pos = XY::new(at.x + 1.0, at.y);
        sim.world.divisions[e].state = State::Attack(agents_core::model::AttackSub::Assault);
        let busy = divs(&sim, "de_3pza")[0];
        sim.world.engaged = vec![false; sim.world.divisions.len()];
        sim.world.engaged[busy] = true;
        let o = opts(&sim, "de_hgr_weichsel", &pic(vec![view(a), view(b)], vec![a]));
        assert!(!has(&o, |k| matches!(k, Kind::ShiftForces { from, .. } if *from == b)));
    }

    /// Перегруппировка: не с наступающей армии (боя на шаге не было), не с армии с открытым флангом, не в армию в кольце.
    #[test]
    fn shift_forces_source_and_destination_limits() {
        let mut sim = load();
        let (a, b) = (hq(&sim, "de_9a"), hq(&sim, "de_3pza"));
        for d in &mut sim.world.divisions { if d.side != sim.world.hqs[a as usize].side { d.vars.pos = XY::new(1.0e5, 1.0e5); } }
        for id in ["de_9a", "de_3pza"] { for i in divs(&sim, id) { sim.world.divisions[i].state = State::Reserve; } }
        sim.world.engaged = vec![false; sim.world.divisions.len()];
        let shift = |sim: &Sim, open: Vec<u32>| has(&opts(sim, "de_hgr_weichsel", &pic(vec![view(a), view(b)], open)), |k| matches!(k, Kind::ShiftForces { .. }));
        assert!(shift(&sim, vec![a]), "основа");
        // источник наступает, хотя боя на шаге не было
        for i in divs(&sim, "de_3pza") { sim.world.divisions[i].state = State::Attack(agents_core::model::AttackSub::Assault); }
        assert!(!shift(&sim, vec![a]));
        for i in divs(&sim, "de_3pza") { sim.world.divisions[i].state = State::Reserve; }
        // источник с открытым флангом
        assert!(!shift(&sim, vec![a, b]));
        // получатель в кольце
        cut(&mut sim, "de_9a", 1.0);
        assert!(!shift(&sim, vec![a]));
    }

    fn req(sim: &Sim, corps: &str, answer: Option<bool>) -> Request {
        Request { hq: hq(sim, corps), tick: 5, division: 0, at: XY::new(0.0, 0.0), answer, answered_at: 0 }
    }

    #[test]
    fn high_answers_each_request() {
        let mut sim = load();
        sim.command.requests = vec![req(&sim, "de_ci", None), req(&sim, "de_v", Some(true)), req(&sim, "de_lvi", None)];
        // до срока ответа (permissionHours) вариантов ответа нет — как у прежнего ответа «держать»
        let wait = sim.rules.command.de.permission_hours as u32;
        sim.world.tick = 5 + wait - 1;
        assert!(!has(&high(&sim), |k| matches!(k, Kind::Permit { .. } | Kind::Forbid { .. })));
        sim.world.tick = 5 + wait;
        let o = high(&sim);
        for i in [0usize, 2] {
            assert!(has(&o, |k| matches!(k, Kind::Permit { request } if *request == i)), "{i}");
            assert!(has(&o, |k| matches!(k, Kind::Forbid { request } if *request == i)), "{i}");
        }
        assert!(!has(&o, |k| matches!(k, Kind::Permit { request: 1 } | Kind::Forbid { request: 1 })));
        assert_eq!(o.iter().filter(|c| matches!(c.kind, Kind::Permit { .. } | Kind::Forbid { .. })).count(), 4);
        let f = o.iter().find(|c| matches!(c.kind, Kind::Forbid { request: 0 })).unwrap();
        let p = o.iter().find(|c| matches!(c.kind, Kind::Permit { request: 0 })).unwrap();
        assert!(f.contrib.get(Motive::Hold) > 0.0 && f.contrib.get(Motive::Save) < 0.0);
        assert!(p.contrib.get(Motive::Save) > 0.0 && p.contrib.get(Motive::Hold) < 0.0);
        // армия под угрозой: запрет обходится дороже
        let calm = f.contrib.get(Motive::Save);
        cut(&mut sim, "de_9a", 0.5);
        let o = high(&sim);
        assert!(o.iter().find(|c| matches!(c.kind, Kind::Forbid { request: 0 })).unwrap().contrib.get(Motive::Save) < calm);
        // нет запросов — нет вариантов запроса
        sim.command.requests.clear();
        assert!(!has(&high(&sim), |k| matches!(k, Kind::Permit { .. } | Kind::Forbid { .. })));
    }

    #[test]
    fn relief_needs_pocket() {
        let mut sim = load();
        let a = hq(&sim, "de_9a");
        assert!(!has(&high(&sim), |k| matches!(k, Kind::Relief { .. })));
        cut(&mut sim, "de_9a", 1.0);
        let o = high(&sim);
        let r = o.iter().find(|c| matches!(c.kind, Kind::Relief { army, .. } if army == a)).expect("выручка");
        assert!(r.contrib.get(Motive::Save) > 0.0);
        // все армии отрезаны — выручать некому
        for id in ["de_3pza", "de_4pza", "de_12a"] { cut(&mut sim, id, 1.0); }
        assert!(!has(&high(&sim), |k| matches!(k, Kind::Relief { .. })));
    }

    #[test]
    fn move_reserve_needs_okw_reserve() {
        let mut sim = load();
        cut(&mut sim, "de_9a", 1.0);
        let reserve = |sim: &Sim| -> Vec<usize> { divs(sim, "de_okw").into_iter().filter(|&i| sim.world.divisions[i].state == State::Reserve).collect() };
        for i in divs(&sim, "de_okw") { sim.world.divisions[i].state = State::Defense(agents_core::model::DefenseSub::Prepared); }
        assert!(reserve(&sim).is_empty());
        assert!(!has(&high(&sim), |k| matches!(k, Kind::MoveReserve { .. })));
        let i = divs(&sim, "de_okw")[0];
        sim.world.divisions[i].state = State::Reserve;
        let o = high(&sim);
        let m = o.iter().find(|c| matches!(c.kind, Kind::MoveReserve { .. })).expect("перемещение резерва");
        assert!(m.contrib.get(Motive::Save) > 0.0);
    }

    /// Чей резерв — резерв верхней инстанции, задаёт `okwReserve.hqs` в правилах командующих, а не код.
    #[test]
    fn okw_reserve_from_rules() {
        let root = repo_root();
        let o = json!({"commanders.okwReserve.hqs": []});
        let (mut sim, _) = agents_core::scenario::load_with(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &format!("{root}/{DATA_DIR}"), &root, Some(&o), None).expect("сценарий");
        cut(&mut sim, "de_9a", 1.0);
        let i = divs(&sim, "de_okw")[0];
        sim.world.divisions[i].state = State::Reserve;
        assert!(!has(&high(&sim), |k| matches!(k, Kind::MoveReserve { .. })));
        let mut sim2 = load();
        assert_eq!(sim2.rules.commanders.okw_reserve_hqs, vec!["de_okw".to_string()]);
        cut(&mut sim2, "de_9a", 1.0);
        sim2.world.divisions[i].state = State::Reserve;
        assert!(has(&high(&sim2), |k| matches!(k, Kind::MoveReserve { .. })));
    }

    /// Резерв уже в угрожаемой армии не «перемещается» к ней; чужой армии (не ОКВ) резервом ОКВ не считается.
    #[test]
    fn move_reserve_excludes_target_own() {
        let mut sim = load();
        cut(&mut sim, "de_9a", 1.0);
        let calm = agents_core::model::DefenseSub::Prepared;
        for id in ["de_okw", "de_9a", "de_3pza", "de_4pza"] { for i in divs(&sim, id) { sim.world.divisions[i].state = State::Defense(calm); } }
        for i in divs(&sim, "de_okw") { sim.world.divisions[i].cut_since = None; }
        // резерв внутри цели и в постороннем соединении — вариантов нет
        let own = divs(&sim, "de_9a")[0];
        sim.world.divisions[own].state = State::Reserve;
        sim.world.divisions[own].cut_since = None; // не окружён: исключает только условие «уже в целевой армии»
        let other = divs(&sim, "de_4pza")[0];
        sim.world.divisions[other].state = State::Reserve;
        assert!(!has(&high(&sim), |k| matches!(k, Kind::MoveReserve { .. })));
        // резерв ОКВ — есть, и точка — центр цели
        let r = divs(&sim, "de_okw")[0];
        sim.world.divisions[r].state = State::Reserve;
        let o = high(&sim);
        let m = o.iter().find(|c| matches!(c.kind, Kind::MoveReserve { .. })).expect("резерв ОКВ");
        let Kind::MoveReserve { hq: h, to } = m.kind else { unreachable!() };
        assert_eq!(h, sim.world.divisions[r].hq);
        let ds = divs(&sim, "de_9a");
        let c = XY::new(ds.iter().map(|&i| sim.world.divisions[i].vars.pos.x).sum::<f64>() / ds.len() as f64, ds.iter().map(|&i| sim.world.divisions[i].vars.pos.y).sum::<f64>() / ds.len() as f64);
        assert!(to.dist(c) < 1e-6);
        // окружённый резерв не двигается
        sim.world.divisions[r].cut_since = Some(0);
        assert!(!has(&high(&sim), |k| matches!(k, Kind::MoveReserve { .. })));
    }
}

/// Цикл решений: польза по мотивам и характеру, выбор, разбор и встраивание в фазу командования.
mod decide {
    use super::*;
    use agents_core::command::control::{Control, Role};
    use agents_core::commander::decide::{score, Scored, DOC_PREFIX};
    use agents_core::commander::options::{Choice, Kind};
    use agents_core::commander::options_su::options_su;
    use agents_core::commander::picture::{ArmyView, Picture};
    use agents_core::model::Side;
    use agents_core::world::Sim;

    fn load(over: Option<&serde_json::Value>) -> Sim {
        let root = repo_root();
        let (sim, _) = agents_core::scenario::load_with(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &format!("{root}/{DATA_DIR}"), &root, over, None).expect("сценарий");
        sim
    }
    fn hq(sim: &Sim, id: &str) -> u32 { sim.world.hqs.iter().position(|h| h.id == id).expect(id) as u32 }
    /// Обе стороны — штабы-агенты под командующими; `before` — правка управления до прогона.
    fn run(over: Option<&serde_json::Value>, hours: u32, before: impl Fn(&mut Sim)) -> Sim {
        let mut sim = load(over);
        let mut pending = Vec::new();
        for side in [Side::Su, Side::De] {
            pending.extend(agents_core::command::control::command_mode(&mut sim, "agents", side).expect("режим"));
            agents_core::commander::enable(&mut sim, side);
        }
        pending.sort_by_key(|x| x.0);
        before(&mut sim);
        for _ in 0..hours { agents_core::command::control::feed(&mut sim, &mut pending, false); sim.step(); }
        sim
    }
    fn commander<'a>(sim: &'a Sim, id: &str) -> Option<&'a agents_core::commander::decide::Commander> {
        let h = hq(sim, id);
        sim.commanders.list.iter().find(|c| c.hq == h)
    }

    /// Обстановка: стрелковая армия на глубине 8 км (главная полоса прорвана), прорыва тактической зоны нет;
    /// танковая армия ждёт.
    fn mobile_case(sim: &mut Sim) -> (Picture, Vec<Choice>) {
        let (rifle, tank) = (hq(sim, "su_8gva"), hq(sim, "su_1gta"));
        sim.command.role_hq[rifle as usize] = Role::First;
        sim.command.role_hq[tank as usize] = Role::Mobile;
        let view = |h: u32, adv: f64| ArmyView { hq: h, advance_km: adv, strength: 1.0, enemy_est: 1.0, enemy_true: 1.0, to_objective_km: Some(80.0), broke_through: false };
        let pic = Picture { tick: 10, armies: vec![view(rifle, 8.0), view(tank, 0.0)], enemy_reserves: vec![], rival: None, open_flanks: vec![], pockets: vec![], to_objective_km: Some(80.0) };
        let p = sim.rules.commanders.for_hq("su_1bf").unwrap().clone();
        let o = options_su(sim, hq(sim, "su_1bf"), &p, &pic);
        (pic, o)
    }
    /// Оценка вариантов с постоянными весами и мотивами (значения до калибровки): проверка механизма — черта меняет
    /// выбор, — а не подобранных чисел, которые калибровка двигает.
    fn scored(_sim: &Sim, o: &[Choice], t: &Traits) -> Vec<Scored> {
        let w = agents_core::commander::Weights { uncertainty: 2.5, losses: 1.0, persistence: 1.0, obedience: 0.5 };
        let m = Motives([0.8, 0.7, 0.3, 0.4, 0.7, 0.0, 0.0]);
        o.iter().map(|c| score(c, &m, t, &w, false)).collect()
    }
    fn best(v: &[Scored]) -> &Kind { &v.iter().max_by(|a, b| a.total.total_cmp(&b.total)).unwrap().choice.kind }
    /// Решение о подвижной группе: ввести или ждать — лучший из этих двух вариантов.
    fn mobile_choice(v: &[Scored]) -> &Kind {
        &v.iter().filter(|s| matches!(s.choice.kind, Kind::CommitMobile { .. } | Kind::WaitMobile)).max_by(|a, b| a.total.total_cmp(&b.total)).unwrap().choice.kind
    }

    /// Слагаемые пользы — как в формуле; честолюбие усиливает соперничество и разгром.
    #[test]
    fn score_formula() {
        let w = agents_core::commander::Weights { uncertainty: 2.0, losses: 3.0, persistence: 0.5, obedience: 1.5 };
        let c = Choice { kind: Kind::Hold, label: "т".into(), contrib: Motives([0.5, 0.4, -0.2, 0.0, 0.3, 0.0, 0.0]), uncertainty: 0.4, losses: 0.2, rule: "т" };
        let m = Motives([0.8, 0.5, 0.3, 0.0, 0.6, 0.0, 0.0]);
        let t = Traits([0.7, 0.6, 0.9, 0.25, 0.4]);
        let s = score(&c, &m, &t, &w, true);
        let amb = 0.5 + 0.9;
        let parts = 0.8 * 0.5 + 0.5 * amb * 0.4 + 0.3 * -0.2 + 0.6 * amb * 0.3;
        let penalty = 0.3 * 2.0 * 0.4 + 0.75 * 3.0 * 0.2;
        let bonus = 0.6 * 0.5 + 0.4 * 1.5 * 0.5;
        assert!((s.parts.get(Motive::Rival) - 0.5 * amb * 0.4).abs() < 1e-12);
        assert!((s.penalty - penalty).abs() < 1e-12 && (s.bonus - bonus).abs() < 1e-12);
        assert!((s.total - (parts - penalty + bonus)).abs() < 1e-12, "{}", s.total);
        assert!(s.mind.is_none());
        let s2 = score(&c, &m, &t, &w, false);
        assert!((s.total - s2.total - 0.6 * 0.5).abs() < 1e-12);
    }

    #[test]
    fn risky_and_cautious_differ() {
        let mut sim = load(None);
        let (_, o) = mobile_case(&mut sim);
        let mut t = sim.rules.commanders.for_hq("su_1bf").unwrap().traits;
        t.0[Trait::Risk as usize] = 0.9;
        let risky = scored(&sim, &o, &t);
        assert!(matches!(best(&risky), Kind::CommitMobile { .. }), "{:?}", best(&risky));
        t.0[Trait::Risk as usize] = 0.1;
        let cautious = scored(&sim, &o, &t);
        assert_eq!(mobile_choice(&cautious), &Kind::WaitMobile);
        assert!(!matches!(best(&cautious), Kind::CommitMobile { .. }));
    }

    #[test]
    fn confident_and_shaken_differ() {
        let mut sim = load(None);
        let (_, o) = mobile_case(&mut sim);
        let p = sim.rules.commanders.for_hq("su_1bf").unwrap().clone();
        let m = &sim.rules.commanders.mood;
        let sure = effective(&p.traits, &Mood { confidence: 0.9, stress: 0.1 }, m);
        let shaken = effective(&p.traits, &Mood { confidence: 0.1, stress: 0.9 }, m);
        let (a, b) = (scored(&sim, &o, &sure), scored(&sim, &o, &shaken));
        assert!(matches!(best(&a), Kind::CommitMobile { .. }), "{:?}", best(&a));
        assert_ne!(best(&a), best(&b));
        assert_eq!(mobile_choice(&b), &Kind::WaitMobile);
    }

    #[test]
    fn decision_repeats_with_seed() {
        let key = |sim: &Sim| -> Vec<(u32, u32, String)> {
            sim.commanders.list.iter().flat_map(|c| c.decisions.iter().map(move |d| (c.hq, d.tick, format!("{:?}", d.options[d.chosen].choice.kind)))).collect()
        };
        let a = run(None, 48, |_| {});
        let b = run(None, 48, |_| {});
        let ka = key(&a);
        assert!(!ka.is_empty());
        assert_eq!(ka, key(&b));
        // каждое решение — с разбором, и документ командующего с правилом
        for c in &a.commanders.list {
            for d in &c.decisions {
                assert!(d.chosen < d.options.len() && !d.why.is_empty() && !d.trigger.is_empty());
            }
            assert!(c.snapshots.iter().filter(|s| s.tick % 6 == 0).count() >= 8, "{}", a.world.hqs[c.hq as usize].id);
        }
        let docs: Vec<_> = a.documents.iter().filter(|d| d.text.starts_with(DOC_PREFIX)).collect();
        assert_eq!(docs.len(), ka.len());
        assert!(docs.iter().all(|d| d.rule.as_deref().is_some_and(|r| !r.is_empty())));
        // у командующего Ставки ответы на запросы — его, прежний ответ «держать» не даётся
        assert!(!a.documents.iter().any(|d| d.text.contains(": держать") && !d.text.starts_with(DOC_PREFIX) && d.hq == hq(&a, "de_hc")));
    }

    /// Штаб без профиля — без командующего, решает по прежним правилам штаба.
    #[test]
    fn hq_without_profile_keeps_staff_rules() {
        let o = json!({"commanders.profiles.busse.hqs": []});
        let sim = run(Some(&o), 48, |_| {});
        assert!(commander(&sim, "de_9a").is_none());
        assert!(commander(&sim, "de_hgr_weichsel").is_some());
        let h = hq(&sim, "de_9a");
        let own: Vec<_> = sim.documents.iter().filter(|d| d.hq == h).collect();
        assert!(!own.is_empty());
        assert!(own.iter().all(|d| !d.text.contains(DOC_PREFIX)), "{:?}", own.iter().find(|d| d.text.contains(DOC_PREFIX)));
    }

    /// Место игрока: командующий молчит.
    #[test]
    fn player_seat_silences_commander() {
        let sim = run(None, 48, |sim| {
            let (f, top) = (hq(sim, "su_1bf"), hq(sim, "de_hc"));
            sim.command.control[f as usize] = Control::Player;
            sim.command.control[top as usize] = Control::Player;
        });
        assert!(commander(&sim, "su_1bf").unwrap().decisions.is_empty());
        assert!(commander(&sim, "de_hc").unwrap().decisions.is_empty());
        assert!(sim.command.requests.iter().all(|r| r.answer.is_none()));
        // а Конев решает
        assert!(!commander(&sim, "su_1uf").unwrap().decisions.is_empty());
    }

    /// По умолчанию командующие выключены: прежние прогоны (и их отпечатки в tests/command.rs) не меняются.
    #[test]
    fn digests_unchanged() {
        let mut sim = load(None);
        assert_eq!(sim.commanders.enabled, [false, false]);
        assert!(sim.commanders.list.is_empty());
        for _ in 0..6 { sim.step(); }
        assert!(sim.commanders.list.is_empty() && sim.commanders.log.dist.is_empty());
        assert!(!sim.documents.iter().any(|d| d.text.starts_with(DOC_PREFIX)));
    }

    /// Состояние не насыщается: через 48 ч ни у кого нет одновременно уверенности ≤ 0,01 и напряжения ≥ 0,99.
    #[test]
    fn mood_not_saturated() {
        let sim = run(None, 48, |_| {});
        for c in &sim.commanders.list {
            let id = &sim.world.hqs[c.hq as usize].id;
            println!("{id}: уверенность {:.2}, напряжение {:.2}", c.mood.confidence, c.mood.stress);
            assert!(!(c.mood.confidence <= 0.01 && c.mood.stress >= 0.99), "{id}: {:?}", c.mood);
        }
    }

    /// Фронт с командующим не вводит подвижные группы сам: введённая — только по решению командующего.
    #[test]
    fn front_with_commander_does_not_auto_commit() {
        let sim = run(None, 48, |_| {});
        for f in ["su_1bf", "su_1uf"] {
            let c = commander(&sim, f).unwrap();
            for (h, x) in sim.world.hqs.iter().enumerate() {
                if x.parent != Some(c.hq) || sim.command.role_hq[h] != Role::Committed { continue; }
                let by_commander = c.decisions.iter().any(|d| d.options[d.chosen].choice.kind == Kind::CommitMobile { hq: h as u32 });
                let is_tank = x.id.contains("gta");
                assert!(!is_tank || by_commander, "{f}: {} введена без решения командующего", x.id);
            }
        }
    }

    /// В начале операции марширует только танковая армия: ни ввода подвижной группы, ни ожидания у фронтов нет.
    #[test]
    fn no_mobile_options_on_first_hours() {
        let sim = run(None, 3, |_| {});
        for f in ["su_1bf", "su_1uf"] {
            let c = commander(&sim, f).unwrap();
            for d in &c.decisions {
                assert!(!d.options.iter().any(|o| matches!(o.choice.kind, Kind::CommitMobile { .. } | Kind::WaitMobile)), "{f} {}: {:?}", d.tick, d.options.iter().map(|o| &o.choice.label).collect::<Vec<_>>());
            }
        }
    }

    // ---- исполнение решений: по одному на семейство ----

    /// Командующий штаба `id` с единственным решением `ch` (как после `decide`).
    fn decided(sim: &mut Sim, id: &str, ch: Choice) -> agents_core::commander::decide::Commander {
        let h = hq(sim, id);
        let mut c = sim.commanders.list.iter().find(|c| c.hq == h).expect("командующий").clone();
        let p = sim.rules.commanders.profiles[c.profile].clone();
        let s = score(&ch, &p.motives, &p.traits, &sim.rules.commanders.weights, false);
        c.intent = Some(ch.kind.clone());
        c.decisions.push(agents_core::commander::decide::Decision { tick: sim.world.tick, trigger: "проверка".into(), options: vec![s], chosen: 0, why: "проверка".into() });
        c
    }
    fn choice(kind: Kind) -> Choice { Choice { kind, label: "проверка".into(), contrib: Motives([0.0; 7]), uncertainty: 0.0, losses: 0.0, rule: "правило проверки" } }
    fn started(side: Side, hours: u32) -> Sim {
        let mut sim = load(None);
        let mut pending = agents_core::command::control::command_mode(&mut sim, "agents", side).expect("режим");
        agents_core::commander::enable(&mut sim, side);
        for _ in 0..hours { agents_core::command::control::feed(&mut sim, &mut pending, false); sim.step(); }
        sim
    }
    use agents_core::command::directive::{Target, Task};
    use agents_core::commander::apply::{apply, execute_permitted};

    /// Два решения подряд «замкнуть тот же котёл» (номер котла в картине сменился, центр сдвинулся на 3 км) — одна
    /// директива; другой котёл — новая директива. Документ решения — на каждое.
    #[test]
    fn repeated_encircle_one_directive() {
        use agents_core::commander::decide::adopt;
        use agents_core::commander::picture::{ArmyView, PocketView};
        use agents_core::geo::XY;
        let mut sim = started(Side::Su, 3);
        let (f, a, b) = (hq(&sim, "su_1bf"), hq(&sim, "su_8gva"), hq(&sim, "su_69a"));
        let view = |h: u32| ArmyView { hq: h, advance_km: 10.0, strength: 1.0, enemy_est: 1.0, enemy_true: 1.0, to_objective_km: Some(50.0), broke_through: false };
        let pocket = |x: f64| PocketView { center: XY::new(x, 0.0), enemy_est: 2.0, gap_km: 1.0, by: vec![a, b] };
        let pic = |pockets: Vec<PocketView>| Picture { tick: sim.world.tick, armies: vec![view(a), view(b)], enemy_reserves: vec![], rival: None, open_flanks: vec![], pockets, to_objective_km: Some(50.0) };
        let (p0, p1, p2) = (pic(vec![pocket(100.0)]), pic(vec![pocket(400.0), pocket(103.0)]), pic(vec![pocket(400.0), pocket(106.0)]));
        let mut c = sim.commanders.list.iter().find(|c| c.hq == f).unwrap().clone();
        let prof = sim.rules.commanders.profiles[c.profile].clone();
        let sc = |k: Kind| vec![score(&choice(k), &prof.motives, &prof.traits, &sim.rules.commanders.weights, false)];
        let (s0, s1, s2) = (sc(Kind::Encircle { pocket: 0 }), sc(Kind::Encircle { pocket: 1 }), sc(Kind::Encircle { pocket: 0 }));
        let issued = |sim: &Sim| sim.command.in_transit.iter().filter(|(_, d)| d.from == f && d.note == "проверка").count();
        let docs = |sim: &Sim| sim.documents.iter().filter(|d| d.hq == f && d.text.starts_with(DOC_PREFIX)).count();
        let tick = sim.world.tick;
        let d0 = docs(&sim);
        c.picture = Some(p0);
        adopt(&mut sim, &mut c, s0, 0, tick, "проверка".into());
        let n = issued(&sim);
        assert_eq!(n, 2, "по директиве каждой охватывающей армии");
        c.picture = Some(p1);
        adopt(&mut sim, &mut c, s1, 0, tick + 1, "проверка".into());
        assert_eq!(issued(&sim), n, "тот же котёл — директивы заново не отдаются");
        assert_eq!(docs(&sim), d0 + 2);
        // другой котёл
        c.picture = Some(p2);
        adopt(&mut sim, &mut c, s2, 0, tick + 2, "проверка".into());
        assert_eq!(issued(&sim), n + 2);
    }

    /// Тот же поворот к объекту соперника подряд — одна директива.
    #[test]
    fn repeated_turn_one_directive() {
        use agents_core::commander::decide::adopt;
        let mut sim = started(Side::Su, 3);
        let (f, tank) = (hq(&sim, "su_1bf"), hq(&sim, "su_2gta"));
        let mut c = sim.commanders.list.iter().find(|c| c.hq == f).unwrap().clone();
        c.picture = Some(Picture { tick: sim.world.tick, armies: vec![], enemy_reserves: vec![], rival: None, open_flanks: vec![], pockets: vec![], to_objective_km: Some(50.0) });
        let prof = sim.rules.commanders.profiles[c.profile].clone();
        let k = Kind::TurnToRival { hq: tank, at: agents_core::geo::XY::new(5.0, 5.0) };
        let tick = sim.world.tick;
        for t in 0..3 {
            let s = vec![score(&choice(k.clone()), &prof.motives, &prof.traits, &sim.rules.commanders.weights, false)];
            adopt(&mut sim, &mut c, s, 0, tick + t, "проверка".into());
            // «продолжать по плану» между повторами не сбрасывает замысел
            let s = vec![score(&choice(Kind::Continue), &prof.motives, &prof.traits, &sim.rules.commanders.weights, true)];
            adopt(&mut sim, &mut c, s, 0, tick + t, "проверка".into());
            assert_eq!(c.intent, Some(k.clone()));
        }
        assert_eq!(sim.command.in_transit.iter().filter(|(_, d)| d.from == f && d.to == Target::Hq(tank)).count(), 1);
    }

    /// Повод «армия прорвала оборону» — один раз на армию; снова — только если армия теряла прорыв не меньше 12 ч.
    #[test]
    fn breakthrough_trigger_once() {
        use agents_core::commander::decide::trigger;
        use agents_core::commander::picture::ArmyView;
        let sim = started(Side::Su, 1);
        let (f, a) = (hq(&sim, "su_1bf"), hq(&sim, "su_8gva"));
        let mut c = sim.commanders.list.iter().find(|c| c.hq == f).unwrap().clone();
        let pic = |tick: u32, broke: bool| Picture { tick, armies: vec![ArmyView { hq: a, advance_km: 20.0, strength: 1.0, enemy_est: 1.0, enemy_true: 1.0, to_objective_km: Some(50.0), broke_through: broke }],
            enemy_reserves: vec![], rival: None, open_flanks: vec![], pockets: vec![], to_objective_km: Some(50.0) };
        let mut fired = Vec::new();
        // прорыв на 10-м часу, потеря на 3 ч, снова прорыв; потеря на 12 ч, снова прорыв
        let broke = |t: u32| (10..=20).contains(&t) || (24..=30).contains(&t) || t >= 43;
        c.picture = Some(pic(0, false));
        for t in 1..50 {
            let p = pic(t, broke(t));
            if trigger(&sim, &mut c, &p, t).is_some_and(|w| w.contains("прорвала оборону")) { fired.push(t); }
            c.picture = Some(p);
        }
        assert_eq!(fired, vec![10, 43]);
    }

    /// Полный путь разрешения: армия поднимает запросы на отход → они ждут срока ответа → верхняя инстанция (Гитлер
    /// с сильной поправкой «спасти армию») разрешает → разрешённый отход отдаётся дивизиям распоряжением их штаба.
    #[test]
    fn permission_path_end_to_end() {
        use agents_core::commander::profile::Motive;
        let mut sim = load(None);
        let mut pending = agents_core::command::control::command_mode(&mut sim, "agents", Side::De).expect("режим");
        for _ in 0..2 { agents_core::command::control::feed(&mut sim, &mut pending, false); sim.step(); }
        agents_core::commander::enable(&mut sim, Side::De);
        let hitler = sim.rules.commanders.profiles.iter().position(|p| p.hqs.iter().any(|h| h == "de_hc")).unwrap();
        sim.rules.commanders.profiles[hitler].motives.0[Motive::Save as usize] = 1.0;
        sim.rules.commanders.profiles[hitler].motives.0[Motive::Hold as usize] = 0.0;
        let a = hq(&sim, "de_9a");
        let k = Kind::Withdraw { hq: a };
        let mut c = decided(&mut sim, "de_9a", choice(k.clone()));
        let at = agents_core::commander::apply::rear_of(&sim, a).expect("рубеж в глубине");
        c.withdraw_at = vec![(a, at)];
        let (n0, t0) = (sim.command.requests.len(), sim.world.tick);
        apply(&mut sim, &c, &k, t0);
        let n1 = sim.command.requests.len();
        assert!(n1 > n0);
        let wait = sim.rules.command.de.permission_hours as u32;
        for _ in 0..wait + 2 {
            // до срока ответа запросы ждут
            if sim.world.tick < t0 + wait { assert!(sim.command.requests[n0..n1].iter().all(|r| r.answer.is_none()), "ответ раньше срока: час {}", sim.world.tick); }
            agents_core::command::control::feed(&mut sim, &mut pending, false);
            sim.step();
        }
        let mine = &sim.command.requests[n0..n1];
        assert!(mine.iter().all(|r| r.answer == Some(true) && r.answered_at == t0 + wait), "{:?}", mine.iter().map(|r| (r.answer, r.answered_at)).collect::<Vec<_>>());
        let top = commander(&sim, "de_hc").unwrap();
        assert!(top.decisions.iter().any(|d| d.tick == t0 + wait && matches!(d.options[d.chosen].choice.kind, Kind::Permit { .. })));
        for r in mine {
            let div = agents_core::command::passing::target_id(&sim, Target::Division(r.division));
            assert!(sim.documents.iter().any(|d| d.hq == r.hq && d.to.contains(&div) && d.rule.as_deref() == Some("разрешение верхней инстанции на отход") && d.text.contains("отходить")), "{div}");
        }
    }

    /// В часе, когда у верхней инстанции ждут несколько запросов, она сначала отвечает на все запросы, потом решает
    /// прочее (резерв, деблокирование) — даже когда прочее (продолжение деблокирования) выгоднее ответа.
    #[test]
    fn high_answers_requests_first() {
        // ответ дорог (потери), перемещение резерва выгодно
        let o = json!({"commanders.profiles.hitler.traits.persistence": 1.0, "commanders.weights.persistence": 3.0});
        let mut sim = load(Some(&o));
        let mut pending = agents_core::command::control::command_mode(&mut sim, "agents", Side::De).expect("режим");
        for _ in 0..2 { agents_core::command::control::feed(&mut sim, &mut pending, false); sim.step(); }
        agents_core::commander::enable(&mut sim, Side::De);
        let a = hq(&sim, "de_9a");
        let ds: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| { let d = &sim.world.divisions[i]; !d.state.out() && { let mut x = d.hq; loop { if x == a { break true; } match sim.world.hqs[x as usize].parent { Some(p) => x = p, None => break false } } } }).collect();
        for &i in ds.iter().take(ds.len() * 6 / 10) { sim.world.divisions[i].cut_since = Some(0); }
        let wait = sim.rules.command.de.permission_hours as u32;
        let tick = sim.world.tick + wait;
        for (k, corps) in ["de_ci", "de_v"].iter().enumerate() {
            let div = ds[ds.len() - 1 - k] as u32;
            sim.command.requests.push(agents_core::command::control::Request { hq: hq(&sim, corps), tick: tick - wait, division: div, at: agents_core::geo::XY::new(0.0, 0.0), answer: None, answered_at: 0 });
        }
        let mine = sim.command.requests.len();
        sim.world.tick = tick;
        // действующее решение верхней инстанции — деблокирование 9 А: его продолжение выгоднее ответа (настойчивость)
        let top = hq(&sim, "de_hc");
        let prof = sim.rules.commanders.for_hq("de_hc").unwrap().clone();
        let relief = agents_core::commander::options_de::options_high(&sim, top, &prof).into_iter().find(|c| matches!(c.kind, Kind::Relief { .. })).expect("деблокирование").kind;
        sim.commanders.list.iter_mut().find(|c| c.hq == top).unwrap().intent = Some(relief);
        agents_core::commander::decide::cycle(&mut sim, tick);
        let top = commander(&sim, "de_hc").unwrap();
        let kinds: Vec<&Kind> = top.decisions.iter().filter(|d| d.tick == tick).map(|d| &d.options[d.chosen].choice.kind).collect();
        assert!(sim.command.requests[mine - 2..mine].iter().all(|r| r.answer.is_some()), "{kinds:?}");
        let first_other = kinds.iter().position(|k| !matches!(k, Kind::Permit { .. } | Kind::Forbid { .. })).unwrap_or(kinds.len());
        assert!(first_other >= 2, "{kinds:?}");
        assert!(kinds[first_other..].iter().all(|k| !matches!(k, Kind::Permit { .. } | Kind::Forbid { .. })), "{kinds:?}");
    }

    #[test]
    fn apply_commit_mobile_sets_role_and_deep_task() {
        let mut sim = started(Side::Su, 3);
        let (f, tank) = (hq(&sim, "su_1bf"), hq(&sim, "su_1gta"));
        assert_eq!(sim.command.role_hq[tank as usize], Role::Mobile);
        let k = Kind::CommitMobile { hq: tank };
        let c = decided(&mut sim, "su_1bf", choice(k.clone()));
        let tick = sim.world.tick;
        apply(&mut sim, &c, &k, tick);
        assert_eq!(sim.command.role_hq[tank as usize], Role::Committed);
        assert!(sim.command.fresh[f as usize]);
        // командующие сейчас вне списка: решение повторно не принимается, штаб фронта распределяет полосу заново
        sim.commanders.enabled = [false, false];
        sim.step();
        let deep = sim.command.in_transit.iter().map(|x| &x.1).chain(sim.command.intent[tank as usize].iter())
            .find(|d| d.to == Target::Hq(tank) && d.from == f && d.rule.as_deref().is_some_and(|r| r.contains("правило проверки"))).expect("задача на глубину");
        assert_eq!(deep.task, Task::Attack);
        assert!(deep.immediate.is_some() && deep.immediate == deep.subsequent, "{:?}", deep.immediate);
        assert!(sim.documents.iter().any(|d| d.text.starts_with(DOC_PREFIX) && d.hq == f));
    }

    #[test]
    fn apply_forbid_answers_request() {
        let mut sim = started(Side::De, 1);
        let corps = hq(&sim, "de_ci");
        sim.command.requests.push(agents_core::command::control::Request { hq: corps, tick: 0, division: 0, at: agents_core::geo::XY::new(0.0, 0.0), answer: None, answered_at: 0 });
        let i = sim.command.requests.len() - 1;
        let k = Kind::Forbid { request: i };
        let c = decided(&mut sim, "de_hc", choice(k.clone()));
        apply(&mut sim, &c, &k, 30);
        assert_eq!(sim.command.requests[i].answer, Some(false));
        assert_eq!(sim.command.requests[i].answered_at, 30);
        let doc = sim.documents.last().unwrap();
        assert!(doc.text.starts_with(DOC_PREFIX) && doc.to.contains(&"de_ci".to_string()) && doc.rule.as_deref() == Some("правило проверки"));
    }

    #[test]
    fn apply_shift_and_turn_issue_directives() {
        let mut sim = started(Side::Su, 3);
        let (f, a, b) = (hq(&sim, "su_1bf"), hq(&sim, "su_69a"), hq(&sim, "su_1gta"));
        let tick = sim.world.tick;
        let k = Kind::ShiftMainBlow { to: vec![a] };
        let c = decided(&mut sim, "su_1bf", choice(k.clone()));
        apply(&mut sim, &c, &k, tick);
        assert!(sim.command.in_transit.iter().any(|(_, d)| d.from == f && d.to == Target::Hq(f) && d.main_blow == vec![a]), "директива фронту");
        let at = agents_core::geo::XY::new(0.0, 0.0);
        let k = Kind::TurnToRival { hq: b, at };
        let c = decided(&mut sim, "su_1bf", choice(k.clone()));
        apply(&mut sim, &c, &k, tick);
        assert!(sim.command.named_hq[b as usize]);
        let d = sim.command.in_transit.iter().map(|x| &x.1).find(|d| d.from == f && d.to == Target::Hq(b)).expect("частная директива");
        assert_eq!(d.task, Task::Attack);
        assert_eq!(d.immediate.as_ref().unwrap().pts, vec![at]);
    }

    #[test]
    fn apply_withdraw_raises_requests_and_waits_for_permit() {
        let mut sim = started(Side::De, 2);
        let a = hq(&sim, "de_9a");
        let k = Kind::Withdraw { hq: a };
        let mut c = decided(&mut sim, "de_9a", choice(k.clone()));
        let at = agents_core::geo::XY::new(1.0, 2.0);
        c.withdraw_at = vec![(a, at)];
        let (n0, t0) = (sim.command.requests.len(), sim.command.in_transit.len());
        let tick = sim.world.tick;
        apply(&mut sim, &c, &k, tick);
        let new: Vec<_> = sim.command.requests[n0..].to_vec();
        assert!(!new.is_empty());
        assert!(new.iter().all(|r| r.at == at && r.answer.is_none() && r.tick == tick));
        // до разрешения войска не двигаются: ни директивы армии, ни распоряжений дивизиям
        assert_eq!(sim.command.in_transit.len(), t0);
        execute_permitted(&mut sim, tick);
        assert_eq!(sim.command.in_transit.len(), t0);
        // повторное решение тех же дивизий второй раз не запрашивает
        apply(&mut sim, &c, &k, tick);
        assert_eq!(sim.command.requests.len(), n0 + new.len());
        // разрешено — отход к рубежу запроса
        let i = n0;
        sim.command.requests[i].answer = Some(true);
        execute_permitted(&mut sim, tick);
        let div = sim.command.requests[i].division;
        let d = sim.command.in_transit.iter().map(|x| &x.1).find(|d| d.to == Target::Division(div)).expect("распоряжение на отход");
        assert_eq!(d.task, Task::Withdraw);
        assert_eq!(d.immediate.as_ref().unwrap().pts, vec![at]);
    }
}

/// Проигрывание «в уме»: копия мира, польза по результату проигрыша.
mod mind {
    use super::*;
    use agents_core::model::Side;
    use agents_core::world::Sim;

    fn load(over: Option<&serde_json::Value>) -> Sim {
        let root = repo_root();
        let (sim, _) = agents_core::scenario::load_with(&format!("{root}/packages/sim/data/scenarios/agents/berlin-1945.json"), &format!("{root}/{DATA_DIR}"), &root, over, None).expect("сценарий");
        sim
    }
    fn run(over: Option<&serde_json::Value>, hours: u32) -> Sim {
        let mut sim = load(over);
        let mut pending = Vec::new();
        for side in [Side::Su, Side::De] {
            pending.extend(agents_core::command::control::command_mode(&mut sim, "agents", side).expect("режим"));
            agents_core::commander::enable(&mut sim, side);
        }
        pending.sort_by_key(|x| x.0);
        for _ in 0..hours { agents_core::command::control::feed(&mut sim, &mut pending, false); sim.step(); }
        sim
    }

    /// Всё, что копия могла бы задеть в оригинале и чего не видит отпечаток.
    fn state_key(sim: &Sim) -> String {
        let su = sim.su_staff.lock().unwrap();
        format!("{}|{}|{:?}|{:?}|{}|{}|{}|{:?}|{:?}", sim.digest(), sim.world.tick, sim.command.requests, sim.command.role_hq,
            sim.command.intent.iter().flatten().count(), sim.documents.len(), sim.journal.len(), su.plan, su.ech)
    }

    /// Копия идёт своим ходом: оригинал не меняется.
    #[test]
    fn fork_does_not_touch_original() {
        let mut sim = run(None, 6);
        let before = state_key(&sim);
        let mut f = sim.fork();
        assert_eq!(f.commanders.enabled, [false, false]);
        assert!(f.llm.is_none() && f.history.is_none() && f.documents.is_empty() && f.journal.is_empty());
        for _ in 0..24 { f.step(); }
        assert_ne!(f.digest(), sim.digest());
        assert_eq!(state_key(&sim), before);
        // оригинал после копии идёт дальше как шёл
        sim.step();
    }

    /// Одинаковые миры с одним зерном — одинаковые результаты проигрыша.
    #[test]
    fn mind_repeats_with_seed() {
        let over = json!({"commanders.lookaheadHours": 12, "commanders.mindMargin": 1.0});
        let key = |sim: &Sim| -> Vec<String> {
            sim.commanders.list.iter().flat_map(|c| c.decisions.iter().flat_map(move |d| d.options.iter().filter_map(move |s| s.mind.as_ref().map(|m| format!("{} {} {:?}", c.hq, d.tick, m))))).collect()
        };
        let (a, b) = (run(Some(&over), 24), run(Some(&over), 24));
        assert!(!key(&a).is_empty());
        assert_eq!(key(&a), key(&b));
    }

    /// Противник в зоне разведки армии — к оценке; вне зоны и в оригинале — как был.
    #[test]
    fn scale_enemy_applies_ratio() {
        let sim = run(None, 12);
        let army = sim.world.hqs.iter().position(|h| h.side == Side::Su && h.echelon == agents_core::model::Echelon::Army).unwrap() as u32;
        let under = |mut h: u32| loop { if h == army { return true; } match sim.world.hqs[h as usize].parent { Some(p) => h = p, None => return false } };
        let mine: Vec<_> = sim.world.divisions.iter().filter(|d| !d.state.out() && under(d.hq)).map(|d| d.vars.pos).collect();
        let recon = sim.rules.contact_km * agents_core::commander::picture::RECON_X;
        let near = |d: &agents_core::model::Division| mine.iter().any(|p| p.dist(d.vars.pos) <= recon);
        let view = agents_core::commander::picture::ArmyView { hq: army, advance_km: 0.0, strength: 1.0, enemy_est: 0.5, enemy_true: 1.0, to_objective_km: None, broke_through: false };
        let pic = agents_core::commander::picture::Picture { tick: 0, armies: vec![view], enemy_reserves: vec![], rival: None, open_flanks: vec![], pockets: vec![], to_objective_km: None };
        let mut f = sim.fork();
        agents_core::commander::mind::scale_enemy(&mut f, &pic);
        let (mut scaled, mut kept) = (0, 0);
        for (o, d) in sim.world.divisions.iter().zip(&f.world.divisions) {
            let hit = o.side == Side::De && !o.state.out() && near(o);
            let k = if hit { 0.5 } else { 1.0 };
            assert!((d.vars.personnel - o.vars.personnel * k).abs() < 1e-9 && (d.vars.tanks - o.vars.tanks * k).abs() < 1e-9 && (d.vars.guns - o.vars.guns * k).abs() < 1e-9, "{}", o.id);
            if hit { scaled += 1 } else { kept += 1 }
        }
        assert!(scaled > 0 && kept > 0, "{scaled} {kept}");
    }

    /// Уточнение вклада: прибавка BLEND·измеренное, зажим −1…1, меняются только четыре мотива, знаки против базового.
    #[test]
    fn refine_blends_and_clamps() {
        use agents_core::commander::mind::refine;
        use agents_core::commander::MindResult;
        let c = Motives([0.2, 0.4, -0.2, 0.1, 0.0, 0.3, -0.5]);
        let base = MindResult { hours: 10, advance_km: 2.0, losses: 0.05, encircled: 0.0 };
        // равен базовому — вклад прежний
        assert_eq!(refine(&c, &base, &base).0, c.0);
        // продвижение на 5 км лучше базового (шкала 1 км/ч × 10 ч = 0,5), потери на 0,05 меньше (шкала 0,1 = 0,5), охват +0,05 (шкала 0,1 = 0,5)
        let m = MindResult { hours: 10, advance_km: 7.0, losses: 0.0, encircled: 0.05 };
        let r = refine(&c, &m, &base);
        assert!((r.0[0] - (0.2 + 0.25)).abs() < 1e-12 && (r.0[1] - (0.4 + 0.25)).abs() < 1e-12);
        assert!((r.0[2] - (-0.2 + 0.25)).abs() < 1e-12 && (r.0[4] - 0.25).abs() < 1e-12);
        for i in [3, 5, 6] { assert_eq!(r.0[i], c.0[i]); }
        // хуже базового — ниже; за пределом шкалы измеренное зажато, итог зажат в −1…1
        let bad = MindResult { hours: 10, advance_km: -100.0, losses: 0.9, encircled: -0.9 };
        let r = refine(&c, &bad, &base);
        assert!((r.0[0] - (0.2 - 0.5)).abs() < 1e-12 && (r.0[2] - (-0.2 - 0.5)).abs() < 1e-12 && (r.0[4] + 0.5).abs() < 1e-12);
        let hi = Motives([0.9, 0.9, 0.9, 0.0, 0.9, 0.0, 0.0]);
        let best = MindResult { hours: 10, advance_km: 100.0, losses: 0.0, encircled: 0.9 };
        let r = refine(&hi, &best, &base);
        assert!(r.0.iter().all(|x| (-1.0..=1.0).contains(x)) && r.0[0] == 1.0 && r.0[4] == 1.0);
    }

    /// Проигранный вариант с действием получает вклад, отличный от прежнего, если исход отличается от базового.
    #[test]
    fn mind_changes_contrib() {
        use agents_core::commander::mind::{imagine, refine};
        use agents_core::commander::options::Kind;
        let sim = run(None, 30);
        let mut checked = 0;
        for c in sim.commanders.list.iter().filter(|c| sim.world.hqs[c.hq as usize].echelon == agents_core::model::Echelon::Front && c.picture.is_some()) {
            let pic = c.picture.as_ref().unwrap();
            let p = sim.rules.commanders.profiles[c.profile].clone();
            let opts = match sim.world.hqs[c.hq as usize].side {
                Side::Su => agents_core::commander::options_su::options_su(&sim, c.hq, &p, pic),
                Side::De => agents_core::commander::options_de::options_de(&sim, c.hq, &p, pic),
            };
            let cont = opts.iter().find(|o| matches!(o.kind, Kind::Continue | Kind::Hold)).expect("без действия");
            let base = imagine(&sim, c, pic, cont, 12);
            for o in opts.iter().filter(|o| !matches!(o.kind, Kind::Continue | Kind::WaitMobile | Kind::Hold | Kind::ShiftForces { .. })) {
                let m = imagine(&sim, c, pic, o, 12);
                if m == base { continue; }
                let r = refine(&o.contrib, &m, &base);
                // отличие исхода от базового меняет вклад, кроме случая зажима у границы
                let moved = r.0 != o.contrib.0;
                let at_edge = [0usize, 1, 2, 4].iter().any(|&i| o.contrib.0[i].abs() >= 1.0);
                assert!(moved || at_edge || m.advance_km == base.advance_km && m.losses == base.losses && m.encircled == base.encircled, "{}", o.label);
                checked += 1;
            }
        }
        assert!(checked > 0, "нет ни одного варианта с исходом, отличным от базового");
    }

    #[test]
    fn mind_off_by_default() {
        let sim = run(None, 30);
        let n: usize = sim.commanders.list.iter().map(|c| c.decisions.len()).sum();
        assert!(n > 0);
        assert!(sim.commanders.list.iter().flat_map(|c| &c.decisions).flat_map(|d| &d.options).all(|s| s.mind.is_none()));
    }

    #[test]
    fn mind_on_fills_top() {
        let sim = run(Some(&json!({"commanders.lookaheadHours": 24, "commanders.mindMargin": 1.0})), 30);
        let mut seen = 0;
        for d in sim.commanders.list.iter().flat_map(|c| &c.decisions) {
            let k = d.options.iter().filter(|s| s.mind.is_some()).count();
            assert!(k <= 3, "{k}");
            if k > 0 { seen += 1; }
            for m in d.options.iter().filter_map(|s| s.mind.as_ref()) { assert_eq!(m.hours, 24); }
        }
        assert!(seen > 0, "ни у одного решения нет проигрыша");
    }

    /// Проигрыш только на близких выборах и только у фронтов и групп армий.
    #[test]
    fn mind_only_on_close_calls() {
        let mind = |sim: &Sim| -> Vec<(bool, bool)> {
            sim.commanders.list.iter().flat_map(|c| {
                let front = sim.world.hqs[c.hq as usize].echelon == agents_core::model::Echelon::Front;
                c.decisions.iter().flat_map(|d| &d.options).map(move |s| (front, s.mind.is_some()))
            }).collect()
        };
        let none = run(Some(&json!({"commanders.lookaheadHours": 24, "commanders.mindMargin": 0.0})), 30);
        assert!(mind(&none).iter().all(|x| !x.1) && !mind(&none).is_empty());
        let all = run(Some(&json!({"commanders.lookaheadHours": 24, "commanders.mindMargin": 1.0})), 30);
        let v = mind(&all);
        assert!(v.iter().any(|x| x.0 && x.1), "фронты без проигрыша");
        assert!(v.iter().all(|x| x.0 || !x.1), "проигрыш у армии или Ставки");
    }

    /// Базовый проигрыш строится раз в час на командующего, сколько бы решений он ни принял.
    #[test]
    fn baseline_once_per_hour() {
        let sim = run(Some(&json!({"commanders.lookaheadHours": 6, "commanders.mindMargin": 1.0})), 30);
        let mut ticks = std::collections::BTreeMap::<u32, std::collections::BTreeSet<u32>>::new();
        for c in &sim.commanders.list {
            for d in c.decisions.iter().filter(|d| d.options.iter().any(|s| s.mind.is_some())) { ticks.entry(d.tick).or_default().insert(c.hq); }
        }
        assert!(ticks.values().any(|h| h.len() >= 2), "в одном часе решал один командующий");
        assert_eq!(sim.commanders.baselines as usize, ticks.values().map(|h| h.len()).sum::<usize>());
    }

    /// Замер: доля копирования (и правил) в проигрыше на 24 ч.
    #[test]
    #[ignore]
    fn fork_cost() {
        let sim = run(None, 12);
        let t = std::time::Instant::now();
        for _ in 0..100 { std::hint::black_box(sim.fork()); }
        let fork = t.elapsed().as_secs_f64() / 100.0;
        let t = std::time::Instant::now();
        for _ in 0..100 { std::hint::black_box(sim.rules.clone()); }
        let rules = t.elapsed().as_secs_f64() / 100.0;
        let mut f = sim.fork();
        let t = std::time::Instant::now();
        for _ in 0..24 { f.step(); }
        let steps = t.elapsed().as_secs_f64();
        println!("fork {:.2} мс, из них правила {:.2} мс; 24 шага {:.1} мс; доля fork в проигрыше {:.1} %, правил {:.1} %", fork * 1e3, rules * 1e3, steps * 1e3, 100.0 * fork / (fork + steps), 100.0 * rules / (fork + steps));
    }

    /// Замер скорости: берлинский сценарий 96 ч, обе стороны под командующими, без «в уме» и с ним.
    #[test]
    #[ignore]
    fn mind_speed() {
        for hours in [0, 24] {
            let t = std::time::Instant::now();
            let sim = run(Some(&json!({"commanders.lookaheadHours": hours})), 96);
            let n: usize = sim.commanders.list.iter().map(|c| c.decisions.len()).sum();
            println!("lookahead {hours}: {:.1} с, решений {n}", t.elapsed().as_secs_f64());
        }
    }
}
