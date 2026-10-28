//! Картина обстановки командующего: что он знает о своих армиях, противнике и сопернике. Чтение мира без
//! изменения: оценка сил противника — с ошибкой разведки (постоянной в пределах шестичасовой сводки), сведения о
//! сопернике — с задержкой сводок, противник виден только в пределах разведки от своих войск.

use crate::command::control::Role;
use crate::geo::XY;
use crate::model::{Echelon, State};
use crate::rng::{Rng, Stream};
use crate::world::Sim;

/// Сколько часов держится одна сводка (одна и та же ошибка оценки).
const REPORT_HOURS: u32 = 6;
/// Дальность разведки в долях `contactKm`.
pub const RECON_X: f64 = 3.0;
/// Расстояние продвижения, ближе которого направление наступления берётся не по смещению, а по цели, км.
const AXIS_MIN_KM: f64 = 2.0;

/// Армия в картине командующего.
#[derive(Clone, Debug, PartialEq)]
pub struct ArmyView {
    pub hq: u32,
    /// Продвижение центра войск армии от места на начало вдоль оси замысла штаба командующего (оси нет — смещение), км.
    pub advance_km: f64,
    /// Боевая сила по составу, доля от начальной.
    pub strength: f64,
    /// Оценка сил противника в пределах разведки (с ошибкой).
    pub enemy_est: f64,
    /// Сила противника там же без ошибки (для проверки модели; командующий им не пользуется).
    pub enemy_true: f64,
    /// Расстояние ближайшей дивизии армии до цели командующего.
    pub to_objective_km: Option<f64>,
    /// У армии нет обороняющегося противника на оси и пройдена глубина ввода подвижных групп; у подвижной группы — никогда.
    pub broke_through: bool,
}

/// Соперник по сводке: где он был `as_of` часов назад.
#[derive(Clone, Debug, PartialEq)]
pub struct RivalView { pub hq: u32, pub to_objective_km: f64, pub as_of: u32 }

