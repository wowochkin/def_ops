//! Варианты решения немецких штабов (армия, группа армий) и Ставки (высшее командование). Вклад в мотивы,
//! неопределённость и потери выводятся из картины простыми правилами; коэффициенты — именованные константы
//! (допущения, подбираются калибровкой). Своё положение штаб берёт из мира: окружённость — по `cut_since` дивизий.
//!
//! Противник, соприкасающийся со своими войсками (в пределах `contact_km`), наблюдается непосредственно и туманом
//! разведки не искажается; поэтому вклинение определяется по его истинному положению.
//!
//! Таблица правил (вклад в мотивы; U — неопределённость, L — потери):
//! - Hold: удержание +, задача +, сохранение − (тем больше, чем сильнее угроза); всегда есть.
//! - Withdraw: сохранение +, против окружения + (растут с угрозой), удержание −, задача −; при открытом фланге
//!   или охвате своих (часть дивизий отрезана), пока меньшинство армии в кольце.
//! - Counterattack: уничтожение +, удержание +, сохранение −; свой резерв в пределах `COUNTER_KM` от вклинения.
//! - ShiftForces: удержание + на угрожаемом участке; берётся с тихого участка: ни одна дивизия не в бою (`World.engaged` — итог предыдущего шага — или наступление, кроме закрепления); не берётся с армии с открытым
//!   флангом и не направляется в армию, уже окружённую (тогда — прорыв).
//! - Breakout: сохранение ++, сбережение сил +, удержание −; штаб в кольце и есть свой штаб снаружи.
//! - Permit / Forbid (Ставка): на каждый неотвеченный запрос, дождавшийся срока ответа `permissionHours`; запрет — удержание +, сохранение − (больше при угрозе
//!   армии), разрешение — наоборот.
//! - Relief (Ставка): сохранение +, удержание −; армия в кольце и есть армия снаружи.
//! - MoveReserve (Ставка): сохранение +, удержание +; резерв ОКВ (штабы `okwReserve.hqs`) и угрожаемая армия.

use super::options::{Choice, Kind};
use super::picture::{divisions_of, under, ArmyView, Picture};
use super::profile::{Motive, Motives, Profile};
use crate::geo::XY;
use crate::model::{AttackSub, Echelon, State};
use crate::world::Sim;

/// Радиус, в котором резерв армии считается близким к вклинению, км.
const COUNTER_KM: f64 = 40.0;
/// Доля дивизий, отрезанных от своих, с которой штаб считается в кольце (большинство).
const POCKET_SHARE: f64 = 0.5;

// Hold
/// Вклад удержания в удержание и задачу; в сохранение — минус на долю угрозы.
const HOLD_HOLD: f64 = 0.7;
const HOLD_TASK: f64 = 0.3;
const HOLD_SAVE: f64 = -0.8;
const HOLD_UNC: f64 = 0.2;
const HOLD_LOSS: f64 = 0.3;
// Withdraw
/// Основа вклада отхода в сохранение и против окружения, прибавка на долю отрезанных и за открытый фланг.
const WD_SAVE: f64 = 0.3;
const WD_NOENC: f64 = 0.3;
const WD_PER_CUT: f64 = 0.6;
const WD_FLANK: f64 = 0.3;
const WD_HOLD: f64 = -0.6;
const WD_TASK: f64 = -0.4;
const WD_UNC: f64 = 0.4;
const WD_LOSS: f64 = 0.25;
// Counterattack
const CA_DESTROY: f64 = 0.6;
const CA_HOLD: f64 = 0.3;
const CA_PRESERVE: f64 = -0.4;
const CA_UNC: f64 = 0.6;
const CA_LOSS: f64 = 0.5;
// ShiftForces
const SF_HOLD: f64 = 0.4;
const SF_UNC: f64 = 0.4;
const SF_LOSS: f64 = 0.15;
// Breakout
const BO_SAVE: f64 = 0.9;
const BO_PRESERVE: f64 = 0.4;
const BO_HOLD: f64 = -0.7;
const BO_UNC: f64 = 0.7;
const BO_LOSS: f64 = 0.6;
// Permit / Forbid
/// Запрет: вклад в удержание и основа вреда сохранению, прибавка вреда на долю угрозы армии запросившего.
const FB_HOLD: f64 = 0.8;
const FB_SAVE: f64 = -0.2;
const FB_SAVE_PER_THREAT: f64 = -0.6;
const FB_UNC: f64 = 0.3;
const FB_LOSS: f64 = 0.35;
/// Разрешение: основа вклада в сохранение, прибавка на долю угрозы, вклад в удержание (отступление от приказа).
const PM_SAVE: f64 = 0.3;
const PM_SAVE_PER_THREAT: f64 = 0.5;
const PM_HOLD: f64 = -0.6;
const PM_UNC: f64 = 0.35;
const PM_LOSS: f64 = 0.2;
// Relief
const RL_SAVE: f64 = 0.6;
const RL_HOLD: f64 = -0.2;
const RL_PRESERVE: f64 = -0.2;
const RL_UNC: f64 = 0.7;
const RL_LOSS: f64 = 0.5;
// MoveReserve
const MR_SAVE: f64 = 0.3;
const MR_HOLD: f64 = 0.3;
const MR_UNC: f64 = 0.3;
const MR_LOSS: f64 = 0.15;

