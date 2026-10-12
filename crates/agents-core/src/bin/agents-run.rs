//! Прогон сценария агентной модели и сверка с историей (docs/plans/agents.md, раздел 9).
//!
//!   cargo run --release --bin agents-run -- --scenario packages/sim/data/scenarios/agents/seelow-1945.json
//!       [--history <сценарий>.history.json] [--out evals-out/agents/seelow] [--runs 5] [--tolerance 10]
//!       [--compare evals-out/demo/berlin-1945-tasks/deviations.json] [--without-fires] [--without-withdrawals] [--de doctrine|llm] [--su doctrine|llm] [--llm-url http://localhost:1234/v1 --llm-model <id>]
//!       [--llm-reasoning default|off|low|medium|high] [--llm-max-tokens N (0 — без потолка)] [--llm-parallel auto|N]
//!       [--llm-sync] [--llm-by-army] [--llm-probe — только замер параллельных запросов]
//!
//! Мерило — как у нынешней модели: расстояние от расчётного положения до исторического, превышение над радиусом
//! неопределённости источника; «в допуске» — превышение не больше допуска (10 км). Дивизии сверяются каждая со
//! своими положениями; армии — центр их дивизий с положением армии из истории нынешней модели (тогда же видно,
//! ближе ли агентная модель к истории, чем нынешняя).
//!
//! Выход: report.md (сверка, разброс по прогонам) и trace.json (ход по часам для показа и инспектора: положение,
//! состояние, численность, запасы каждой дивизии; журнал с причинами).

use agents_core::geo::{LngLat, XY};
use agents_core::model::Side;
use agents_core::scenario;
use agents_core::time::parse_hours;
use agents_core::{repo_root, DATA_DIR};
use serde::Deserialize;
use std::collections::{BTreeMap, HashMap};
use std::fmt::Write as _;
use std::time::Instant;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct HistPos {
    formation: String,
    time: String,
    at: LngLat,
    #[serde(default)]
    approx_km: Option<f64>,
}

#[derive(Deserialize)]
struct History {
    #[serde(default)]
    divisions: Vec<HistPos>,
    #[serde(default)]
    armies: Vec<HistPos>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TsDev {
    formation: String,
    time: String,
    #[serde(default)]
    excess_km: f64,
}
#[derive(Deserialize)]
struct TsDevs {
    deviations: Vec<TsDev>,
}

fn arg(args: &[String], k: &str) -> Option<String> {
    args.iter().position(|a| a == &format!("--{k}")).and_then(|i| args.get(i + 1)).cloned()
}

struct Dev {
    formation: String,
    day: String,
    km: f64,
    excess: f64,
    side: Side,
    group: String,
    /// Участок для сверки вне настройки: фронт (советские) или армия (немецкие); «настройка» — участок Зееловских высот.
    sector: String,
}

/// Объединения участка Зееловских высот: на нём выбирались правила модели (docs/plans/agents.md, 10б–10и); остальные
/// участки — проверка без перенастройки.
const TUNED: &[&str] = &["su_47a", "su_3ua", "su_5ua", "su_8gva", "su_69a", "su_1gta", "su_2gta", "de_ci", "de_lvi", "de_xi_ss"];

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() { return f64::NAN; }
    v.sort_by(|a, b| a.total_cmp(b));
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let root = repo_root();
    let scen = arg(&args, "scenario").expect("--scenario");
    let scen_path = if scen.starts_with('/') { scen.clone() } else { format!("{root}/{scen}") };
    let hist_path = arg(&args, "history").map(|h| format!("{root}/{h}")).unwrap_or_else(|| scen_path.replace(".json", ".history.json"));
    let out_dir = format!("{root}/{}", arg(&args, "out").unwrap_or_else(|| "evals-out/agents/run".into()));
    let runs: u64 = arg(&args, "runs").and_then(|s| s.parse().ok()).unwrap_or(5);
    let tol: f64 = arg(&args, "tolerance").and_then(|s| s.parse().ok()).unwrap_or(10.0);
    let compare = arg(&args, "compare").unwrap_or_else(|| "evals-out/demo/berlin-1945-tasks/deviations.json".into());
    std::fs::create_dir_all(&out_dir).expect("папка вывода");

