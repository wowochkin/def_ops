//! Окружение (docs/plans/agents.md, 10т): путь к своим — от краёв театра в обход войск противника и его территории
//! вблизи его войск. Территория — след прошедших дивизий; вдали от войск противника она преградой не считается: за
//! советскими колоннами остаётся немецкая разметка, и рвущиеся вперёд танковые армии оказывались бы «в окружении». Дивизия, к которой пути нет дольше срока окружения, окружена: не получает подвоза (кроме гарнизонов
//! крепостей со складами), немецкие штабы по доктрине ведут её на прорыв к своим, без боеприпасов она сдаётся.

use std::collections::VecDeque;

use crate::geo::XY;
use crate::model::{AttackSub, Division, OrderKind, Side, State};
use crate::theatre::WATER;
use crate::world::{side_code, Event, Sim, World};

impl Sim {
    /// Клетки, до которых доходит путь стороны от краёв театра: не по воде без дороги, не ближе `zoc_km` к войскам
    /// противника и не по его территории ближе `hold_km` к его войскам; ближе `own_km` к своим войскам — путь есть. Второе — клетки ближе `hold_km` к войскам
    /// противника (там его территорию держат). Соседство — по сторонам клетки: по диагонали между двумя клетками
    /// противника путь не проходит.
    pub(crate) fn reach_of(&self, w: &World, side: Side) -> (Vec<bool>, Vec<bool>) {
        let t = &*self.theatre;
        let n = t.centers.len();
        let p = &self.rules.pocket;
        let enemy = side_code(side.enemy());
        let cell = if n > 1 { t.centers[0].dist(t.centers[1]).max(0.1) } else { 1.0 };
        let mut blocked: Vec<bool> = (0..n).map(|c| t.terrain[c] == WATER && t.road[c] == 0).collect();
        // зона войск противника — сплошь; его территория — только вблизи его войск (там её держат)
        let mut near_enemy = vec![false; n];
        let mark = |pos: XY, km: f64, out: &mut Vec<bool>| {
            let Some(c) = t.cell_of_xy(pos) else { return };
            let rc = (km / cell).ceil() as i32;
            let (col, row) = ((c % t.cols) as i32, (c / t.cols) as i32);
            for dr in -rc..=rc {
                for dc in -rc..=rc {
                    let (cc, rr) = (col + dc, row + dr);
                    if cc < 0 || rr < 0 || cc >= t.cols as i32 || rr >= t.rows as i32 { continue; }
                    let k = rr as usize * t.cols + cc as usize;
                    if t.centers[k].dist(pos) <= km { out[k] = true; }
                }
            }
        };
        for d in w.divisions.iter().filter(|d| d.side != side && !d.state.out() && d.state != State::Remnant) {
            mark(d.vars.pos, p.zoc_km, &mut blocked);
            mark(d.vars.pos, p.hold_km, &mut near_enemy);
        }
        for c in 0..n { if near_enemy[c] && w.control[c] == enemy { blocked[c] = true; } }
        // где стоят свои войска, путь есть: цепочка своих дивизий держит коридор и среди войск противника (город)
        let mut own = vec![false; n];
        for d in w.divisions.iter().filter(|d| d.side == side && !d.state.out() && d.state != State::Remnant) {
            mark(d.vars.pos, p.own_km, &mut own);
        }
        for c in 0..n { if own[c] && !(t.terrain[c] == WATER && t.road[c] == 0) { blocked[c] = false; } }
        let mut seen = vec![false; n];
        let mut q = VecDeque::new();
        for c in 0..n {
            let (col, row) = (c % t.cols, c / t.cols);
            // край театра — свой тыл, только где территория не противника (восток театра — советский тыл)
            if (col == 0 || row == 0 || col + 1 == t.cols || row + 1 == t.rows) && !blocked[c] && w.control[c] != enemy { seen[c] = true; q.push_back(c); }
        }
        while let Some(c) = q.pop_front() {
            for k in [0, 2, 4, 6] {
                if let Some(nb) = t.neighbor(c, k) {
                    if !seen[nb] && !blocked[nb] { seen[nb] = true; q.push_back(nb); }
                }
            }
        }
        (seen, near_enemy)
    }

    /// Есть ли путь к своим в пределах `link_km` от точки.
    fn linked(&self, reach: &[bool], p: XY) -> bool {
        let t = &*self.theatre;
        let km = self.rules.pocket.link_km;
        let Some(c) = t.cell_of_xy(p) else { return true };
        let cell = if t.centers.len() > 1 { t.centers[0].dist(t.centers[1]).max(0.1) } else { 1.0 };
        let rc = (km / cell).ceil() as i32;
        let (col, row) = ((c % t.cols) as i32, (c / t.cols) as i32);
        for dr in -rc..=rc {
            for dc in -rc..=rc {
                let (cc, rr) = (col + dc, row + dr);
                if cc < 0 || rr < 0 || cc >= t.cols as i32 || rr >= t.rows as i32 { continue; }
                let k = rr as usize * t.cols + cc as usize;
                if reach[k] && t.centers[k].dist(p) <= km { return true; }
            }
        }
        false
    }