fn contrib(parts: &[(Motive, f64)]) -> Motives {
    let mut m = [0.0; 7];
    for &(k, v) in parts { m[k as usize] = v.clamp(-1.0, 1.0); }
    Motives(m)
}

fn name(sim: &Sim, hq: u32) -> &str { &sim.world.hqs[hq as usize].name }

/// Доля живых дивизий штаба, отрезанных от своих (`None` — дивизий нет).
fn cut_share(sim: &Sim, hq: u32) -> Option<f64> {
    let ds = divisions_of(sim, hq);
    if ds.is_empty() { return None; }
    Some(ds.iter().filter(|&&i| sim.world.divisions[i].cut_since.is_some()).count() as f64 / ds.len() as f64)
}

fn centroid(sim: &Sim, ds: &[usize]) -> Option<XY> {
    if ds.is_empty() { return None; }
    let n = ds.len() as f64;
    Some(XY::new(ds.iter().map(|&i| sim.world.divisions[i].vars.pos.x).sum::<f64>() / n, ds.iter().map(|&i| sim.world.divisions[i].vars.pos.y).sum::<f64>() / n))
}

/// Штаб в кольце: отрезана большая часть его дивизий.
fn in_pocket(sim: &Sim, hq: u32) -> bool { cut_share(sim, hq).is_some_and(|s| s > POCKET_SHARE) }

/// Армии стороны штаба `hq` (все, не только подчинённые).
fn side_armies(sim: &Sim, hq: u32) -> Vec<u32> {
    let side = sim.world.hqs[hq as usize].side;
    (0..sim.world.hqs.len() as u32).filter(|&h| sim.world.hqs[h as usize].echelon == Echelon::Army && sim.world.hqs[h as usize].side == side).collect()
}

/// Свой штаб снаружи: армия с дивизиями, из которых ни одна не отрезана, ближайшая к `from`; цель — центр её дивизий.
pub(super) fn outside_hq(sim: &Sim, hq: u32, from: XY) -> Option<(u32, XY)> {
    side_armies(sim, hq).into_iter().filter(|&a| cut_share(sim, a) == Some(0.0))
        .filter_map(|a| centroid(sim, &divisions_of(sim, a)).map(|c| (a, c)))
        .min_by(|x, y| x.1.dist(from).total_cmp(&y.1.dist(from)))
}

/// Угроза армии 0…1: доля отрезанных дивизий, при открытом фланге не меньше половины.
fn threat(sim: &Sim, pic: Option<&Picture>, army: u32) -> f64 {
    let flank = pic.is_some_and(|p| p.open_flanks.contains(&army));
    cut_share(sim, army).unwrap_or(0.0).max(if flank { 0.5 } else { 0.0 })
}

/// Дивизия в бою: была в бою на предыдущем шаге (`World.engaged` — его итог) или наступает (кроме закрепления).
fn in_combat(sim: &Sim, i: usize) -> bool {
    sim.world.engaged.get(i).copied().unwrap_or(false) || matches!(sim.world.divisions[i].state, State::Attack(s) if s != AttackSub::Consolidate)
}

/// Дивизия окружена или отрезана от своих.
fn is_cut(sim: &Sim, i: usize) -> bool { sim.world.divisions[i].cut_since.is_some() }

