//! Варианты решения советского фронта по картине обстановки. Вклад в мотивы, неопределённость и потери выводятся
//! из картины простыми правилами; коэффициенты — именованные константы (допущения, подбираются калибровкой).
//!
//! Таблица правил (вклад в мотивы; U — неопределённость, L — потери):
//! - Continue: задача +, остальное 0; U, L малы.
//! - CommitMobile: с продвижения главного удара на глубину `commitDepthKm`; задача + (больше при прорыве), соперник +
//!   (если он есть), сохранение −; U выше без прорыва.
//! - WaitMobile: сохранение +, задача −, соперник − (если он ближе к объекту); U мала.
//! - ShiftMainBlow: задача +, сохранение −.
//! - TurnToRival: соперник +, задача − (уход от направления задачи старшего к объекту соперника; без замысла не появляется).
//! - Encircle: уничтожение +, задача +.
//! - CommitSecond: задача +, сохранение −.

use super::options::{Choice, Kind};
use super::picture::{divisions_of, profile_objective_xy, ArmyView, Picture};
use super::profile::{Motive, Motives, Profile};
use crate::command::control::Role;
use crate::geo::XY;
use crate::world::Sim;

/// Во сколько раз продвижение армии вне главного удара должно превышать продвижение главного удара для переноса удара.
const SHIFT_RATIO: f64 = 1.5;
/// Наименьший отрыв вырвавшейся армии от главного удара для переноса удара, км (при нулевом продвижении кратность не работает).
const SHIFT_MIN_LEAD_KM: f64 = 5.0;

// Continue
/// Вклад «идти по плану» в задачу.
const CONT_TASK: f64 = 0.1;
/// Неопределённость и потери «идти по плану».
const CONT_UNC: f64 = 0.1;
const CONT_LOSS: f64 = 0.1;
// CommitMobile
/// Вклад ввода подвижной группы в задачу без прорыва и прибавка к нему при прорыве.
const COMMIT_TASK: f64 = 0.5;
const COMMIT_TASK_BROKE: f64 = 0.3;
/// Вклад ввода в соперничество, если соперник есть.
const COMMIT_RIVAL: f64 = 0.4;
/// Вклад ввода в сохранение сил (риск потерь).
const COMMIT_PRESERVE: f64 = -0.3;
/// Неопределённость и потери ввода без прорыва и с прорывом.
const COMMIT_UNC_OPEN: f64 = 0.7;
const COMMIT_UNC_BROKE: f64 = 0.2;
const COMMIT_LOSS_OPEN: f64 = 0.5;
const COMMIT_LOSS_BROKE: f64 = 0.25;
// WaitMobile
/// Вклад ожидания в сохранение сил и в задачу (замедление), в соперничество при отставании от соперника.
const WAIT_PRESERVE: f64 = 0.4;
const WAIT_TASK: f64 = -0.2;
const WAIT_RIVAL: f64 = -0.3;
const WAIT_UNC: f64 = 0.2;
const WAIT_LOSS: f64 = 0.05;
// ShiftMainBlow
/// Вклад переноса главного удара в задачу и сохранение сил; неопределённость и потери.
const SHIFT_TASK: f64 = 0.3;
const SHIFT_PRESERVE: f64 = -0.1;
const SHIFT_UNC: f64 = 0.5;
const SHIFT_LOSS: f64 = 0.3;
// TurnToRival
/// Вклад поворота к объекту соперника в соперничество и (отход от задачи старшего) в задачу.
const TURN_RIVAL: f64 = 0.7;
const TURN_TASK: f64 = -0.4;
const TURN_UNC: f64 = 0.6;
const TURN_LOSS: f64 = 0.4;
// Encircle
/// Вклад замыкания котла в уничтожение противника и в задачу.
const ENC_DESTROY: f64 = 0.8;
const ENC_TASK: f64 = 0.1;
const ENC_UNC: f64 = 0.4;
const ENC_LOSS: f64 = 0.3;
// CommitSecond
/// Вклад ввода второго эшелона в задачу и сохранение сил.
const SECOND_TASK: f64 = 0.4;
const SECOND_PRESERVE: f64 = -0.15;
const SECOND_UNC: f64 = 0.3;
const SECOND_LOSS: f64 = 0.35;

