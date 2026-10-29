//! Командующие в ходе прогона (поле `commanders` в trace.json): черты с пределами и источниками, мотивы,
//! снимки картины по часам, решения со всеми вариантами и оценками. Без включённых командующих поля нет.

use super::options::Kind;
use super::profile::{MOTIVES, TRAITS};
use super::{Motives, Scored};
use crate::geo::XY;
use crate::world::Sim;
use serde_json::{json, Map, Value};

fn r3(x: f64) -> f64 { (x * 1000.0).round() / 1000.0 }

fn motives(m: &Motives) -> Value {
    let mut o = Map::new();
    for (i, k) in MOTIVES.iter().enumerate() { o.insert((*k).into(), json!(r3(m.0[i]))); }
    Value::Object(o)
}

/// Короткое имя вида варианта и его точка (если у варианта она есть).
fn kind(k: &Kind) -> (&'static str, Option<XY>) {
    match k {
        Kind::Continue => ("continue", None),
        Kind::CommitMobile { .. } => ("commitMobile", None),
        Kind::WaitMobile => ("waitMobile", None),
        Kind::ShiftMainBlow { .. } => ("shiftMainBlow", None),
        Kind::TurnToRival { at, .. } => ("turnToRival", Some(*at)),
        Kind::Encircle { .. } => ("encircle", None),
        Kind::CommitSecond { .. } => ("commitSecond", None),
        Kind::Hold => ("hold", None),
        Kind::Withdraw { .. } => ("withdraw", None),
        Kind::Counterattack { at, .. } => ("counterattack", Some(*at)),
        Kind::ShiftForces { .. } => ("shiftForces", None),
        Kind::Breakout { toward } => ("breakout", Some(*toward)),
        Kind::Permit { .. } => ("permit", None),
        Kind::Forbid { .. } => ("forbid", None),
        Kind::Relief { toward, .. } => ("relief", Some(*toward)),
        Kind::MoveReserve { to, .. } => ("moveReserve", Some(*to)),
        Kind::Assign { at, .. } => ("assign", Some(*at)),
    }
}

fn option(sim: &Sim, o: &Scored) -> Value {
    let (name, at) = kind(&o.choice.kind);
    // деблокирование: выручаемая армия и армия, которая выручает (получатель директивы)
    let (army, by) = match &o.choice.kind {
        Kind::Relief { army, by, .. } => (Some(sim.world.hqs[*army as usize].id.clone()), Some(sim.world.hqs[*by as usize].id.clone())),
        Kind::Assign { army, .. } => (Some(sim.world.hqs[*army as usize].id.clone()), None),
        _ => (None, None),
    };
    let mut v = json!({
        "kind": name, "label": o.choice.label, "rule": o.choice.rule, "army": army, "by": by,
        "target": at.map(|p| sim.theatre.proj.to_lnglat(p)),
        "parts": motives(&o.parts), "penalty": r3(o.penalty), "bonus": r3(o.bonus), "total": r3(o.total),
        "mind": o.mind.as_ref().map(|m| json!({ "hours": m.hours, "advanceKm": r3(m.advance_km), "losses": r3(m.losses), "encircled": r3(m.encircled) })),
    });
    // задача армии вне истории: объект плана или пункт по местности
    if let Kind::Assign { from_plan, defend, .. } = &o.choice.kind {
        v["fromPlan"] = json!(from_plan);
        if *defend { v["defend"] = json!(true); }
    }
    v
}

/// Поле `commanders` хода; `None` — командующих нет.
pub fn describe(sim: &Sim) -> Option<Value> {
    if sim.commanders.list.is_empty() { return None; }
    let w = &sim.world;
    let pr = &sim.theatre.proj;
    let id = |h: u32| w.hqs[h as usize].id.clone();
    let out: Vec<Value> = sim.commanders.list.iter().map(|c| {
        let p = &sim.rules.commanders.profiles[c.profile];
        let mut traits = Map::new();
        for (k, _) in TRAITS {
            let node = sim.rules.commanders.raw.pointer(&format!("/profiles/{}/traits/{k}", p.id));
            let f = |key: &str| node.and_then(|n| n.get(key)).cloned().unwrap_or(Value::Null);
            traits.insert(k.into(), json!({ "value": f("value"), "range": f("range"), "source": f("source"), "confidence": f("confidence") }));
        }
        let snapshots: Vec<Value> = c.snapshots.iter().map(|s| json!({
            "tick": s.tick, "motives": motives(&s.motives), "mood": { "confidence": r3(s.mood.confidence), "stress": r3(s.mood.stress) }, "intent": s.intent,
            "picture": {
                "armies": s.picture.armies.iter().map(|a| json!({
                    "hq": id(a.hq), "advanceKm": r3(a.advance_km), "strength": r3(a.strength), "enemyEst": r3(a.enemy_est), "enemyTrue": r3(a.enemy_true),
                    "toObjectiveKm": a.to_objective_km.map(r3), "brokeThrough": a.broke_through,
                })).collect::<Vec<_>>(),
                "rival": s.picture.rival.as_ref().map(|r| json!({ "hq": id(r.hq), "toObjectiveKm": r3(r.to_objective_km), "asOf": r.as_of })),
                "openFlanks": s.picture.open_flanks.iter().map(|&h| id(h)).collect::<Vec<_>>(),
                "pockets": s.picture.pockets.iter().map(|k| json!({ "center": pr.to_lnglat(k.center), "enemyEst": r3(k.enemy_est), "gapKm": r3(k.gap_km) })).collect::<Vec<_>>(),
                "enemyReserves": s.picture.enemy_reserves.iter().map(|(at, n)| json!({ "at": pr.to_lnglat(*at), "strength": r3(*n) })).collect::<Vec<_>>(),
                "toObjectiveKm": s.picture.to_objective_km.map(r3),
            },
        })).collect();
        let decisions: Vec<Value> = c.decisions.iter().map(|d| json!({
            "tick": d.tick, "trigger": d.trigger, "chosen": d.chosen, "why": d.why,
            "options": d.options.iter().map(|o| option(sim, o)).collect::<Vec<_>>(),
        })).collect();
        json!({
            "hq": id(c.hq), "profile": p.id, "name": p.name, "side": w.hqs[c.hq as usize].side,
            "traits": traits, "baseMotives": motives(&p.motives), "rival": p.rival, "objective": p.objective,
            "snapshots": snapshots, "decisions": decisions,
        })
    }).collect();
    Some(Value::Array(out))
}
