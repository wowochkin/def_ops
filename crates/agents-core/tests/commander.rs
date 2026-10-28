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
