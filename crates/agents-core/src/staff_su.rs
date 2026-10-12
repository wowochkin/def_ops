//! Советские штабы по доктрине (docs/plans/agents.md, раздел 10о): исторические задачи сценария — замысел армии (куда
//! наступать), а кем и когда — решает штаб армии по правилам советской доктрины наступления 1944–45 гг.
//! (docs/sources/soviet-offensive-doctrine-1945-tsamo.json и soviet-offensive-doctrine-1945.json; числа — data/rules/agents-v0.json, раздел doctrine.su):
//! - стрелковые дивизии армии — в два эшелона: две трети, ближние к противнику, атакуют сразу, остальные ждут;
//! - второй эшелон вводится, когда первый прорвал главную полосу (продвинулся на глубину ближайшей задачи корпуса)
//!   или на 2–3-й день, а дивизия второго эшелона — на смену остановившейся дивизии первого;
//! - танковая армия (подвижная группа) вводится после прорыва тактической зоны соседними стрелковыми дивизиями,
//!   а если его нет за установленный срок — для завершения прорыва;
//! - задачи, кроме наступления (оборона, выдвижение, отход), доводятся как есть.

use crate::geo::XY;
use crate::model::*;
use crate::world::{ScriptOrder, Sim, World};
use crate::staff::Decision;

/// Замысел армии для дивизии: последняя задача сценария.
#[derive(Clone, Debug)]
pub struct Plan {
    pub kind: OrderKind,
    pub target: XY,
    pub forced: bool,
    pub note: String,
}

/// Место дивизии в построении армии.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Ech {
    #[default]
    Unset,
    First,
    Second,
    Mobile,
    Committed,
}

#[derive(Default)]
pub struct SuStaff {
    pub plan: Vec<Option<Plan>>,
    pub ech: Vec<Ech>,
    /// Положение дивизии, когда она получила первую задачу, — от него считается продвижение.
    pub start: Vec<Option<XY>>,
    pub since: Vec<u32>,
    pub replaced: Vec<bool>,
}

impl SuStaff {
    fn fit(&mut self, n: usize) {
        if self.plan.len() < n {
            self.plan.resize(n, None);
            self.ech.resize(n, Ech::Unset);
            self.start.resize(n, None);
            self.since.resize(n, 0);
            self.replaced.resize(n, false);
        }
    }
}

fn mobile(d: &Division) -> bool { matches!(d.params.kind.as_str(), "tk" | "mk" | "brigade" | "kd" | "stug") }

impl Sim {
    /// Задача сценария советской дивизии в режиме «по доктрине»: замысел; дивизиям, уже введённым в бой, и задачи
    /// не на наступление — сразу, остальным — по решению штаба (su_doctrine_hq).
    pub(crate) fn su_plan(&self, w: &World, o: &ScriptOrder, due: &mut Vec<ScriptOrder>) {
        let Ok(mut st) = self.su_staff.lock() else { return };
        st.fit(w.divisions.len());
        let follow_at = o.follow.as_deref().and_then(|f| self.place_of(w, f));
        for &d in &o.to {
            let i = d as usize;
            let pos = w.divisions[i].vars.pos;
            let target = match follow_at { Some(c) => XY::new(c.x + o.offset.x, c.y + o.offset.y), None => o.target.unwrap_or(pos) };
            st.plan[i] = Some(Plan { kind: o.kind, target, forced: o.forced, note: o.note.clone() });
            if st.start[i].is_none() { st.start[i] = Some(pos); }
            if o.kind != OrderKind::Attack || matches!(st.ech[i], Ech::First | Ech::Committed) {
                due.push(ScriptOrder { to: vec![d], target: Some(target), follow: None, offset: XY::default(), ..o.clone() });
            }
        }
    }

