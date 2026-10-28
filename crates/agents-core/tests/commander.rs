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
    let s = Mood { confidence: 0.5, stress: 0.2 };
    let next = mood_step(&s, &now, Some(&prev), 0.0, m);
    assert!(next.confidence > s.confidence, "{next:?}");
    let slow = pic(1, vec![army(1, 0.0, 1.0), army(2, 0.0, 1.0)]);
    assert!(mood_step(&s, &slow, Some(&prev), 0.0, m).confidence < s.confidence);
}

#[test]
fn stress_grows_on_threat() {
    let m = &Rules::load(&data()).unwrap().commanders.mood;
    let calm = pic(1, vec![army(1, 0.0, 1.0), army(2, 0.0, 1.0)]);
    let mut threat = calm.clone();
    threat.open_flanks = vec![1, 2];
    let s = Mood { confidence: 0.5, stress: 0.2 };
    assert!(mood_step(&s, &threat, None, 0.0, m).stress > mood_step(&s, &calm, None, 0.0, m).stress);
    let weak = pic(1, vec![army(1, 0.0, 0.3), army(2, 0.0, 0.3)]);
    assert!(mood_step(&s, &weak, None, 0.0, m).stress > mood_step(&s, &calm, None, 0.0, m).stress);
    // отставание от срока задачи тоже давит
    assert!(mood_step(&s, &calm, None, 0.8, m).stress > mood_step(&s, &calm, None, 0.0, m).stress);
}

#[test]
fn mood_decays_to_start() {
    let m = &Rules::load(&data()).unwrap().commanders.mood;
    let calm = pic(1, vec![army(1, 0.0, 1.0)]);
    let mut s = Mood { confidence: 0.95, stress: 0.9 };
    let d0 = (s.confidence - m.start.confidence).abs() + (s.stress - m.start.stress).abs();
    for _ in 0..24 { s = mood_step(&s, &calm, None, 0.0, m); }
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
        let depth = sim.rules.doctrine_su.tank_commit_depth_km;
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
