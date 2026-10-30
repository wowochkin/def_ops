//! Ходатайство штаба фронта в верхнюю инстанцию о разграничительной линии с соседним фронтом (этап 4 пакета команд):
//! рассматривается на том же ходу по правилу — Ставка принимает, если новая линия не отнимает у соседа его главный удар
//! и полосу шире половины прежней (`command.petitionMinShare`), иначе отклоняет с объяснением. Ответ — документом
//! верхней инстанции; принятая линия — директивой без оси обоим фронтам (меняет только их границы); фронт, идущий по
//! истории, доводит её распоряжением до своей фланговой армии и с истории не сходит.

use crate::command::agent::{frame, mid, place, subs_of};
use crate::command::band::{line_dist, side_of, width_km, Band};
use crate::command::control::{Control, DocKind, Document};
use crate::command::directive::{Directive, Form, Target, Task};
use crate::command::passing::passing_hours;
use crate::geo::XY;
use crate::model::Echelon;
use crate::world::{Event, Sim};

/// Правило директив и документов ходатайства.
pub const PETITION_RULE: &str = "ходатайство о разграничительной линии";

/// Поданное ходатайство и ответ на него.
#[derive(Clone, Debug, PartialEq)]
pub struct Petition { pub tick: u32, pub from: u32, pub neighbour: u32, pub line: Vec<XY>, pub note: String, pub accepted: bool, pub why: String }

/// Решение по ходатайству: принято (доля прежней ширины полосы соседа) или отклонено (причина).
#[derive(Clone, Debug, PartialEq)]
pub enum Verdict { Accept { share: f64 }, Reject(String) }

/// Правило рассмотрения: главный удар соседа отнят, если какая-либо его точка `main` по другую сторону новой линии,
/// чем `neighbour_ref` (точка заведомо в полосе соседа); иначе доля — ширина новой полосы соседа к прежней, меньше
/// `min_share` — отказ.
pub fn judge(main: &[XY], neighbour_ref: XY, line: &[XY], old: &Band, new: &Band, min_share: f64) -> Verdict {
    let r = side_of(line, neighbour_ref);
    if main.iter().any(|&p| side_of(line, p) * r < 0.0) { return Verdict::Reject("главный удар соседа оказался бы в нашей полосе".into()); }
    let w = width_km(old);
    let share = if w > 1e-6 { width_km(new) / w } else { 1.0 };
    if share < min_share {
        let n = (share * 100.0).round().min((min_share * 100.0).ceil() - 1.0).max(0.0);
        let less = if (min_share - 0.5).abs() < 1e-9 { "меньше половины".to_string() } else { format!("меньше {:.0} %", min_share * 100.0) };
        return Verdict::Reject(format!("полоса соседа сузилась бы до {n:.0} % прежней — {less}"));
    }
    Verdict::Accept { share }
}

/// Замысел штаба `n` для рассмотрения: действующий, иначе — по директивам старшего к этому часу (ось, главный удар,
/// границы, ближайшая задача — последние названные).
fn plan_of(sim: &Sim, n: u32, tick: u32) -> Directive {
    if let Some(d) = sim.command.intent[n as usize].clone() { return d; }
    let top = sim.world.hqs[n as usize].parent.unwrap_or(n);
    let mut d = Directive { id: format!("{PETITION_RULE}:{}", sim.world.hqs[n as usize].id), from: top, to: Target::Hq(n), form: Form::Order, task: Task::default(),
        axis: Vec::new(), immediate: None, subsequent: None, boundaries: Vec::new(), main_blow: Vec::new(), reserve: Vec::new(), junction: None,
        hasty: false, ready: false, rule: Some(PETITION_RULE.into()), issued: 0, note: String::new() };
    let mut hs: Vec<&(u32, Directive)> = sim.historical.iter().filter(|(at, h)| *at <= tick && h.to == Target::Hq(n) && h.from == top).collect();
    hs.sort_by_key(|(at, _)| *at);
    for (_, h) in hs {
        d.task = h.task;
        if h.axis.len() >= 2 { d.axis = h.axis.clone(); }
        if !h.main_blow.is_empty() { d.main_blow = h.main_blow.clone(); }
        if !h.boundaries.is_empty() { d.boundaries = h.boundaries.clone(); }
        if h.immediate.is_some() { d.immediate = h.immediate.clone(); }
    }
    d
}

/// Полоса соседа `n` по его замыслу и её граница, ближайшая к штабу `from` (слева — `true`).
fn band_of_neighbour(sim: &Sim, from: u32, n: u32, tick: u32) -> (Directive, Band, bool) {
    let d = plan_of(sim, n, tick);
    let subs = subs_of(sim, n);
    let band = frame(sim, n, &d, &subs).band;
    let p = place(sim, Target::Hq(from));
    let left = line_dist(&band.left, p) <= line_dist(&band.right, p);
    (d, band, left)
}