    /// Решение штаба армии по советской доктрине.
    pub(crate) fn su_doctrine_hq(&self, w: &World, tick: u32, h: usize, subs: &[usize]) -> Decision {
        let doc = &self.rules.doctrine_su;
        let mut dec = Decision { orders: Vec::new(), why: Vec::new() };
        let Ok(mut st) = self.su_staff.lock() else { return dec };
        st.fit(w.divisions.len());
        let attack_plan = |st: &SuStaff, i: usize| st.plan[i].as_ref().is_some_and(|p| p.kind == OrderKind::Attack);
        let enemy_km = |i: usize| w.divisions.iter().filter(|e| e.side != w.divisions[i].side && !e.state.out()).map(|e| e.vars.pos.dist(w.divisions[i].vars.pos)).fold(f64::INFINITY, f64::min);
        // продвижение от исходного к цели замысла, км
        let advance = |st: &SuStaff, i: usize| -> f64 {
            let (Some(s), Some(p)) = (st.start[i], st.plan[i].as_ref()) else { return 0.0 };
            let (tx, ty) = (p.target.x - s.x, p.target.y - s.y);
            let l = (tx * tx + ty * ty).sqrt();
            let q = w.divisions[i].vars.pos;
            if l < 1e-6 { return 0.0 }
            ((q.x - s.x) * tx + (q.y - s.y) * ty) / l
        };
        let give = |st: &mut SuStaff, i: usize, why: String, dec: &mut Decision| {
            if let Some(p) = st.plan[i].clone() { self.order_for(w, tick, h, i, p.kind, p.target, format!("{why}; задача: {}", p.note), "доктрина", dec); }
        };
        let mobile_army = subs.iter().filter(|&&i| mobile(&w.divisions[i])).count() * 2 >= subs.len().max(1);

        // построение: кто ещё не распределён
        let unset: Vec<usize> = subs.iter().copied().filter(|&i| st.ech[i] == Ech::Unset && attack_plan(&st, i)).collect();
        if mobile_army {
            for &i in &unset { st.ech[i] = Ech::Mobile; st.since[i] = tick; dec.why.push(format!("{} — подвижная группа: ждёт прорыва тактической зоны", w.divisions[i].name)); }
        } else {
            let (mut rifle, npp): (Vec<usize>, Vec<usize>) = unset.iter().partition(|&&i| !mobile(&w.divisions[i]));
            for &i in &npp { st.ech[i] = Ech::First; give(&mut st, i, "танки непосредственной поддержки пехоты — с первым эшелоном".into(), &mut dec); }
            rifle.sort_by(|&a, &b| enemy_km(a).total_cmp(&enemy_km(b)).then(a.cmp(&b)));
            let n1 = ((rifle.len() as f64) * doc.first_echelon_share).ceil() as usize;
            for (k, &i) in rifle.iter().enumerate() {
                if k < n1 { st.ech[i] = Ech::First; give(&mut st, i, "первый эшелон армии".into(), &mut dec); }
                else { st.ech[i] = Ech::Second; st.since[i] = tick; dec.why.push(format!("{} — второй эшелон армии: ждёт прорыва главной полосы или смены", w.divisions[i].name)); }
            }
        }

        // ввод второго эшелона
        let first: Vec<usize> = subs.iter().copied().filter(|&i| st.ech[i] == Ech::First && attack_plan(&st, i)).collect();
        let mut second: Vec<usize> = subs.iter().copied().filter(|&i| st.ech[i] == Ech::Second).collect();
        if !first.is_empty() && !second.is_empty() {
            let mean = first.iter().map(|&i| advance(&st, i)).sum::<f64>() / first.len() as f64;
            let waited = second.iter().map(|&i| tick.saturating_sub(st.since[i])).min().unwrap_or(0) as f64;
            if mean >= doc.commit_depth_km || waited >= doc.second_echelon_fallback_hours {
                let why = if mean >= doc.commit_depth_km { format!("первый эшелон продвинулся на {mean:.1} км — главная полоса прорвана, ввод второго эшелона") }
                    else { format!("{waited:.0} ч в ожидании — второй эшелон вводится на 2–3-й день (продвижение первого {mean:.1} км)") };
                for &i in &second { st.ech[i] = Ech::Committed; give(&mut st, i, why.clone(), &mut dec); }
                second.clear();
            } else {
                // смена остановившейся дивизии первого эшелона ближайшей дивизией второго
                for &i in &first {
                    let d = &w.divisions[i];
                    let stalled = matches!(d.state, State::Defense(_)) && enemy_km(i) <= self.rules.contact_km + 4.0;
                    if !stalled || st.replaced[i] || second.is_empty() { continue; }
                    let k = (0..second.len()).min_by(|&a, &b| w.divisions[second[a]].vars.pos.dist(d.vars.pos).total_cmp(&w.divisions[second[b]].vars.pos.dist(d.vars.pos))).unwrap();
                    let j = second.remove(k);
                    st.replaced[i] = true;
                    st.ech[j] = Ech::Committed;
                    give(&mut st, j, format!("{} остановилась ({}) — смена вторым эшелоном", d.name, d.state.label()), &mut dec);
                }
            }
        }

        // ввод подвижной группы: соседние стрелковые дивизии прорвали тактическую зону
        let mob: Vec<usize> = subs.iter().copied().filter(|&i| st.ech[i] == Ech::Mobile).collect();
        for &i in &mob {
            let p = w.divisions[i].vars.pos;
            let broke = (0..w.divisions.len()).filter(|&j| { let e = &w.divisions[j]; e.side == w.divisions[i].side && !mobile(e) && !e.state.out() && e.vars.pos.dist(p) <= 25.0 })
                .map(|j| advance(&st, j)).fold(0.0, f64::max);
            let waited = (tick - st.since[i]) as f64;
            let why = if broke >= doc.tank_commit_depth_km { Some(format!("стрелковые дивизии рядом продвинулись на {broke:.1} км — тактическая зона прорвана, ввод подвижной группы")) }
                else if waited >= doc.tank_commit_fallback_hours { Some(format!("за {waited:.0} ч тактическая зона не прорвана (продвижение {broke:.1} км) — ввод для завершения прорыва")) }
                else { None };
            if let Some(why) = why { st.ech[i] = Ech::Committed; give(&mut st, i, why, &mut dec); }
        }
        dec
    }
}
