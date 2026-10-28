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
        // без соперника у профиля нет и сводки о нём
        assert!(picture(&sim, hq(&sim, "su_2bf"), &log).rival.is_none() || sim.rules.commanders.for_hq("su_2bf").unwrap().rival.is_some());
    }
}