    let hist: History = serde_json::from_str(&std::fs::read_to_string(&hist_path).unwrap_or_else(|e| panic!("{hist_path}: {e}"))).expect("история");
    let ts_devs: HashMap<(String, String), TsDev> = std::fs::read_to_string(format!("{root}/{compare}")).ok()
        .and_then(|t| serde_json::from_str::<TsDevs>(&t).ok())
        .map(|d| d.deviations.into_iter().map(|x| ((x.formation.clone(), x.time[..10].to_string()), x)).collect())
        .unwrap_or_default();

    let mut per_run: Vec<(f64, f64, f64)> = Vec::new(); // доля в допуске: дивизии, армии; время
    let mut first: Option<(Vec<Dev>, Vec<(Dev, Option<f64>)>, String, String)> = None;
    for seed in 1..=runs {
        let (mut sim, meta) = scenario::load(&scen_path, &format!("{root}/{DATA_DIR}"), &root).unwrap_or_else(|e| panic!("{e}"));
        sim.seed = seed;
        // вариант без отвода с первой позиции (отвод по источникам C — сравнение вариантов)
        if args.iter().any(|a| a == "--without-withdrawals") { sim.withdrawals.clear(); }
        if args.iter().any(|a| a == "--without-fires") { sim.fires.clear(); }
        // источник решений штабов: --de doctrine / --su doctrine (по умолчанию — приказы сценария)
        for (k, side) in [("su", 0usize), ("de", 1usize)] {
            match arg(&args, k).as_deref() {
                Some("doctrine") => sim.sources[side] = agents_core::staff::Source::Doctrine,
                Some("llm") => sim.sources[side] = agents_core::staff::Source::Llm,
                _ => {}
            }
        }
        if let Some(model) = arg(&args, "llm-model") {
            let mut c = agents_core::llm::LlmConfig::new(&arg(&args, "llm-url").unwrap_or_else(|| "http://localhost:1234/v1".into()), &model);
            if let Some(r) = arg(&args, "llm-reasoning") { c.reasoning = agents_core::llm::Reasoning::parse(&r).unwrap_or_else(|| panic!("--llm-reasoning: default|off|low|medium|high")); }
            if let Some(t) = arg(&args, "llm-max-tokens") { c.max_tokens = t.parse().expect("--llm-max-tokens: число"); }
            if let Some(p) = arg(&args, "llm-parallel") { c.parallel = if p == "auto" { 0 } else { p.parse().expect("--llm-parallel: auto или число") }; }
            c.sync = args.iter().any(|a| a == "--llm-sync");
            c.by_army = args.iter().any(|a| a == "--llm-by-army");
            if args.iter().any(|a| a == "--llm-probe") {
                let p = agents_core::llm::probe_parallel(&c, 16).unwrap_or_else(|e| panic!("замер: {e}"));
                for (n, tps, secs) in &p.rows { println!("одновременно {n:>2}: {tps:>7.1} ток/с всего, ступень {secs:.1} с"); }
                println!("выбрано: {}", p.best);
                return;
            }
            sim.llm = Some(c);
            sim.on_progress = Some(Box::new(|m| eprintln!("{m}")));
        }
        let start = parse_hours(&meta.start).expect("start");
        let n = sim.world.divisions.len();
        // кадры: по часу на дивизию
        let mut frames: Vec<Vec<serde_json::Value>> = Vec::new();
        let mut snaps: Vec<Vec<XY>> = Vec::new();
        let mut alive: Vec<Vec<bool>> = Vec::new();
        let frame = agents_core::trace::frame;
        let t0 = Instant::now();
        snaps.push(sim.world.divisions.iter().map(|d| d.vars.pos).collect());
        alive.push(sim.world.divisions.iter().map(|d| !d.state.out()).collect());
        if seed == 1 { frames.push(frame(&sim)); }
        for _ in 0..meta.hours {
            sim.step();
            snaps.push(sim.world.divisions.iter().map(|d| d.vars.pos).collect());
            alive.push(sim.world.divisions.iter().map(|d| !d.state.out()).collect());
            if seed == 1 { frames.push(frame(&sim)); }
        }
        let secs = t0.elapsed().as_secs_f64();
        let idx: HashMap<&str, usize> = sim.world.divisions.iter().enumerate().map(|(i, d)| (d.id.as_str(), i)).collect();
        let hq_name = |i: usize| sim.world.hqs[sim.world.divisions[i].hq as usize].id.clone();
        // предки штаба (сам штаб первым)
        let chain = |h: usize| { let mut v = vec![h]; while let Some(p) = sim.world.hqs[*v.last().unwrap()].parent { if v.len() > 8 { break; } v.push(p as usize); } v };
        let sector_of_hq = |h: usize| -> String {
            let c = chain(h);
            let tuned = c.iter().any(|&k| TUNED.contains(&sim.world.hqs[k].id.as_str()));
            let want = if sim.world.hqs[h].side == Side::Su { agents_core::model::Echelon::Front } else { agents_core::model::Echelon::Army };
            let top = c.iter().find(|&&k| sim.world.hqs[k].echelon == want).or(c.last()).map(|&k| sim.world.hqs[k].name.clone()).unwrap_or_default();
            if tuned { format!("{top}: Зееловские высоты (настройка)") } else { top }
        };
        let hq_idx_of = |id: &str| sim.world.hqs.iter().position(|h| h.id == id);
        // исходные положения (шаг 0) — вход сценария, а не проверка: в мерило не идут
        let tick_of = |time: &str| -> Option<usize> {
            let h = parse_hours(time)? - start;
            if h <= 0 || h > meta.hours as i64 { None } else { Some(h as usize) }
        };
        // дивизии
        let mut devs = Vec::new();
        for h in &hist.divisions {
            let (Some(&i), Some(t)) = (idx.get(h.formation.as_str()), tick_of(&h.time)) else { continue };
            let km = snaps[t][i].dist(sim.theatre.proj.to_xy(h.at));
            let excess = (km - h.approx_km.unwrap_or(5.0)).max(0.0);
            devs.push(Dev { formation: h.formation.clone(), day: h.time[..10].to_string(), km, excess, side: sim.world.divisions[i].side, group: hq_name(i), sector: sector_of_hq(sim.world.divisions[i].hq as usize) });
        }
        // армии: центр дивизий армии; немецкие дивизии — сами
        let mut adevs = Vec::new();
        for h in &hist.armies {
            let Some(t) = tick_of(&h.time) else { continue };
            let members: Vec<usize> = if let Some(&i) = idx.get(h.formation.as_str()) { vec![i] } else {
                // все соединения штаба и его подчинённых штабов
                let Some(k) = hq_idx_of(&h.formation) else { continue };
                (0..n).filter(|&i| alive[t][i] && chain(sim.world.divisions[i].hq as usize).contains(&k)).collect()
            };
            let sector = match idx.get(h.formation.as_str()) { Some(&i) => sector_of_hq(sim.world.divisions[i].hq as usize), None => hq_idx_of(&h.formation).map(sector_of_hq).unwrap_or_default() };
            if members.is_empty() { continue; }
            let c = members.iter().fold(XY::default(), |s, &i| XY::new(s.x + snaps[t][i].x / members.len() as f64, s.y + snaps[t][i].y / members.len() as f64));
            let km = c.dist(sim.theatre.proj.to_xy(h.at));
            let excess = (km - h.approx_km.unwrap_or(5.0)).max(0.0);
            let side = if h.formation.starts_with("su_") { Side::Su } else { Side::De };
            let ts = ts_devs.get(&(h.formation.clone(), h.time[..10].to_string())).map(|d| d.excess_km);
            adevs.push((Dev { formation: h.formation.clone(), day: h.time[..10].to_string(), km, excess, side, group: h.formation.clone(), sector }, ts));
        }
        let share = |v: &[&Dev]| v.iter().filter(|d| d.excess <= tol).count() as f64 / v.len().max(1) as f64;
        per_run.push((share(&devs.iter().collect::<Vec<_>>()), share(&adevs.iter().map(|x| &x.0).collect::<Vec<_>>()), secs));
        if seed == 1 {
            // trace.json
            let trace = agents_core::trace::describe(&sim, &meta, std::mem::take(&mut frames));
            std::fs::write(format!("{out_dir}/trace.json"), serde_json::to_string(&trace).unwrap()).expect("trace.json");
            let mut transitions: BTreeMap<String, usize> = BTreeMap::new();
            for e in &sim.journal { if let Some((_, rest)) = e.text.split_once(": ") { if e.text.contains(" → ") { *transitions.entry(rest.to_string()).or_default() += 1; } } }
            let mut tr: Vec<(String, usize)> = transitions.into_iter().collect();
            tr.sort_by(|a, b| b.1.cmp(&a.1));
            let summary = tr.iter().take(12).map(|(k, v)| format!("| {k} | {v} |")).collect::<Vec<_>>().join("\n");
            first = Some((devs, adevs, summary, format!("{n} дивизий, {} ч, расчёт {:.2} с", meta.hours, secs)));
        }
    }

