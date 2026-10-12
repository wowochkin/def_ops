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
    // без мостов технике через Одер на участке фронта хода нет (обход возможен только через побережье:
    // проливы Свина, Дзивна и Пенештром в растре 1 км — суша, известный пробел данных театра), пехота форсирует
    let none_open = |_: u16| false;
    if let Some((p, _)) = route::find(&t, &r, Side::Su, Mobility::Tracked, from, to, &none_open) {
        assert!(p.iter().any(|&c| t.cell_lnglat(c as usize)[1] > 53.7), "технике без мостов нашёлся путь через Одер на участке фронта");
    }
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
