//! Варианты решения советского фронта по картине обстановки. Вклад в мотивы, неопределённость и потери выводятся
//! из картины простыми правилами; коэффициенты — именованные константы (допущения, подбираются калибровкой).
//!
//! Таблица правил (вклад в мотивы; U — неопределённость, L — потери):
//! - Continue: задача +, остальное 0; U, L малы.
//! - CommitMobile: с продвижения главного удара (без подвижных групп) на глубину `commitDepthKm`; задача + (больше при прорыве), соперник +
//!   (если он есть), сохранение −; U выше без прорыва. По сроку ввода `tankCommitFallbackHours` (приказ НКО 1942 г. о танковых войсках,
//!   как у штаба фронта) — и без продвижения, с малой U.
//! - WaitMobile: сохранение +, задача −, соперник − (если он ближе к объекту); U мала.
//! - ShiftMainBlow: задача +, сохранение −; на подвижные группы удар не переносится.
//! - TurnToRival: соперник +, задача − (уход от направления задачи старшего к объекту соперника; без замысла не появляется).
//! - Encircle: уничтожение +, задача +.
//! - CommitSecond: задача +, сохранение −.
//! - Assign («история как замысел»: армия вне истории без задачи, с выполненной или потерявшей смысл): задача +,
//!   соперник + (если объект ближе армии к объекту соперника), сохранение − (мало); U меньше у объекта плана фронта,
//!   чем у пункта по местности. Не вариант в споре решений: штаб фронта ставит её каждый час (decide.rs, `staff`);
//!   объекты в зоне изменённого замысла (`drop`) не берутся.
//!
//! В «истории как замысле» фронт идёт по приказам сценария, и командующий решает только за армии вне истории:
//! варианты строятся по картине с одними этими армиями, без переноса главного удара (это замысел самого фронта).

use super::options::{Choice, Kind};
use super::picture::{divisions_of, profile_objective_xy, ArmyView, Picture};
use super::profile::{Motive, Motives, Profile};
use crate::command::agent::place;
use crate::command::control::{Control, Role};
use crate::command::directive::Target;
use crate::geo::XY;
use crate::intent::{self, Chain, Reason};
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
/// Неопределённость ввода по сроку: срок ввода — правило, а не догадка о прорыве.
const COMMIT_UNC_LATE: f64 = 0.2;
const RULE_COMMIT: &str = "ПУ-43: подвижные группы вводятся в прорыв на глубину тактической обороны; глубокая операция";
const RULE_COMMIT_LATE: &str = "приказ НКО 1942 г. о боевом применении танковых войск: тактическая зона за срок не прорвана — подвижная группа вводится для завершения прорыва";
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
// Assign
/// Вклад постановки задачи армии вне истории в задачу, соперничество (объект ближе к объекту соперника) и сохранение сил.
const ASSIGN_TASK: f64 = 0.4;
const ASSIGN_RIVAL: f64 = 0.3;
const ASSIGN_PRESERVE: f64 = -0.1;
/// Неопределённость: объект плана фронта — известный замысел; пункт по местности — догадка.
const ASSIGN_UNC_PLAN: f64 = 0.2;
const ASSIGN_UNC_GROUND: f64 = 0.35;
const ASSIGN_LOSS: f64 = 0.2;
/// Объект плана впереди армии: угол к её оси не больше 60° (косинус).
const AHEAD_COS: f64 = 0.5;
/// Пункт по местности: населённый пункт или мост не дальше стольких км от точки суточного перехода по оси (допущение).
const GROUND_KM: f64 = 10.0;
/// Оборона армии без задачи в районе операции: у населённого пункта не дальше стольких км от её центра, иначе на месте
/// (допущение: армия не уходит далеко, чтобы занять оборону).
const DEFEND_KM: f64 = 10.0;
const RULE_ASSIGN_PLAN: &str = "ПУ-43: задача армии — в замысле операции фронта; ближайший объект плана в полосе армии";
const RULE_ASSIGN_DEFEND: &str = "ПУ-43: армия без задачи в полосе фронта — оборона занятого рубежа до новой задачи";
const RULE_ASSIGN_GROUND: &str = "ПУ-43: ближайшая задача армии — на глубину суточного перехода по оси наступления";

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
    if !crate::commander::decide::for_strayed(sim, hq) { return plan_options(sim, hq, p, pic, false); }
    let off = strayed(sim, pic);
    if off.is_empty() { return Vec::new(); }
    let mut view = pic.clone();
    view.armies.retain(|a| off.contains(&a.hq));
    // задачу армии без задачи ставит штаб фронта каждый час (decide.rs, `staff`) — среди вариантов её нет
    plan_options(sim, hq, p, &view, true)
}