pub fn options_de(sim: &Sim, hq: u32, _p: &Profile, pic: &Picture) -> Vec<Choice> {
    let w = &sim.world;
    let mine: Vec<&ArmyView> = pic.armies.iter().collect();
    let worst = mine.iter().map(|a| threat(sim, Some(pic), a.hq)).fold(0.0, f64::max);
    let mut out = vec![Choice {
        kind: Kind::Hold, label: "Держаться на занятых рубежах".into(),
        contrib: contrib(&[(Motive::Hold, HOLD_HOLD), (Motive::Task, HOLD_TASK), (Motive::Save, HOLD_SAVE * worst)]),
        uncertainty: HOLD_UNC, losses: HOLD_LOSS, rule: "Truppenführung: оборона рубежа до последней возможности — по приказу старшего начальника",
    }];

    // отход армии: открытый фланг или охват своих, пока большинство армии не в кольце
    for a in &mine {
        let share = cut_share(sim, a.hq).unwrap_or(0.0);
        let flank = pic.open_flanks.contains(&a.hq);
        if in_pocket(sim, a.hq) || (!flank && share <= 0.0) { continue; }
        let k = WD_PER_CUT * share + if flank { WD_FLANK } else { 0.0 };
        out.push(Choice {
            kind: Kind::Withdraw { hq: a.hq }, label: format!("Отвести {} на рубеж в глубине", name(sim, a.hq)),
            contrib: contrib(&[(Motive::Save, WD_SAVE + k), (Motive::NoEncircle, WD_NOENC + k), (Motive::Hold, WD_HOLD), (Motive::Task, WD_TASK)]),
            uncertainty: WD_UNC, losses: WD_LOSS, rule: "Truppenführung: elastische Verteidigung — отход, чтобы не быть охваченным",
        });
    }

    // контратака: наступающий противник вблизи своих войск (вклинение) и свой резерв армии рядом
    let own: Vec<usize> = mine.iter().flat_map(|a| divisions_of(sim, a.hq)).collect();
    let wedges: Vec<XY> = (0..w.divisions.len()).filter(|&e| {
        let d = &w.divisions[e];
        d.side != w.hqs[hq as usize].side && matches!(d.state, State::Attack(_)) && own.iter().any(|&i| w.divisions[i].vars.pos.dist(d.vars.pos) <= sim.rules.contact_km)
    }).map(|e| w.divisions[e].vars.pos).collect();
    for a in &mine {
        let reserve: Vec<XY> = divisions_of(sim, a.hq).into_iter().filter(|&i| w.divisions[i].state == State::Reserve && !is_cut(sim, i)).map(|i| w.divisions[i].vars.pos).collect();
        let best = wedges.iter().filter_map(|&at| reserve.iter().map(|r| r.dist(at)).min_by(f64::total_cmp).filter(|&d| d <= COUNTER_KM).map(|d| (at, d)))
            .min_by(|x, y| x.1.total_cmp(&y.1));
        if let Some((at, _)) = best {
            out.push(Choice {
                kind: Kind::Counterattack { from: a.hq, at }, label: format!("Контратаковать резервом {} по вклинившемуся противнику", name(sim, a.hq)),
                contrib: contrib(&[(Motive::Destroy, CA_DESTROY), (Motive::Hold, CA_HOLD), (Motive::Preserve, CA_PRESERVE)]),
                uncertainty: CA_UNC, losses: CA_LOSS, rule: "Truppenführung: вклинение ликвидируется немедленной контратакой резерва",
            });
        }
    }

    // перегруппировка: с тихой армии (в текущий час нет боя) на угрожаемую
    let quiet = |a: &ArmyView| divisions_of(sim, a.hq).into_iter().all(|i| !in_combat(sim, i));
    for to in mine.iter().filter(|a| threat(sim, Some(pic), a.hq) > 0.0 && !in_pocket(sim, a.hq)) {
        let from = mine.iter().filter(|a| a.hq != to.hq && quiet(a) && !pic.open_flanks.contains(&a.hq)).max_by(|x, y| x.strength.total_cmp(&y.strength));
        if let Some(from) = from {
            out.push(Choice {
                kind: Kind::ShiftForces { from: from.hq, to: to.hq }, label: format!("Передать силы от {} к {}", name(sim, from.hq), name(sim, to.hq)),
                contrib: contrib(&[(Motive::Hold, SF_HOLD)]),
                uncertainty: SF_UNC, losses: SF_LOSS, rule: "Truppenführung: силы собираются на решающем участке за счёт спокойных",
            });
        }
    }

    // прорыв из кольца к своему штабу снаружи
    if in_pocket(sim, hq) {
        if let Some(from) = centroid(sim, &divisions_of(sim, hq)) {
            if let Some((_, toward)) = outside_hq(sim, hq, from) {
                out.push(Choice {
                    kind: Kind::Breakout { toward }, label: "Прорываться из окружения к своим".into(),
                    contrib: contrib(&[(Motive::Save, BO_SAVE), (Motive::Preserve, BO_PRESERVE), (Motive::Hold, BO_HOLD)]),
                    uncertainty: BO_UNC, losses: BO_LOSS, rule: "Truppenführung: окружённые прорываются на соединение со своими, пока кольцо не сомкнулось плотно",
                });
            }
        }
    }
    out
}