/// Нынешняя разграничительная линия `from` / `n`: граница полосы соседа, ближайшая к `from`.
pub fn boundary(sim: &Sim, from: u32, n: u32, tick: u32) -> Vec<XY> {
    let (_, band, left) = band_of_neighbour(sim, from, n, tick);
    if left { band.left } else { band.right }
}

/// Граница с названным соседом заменяется новой линией; нет такой — ближайшая на той же стороне оси; нет и её —
/// добавляется.
fn merge(bs: &mut Vec<(Option<u32>, Vec<XY>)>, axis: &[XY], other: Option<u32>, line: &[XY]) {
    if let Some(k) = other.and_then(|o| bs.iter().position(|(x, _)| *x == Some(o))) { bs[k] = (other, line.to_vec()); return; }
    let Some(m) = mid(line) else { return };
    let ax: Vec<XY> = match axis { [a, .., b] => vec![*a, *b], _ => Vec::new() };
    let side = |l: &[XY]| if ax.len() == 2 { mid(l).map_or(0.0, |c| side_of(&ax, c)) } else { 0.0 };
    let s = side(line);
    let k = bs.iter().enumerate().filter(|(_, (_, l))| l.len() >= 2 && (ax.len() < 2 || side(l) * s > 0.0))
        .min_by(|a, b| line_dist(&a.1 .1, m).total_cmp(&line_dist(&b.1 .1, m))).map(|(k, _)| k);
    match k { Some(k) => bs[k] = (other, line.to_vec()), None => bs.push((other, line.to_vec())) }
}

/// Директива или распоряжение по ходатайству — в путь (документ — общий, отдаёт `submit` или `arrived`).
fn send(sim: &mut Sim, from: u32, to: u32, form: Form, other: Option<u32>, line: &[XY], note: &str, tick: u32) {
    let task = sim.command.intent[to as usize].as_ref().map_or(Task::default(), |d| d.task);
    let ech = sim.world.hqs[to as usize].echelon;
    let d = Directive { id: format!("{PETITION_RULE}:{tick}:{}", sim.world.hqs[to as usize].id), from, to: Target::Hq(to), form, task,
        axis: Vec::new(), immediate: None, subsequent: None, boundaries: vec![(other, line.to_vec())], main_blow: Vec::new(), reserve: Vec::new(), junction: None,
        hasty: false, ready: false, rule: Some(PETITION_RULE.into()), issued: tick, note: note.to_string() };
    let at = tick + passing_hours(&sim.rules.command, Some(ech), form).round() as u32;
    sim.command.in_transit.push((at, d));
}

/// Рассмотреть ходатайство штаба `from` о линии с соседом `neighbour` (проверки — `Game::petition`): донесение,
/// решение по правилу, ответ документом верхней инстанции; принято — директивы обоим фронтам. Возвращает «принято».
pub fn submit(sim: &mut Sim, from: u32, neighbour: u32, line: Vec<XY>, note: String, tick: u32) -> bool {
    let top = sim.world.hqs[from as usize].parent.unwrap_or(from);
    let id = |sim: &Sim, h: u32| sim.world.hqs[h as usize].id.clone();
    let name = |sim: &Sim, h: u32| sim.world.hqs[h as usize].name.clone();
    let at = |sim: &Sim, p: XY| { let q = sim.theatre.proj.to_lnglat(p); format!("{:.2}, {:.2}", q[1], q[0]) };
    let (fname, nname) = (name(sim, from), name(sim, neighbour));
    let mut text = format!("Ходатайство о разграничительной линии с соседом ({nname}): новая линия от {} до {}", at(sim, line[0]), at(sim, *line.last().unwrap()));
    if !note.is_empty() { text += &format!("; {note}"); }
    sim.documents.push(Document { tick, hq: from, kind: DocKind::Report, to: vec![id(sim, top)], text, rule: Some(PETITION_RULE.into()) });
    let (d, old, left) = band_of_neighbour(sim, from, neighbour, tick);
    let new = if left { Band { left: line.clone(), right: old.right.clone() } } else { Band { left: old.left.clone(), right: line.clone() } };
    let far = mid(if left { &old.right } else { &old.left }).unwrap_or_else(|| place(sim, Target::Hq(neighbour)));
    let mut main: Vec<XY> = d.main_blow.iter().map(|&m| place(sim, Target::Hq(m))).collect();
    if main.is_empty() { main.extend(d.axis.first().copied()); }
    let verdict = judge(&main, far, &line, &old, &new, sim.rules.command.petition_min_share);
    let (accepted, why, doc) = match verdict {
        Verdict::Accept { share } => {
            let why = format!("полоса соседа — {:.0} % прежней, главный удар не затронут", share * 100.0);
            (true, why.clone(), Document { tick, hq: top, kind: DocKind::Directive, to: vec![id(sim, from), id(sim, neighbour)],
                text: format!("Ходатайство удовлетворено ({fname}): разграничительная линия с соседом ({nname}) — по новой линии; {why}"), rule: Some(PETITION_RULE.into()) })
        }
        Verdict::Reject(why) => (false, why.clone(), Document { tick, hq: top, kind: DocKind::Notice, to: vec![id(sim, from)],
            text: format!("Ходатайство отклонено ({fname}): {why}; линии прежние"), rule: Some(PETITION_RULE.into()) }),
    };
    sim.journal.push(Event { tick, agent: u32::MAX, text: doc.text.clone() });
    sim.documents.push(doc);
    if accepted {
        send(sim, top, from, Form::Order, Some(neighbour), &line, &note, tick);
        send(sim, top, neighbour, Form::Order, Some(from), &line, &note, tick);
    }
    sim.command.petitions.push(Petition { tick, from, neighbour, line, note, accepted, why });
    accepted
}