/// Котёл противника: войска без пути к своим.
#[derive(Clone, Debug, PartialEq)]
pub struct PocketView {
    pub center: XY,
    pub enemy_est: f64,
    /// Просвет между охватывающими армиями; при одной армии — удаление котла от земли, до которой у противника есть путь.
    pub gap_km: f64,
    /// Штабы армий, охватывающих котёл: свои и соседа, с двух сторон.
    pub by: Vec<u32>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Picture {
    pub tick: u32,
    pub armies: Vec<ArmyView>,
    /// Резервы противника в пределах разведки: место и оценка силы.
    pub enemy_reserves: Vec<(XY, f64)>,
    pub rival: Option<RivalView>,
    /// Армии, у которых сбоку или сзади противник и соседи его не прикрывают.
    pub open_flanks: Vec<u32>,
    pub pockets: Vec<PocketView>,
    pub to_objective_km: Option<f64>,
}

/// Ведомость, которую ведёт вызывающий (картина мира не меняет): по штабам расстояния до цели по часам
/// `(час, км)` и исходный центр войск штаба — по живым дивизиям на первой записи; от него считаются
/// продвижение армий и ось наступления.
#[derive(Clone, Debug, Default)]
pub struct DistLog {
    pub dist: Vec<Vec<(u32, f64)>>,
    pub start: Vec<Option<XY>>,
}

impl DistLog {
    /// Запись на текущий час для каждого штаба, у профиля которого есть цель. Вызывать раз в час.
    pub fn record(&mut self, sim: &Sim) {
        let tick = sim.world.tick;
        let n = sim.world.hqs.len();
        if self.dist.len() < n { self.dist.resize(n, Vec::new()); }
        if self.start.len() < n { self.start.resize(n, None); }
        for h in 0..n as u32 {
            if self.start[h as usize].is_none() {
                let ps: Vec<XY> = divisions_of(sim, h).into_iter().map(|i| sim.world.divisions[i].vars.pos).collect();
                self.start[h as usize] = centroid(&ps);
            }
            let Some(km) = dist_to_objective(sim, h) else { continue };
            let v = &mut self.dist[h as usize];
            if v.last().is_none_or(|l| l.0 < tick) { v.push((tick, km)); }
        }
    }
    /// Последняя запись штаба не позже часа `hour`.
    fn at(&self, hq: u32, hour: u32) -> Option<(u32, f64)> {
        self.dist.get(hq as usize)?.iter().rev().find(|e| e.0 <= hour).copied()
    }
}

/// Штаб `h` подчинён `top` (или это он сам).
pub(super) fn under(sim: &Sim, mut h: u32, top: u32) -> bool {
    loop {
        if h == top { return true; }
        match sim.world.hqs[h as usize].parent { Some(p) => h = p, None => return false }
    }
}

/// Живые дивизии штаба и его подчинённых.
pub(super) fn divisions_of(sim: &Sim, top: u32) -> Vec<usize> {
    (0..sim.world.divisions.len()).filter(|&i| { let d = &sim.world.divisions[i]; !d.state.out() && under(sim, d.hq, top) }).collect()
}

/// Место объекта профиля в километрах театра.
pub(super) fn profile_objective_xy(sim: &Sim, p: &crate::commander::Profile) -> Option<XY> {
    let c = &sim.rules.commanders;
    Some(sim.theatre.proj.to_xy(c.objective_at(p.objective.as_deref()?)?))
}

/// Место цели командующего штаба в километрах театра.
fn objective_xy(sim: &Sim, hq: u32) -> Option<XY> {
    profile_objective_xy(sim, sim.rules.commanders.for_hq(&sim.world.hqs[hq as usize].id)?)
}

/// Расстояние ближайшей дивизии штаба до его цели.
pub(super) fn dist_to_objective(sim: &Sim, hq: u32) -> Option<f64> {
    let o = objective_xy(sim, hq)?;
    divisions_of(sim, hq).into_iter().map(|i| sim.world.divisions[i].vars.pos.dist(o)).min_by(f64::total_cmp)
}

/// Множитель ошибки разведки `1 + e·u`, `u ∈ [-1, 1]`: постоянен в пределах сводки.
fn fog_mult(sim: &Sim, agent: u32, tick: u32) -> f64 {
    let e = sim.rules.commanders.fog.strength_error;
    let u = 2.0 * Rng::new(sim.seed, agent, tick / REPORT_HOURS, Stream::Fog).f64() - 1.0;
    1.0 + e * u
}

fn centroid(ps: &[XY]) -> Option<XY> {
    if ps.is_empty() { return None; }
    let n = ps.len() as f64;
    Some(XY::new(ps.iter().map(|p| p.x).sum::<f64>() / n, ps.iter().map(|p| p.y).sum::<f64>() / n))
}

fn unit(from: XY, to: XY) -> Option<XY> {
    let d = from.dist(to);
    if d < 1e-9 { None } else { Some(XY::new((to.x - from.x) / d, (to.y - from.y) / d)) }
}

pub fn picture(sim: &Sim, hq: u32, log: &DistLog) -> Picture {
    let w = &sim.world;
    let tick = w.tick;
    let me = &w.hqs[hq as usize];
    let enemy_side = me.side.enemy();
    let contact = sim.rules.contact_km;
    let recon = contact * RECON_X;
    let objective = objective_xy(sim, hq);
    let enemies: Vec<usize> = (0..w.divisions.len()).filter(|&i| w.divisions[i].side == enemy_side && !w.divisions[i].state.out()).collect();
    let army_hqs: Vec<u32> = (0..w.hqs.len() as u32).filter(|&h| w.hqs[h as usize].echelon == Echelon::Army && w.hqs[h as usize].side == me.side && under(sim, h, hq)).collect();
    let all_own: Vec<usize> = army_hqs.iter().flat_map(|&a| divisions_of(sim, a)).collect();
    let seen = |p: XY, own: &[usize]| own.iter().any(|&i| w.divisions[i].vars.pos.dist(p) <= recon);
    let front_axis: Option<&[XY]> = sim.command.intent.get(hq as usize).and_then(Option::as_ref).map(|d| d.axis.as_slice()).filter(|ax| ax.len() >= 2);

    let mut armies = Vec::new();
    let mut open_flanks = Vec::new();
    for &a in &army_hqs {
        let mine = divisions_of(sim, a);
        let pos: Vec<XY> = mine.iter().map(|&i| w.divisions[i].vars.pos).collect();
        let Some(c) = centroid(&pos) else { continue };
        let start = log.start.get(a as usize).copied().flatten();
        // продвижение — вдоль оси замысла штаба командующего; оси нет — смещение от исходного места
        let advance_km = match front_axis { Some(ax) => crate::command::agent::advance(start, c, ax), None => start.map_or(0.0, |s| c.dist(s)) };
        let (mut s, mut s0) = (0.0, 0.0);
        for d in &w.divisions {
            if d.state == State::Pending || d.state == State::Merged || !under(sim, d.hq, a) { continue; }
            s += sim.material_strength(d);
            s0 += d.vars.strength0;
        }
        let in_sight: Vec<usize> = enemies.iter().copied().filter(|&e| seen(w.divisions[e].vars.pos, &mine)).collect();
        let enemy_true: f64 = in_sight.iter().map(|&e| sim.strength(&w.divisions[e])).sum();
        let enemy_est = enemy_true * fog_mult(sim, a, tick);
        // ось наступления: смещение от исходного места; пока оно мало — на цель; иначе на противника в пределах разведки
        let toward_enemy = centroid(&in_sight.iter().map(|&e| w.divisions[e].vars.pos).collect::<Vec<_>>());
        let axis = if let (true, Some(s)) = (advance_km >= AXIS_MIN_KM, start) { unit(s, c) } else { objective.and_then(|o| unit(c, o)).or_else(|| toward_enemy.and_then(|e| unit(c, e))) };
        let ahead = |p: XY| axis.is_none_or(|u| (p.x - c.x) * u.x + (p.y - c.y) * u.y >= 0.0);
        let defended = in_sight.iter().any(|&e| {
            let ed = &w.divisions[e];
            matches!(ed.state, State::Defense(_)) && pos.iter().any(|&p| ahead(p) && p.dist(ed.vars.pos) <= contact)
        });
        // подвижная группа (до ввода и введённая) не прорывает оборону: её марш за главным ударом — не прорыв
        let mobile = matches!(sim.command.role_hq.get(a as usize), Some(Role::Mobile | Role::Committed));
        let broke_through = !mobile && advance_km >= sim.rules.doctrine_su.tank_commit_depth_km && !defended;
        let to_objective_km = objective.and_then(|o| pos.iter().map(|p| p.dist(o)).min_by(f64::total_cmp));
        // открытый фланг: противник сбоку или сзади, и ни одна дивизия соседних армий его не прикрывает
        if let Some(u) = axis {
            let covered = |p: XY| (0..w.divisions.len()).any(|i| { let o = &w.divisions[i]; o.side == me.side && !o.state.out() && !mine.contains(&i) && o.vars.pos.dist(p) <= contact });
            let open = in_sight.iter().any(|&e| {
                let p = w.divisions[e].vars.pos;
                if pos.iter().map(|q| q.dist(p)).fold(f64::INFINITY, f64::min) > recon { return false; }
                let d = c.dist(p);
                d > 1e-9 && ((p.x - c.x) * u.x + (p.y - c.y) * u.y) / d < 0.5 && !covered(p)
            });
            if open { open_flanks.push(a); }
        }
        armies.push(ArmyView { hq: a, advance_km, strength: if s0 > 0.0 { s / s0 } else { 0.0 }, enemy_est, enemy_true, to_objective_km, broke_through });
    }

    let enemy_reserves: Vec<(XY, f64)> = enemies.iter().copied()
        .filter(|&e| matches!(w.divisions[e].state, State::Reserve | State::March(_)) && seen(w.divisions[e].vars.pos, &all_own))
        .map(|e| (w.divisions[e].vars.pos, sim.strength(&w.divisions[e]) * fog_mult(sim, 0x8000_0000 | e as u32, tick))).collect();

    // котлы: противник без пути к своим, связные в пределах двойного соприкосновения
    let cut: Vec<usize> = enemies.iter().copied().filter(|&e| w.divisions[e].cut_since.is_some()).collect();
    let mut group = vec![usize::MAX; cut.len()];
    let mut n_groups = 0;
    for i in 0..cut.len() {
        if group[i] != usize::MAX { continue; }
        group[i] = n_groups;
        let mut stack = vec![i];
        while let Some(x) = stack.pop() {
            for j in 0..cut.len() {
                if group[j] == usize::MAX && w.divisions[cut[x]].vars.pos.dist(w.divisions[cut[j]].vars.pos) <= contact * 2.0 { group[j] = n_groups; stack.push(j); }
            }
        }
        n_groups += 1;
    }
    let own_armies: Vec<u32> = (0..w.hqs.len() as u32).filter(|&h| w.hqs[h as usize].echelon == Echelon::Army && w.hqs[h as usize].side == me.side).collect();
    let mut pockets = Vec::new();
    for g in 0..n_groups {
        let members: Vec<usize> = (0..cut.len()).filter(|&i| group[i] == g).map(|i| cut[i]).collect();
        if !members.iter().any(|&e| seen(w.divisions[e].vars.pos, &all_own)) { continue; }
        let Some(center) = centroid(&members.iter().map(|&e| w.divisions[e].vars.pos).collect::<Vec<_>>()) else { continue };
        let enemy_est = members.iter().map(|&e| sim.strength(&w.divisions[e]) * fog_mult(sim, 0x8000_0000 | e as u32, tick)).sum();
        // охватывающие армии: ближайшая и ближайшая с противоположной стороны котла
        let mut near: Vec<(f64, u32, XY)> = own_armies.iter().filter_map(|&a| {
            divisions_of(sim, a).into_iter().map(|i| w.divisions[i].vars.pos).min_by(|p, q| p.dist(center).total_cmp(&q.dist(center))).map(|p| (p.dist(center), a, p))
        }).filter(|x| x.0 <= recon * 2.0).collect();
        near.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        let Some(&(_, a1, p1)) = near.first() else { continue };
        let side = |p: XY| (p.x - center.x) * (p1.x - center.x) + (p.y - center.y) * (p1.y - center.y);
        let (by, gap_km) = match near.iter().skip(1).find(|x| side(x.2) < 0.0) {
            Some(&(_, a2, p2)) => (vec![a1, a2], p1.dist(p2)),
            None => {
                // одна сторона: просвет до земли, откуда противник ещё имеет путь к своим (как в поиске пути в pocket.rs)
                let reach = &w.reach[crate::staff::side_idx(enemy_side)];
                let gap = (0..reach.len()).filter(|&c| reach[c]).map(|c| sim.theatre.centers[c].dist(center)).min_by(f64::total_cmp).unwrap_or(f64::INFINITY);
                (vec![a1], gap)
            }
        };
        pockets.push(PocketView { center, enemy_est, gap_km, by });
    }

    // соперник — по сводке, отставшей на задержку сводок
    let rival = sim.rules.commanders.for_hq(&me.id).and_then(|p| p.rival.as_deref()).and_then(|rid| {
        let rp = sim.rules.commanders.profiles.iter().find(|p| p.id == rid)?;
        let as_of = tick.checked_sub(sim.rules.commanders.fog.report_delay_hours)?;
        let rh = (0..w.hqs.len() as u32).filter(|&h| rp.hqs.contains(&w.hqs[h as usize].id)).find(|&h| log.at(h, as_of).is_some())?;
        let (hour, km) = log.at(rh, as_of)?;
        Some(RivalView { hq: rh, to_objective_km: km, as_of: hour })
    });

    Picture { tick, armies, enemy_reserves, rival, open_flanks, pockets, to_objective_km: dist_to_objective(sim, hq) }
}
