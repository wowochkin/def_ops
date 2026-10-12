//! Штабы, решающие сами (docs/plans/agents.md, раздел 5): источник решений выбирается для каждой стороны —
//! исторические приказы сценария или штабы «по доктрине». Штаб по доктрине раз в цикл управления оценивает
//! обстановку по своим дивизиям и отдаёт приказы: держаться, контратаковать резервом, закрыть прорыв, отойти на
//! следующий рубеж. Правила и числа — data/rules/agents-v0.json, раздел doctrine; каждое решение — в журнале
//! с обоснованием.

use crate::geo::XY;
use crate::model::*;
use crate::world::{Event, ScriptOrder, Sim, World};

/// Источник решений штабов стороны.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// Приказы сценария (исторические задачи).
    Script,
    /// Штабы по доктрине стороны.
    Doctrine,
}

/// Оценка дивизии штабом.
struct Assess {
    i: usize,
    strength: f64,
    /// Сила противника в досягаемости, к своей силе.
    threat: f64,
    broken: bool,
}

impl Sim {
    /// Решения штабов по доктрине на шаг `tick`: приказы (с задержкой доведения — как у приказов сценария) и записи журнала.
    pub fn doctrine_orders(&self, w: &World, tick: u32) -> (Vec<ScriptOrder>, Vec<Event>) {
        let doc = &self.rules.doctrine;
        let mut orders = Vec::new();
        let mut journal = Vec::new();
        let cycle = doc.cycle_hours.max(1.0) as u32;
        for (h, hq) in w.hqs.iter().enumerate() {
            if self.sources[side_idx(hq.side)] != Source::Doctrine { continue; }
            // цикл управления; штабы разнесены по часам, чтобы не решать все разом
            if (tick + h as u32) % cycle != 0 && tick != 0 { continue; }
            let subs: Vec<usize> = (0..w.divisions.len()).filter(|&i| w.divisions[i].hq as usize == h && w.divisions[i].state != State::Destroyed).collect();
            if subs.is_empty() { continue; }
            let a: Vec<Assess> = subs.iter().map(|&i| self.assess(w, i)).collect();
            let mut why: Vec<String> = Vec::new();
            let mut issue = |i: usize, kind: OrderKind, target: XY, note: String, why: &mut Vec<String>| {
                let d = &w.divisions[i];
                // не повторять тот же приказ
                if let Some(o) = &d.order { if o.kind == kind && o.target.dist(target) < 2.0 { return; } }
                why.push(format!("{} — {}: {}", d.name, kind.label(), note));
                orders.push(ScriptOrder { at: tick, hq: h as u32, to: vec![i as u32], kind, target: Some(target), forced: false, note: format!("решение штаба по доктрине: {note}") });
            };
            // прорывы на полосе штаба: дивизия противника глубже нашей дивизии (у неё в тылу) — часть главной позиции
            // потеряна (TM-E 30-451, A); ответ — немедленная контратака резервом во фланг вклинения, если резерва хватает
            // (не меньше 1/3 прорвавшегося — DA Pam 20-233, с. 9, B), иначе — закрыть направление рубежом за ней
            let pens: Vec<(usize, usize)> = a.iter().filter_map(|x| self.penetrator(w, x.i).map(|e| (x.i, e))).collect();
            let mut used: Vec<usize> = Vec::new();
            for x in &a {
                let d = &w.divisions[x.i];
                let pen = pens.iter().find(|p| p.0 == x.i).map(|p| p.1);
                if x.broken || pen.is_some() {
                    // разбита или обойдена: отход на следующий рубеж (угроза охвата — последовательные позиции через 8–10 км,
                    // DA Pam 20-233, с. 64–70, B); при приказе «держаться» — держаться
                    let why_txt = if let Some(e) = pen { format!("в тылу — {} (угроза охвата)", w.divisions[e].name) } else {
                        format!("боевая сила {:.0} % от исходной, организованность {:.2}", 100.0 * x.strength / d.vars.strength0.max(1e-9), d.vars.cohesion) };
                    if doc.hold_orders {
                        issue(x.i, OrderKind::Hold, d.vars.pos, format!("{why_txt}; приказ «держаться» (Haltebefehl) — отход запрещён"), &mut why);
                    } else {
                        let t = self.line_behind(w, x.i);
                        issue(x.i, OrderKind::Withdraw, t, format!("{why_txt} — отход на следующий рубеж"), &mut why);
                    }
                } else if x.threat > 0.0 {
                    let kind = if doc.hold_orders { OrderKind::Hold } else { OrderKind::Defend };
                    issue(x.i, kind, d.vars.pos, format!("противник в соприкосновении, его сила в досягаемости — {:.1} от своей; удерживать полосу", x.threat), &mut why);
                } else if let Some(&(hit, e)) = pens.iter().filter(|p| !used.contains(&p.1)).min_by(|p, q| w.divisions[p.1].vars.pos.dist(d.vars.pos).total_cmp(&w.divisions[q.1].vars.pos.dist(d.vars.pos))) {
                    let es = self.strength(&w.divisions[e]);
                    let ratio = x.strength / es.max(1e-9);
                    if ratio >= doc.counterattack_ratio {
                        used.push(e);
                        issue(x.i, OrderKind::Attack, w.divisions[e].vars.pos, format!("контратака во фланг вклинения: {} в тылу у {}, своих сил к прорвавшимся {:.2}", w.divisions[e].name, w.divisions[hit].name, ratio), &mut why);
                    } else {
                        let block = self.behind(w, hit, doc.block_depth_km);
                        issue(x.i, OrderKind::Defend, block, format!("сил для контратаки мало ({:.2} к прорвавшимся {}) — занять рубеж за {}", ratio, w.divisions[e].name, w.divisions[hit].name), &mut why);
                    }
                }
            }
            if !why.is_empty() {
                journal.push(Event { tick, agent: u32::MAX, text: format!("штаб «{}» (по доктрине): {}", hq.name, why.join("; ")) });
            }
        }
        (orders, journal)
    }