    // ---------- отчёт ----------
    let (devs, adevs, transitions, runinfo) = first.expect("прогон");
    let mut r = String::new();
    let scen_name = scen.rsplit('/').next().unwrap_or(&scen);
    let _ = writeln!(r, "# Агентная модель: сверка с историей — {scen_name}\n");
    let _ = writeln!(r, "Прогон seed 1: {runinfo}. Допуск ±{tol} км сверх радиуса неопределённости источника (мерило нынешней модели); исходные положения (утро первого дня) — вход сценария, в мерило не входят.\n");
    let fmt_share = |v: &[f64]| { let (lo, hi) = v.iter().fold((f64::MAX, f64::MIN), |(a, b), &x| (a.min(x), b.max(x))); format!("{:.0}–{:.0} %", lo * 100.0, hi * 100.0) };
    let _ = writeln!(r, "Разброс по {} прогонам (seed 1…{}): дивизии в допуске {}; армии (центр дивизий) {}.\n", runs, runs,
        fmt_share(&per_run.iter().map(|x| x.0).collect::<Vec<_>>()), fmt_share(&per_run.iter().map(|x| x.1).collect::<Vec<_>>()));

    let block = |r: &mut String, title: &str, v: &[&Dev]| {
        let _ = writeln!(r, "## {title}\n");
        let _ = writeln!(r, "| | положений | в допуске | медиана расстояния, км | медиана превышения, км |\n|---|---|---|---|---|");
        for (lbl, side) in [("советские", Some(Side::Su)), ("немецкие", Some(Side::De)), ("все", None)] {
            let s: Vec<&&Dev> = v.iter().filter(|d| side.map_or(true, |x| d.side == x)).collect();
            if s.is_empty() { continue; }
            let w = s.iter().filter(|d| d.excess <= tol).count() as f64 / s.len() as f64;
            let _ = writeln!(r, "| {lbl} | {} | {:.0} % | {:.1} | {:.1} |", s.len(), w * 100.0, median(s.iter().map(|d| d.km).collect()), median(s.iter().map(|d| d.excess).collect()));
        }
        let _ = writeln!(r);
        let mut days: BTreeMap<&str, Vec<&Dev>> = BTreeMap::new();
        for d in v { days.entry(d.day.as_str()).or_default().push(d); }
        let _ = writeln!(r, "| день | положений | в допуске | медиана расстояния, км |\n|---|---|---|---|");
        for (day, s) in days {
            let w = s.iter().filter(|d| d.excess <= tol).count() as f64 / s.len() as f64;
            let _ = writeln!(r, "| {day} | {} | {:.0} % | {:.1} |", s.len(), w * 100.0, median(s.iter().map(|d| d.km).collect()));
        }
        let _ = writeln!(r);
    };
    block(&mut r, "Дивизии: собственные положения по источникам", &devs.iter().collect::<Vec<_>>());
    // по армиям (дивизии)
    let mut groups: BTreeMap<&str, Vec<&Dev>> = BTreeMap::new();
    for d in &devs { groups.entry(d.group.as_str()).or_default().push(d); }
    let _ = writeln!(r, "По объединениям (дивизии):\n\n| объединение | положений | в допуске | медиана расстояния, км |\n|---|---|---|---|");
    for (g, s) in &groups {
        let w = s.iter().filter(|d| d.excess <= tol).count() as f64 / s.len() as f64;
        let _ = writeln!(r, "| {g} | {} | {:.0} % | {:.1} |", s.len(), w * 100.0, median(s.iter().map(|d| d.km).collect()));
    }
    let _ = writeln!(r);
    block(&mut r, "Армии и немецкие дивизии: сравнение с нынешней моделью", &adevs.iter().map(|x| &x.0).collect::<Vec<_>>());
    let _ = writeln!(r, "Те же положения, что сверяет нынешняя модель (история сценария `berlin-1945-tasks`); у армий — центр её дивизий. Превышение над радиусом источника, км:\n");
    let _ = writeln!(r, "| формирование | день | агентная модель | нынешняя модель |\n|---|---|---|---|");
    let mut both = (0usize, 0usize, 0usize);
    for (d, ts) in &adevs {
        let tsv = ts.map(|x| format!("{x:.1}")).unwrap_or_else(|| "—".into());
        if let Some(x) = ts { both.0 += 1; if d.excess + 0.5 < *x { both.1 += 1; } else if *x + 0.5 < d.excess { both.2 += 1; } }
        let _ = writeln!(r, "| {} | {} | {:.1} | {} |", d.formation, d.day, d.excess, tsv);
    }
    let pairs: Vec<(f64, f64)> = adevs.iter().filter_map(|(d, ts)| ts.map(|x| (d.excess, x))).collect();
    let w = |f: &dyn Fn(&(f64, f64)) -> f64| pairs.iter().filter(|p| f(p) <= tol).count() as f64 / pairs.len().max(1) as f64 * 100.0;
    let _ = writeln!(r, "\nПарных сравнений {}: агентная модель ближе к истории в {}, нынешняя — в {}, остальные — в пределах 0,5 км. В допуске на этих положениях: агентная модель {:.0} %, нынешняя {:.0} %; медиана превышения {:.1} и {:.1} км.\n",
        both.0, both.1, both.2, w(&|p| p.0), w(&|p| p.1), median(pairs.iter().map(|p| p.0).collect()), median(pairs.iter().map(|p| p.1).collect()));
    // по участкам и периодам: на участке и в дни настройки и вне их (проверка без перенастройки)
    let mut cells: BTreeMap<(String, &str), Vec<(f64, f64)>> = BTreeMap::new();
    for (d, ts) in &adevs {
        let Some(x) = ts else { continue };
        let period = if d.day.as_str() < "1945-04-20" { "16–19.04" } else { "20.04 и позже" };
        cells.entry((d.sector.clone(), period)).or_default().push((d.excess, *x));
    }
    if cells.len() > 1 {
        let _ = writeln!(r, "## По участкам и периодам\n\nПравила модели выбирались на Зееловских высотах 16–19.04; остальные участки и дни — проверка без перенастройки.\n\n| участок | период | положений | в допуске: агентная | нынешняя | среднее превышение, км: агентная | нынешняя |\n|---|---|---|---|---|---|---|");
        let mut all_out: Vec<(f64, f64)> = Vec::new();
        for ((sec, per), v) in &cells {
            let inn = |f: &dyn Fn(&(f64, f64)) -> f64| v.iter().filter(|p| f(p) <= tol).count() as f64 / v.len() as f64 * 100.0;
            let mean = |f: &dyn Fn(&(f64, f64)) -> f64| v.iter().map(f).sum::<f64>() / v.len() as f64;
            let _ = writeln!(r, "| {sec} | {per} | {} | {:.0} % | {:.0} % | {:.1} | {:.1} |", v.len(), inn(&|p| p.0), inn(&|p| p.1), mean(&|p| p.0), mean(&|p| p.1));
            if !(sec.contains("настройка") && *per == "16–19.04") { all_out.extend(v.iter().copied()); }
        }
        let a = all_out.iter().filter(|p| p.0 <= tol && p.1 > tol).count();
        let b = all_out.iter().filter(|p| p.0 > tol && p.1 <= tol).count();
        let inn = |f: &dyn Fn(&(f64, f64)) -> f64| all_out.iter().filter(|p| f(p) <= tol).count() as f64 / all_out.len().max(1) as f64 * 100.0;
        let _ = writeln!(r, "\nВне настройки ({} положений): в допуске агентная {:.0} %, нынешняя {:.0} %; в допуске только у агентной — {a}, только у нынешней — {b}.\n", all_out.len(), inn(&|p| p.0), inn(&|p| p.1));
    }
    let mut worst: Vec<&Dev> = devs.iter().collect();
    worst.sort_by(|a, b| b.excess.total_cmp(&a.excess));
    let _ = writeln!(r, "## Наибольшие расхождения дивизий\n\n| дивизия | объединение | день | расстояние, км | превышение, км |\n|---|---|---|---|---|");
    for d in worst.iter().take(15) { let _ = writeln!(r, "| {} | {} | {} | {:.1} | {:.1} |", d.formation, d.group, d.day, d.km, d.excess); }
    let _ = writeln!(r, "\n## Частые переходы состояний (seed 1)\n\n| переход и причина | раз |\n|---|---|\n{transitions}\n");
    let _ = writeln!(r, "Ход по часам — `trace.json` (положение, состояние, численность, запасы каждой дивизии; журнал с причинами).");
    std::fs::write(format!("{out_dir}/report.md"), &r).expect("report.md");
    println!("{}", r.lines().take(4).collect::<Vec<_>>().join("\n"));
    println!("отчёт: {out_dir}/report.md; ход: {out_dir}/trace.json");
}