/// Армии картины вне истории, за которые решает командующий (армию игрока ведёт игрок).
pub fn strayed(sim: &Sim, pic: &Picture) -> Vec<u32> {
    pic.armies.iter().map(|a| a.hq).filter(|&a| intent::off_history(sim, a) && sim.command.control.get(a as usize) != Some(&Control::Player)).collect()
}

/// Армии нужна задача (директивы ей в пути нет): её нет, она выполнена (армия у цели в пределах соприкосновения) или потеряла смысл; неспособная
/// армия новой задачи не получает.
pub fn needs_task(sim: &Sim, army: u32) -> bool {
    // директива армии в пути — задача уже поставлена
    if sim.command.in_transit.iter().any(|(_, d)| d.to == Target::Hq(army)) { return false; }
    let Some(d) = sim.command.intent.get(army as usize).and_then(Option::as_ref) else { return true };
    let t = intent::of_directive(d.issued, d);
    if intent::done(sim, army, &t) { return true; }
    let chain = Chain { owner: army, tasks: Vec::new(), next: 0, start: None };
    !matches!(intent::sense(sim, &chain, &t), Ok(()) | Err(Reason::Unfit))
}

/// Ось армии: ось её задачи; нет — к объекту фронта; нет и его — к ближайшему противнику.
fn army_axis(sim: &Sim, p: &Profile, army: u32, c: XY) -> Option<XY> {
    if let Some(d) = sim.command.intent.get(army as usize).and_then(Option::as_ref) {
        if let (Some(a), Some(b)) = (d.axis.first(), d.axis.last()) { if a.dist(*b) > 1e-6 { return Some(XY::new(b.x - a.x, b.y - a.y)); } }
    }
    let side = sim.world.hqs[army as usize].side;
    let to = profile_objective_xy(sim, p).filter(|o| o.dist(c) > 1e-6).or_else(|| {
        sim.world.divisions.iter().filter(|d| d.side != side && !d.state.out()).map(|d| d.vars.pos).min_by(|a, b| a.dist(c).total_cmp(&b.dist(c)))
    })?;
    Some(XY::new(to.x - c.x, to.y - c.y))
}

