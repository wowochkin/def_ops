//! Ход прогона по часам для показа и инспектора (docs/plans/agents.md, раздел 8): положение, состояние, численность,
//! запасы каждой дивизии на каждый час, журнал с причинами, штабы, параметры с источниками.

use crate::world::Sim;
use crate::time::format_hours;
use serde_json::{json, Value};

/// Поля кадра дивизии — в этом порядке.
/// encircled — сколько часов дивизия в окружении (0 — не окружена; pocket.rs).
pub const FIELDS: [&str; 11] = ["lng", "lat", "state", "personnel", "tanks", "guns", "ammo", "fuel", "fatigue", "cohesion", "encircled"];

/// Кадр: по строке на дивизию.
pub fn frame(sim: &Sim) -> Vec<Value> {
    sim.world.divisions.iter().map(|d| {
        let p = sim.theatre.proj.to_lnglat(d.vars.pos);
        let r2 = |x: f64| (x * 100.0).round() / 100.0;
        json!([(p[0] * 1e4).round() / 1e4, (p[1] * 1e4).round() / 1e4, d.state.label(), d.vars.personnel.round(), d.vars.tanks.round(), d.vars.guns.round(),
               r2(d.vars.ammo), r2(d.vars.fuel), r2(d.vars.fatigue), r2(d.vars.cohesion), if sim.encircled(d, sim.world.tick) { d.cut_since.map_or(0, |s| sim.world.tick.saturating_sub(s)) } else { 0 }])
    }).collect()
}

/// Прогон `hours` шагов с записью кадров; возвращает ход в формате trace.json.
pub fn run(sim: &mut Sim, hours: u32, meta: &crate::scenario::Meta) -> Value {
    let mut frames = vec![frame(sim)];
    for _ in 0..hours { sim.step(); frames.push(frame(sim)); }
    describe(sim, meta, frames)
}

pub fn describe(sim: &Sim, meta: &crate::scenario::Meta, frames: Vec<Vec<Value>>) -> Value {
    let w = &sim.world;
    let divisions: Vec<Value> = w.divisions.iter().map(|d| json!({
        "id": d.id, "name": d.name, "side": d.side, "hq": w.hqs[d.hq as usize].id, "kind": d.params.kind,
        "mobility": d.params.mobility, "size": d.params.size, "quality": d.params.quality, "note": d.note,
    })).collect();
    let hqs: Vec<Value> = w.hqs.iter().map(|h| json!({
        "id": h.id, "name": h.name, "side": h.side, "echelon": h.echelon,
        "parent": h.parent.map(|p| w.hqs[p as usize].id.clone()),
    })).collect();
    let journal: Vec<Value> = sim.journal.iter().map(|e| json!({
        "tick": e.tick,
        "time": format_hours(sim.start_hour + e.tick as i64),
        "agent": if e.agent == u32::MAX { Value::Null } else { json!(w.divisions[e.agent as usize].id) },
        "text": e.text,
    })).collect();
    json!({
        "scenario": meta.id, "name": meta.name, "start": meta.start, "hours": meta.hours, "seed": sim.seed,
        "theatre": sim.theatre.id,
        "fields": FIELDS, "divisions": divisions, "hqs": hqs, "frames": frames, "journal": journal,
        "sources": sim.sources.iter().map(|s| format!("{s:?}").to_lowercase()).collect::<Vec<_>>(),
        "llm": sim.llm.as_ref().map(|c| {
            let mut v = c.describe();
            if let Some(&n) = sim.llm_par.get() { v["parallelUsed"] = json!(n); }
            if let Some(p) = sim.llm_probe.lock().ok().and_then(|p| p.clone()) { v["probe"] = p; }
            v
        }),
        "staff": sim.llm_log.lock().map(|l| l.clone()).unwrap_or_default(),
        // документы штабов (командование по ступеням): директивы, приказы, распоряжения, извещения
        "documents": sim.documents.iter().map(|d| json!({
            "tick": d.tick, "time": format_hours(sim.start_hour + d.tick as i64), "hq": w.hqs[d.hq as usize].id,
            "kind": d.kind, "to": d.to, "text": d.text, "rule": d.rule,
        })).collect::<Vec<_>>(),
        // действующий приказ каждой дивизии на последний шаг (для докладов в игре): что, куда, от кого, когда
        "orders": w.divisions.iter().map(|d| d.order.as_ref().map(|o| json!({
            "kind": o.kind, "target": sim.theatre.proj.to_lnglat(o.target), "from": w.hqs[o.from as usize].id,
            "issued": o.issued, "arrives": o.arrives, "note": o.note,
        }))).collect::<Vec<_>>(),
    })
}
