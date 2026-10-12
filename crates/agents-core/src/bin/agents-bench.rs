//! Замер быстродействия ядра на синтетическом сценарии (цели — docs/plans/agents.md, раздел 7.5) и проверка
//! воспроизводимости: один и тот же прогон на разном числе потоков должен дать одинаковую свёртку состояния.
//!
//!   cargo run --release --bin agents-bench -- [--divisions 400] [--objects 2000] [--hours 552]
//!       [--threads 1,2,4] [--theatre packages/sim/data/theatres/oder-berlin-1945.json] [--seed 1]

use agents_core::rules::Rules;
use agents_core::scenario::synthetic;
use agents_core::theatre::Theatre;
use agents_core::{repo_root, DATA_DIR};
use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::Instant;

fn arg(args: &[String], k: &str, d: &str) -> String {
    args.iter().position(|a| a == &format!("--{k}")).and_then(|i| args.get(i + 1)).cloned().unwrap_or_else(|| d.to_string())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = repo_root();
    let n: usize = arg(&args, "divisions", "400").parse().expect("--divisions");
    let n_obj: usize = arg(&args, "objects", "2000").parse().expect("--objects");
    let hours: u32 = arg(&args, "hours", "552").parse().expect("--hours");
    let seed: u64 = arg(&args, "seed", "1").parse().expect("--seed");
    let max_threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1);
    let threads: Vec<usize> = arg(&args, "threads", &format!("1,{max_threads}")).split(',').filter_map(|s| s.parse().ok()).collect();
    let theatre_path = format!("{root}/{}", arg(&args, "theatre", "packages/sim/data/theatres/oder-berlin-1945.json"));

    let t0 = Instant::now();
    let theatre = Arc::new(Theatre::load(&theatre_path).unwrap_or_else(|e| panic!("{e}")));
    let rules = Rules::load(&format!("{root}/{DATA_DIR}")).unwrap_or_else(|e| panic!("{e}"));
    let crossings = theatre.river_cross.iter().map(|m| m.count_ones() as usize).sum::<usize>() / 2;
    println!("театр «{}»: {}×{} клеток, переходов через большие реки {}, из них по мостам {}; загрузка {:.2} с",
        theatre.name, theatre.cols, theatre.rows, crossings, theatre.crossing_bridge.len() / 2, t0.elapsed().as_secs_f64());
    println!("сценарий: {n} дивизий, {n_obj} объектов, {hours} шагов по 1 ч; ядер доступно {max_threads}");

    let mut digests = Vec::new();
    for &th in &threads {
        let pool = rayon::ThreadPoolBuilder::new().num_threads(th).build().expect("пул потоков");
        let mut sim = synthetic(theatre.clone(), rules.clone(), n, n_obj, seed, "1945-04-16T03:00");
        let mut ticks: Vec<f64> = Vec::with_capacity(hours as usize);
        let start = Instant::now();
        pool.install(|| {
            for _ in 0..hours {
                let s = Instant::now();
                sim.step();
                ticks.push(s.elapsed().as_secs_f64() * 1000.0);
            }
        });
        let total = start.elapsed().as_secs_f64();
        let mut sorted = ticks.clone();
        sorted.sort_by(|a, b| a.total_cmp(b));
        let mean = ticks.iter().sum::<f64>() / ticks.len().max(1) as f64;
        let p95 = sorted[(sorted.len() as f64 * 0.95) as usize - 1];
        let max = sorted[sorted.len() - 1];
        let digest = sim.digest();
        digests.push(digest);
        println!("\nпотоков {th}: всего {total:.2} с; шаг — среднее {mean:.1} мс, 95 % {p95:.1} мс, максимум {max:.1} мс; первый шаг {:.1} мс; свёртка {digest:016x}", ticks[0]);
        let mut states: BTreeMap<String, usize> = BTreeMap::new();
        for d in &sim.world.divisions { *states.entry(format!("{:?} {}", d.side, d.state.label())).or_default() += 1; }
        let destroyed = sim.world.divisions.iter().filter(|d| d.state.out()).count();
        println!("  к концу: {destroyed} небоеспособных; событий в журнале {}", sim.journal.len());
        for (k, v) in states { println!("  {k}: {v}"); }
    }
    let same = digests.windows(2).all(|w| w[0] == w[1]);
    println!("\nвоспроизводимость на разном числе потоков: {}", if same { "свёртки совпадают" } else { "РАСХОЖДЕНИЕ" });
    if !same { std::process::exit(1); }
}
