//! Советские штабы по доктрине (docs/plans/agents.md, раздел 10о): исторические задачи сценария — замысел армии (куда
//! наступать), а кем и когда — решает штаб армии по правилам советской доктрины наступления 1944–45 гг.
//! (docs/sources/soviet-offensive-doctrine-1945-tsamo.json и soviet-offensive-doctrine-1945.json; числа — data/rules/agents-v0.json, раздел doctrine.su):
//! - стрелковые дивизии армии — в два эшелона: две трети, ближние к противнику, атакуют сразу, остальные ждут;
//! - второй эшелон вводится, когда первый прорвал главную полосу (продвинулся на глубину ближайшей задачи корпуса)
//!   или на 2–3-й день, а дивизия второго эшелона — на смену остановившейся дивизии первого;
//! - танковая армия (подвижная группа) вводится после прорыва тактической зоны соседними стрелковыми дивизиями,
//!   а если его нет за установленный срок — для завершения прорыва;
//! - задачи, кроме наступления (оборона, выдвижение, отход), доводятся как есть.
//!
//! На языковой модели (su_llm_hq) решает штаб армии за все её дивизии: та же обстановка (замысел, эшелон, продвижение,
//! противник рядом) и правила доктрины в подсказке; при сбое модели — по доктрине.

use crate::geo::XY;
use crate::model::*;
use crate::world::{ScriptOrder, Sim, World};
use crate::staff::Decision;
use crate::llm;
use serde_json::{json, Value};

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

    /// Решение штаба армии на языковой модели: кем и когда наступать на цели замысла.
    pub(crate) fn su_llm_hq(&self, w: &World, tick: u32, lead: usize, groups: &[(usize, Vec<usize>)], cfg: &llm::LlmConfig) -> Result<Decision, String> {
        let doc = &self.rules.doctrine_su;
        let hq = &w.hqs[lead];
        let km1 = |x: f64| (x * 10.0).round() / 10.0;
        let all: Vec<usize> = groups.iter().flat_map(|g| g.1.iter().copied()).collect();
        let situation = {
            let Ok(mut st) = self.su_staff.lock() else { return Err("штаб занят".into()) };
            st.fit(w.divisions.len());
            let divs: Vec<Value> = all.iter().map(|&i| {
                let d = &w.divisions[i];
                let plan = st.plan[i].as_ref();
                let advance = match (st.start[i], plan) {
                    (Some(s0), Some(p)) => { let (tx, ty) = (p.target.x - s0.x, p.target.y - s0.y); let l = (tx * tx + ty * ty).sqrt().max(1e-6); ((d.vars.pos.x - s0.x) * tx + (d.vars.pos.y - s0.y) * ty) / l }
                    _ => 0.0,
                };
                let mut enemies: Vec<(usize, f64)> = w.divisions.iter().enumerate().filter(|(_, e)| e.side != d.side && !e.state.out())
                    .map(|(j, e)| (j, e.vars.pos.dist(d.vars.pos))).filter(|x| x.1 <= 15.0).collect();
                enemies.sort_by(|a, b| a.1.total_cmp(&b.1));
                json!({
                    "id": d.id, "name": d.name, "type": if mobile(d) { "подвижная (танки, мехпехота, конница)" } else { "стрелковая" },
                    "state": d.state.label(), "people": d.vars.personnel.round(), "tanks": d.vars.tanks.round(),
                    "strength_pct_of_initial": (100.0 * self.strength(d) / d.vars.strength0.max(1e-9)).round(), "ammo": km1(d.vars.ammo),
                    "echelon": match st.ech[i] { Ech::Unset => "не распределена", Ech::First => "первый эшелон", Ech::Second => "второй эшелон (ждёт)", Ech::Mobile => "подвижная группа (ждёт ввода)", Ech::Committed => "введена в бой" },
                    "objective": plan.filter(|p| p.kind == OrderKind::Attack).map(|p| json!({ "task": p.note, "km_to_objective": km1(p.target.dist(d.vars.pos)), "advanced_km": km1(advance) })),
                    "current_order": d.order.as_ref().map(|o| o.kind.label()),
                    "enemies_within_15km": enemies.iter().take(4).map(|&(j, k)| json!({ "id": w.divisions[j].id, "name": w.divisions[j].name, "km": km1(k), "state": w.divisions[j].state.label() })).collect::<Vec<_>>(),
                })
            }).collect();
            json!({ "divisions": divs })
        };
        let system = format!(
            "Ты — начальник штаба армии «{}» в Берлинской операции, апрель 1945 года. Раз в {} ч ты решаешь, какие дивизии армии наступают на цели замысла армии, какие ждут, какие закрепляются.\nДействуй по советской доктрине наступления 1944–45 гг.: стрелковые дивизии — в два эшелона, около {:.0} % в первом; второй эшелон вводится, когда первый продвинулся на глубину главной полосы ({:.0} км) или на 2–3-й день, а дивизия второго эшелона — на смену остановившейся; подвижную группу (танковую армию, корпус) вводят после прорыва тактической зоны ({:.0} км) или для завершения прорыва, если его нет за {:.0} ч; узел, где атака не идёт, — обходить; не штурмовать с ходу неподавленного противника, а закрепиться и атаковать утром после артподготовки.\nДоступные действия: attack — наступать на цель замысла (objective); attack_enemy — атаковать дивизию противника (target — её id); wait — ждать во втором эшелоне или в резерве; defend — закрепиться на месте.\nОтветь только JSON без пояснений вокруг: {}. По дивизии, которой приказ не меняешь, приказ не давай.",
            hq.name, doc.cycle_hours, doc.first_echelon_share * 100.0, doc.commit_depth_km, doc.tank_commit_depth_km, doc.tank_commit_fallback_hours, SU_REPLY_FORMAT);
        let time = crate::time::format_hours(self.start_hour + tick as i64);
        let user = format!("Время: {time} (МСК). Обстановка по дивизиям армии (strength_pct — от исходной; advanced_km — продвижение к цели от исходного положения):\n{situation}");
        let list = self.ask_staff(tick, hq, system, user, cfg)?;
        let mut dec = Decision { orders: Vec::new(), why: Vec::new() };
        let Ok(mut st) = self.su_staff.lock() else { return Ok(dec) };
        let id_of = |s: &str| w.divisions.iter().position(|d| d.id == s);
        for o in &list {
            let Some(i) = o.get("division").and_then(Value::as_str).and_then(id_of) else { continue };
            let Some(h) = groups.iter().find(|g| g.1.contains(&i)).map(|g| g.0) else { continue };
            let d = &w.divisions[i];
            let reason = o.get("reason").and_then(Value::as_str).unwrap_or("").to_string();
            match o.get("action").and_then(Value::as_str).unwrap_or("") {
                "attack" => match st.plan[i].clone().filter(|p| p.kind == OrderKind::Attack) {
                    Some(p) => { st.ech[i] = if st.ech[i] == Ech::Unset { Ech::First } else { Ech::Committed }; self.order_for(w, tick, h, i, OrderKind::Attack, p.target, format!("{reason}; задача: {}", p.note), "модель", &mut dec) }
                    None => dec.why.push(format!("{} — отклонено: у дивизии нет цели наступления", d.name)),
                },
                "attack_enemy" => match o.get("target").and_then(Value::as_str).and_then(id_of) {
                    Some(j) if w.divisions[j].side != d.side && w.divisions[j].vars.pos.dist(d.vars.pos) <= 25.0 => {
                        st.ech[i] = Ech::Committed;
                        self.order_for(w, tick, h, i, OrderKind::Attack, w.divisions[j].vars.pos, reason, "модель", &mut dec)
                    }
                    _ => dec.why.push(format!("{} — отклонено: цель атаки не найдена рядом", d.name)),
                },
                "wait" => { if st.ech[i] == Ech::Unset { st.ech[i] = if mobile(d) { Ech::Mobile } else { Ech::Second }; st.since[i] = tick; } dec.why.push(format!("{} — ждёт: {reason}", d.name)); }
                "defend" => self.order_for(w, tick, h, i, OrderKind::Defend, d.vars.pos, reason, "модель", &mut dec),
                other => dec.why.push(format!("{} — отклонено: недопустимое действие «{other}»", d.name)),
            }
        }
        Ok(dec)
    }
}

/// Формат ответа модели — советского штаба армии.
const SU_REPLY_FORMAT: &str = r#"{"orders": [{"division": "id своей дивизии", "action": "attack|attack_enemy|wait|defend", "target": "id дивизии противника или null", "reason": "коротко, по-русски"}]}"#;