fn contrib(parts: &[(Motive, f64)]) -> Motives {
    let mut m = [0.0; 7];
    for &(k, v) in parts { m[k as usize] = v.clamp(-1.0, 1.0); }
    Motives(m)
}

fn role(sim: &Sim, hq: u32) -> Role { sim.command.role_hq.get(hq as usize).copied().unwrap_or_default() }

fn name(sim: &Sim, hq: u32) -> &str { &sim.world.hqs[hq as usize].name }

/// Конечная точка задачи, полученной фронтом: конец оси, иначе середина последующего рубежа, иначе ближайшего.
fn task_goal(sim: &Sim, hq: u32) -> Option<XY> {
    let d = sim.command.intent.get(hq as usize)?.as_ref()?;
    if let Some(&p) = d.axis.last() { return Some(p); }
    let line = d.subsequent.as_ref().filter(|l| !l.pts.is_empty()).or(d.immediate.as_ref().filter(|l| !l.pts.is_empty()))?;
    let n = line.pts.len() as f64;
    Some(XY::new(line.pts.iter().map(|p| p.x).sum::<f64>() / n, line.pts.iter().map(|p| p.y).sum::<f64>() / n))
}

pub fn options_su(sim: &Sim, hq: u32, p: &Profile, pic: &Picture) -> Vec<Choice> {
    let mut out = vec![Choice {
        kind: Kind::Continue, label: "Продолжать по плану".into(), contrib: contrib(&[(Motive::Task, CONT_TASK)]),
        uncertainty: CONT_UNC, losses: CONT_LOSS, rule: "ПУ-43: выполнять задачу, поставленную старшим начальником",
    }];

    // армии главного удара: по замыслу старшего, иначе первый эшелон
    let named: Vec<u32> = sim.command.intent.get(hq as usize).and_then(Option::as_ref).map(|d| d.main_blow.clone()).unwrap_or_default();
    let main: Vec<&ArmyView> = pic.armies.iter().filter(|a| if named.is_empty() { role(sim, a.hq) == Role::First } else { named.contains(&a.hq) }).collect();
    let main_adv = main.iter().map(|a| a.advance_km).fold(0.0, f64::max);
    let broke = main.iter().any(|a| a.broke_through);
    let mobile: Vec<&ArmyView> = pic.armies.iter().filter(|a| role(sim, a.hq) == Role::Mobile).collect();

    // подвижная группа: ввод после пройденной глубины; ожидание — пока нет прорыва
    // появляется с глубины ввода вторых эшелонов (главная полоса прорвана); без прорыва тактической зоны — неопределённее
    if !mobile.is_empty() && main_adv >= sim.rules.doctrine_su.commit_depth_km {
        let (unc, loss) = if broke { (COMMIT_UNC_BROKE, COMMIT_LOSS_BROKE) } else { (COMMIT_UNC_OPEN, COMMIT_LOSS_OPEN) };
        let task = COMMIT_TASK + if broke { COMMIT_TASK_BROKE } else { 0.0 };
        let rival = if pic.rival.is_some() { COMMIT_RIVAL } else { 0.0 };
        for m in &mobile {
            out.push(Choice {
                kind: Kind::CommitMobile { hq: m.hq }, label: format!("Ввести {} в прорыв", name(sim, m.hq)),
                contrib: contrib(&[(Motive::Task, task), (Motive::Rival, rival), (Motive::Preserve, COMMIT_PRESERVE)]),
                uncertainty: unc, losses: loss, rule: "ПУ-43: подвижные группы вводятся в прорыв на глубину тактической обороны; глубокая операция",
            });
        }
        if !broke {
            let rival = match &pic.rival { Some(r) if pic.to_objective_km.is_some_and(|mine| r.to_objective_km < mine) => WAIT_RIVAL, _ => 0.0 };
            out.push(Choice {
                kind: Kind::WaitMobile, label: "Не вводить подвижную группу до прорыва".into(),
                contrib: contrib(&[(Motive::Preserve, WAIT_PRESERVE), (Motive::Task, WAIT_TASK), (Motive::Rival, rival)]),
                uncertainty: WAIT_UNC, losses: WAIT_LOSS, rule: "ПУ-43: ввод подвижных групп — после прорыва тактической зоны обороны",
            });
        }
    }

    // главный удар переносится на армии, вырвавшиеся вперёд
    if !main.is_empty() {
        let to: Vec<u32> = pic.armies.iter().filter(|a| !main.iter().any(|m| m.hq == a.hq) && a.advance_km > main_adv * SHIFT_RATIO && a.advance_km - main_adv >= SHIFT_MIN_LEAD_KM).map(|a| a.hq).collect();
        if !to.is_empty() {
            out.push(Choice {
                kind: Kind::ShiftMainBlow { to }, label: "Перенести главный удар на добившиеся успеха армии".into(),
                contrib: contrib(&[(Motive::Task, SHIFT_TASK), (Motive::Preserve, SHIFT_PRESERVE)]),
                uncertainty: SHIFT_UNC, losses: SHIFT_LOSS, rule: "ПУ-43: усилие наращивается на направлении, где достигнут успех",
            });
        }
    }

    // поворот к объекту соперника
    if let Some(rp) = p.rival.as_deref().and_then(|r| sim.rules.commanders.profiles.iter().find(|q| q.id == r)) {
        if p.objective.is_some() {
            if let Some(at) = profile_objective_xy(sim, rp).filter(|&at| task_goal(sim, hq).is_some_and(|g| g.dist(at) > sim.rules.commanders.options.turn_km)) {
                let near = |a: &ArmyView| divisions_of(sim, a.hq).into_iter().map(|i| sim.world.divisions[i].vars.pos.dist(at)).min_by(f64::total_cmp);
                let limit = sim.rules.commanders.options.turn_km;
                let best = pic.armies.iter().filter_map(|a| near(a).filter(|&d| d < limit).map(|d| (a, d)))
                    .min_by(|x, y| {
                        let not_tank = |a: &ArmyView| !matches!(role(sim, a.hq), Role::Mobile | Role::Committed);
                        not_tank(x.0).cmp(&not_tank(y.0)).then(x.1.total_cmp(&y.1))
                    });
                if let Some((a, _)) = best {
                    out.push(Choice {
                        kind: Kind::TurnToRival { hq: a.hq, at }, label: format!("Повернуть {} к объекту соперника", name(sim, a.hq)),
                        contrib: contrib(&[(Motive::Rival, TURN_RIVAL), (Motive::Task, TURN_TASK)]),
                        uncertainty: TURN_UNC, losses: TURN_LOSS, rule: "ПУ-43: смена направления усилий — по решению командующего с уведомлением старшего",
                    });
                }
            }
        }
    }

    // котлы с малым просветом
    for (i, k) in pic.pockets.iter().enumerate() {
        if k.gap_km < sim.rules.commanders.options.encircle_gap_km {
            out.push(Choice {
                kind: Kind::Encircle { pocket: i }, label: format!("Замкнуть кольцо окружения: котёл № {}", i + 1),
                contrib: contrib(&[(Motive::Destroy, ENC_DESTROY), (Motive::Task, ENC_TASK)]),
                uncertainty: ENC_UNC, losses: ENC_LOSS, rule: "ПУ-43: окружение и уничтожение группировки охватом с флангов; глубокая операция",
            });
        }
    }

    // второй эшелон
    for a in pic.armies.iter().filter(|a| role(sim, a.hq) == Role::Second) {
        out.push(Choice {
            kind: Kind::CommitSecond { hq: a.hq }, label: format!("Ввести {} из второго эшелона", name(sim, a.hq)),
            contrib: contrib(&[(Motive::Task, SECOND_TASK), (Motive::Preserve, SECOND_PRESERVE)]),
            uncertainty: SECOND_UNC, losses: SECOND_LOSS, rule: "ПУ-43: второй эшелон вводится для наращивания удара на решающем направлении",
        });
    }
    out
}