    fn assess(&self, w: &World, i: usize) -> Assess {
        let d = &w.divisions[i];
        let doc = &self.rules.doctrine;
        let reach = self.rules.contact_km + self.rules.combat.defense_frontage_km(d) / 2.0;
        let enemy_strength: f64 = w.divisions.iter()
            .filter(|e| e.side != d.side && e.state != State::Destroyed && e.vars.pos.dist(d.vars.pos) <= reach)
            .map(|e| self.strength(e)).sum();
        let strength = self.strength(d);
        let broken = strength / d.vars.strength0.max(1e-9) < doc.withdraw_strength_share || d.vars.cohesion < doc.withdraw_cohesion;
        Assess { i, strength, threat: enemy_strength / strength.max(1e-9), broken }
    }

    /// Направление «в тыл» каждой дивизии по исходной обстановке (от центра противника в 20 км к дивизии) и исходная
    /// глубина противника в её полосе — неизменны в прогоне: на плацдарме, где противник охватывает с трёх сторон, а
    /// дивизии — точки в центре своих районов, «тыл» и «прорыв» иначе сбиваются.
    fn fronts(&self, w: &World) -> &Vec<(XY, f64)> {
        self.rear_dir.get_or_init(|| (0..w.divisions.len()).map(|i| {
            let p = w.divisions[i].vars.pos;
            let c = self.enemy_center(w, i);
            let (dx, dy) = (p.x - c.x, p.y - c.y);
            let l = (dx * dx + dy * dy).sqrt();
            let r = if l < 1e-6 { XY::new(-1.0, 0.0) } else { XY::new(dx / l, dy / l) };
            let base = self.depths(w, i, r).map(|x| x.1).fold(f64::NEG_INFINITY, f64::max);
            (r, base)
        }).collect())
    }