    /// Ближайшая к точке клетка, до которой доходит путь к своим (цель прорыва).
    pub(crate) fn nearest_linked(&self, w: &World, side: Side, p: XY) -> Option<XY> {
        let reach = &w.reach[crate::staff::side_idx(side)];
        let t = &*self.theatre;
        (0..reach.len()).filter(|&c| reach[c]).map(|c| (t.centers[c], t.centers[c].dist(p))).min_by(|a, b| a.1.total_cmp(&b.1)).map(|x| x.0)
    }

    /// Окружена ли дивизия к шагу `tick` (путь к своим отрезан не меньше срока окружения).
    pub fn encircled(&self, d: &Division, tick: u32) -> bool {
        d.cut_since.is_some_and(|s| tick.saturating_sub(s) as f64 >= self.rules.pocket.encircle_hours)
    }

    /// Пересчёт путей к своим, начало и конец окружения, выход из котла, капитуляция.
    pub(crate) fn apply_pockets(&self, w: &mut World, journal: &mut Vec<Event>) {
        let tick = w.tick;
        let p = &self.rules.pocket;
        let (su, held_by_de) = self.reach_of(w, Side::Su);
        let (de, held_by_su) = self.reach_of(w, Side::De);
        let reach = [su, de];
        for i in 0..w.divisions.len() {
            if w.divisions[i].state.out() { continue; }
            let cut = !self.linked(&reach[crate::staff::side_idx(w.divisions[i].side)], w.divisions[i].vars.pos);
            let was = self.encircled(&w.divisions[i], tick);
            let d = &mut w.divisions[i];
            match (cut, d.cut_since) {
                (true, None) => d.cut_since = Some(tick),
                (true, Some(s)) => {
                    d.relink_since = None;
                    if (tick - s) as f64 == p.encircle_hours {
                        journal.push(Event { tick, agent: i as u32, text: format!("окружена: пути к своим нет {:.0} ч — подвоза нет", p.encircle_hours) });
                    }
                }
                (false, Some(_)) if !was => d.cut_since = None,
                (false, Some(s)) => {
                    // окружение снимается, когда путь к своим держится release_hours подряд: разовая брешь — не выход
                    let r0 = *d.relink_since.get_or_insert(tick);
                    if (tick - r0) as f64 >= p.release_hours {
                        // вырвавшиеся бросают тяжёлое вооружение (9 А вышла к 12 А без техники, LT_HALBE)
                        let breakout = d.side == Side::De && d.order.as_ref().is_some_and(|o| o.kind == OrderKind::Attack);
                        if breakout {
                            d.vars.tanks *= p.breakout_keep;
                            d.vars.guns *= p.breakout_keep;
                        }
                        journal.push(Event { tick, agent: i as u32, text: format!("путь к своим восстановлен после {} ч окружения{}", r0 - s,
                            if breakout { format!(" — вышла с прорывом, вынесла {:.0} % танков и орудий", p.breakout_keep * 100.0) } else { String::new() }) });
                        d.cut_since = None;
                        d.relink_since = None;
                    }
                }
                (false, None) => {}
            }
            // капитуляция: окружённая немецкая дивизия без складов и боеприпасов (Красная армия 1945 г. в окружении не сдавалась)
            let d = &w.divisions[i];
            if d.side == Side::De && d.params.kind != "garrison" && d.vars.ammo < p.surrender_ammo {
                if let Some(s) = d.cut_since {
                    let h = (tick - s) as f64;
                    let firm = d.order.as_ref().is_some_and(|o| matches!(o.kind, OrderKind::Hold | OrderKind::Attack));
                    let limit = if firm { p.surrender_hours_firm } else { p.surrender_hours };
                    if h >= limit {
                        let d = &mut w.divisions[i];
                        journal.push(Event { tick, agent: i as u32, text: format!("{} → {}: окружена {:.0} ч, боеприпасов {:.2} бк — капитуляция, в плен около {:.0} человек",
                            d.state.label(), State::Destroyed.label(), h, d.vars.ammo, d.vars.personnel) });
                        d.state = State::Destroyed;
                        d.state_since = tick;
                    }
                }
            }
        }
        w.reach = reach;
        w.held = [held_by_su, held_by_de];
    }

    /// Потери прорывающихся из окружения, пока рядом противник: колонны идут через его огонь (из котла у Хальбе к 12 А
    /// дошли ~30 тыс., оставлено ~13 тыс. пленными и >5 тыс. убитыми — около 40 % за ~2,6 сут, LT_HALBE гл. 13).
    pub(crate) fn apply_breakout_losses(&self, w: &mut World) {
        let p = &self.rules.pocket;
        let reach = self.rules.contact_km + p.zoc_km;
        let hits: Vec<usize> = (0..w.divisions.len()).filter(|&i| {
            let d = &w.divisions[i];
            d.state == State::Attack(AttackSub::Breakout) && w.divisions.iter().any(|e| e.side != d.side && !e.state.out() && e.state != State::Remnant && e.vars.pos.dist(d.vars.pos) <= reach)
        }).collect();
        for i in hits {
            crate::world::lose(&mut w.divisions[i], p.breakout_loss_day / 24.0, 1.0, &self.rules.combat);
        }
    }
}