/// Вариант «поставить задачу» армии вне истории (спецификация, раздел 2.2): ближайший объект плана фронта впереди в
/// полосе армии (к оси не больше 60°), ещё у противника (своих в пределах соприкосновения нет), не дальше `reachDays`
/// суточных переходов; нет такого — ближайший населённый пункт (центр кольца) или мост у точки суточного перехода по
/// оси (не дальше `GROUND_KM`), нет и их — сама точка. Пункт по местности — только в районе операции фронта: не
/// дальше `intent.leaveKm` от объекта плана (вне зон изменённого замысла) и впереди армии, к ближайшему противнику;
/// такого нет — «занять оборону» у ближайшего населённого пункта не дальше `DEFEND_KM` от центра армии, нет его — на месте.
pub fn assign(sim: &Sim, p: &Profile, army: u32) -> Option<Choice> {
    let w = &sim.world;
    let r = &sim.rules;
    let ds = divisions_of(sim, army);
    if ds.is_empty() { return None; }
    let c = place(sim, Target::Hq(army));
    let ax = army_axis(sim, p, army, c)?;
    let al = (ax.x * ax.x + ax.y * ax.y).sqrt();
    if al < 1e-9 { return None; }
    let rate = ds.iter().map(|&i| r.enemy_territory_km_day[w.divisions[i].params.mobility as usize]).sum::<f64>() / ds.len() as f64;
    let side = w.hqs[army as usize].side;
    let ours = |g: XY| w.divisions.iter().any(|d| d.side == side && !d.state.out() && d.vars.pos.dist(g) <= r.contact_km);
    let front = w.hqs[army as usize].parent.unwrap_or(army);
    let plan = intent::plan_objectives(sim, front).into_iter().filter(|&g| {
        let d = c.dist(g);
        d > r.contact_km && d <= r.intent.reach_days * rate && ((g.x - c.x) * ax.x + (g.y - c.y) * ax.y) / (d * al) >= AHEAD_COS && !ours(g) && !intent::intervene::banned(sim, army, g)
    }).min_by(|a, b| c.dist(*a).total_cmp(&c.dist(*b)));
    // район операции фронта: не дальше leaveKm от объекта его плана (вне зон изменённого замысла армии) и впереди
    // армии — к ближайшему противнику
    let objectives: Vec<XY> = intent::plan_objectives(sim, front).into_iter().filter(|&g| !intent::intervene::banned(sim, army, g)).collect();
    let enemy = w.divisions.iter().filter(|d| d.side != side && !d.state.out()).map(|d| d.vars.pos).min_by(|a, b| a.dist(c).total_cmp(&b.dist(c)));
    let admissible = |g: XY| !intent::intervene::banned(sim, army, g) && objectives.iter().any(|o| o.dist(g) <= r.intent.leave_km)
        && enemy.is_some_and(|e| (g.x - c.x) * (e.x - c.x) + (g.y - c.y) * (e.y - c.y) > 0.0);
    let pr = &sim.theatre.proj;
    let areas: Vec<(XY, String)> = sim.theatre.areas.iter().filter(|a| !a.ring.is_empty()).map(|a| {
        let v: Vec<XY> = a.ring.iter().map(|x| pr.to_xy(*x)).collect();
        let n = v.len() as f64;
        (XY::new(v.iter().map(|x| x.x).sum::<f64>() / n, v.iter().map(|x| x.y).sum::<f64>() / n), a.name.clone())
    }).collect();
    let (at, from_plan, defend, what) = match plan {
        Some(g) => (g, true, false, "объект плана фронта".to_string()),
        None => {
            let q = XY::new(c.x + ax.x / al * rate, c.y + ax.y / al * rate);
            let bridges = sim.theatre.bridges.iter().map(|b| (b.pos, b.name.clone()));
            let ground = areas.iter().cloned().chain(bridges).filter(|x| x.0.dist(q) <= GROUND_KM && admissible(x.0)).min_by(|a, b| a.0.dist(q).total_cmp(&b.0.dist(q)));
            match ground {
                Some((at, n)) => (at, false, false, n),
                None if admissible(q) => (q, false, false, "рубеж суточного перехода".to_string()),
                // в районе операции задачи нет — оборона у ближайшего населённого пункта не дальше DEFEND_KM (нет такого — на месте)
                None => {
                    let (at, n) = areas.iter().filter(|x| x.0.dist(c) <= DEFEND_KM && !intent::intervene::banned(sim, army, x.0)).min_by(|a, b| a.0.dist(c).total_cmp(&b.0.dist(c))).cloned()
                        .unwrap_or((c, "на месте".to_string()));
                    (at, false, true, format!("нет задачи в полосе фронта — оборона ({n})"))
                }
            }
        }
    };
    let rival = p.rival.as_deref().and_then(|id| sim.rules.commanders.profiles.iter().find(|q| q.id == id)).and_then(|rp| profile_objective_xy(sim, rp))
        .map_or(0.0, |o| if at.dist(o) < c.dist(o) { ASSIGN_RIVAL } else { 0.0 });
    Some(Choice {
        kind: Kind::Assign { army, at, from_plan, defend }, label: format!("Поставить {} задачу: {what}", name(sim, army)),
        contrib: contrib(&[(Motive::Task, ASSIGN_TASK), (Motive::Rival, rival), (Motive::Preserve, ASSIGN_PRESERVE)]),
        uncertainty: if from_plan { ASSIGN_UNC_PLAN } else { ASSIGN_UNC_GROUND }, losses: ASSIGN_LOSS,
        rule: if from_plan { RULE_ASSIGN_PLAN } else if defend { RULE_ASSIGN_DEFEND } else { RULE_ASSIGN_GROUND },
    })
}