/// Директива по ходатайству пришла штабу `h`: граница его замысла с соседом заменяется линией (замысла нет — у фронта не
/// под игроком он восстанавливается по директивам старшего); штаб-агент разбирает полосу заново; фронт по сценарию
/// (истории) доводит линию распоряжением до своей армии, ближайшей к линии; штаб игрока — только граница.
pub fn arrived(sim: &mut Sim, h: u32, d: &Directive, tick: u32) {
    let hu = h as usize;
    let Some((other, line)) = d.boundaries.first().cloned() else { return };
    let (control, ech) = (sim.command.control[hu], sim.world.hqs[hu].echelon);
    if sim.command.intent[hu].is_none() && control != Control::Player && ech == Echelon::Front {
        sim.command.intent[hu] = Some(plan_of(sim, h, tick));
    }
    if let Some(i) = sim.command.intent[hu].as_mut() { let axis = i.axis.clone(); merge(&mut i.boundaries, &axis, other, &line); }
    match control {
        Control::Agent => sim.command.fresh[hu] = true,
        Control::Script if ech == Echelon::Front => {
            let army = subs_of(sim, h).into_iter().filter_map(|t| match t { Target::Hq(k) => Some(k), _ => None })
                .min_by(|&a, &b| line_dist(&line, place(sim, Target::Hq(a))).total_cmp(&line_dist(&line, place(sim, Target::Hq(b)))));
            let Some(a) = army else { return };
            let with = other.map(|o| sim.world.hqs[o as usize].name.clone()).unwrap_or_default();
            sim.documents.push(Document { tick, hq: h, kind: DocKind::Instruction, to: vec![sim.world.hqs[a as usize].id.clone()],
                text: format!("разграничительная линия с соседом ({with}) — по директиве верхней инстанции (ходатайство удовлетворено)"), rule: Some(PETITION_RULE.into()) });
            send(sim, h, a, Form::Instruction, None, &line, &d.note, tick);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::command::band::{side_of, width_km, Band};
    use crate::geo::XY;

    fn h(y: f64) -> Vec<XY> { vec![XY::new(0.0, y), XY::new(30.0, y)] }

    #[test]
    fn judge_accepts_small_shift() {
        let old = Band { left: h(10.0), right: h(-10.0) };
        let new = Band { left: h(7.0), right: h(-10.0) };
        match judge(&[XY::new(15.0, 0.0)], XY::new(15.0, 0.0), &h(7.0), &old, &new, 0.5) {
            Verdict::Accept { share } => assert!((share - 0.85).abs() < 0.01, "{share}"),
            Verdict::Reject(w) => panic!("{w}"),
        }
    }

    #[test]
    fn judge_rejects_main_blow() {
        let old = Band { left: h(10.0), right: h(-10.0) };
        let new = Band { left: h(7.0), right: h(-10.0) };
        match judge(&[XY::new(15.0, 8.5)], XY::new(15.0, 0.0), &h(7.0), &old, &new, 0.5) {
            Verdict::Reject(w) => assert!(w.contains("главный удар"), "{w}"),
            v => panic!("{v:?}"),
        }
    }

    #[test]
    fn judge_rejects_narrow() {
        let old = Band { left: h(10.0), right: h(-10.0) };
        let new = Band { left: h(-2.0), right: h(-10.0) };
        match judge(&[XY::new(15.0, -5.0)], XY::new(15.0, -5.0), &h(-2.0), &old, &new, 0.5) {
            Verdict::Reject(w) => assert!(w.contains("40 %") && w.contains("меньше половины"), "{w}"),
            v => panic!("{v:?}"),
        }
    }

    #[test]
    fn width_and_side() {
        assert!((width_km(&Band { left: h(5.0), right: h(-5.0) }) - 10.0).abs() < 0.01);
        // встречное направление границ ширину не меняет
        assert!((width_km(&Band { left: h(5.0), right: h(-5.0).into_iter().rev().collect() }) - 10.0).abs() < 0.01);
        let l = h(0.0);
        assert!(side_of(&l, XY::new(10.0, 1.0)) * side_of(&l, XY::new(10.0, -1.0)) < 0.0, "знак меняется через линию");
    }
}