    /// Глубина дивизий противника в полосе дивизии (полполосы и 2 км по фронту, до 15 км) вдоль направления «в тыл».
    fn depths<'a>(&'a self, w: &'a World, i: usize, r: XY) -> impl Iterator<Item = (usize, f64)> + 'a {
        let d = &w.divisions[i];
        let half = self.rules.combat.defense_frontage_km(d) / 2.0 + 2.0;
        w.divisions.iter().enumerate()
            .filter(move |(_, e)| e.side != d.side && e.state != State::Destroyed)
            .filter_map(move |(j, e)| {
                let (dx, dy) = (e.vars.pos.x - d.vars.pos.x, e.vars.pos.y - d.vars.pos.y);
                let depth = dx * r.x + dy * r.y;
                let lateral = (-dx * r.y + dy * r.x).abs();
                (lateral <= half && depth < 15.0 && depth > -15.0).then_some((j, depth))
            })
    }

    /// Прорвавшийся: дивизия противника в полосе дивизии, продвинувшаяся вглубь дальше исходной глубины противника
    /// в этой полосе на глубину главной полосы обороны (5–6 км, БУП-42 §619, A) — главная полоса прорвана.
    fn penetrator(&self, w: &World, i: usize) -> Option<usize> {
        let (r, base) = self.fronts(w)[i];
        let base = if base.is_finite() { base } else { -6.0 };
        let need = base + self.rules.doctrine.penetration_depth_km;
        self.depths(w, i, r).filter(|x| x.1 > need).max_by(|x, y| x.1.total_cmp(&y.1).then(y.0.cmp(&x.0))).map(|x| x.0)
    }

    /// Центр противника вокруг дивизии (в 20 км; если никого — всех).
    fn enemy_center(&self, w: &World, i: usize) -> XY {
        let d = &w.divisions[i];
        let pick = |lim: f64| -> Option<XY> {
            let v: Vec<XY> = w.divisions.iter().filter(|e| e.side != d.side && e.state != State::Destroyed && e.vars.pos.dist(d.vars.pos) <= lim).map(|e| e.vars.pos).collect();
            if v.is_empty() { None } else { Some(XY::new(v.iter().map(|p| p.x).sum::<f64>() / v.len() as f64, v.iter().map(|p| p.y).sum::<f64>() / v.len() as f64)) }
        };
        pick(20.0).or_else(|| pick(f64::INFINITY)).unwrap_or(d.vars.pos)
    }

    /// Точка в `km` за дивизией (по направлению «в тыл» исходной обстановки).
    fn behind(&self, w: &World, i: usize, km: f64) -> XY {
        let p = w.divisions[i].vars.pos;
        let r = self.fronts(w)[i].0;
        XY::new(p.x + r.x * km, p.y + r.y * km)
    }

    /// Следующий свой рубеж (укреплённая полоса театра) за дивизией; если его нет — точка в withdraw_step_km за ней.
    fn line_behind(&self, w: &World, i: usize) -> XY {
        let d = &w.divisions[i];
        let t = &*self.theatre;
        let side = match d.side { Side::Su => "su", Side::De => "de" };
        let c = self.enemy_center(w, i);
        let here = d.vars.pos.dist(c);
        let mut best: Option<(XY, f64)> = None;
        for l in t.lines.iter().filter(|l| l.side.as_deref() == Some(side) && l.fortification.unwrap_or(0) > 0) {
            for p in l.line.iter().map(|p| t.proj.to_xy(*p)) {
                if p.dist(c) < here + 2.0 { continue; } // не позади
                let k = p.dist(d.vars.pos);
                if best.map_or(true, |(_, b)| k < b) { best = Some((p, k)); }
            }
        }
        best.map(|b| b.0).unwrap_or_else(|| self.behind(w, i, self.rules.doctrine.withdraw_step_km))
    }
}

pub fn side_idx(s: Side) -> usize { match s { Side::Su => 0, Side::De => 1 } }