pub fn options_high(sim: &Sim, hq: u32, _p: &Profile) -> Vec<Choice> {
    let mut out = Vec::new();

    // неотвеченные запросы корпусов: по паре «разрешить / запретить»
    // запросы, дождавшиеся срока ответа (`permissionHours` — тот же час, когда отвечал прежний «держать»)
    let wait = sim.rules.command.de.permission_hours as u32;
    for (i, r) in sim.command.requests.iter().enumerate().filter(|(_, r)| r.answer.is_none() && sim.world.tick >= r.tick + wait) {
        let army = sim.world.hqs[r.hq as usize].parent;
        let t = army.map_or(0.0, |a| threat(sim, None, a));
        out.push(Choice {
            kind: Kind::Forbid { request: i }, label: format!("Запретить отход: {}", name(sim, r.hq)),
            contrib: contrib(&[(Motive::Hold, FB_HOLD), (Motive::Save, FB_SAVE + FB_SAVE_PER_THREAT * t)]),
            uncertainty: FB_UNC, losses: FB_LOSS, rule: "Приказ «держать» — политическая цель Ставки с начала операции; Truppenführung: решение принимает старший начальник",
        });
        out.push(Choice {
            kind: Kind::Permit { request: i }, label: format!("Разрешить отход: {}", name(sim, r.hq)),
            contrib: contrib(&[(Motive::Save, PM_SAVE + PM_SAVE_PER_THREAT * t), (Motive::Hold, PM_HOLD)]),
            uncertainty: PM_UNC, losses: PM_LOSS, rule: "Truppenführung: elastische Verteidigung — отход допустим, если рубеж не удержать",
        });
    }

    // окружённые армии и армии снаружи
    let armies = side_armies(sim, hq);
    let pocketed: Vec<u32> = armies.iter().copied().filter(|&a| in_pocket(sim, a)).collect();
    for &a in &pocketed {
        let Some(c) = centroid(sim, &divisions_of(sim, a)) else { continue };
        if let Some((by, _)) = outside_hq(sim, hq, c) {
            out.push(Choice {
                kind: Kind::Relief { army: a, by, toward: c }, label: format!("Выручить {} ударом снаружи", name(sim, a)),
                contrib: contrib(&[(Motive::Save, RL_SAVE), (Motive::Hold, RL_HOLD), (Motive::Preserve, RL_PRESERVE)]),
                uncertainty: RL_UNC, losses: RL_LOSS, rule: "Truppenführung: окружённым помогают встречным ударом извне",
            });
        }
    }

    // резерв ОКВ (штабы `okwReserve.hqs` правил командующих) — к самой угрожаемой армии
    let okw: Vec<u32> = (0..sim.world.hqs.len() as u32).filter(|&h| sim.rules.commanders.okw_reserve_hqs.contains(&sim.world.hqs[h as usize].id)).collect();
    let reserves: Vec<usize> = (0..sim.world.divisions.len()).filter(|&i| {
        let d = &sim.world.divisions[i];
        d.state == State::Reserve && (d.hq == hq || okw.iter().any(|&o| under(sim, d.hq, o)))
    }).collect();
    let target = armies.iter().copied().map(|a| (a, threat(sim, None, a))).filter(|x| x.1 > 0.0)
        .max_by(|x, y| x.1.total_cmp(&y.1).then(y.0.cmp(&x.0))).and_then(|(a, _)| centroid(sim, &divisions_of(sim, a)).map(|c| (a, c)));
    if let Some((army, to)) = target {
        let mut seen = Vec::new();
        for i in reserves.into_iter().filter(|&i| !is_cut(sim, i) && !under(sim, sim.world.divisions[i].hq, army)) {
            let h = sim.world.divisions[i].hq;
            if seen.contains(&h) { continue; }
            seen.push(h);
            out.push(Choice {
                kind: Kind::MoveReserve { hq: h, to }, label: format!("Двинуть резерв {} к угрожаемой армии", name(sim, h)),
                contrib: contrib(&[(Motive::Save, MR_SAVE), (Motive::Hold, MR_HOLD)]),
                uncertainty: MR_UNC, losses: MR_LOSS, rule: "Truppenführung: резерв старшего начальника вводится на решающем участке",
            });
        }
    }
    out
}