/// Варианты по картине `pic`; `strayed` — «история как замысел»: в картине только армии вне истории, без переноса
/// главного удара, котлы — только те, что замыкают эти армии.
fn plan_options(sim: &Sim, hq: u32, p: &Profile, pic: &Picture, strayed: bool) -> Vec<Choice> {
    let mut out = vec![Choice {
        kind: Kind::Continue, label: "Продолжать по плану".into(), contrib: contrib(&[(Motive::Task, CONT_TASK)]),
        uncertainty: CONT_UNC, losses: CONT_LOSS, rule: "ПУ-43: выполнять задачу, поставленную старшим начальником",
    }];

    // армии главного удара: по замыслу старшего, иначе первый эшелон
    let named: Vec<u32> = sim.command.intent.get(hq as usize).and_then(Option::as_ref).map(|d| d.main_blow.clone()).unwrap_or_default();
    // подвижные группы (до ввода и введённые) в главный удар не входят: их марш — не продвижение главного удара
    let tank = |a: &ArmyView| matches!(role(sim, a.hq), Role::Mobile | Role::Committed);
    let main: Vec<&ArmyView> = pic.armies.iter().filter(|a| !tank(a) && if named.is_empty() { role(sim, a.hq) == Role::First } else { named.contains(&a.hq) }).collect();
    let main_adv = main.iter().map(|a| a.advance_km).fold(0.0, f64::max);
    let broke = main.iter().any(|a| a.broke_through);
    let mobile: Vec<&ArmyView> = pic.armies.iter().filter(|a| role(sim, a.hq) == Role::Mobile).collect();

    // подвижная группа: ввод с глубины ввода вторых эшелонов (главная полоса прорвана) или по сроку ввода
    // (`tankCommitFallbackHours`, как у штаба фронта); без прорыва тактической зоны — неопределённее; ожидание — пока нет прорыва
    let deep = main_adv >= sim.rules.doctrine_su.commit_depth_km;
    let late = |m: &ArmyView| sim.world.tick.saturating_sub(sim.command.since(Target::Hq(m.hq))) as f64 >= sim.rules.doctrine_su.tank_commit_fallback_hours;
    let ready: Vec<&&ArmyView> = mobile.iter().filter(|m| deep || late(m)).collect();
    if !ready.is_empty() {
        let rival = if pic.rival.is_some() { COMMIT_RIVAL } else { 0.0 };
        for m in &ready {
            let (unc, loss, task, rule) = if broke { (COMMIT_UNC_BROKE, COMMIT_LOSS_BROKE, COMMIT_TASK + COMMIT_TASK_BROKE, RULE_COMMIT) }
                else if late(m) { (COMMIT_UNC_LATE, COMMIT_LOSS_OPEN, COMMIT_TASK, RULE_COMMIT_LATE) }
                else { (COMMIT_UNC_OPEN, COMMIT_LOSS_OPEN, COMMIT_TASK, RULE_COMMIT) };
            out.push(Choice {
                kind: Kind::CommitMobile { hq: m.hq }, label: format!("Ввести {} в прорыв", name(sim, m.hq)),
                contrib: contrib(&[(Motive::Task, task), (Motive::Rival, rival), (Motive::Preserve, COMMIT_PRESERVE)]),
                uncertainty: unc, losses: loss, rule,
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
    if !strayed && !main.is_empty() {
        let to: Vec<u32> = pic.armies.iter().filter(|a| !tank(a) && !main.iter().any(|m| m.hq == a.hq) && a.advance_km > main_adv * SHIFT_RATIO && a.advance_km - main_adv >= SHIFT_MIN_LEAD_KM).map(|a| a.hq).collect();
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
        if strayed && !k.by.iter().any(|h| pic.armies.iter().any(|a| a.hq == *h)) { continue; }
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
