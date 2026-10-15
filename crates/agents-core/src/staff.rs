//! Штабы, решающие сами (docs/plans/agents.md, раздел 5): источник решений выбирается для каждой стороны —
//! исторические приказы сценария, штабы «по доктрине» или штабы на языковой модели. Штаб раз в цикл управления
//! оценивает обстановку по своим дивизиям и отдаёт приказы: держаться, оборонять, контратаковать резервом, закрыть
//! прорыв, отойти на следующий рубеж. Правила и числа доктрины — data/rules/agents-v0.json, раздел doctrine. Штаб на
//! модели получает ту же оценку обстановки и выбирает из тех же действий; если модель недоступна или ответила
//! негодно, решает доктрина. Каждое решение — в журнале с обоснованием; запросы и ответы модели — в llm_log.

use crate::geo::XY;
use crate::llm;
use crate::model::*;
use crate::world::{Event, ScriptOrder, Sim, World};
use serde_json::{json, Value};

/// Источник решений штабов стороны.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Source {
    /// Приказы сценария (исторические задачи).
    Script,
    /// Штабы по доктрине стороны.
    Doctrine,
    /// Штабы на языковой модели (Sim::llm); при сбое — по доктрине.
    Llm,
}

/// Формат ответа модели-штаба.
const REPLY_FORMAT: &str = r#"{"orders": [{"division": "id своей дивизии", "action": "hold|defend|withdraw|counterattack|block|breakout", "target": "id или null", "reason": "коротко, по-русски"}]}"#;

/// Оценка дивизии штабом.
struct Assess {
    i: usize,
    strength: f64,
    /// Сила противника в досягаемости, к своей силе.
    threat: f64,
    broken: bool,
}

/// Решение штаба: приказы и пояснения к ним.
pub(crate) struct Decision {
    pub(crate) orders: Vec<ScriptOrder>,
    pub(crate) why: Vec<String>,
}

impl Sim {
    /// Решения штабов (по доктрине или на модели) на шаг `tick`: приказы (с задержкой доведения — как у приказов
    /// сценария) и записи журнала.
    pub fn doctrine_orders(&self, w: &World, tick: u32) -> (Vec<ScriptOrder>, Vec<Event>) {
        let cycle = self.rules.doctrine.cycle_hours.max(1.0) as u32;
        // цикл управления; штабы разнесены по часам, чтобы не решать все разом (на модели — по выбору: в один час)
        let due = |key: usize, sync: bool| if sync { tick % cycle == 0 } else { (tick + key as u32) % cycle == 0 || tick == 0 };
        let subs_of = |h: usize| -> Vec<usize> { (0..w.divisions.len()).filter(|&i| w.divisions[i].hq as usize == h && !w.divisions[i].state.out() && w.divisions[i].state != State::Remnant).collect() };
        let mut decided: Vec<(usize, Decision, String)> = Vec::new();
        // запросы к модели: ведущий штаб (корпус или армия при объединении) и его корпуса с дивизиями
        let mut asks: Vec<(usize, Vec<(usize, Vec<usize>)>)> = Vec::new();
        let su_cycle = self.rules.doctrine_su.cycle_hours.max(1.0) as u32;
        for (h, hq) in w.hqs.iter().enumerate() {
            let src = self.sources[side_idx(hq.side)];
            if src == Source::Script { continue; }
            let subs = subs_of(h);
            if subs.is_empty() { continue; }
            // советская сторона — по своей доктрине (staff_su.rs); на модели решает штаб армии за все её дивизии
            if hq.side == Side::Su {
                if tick % su_cycle != 0 { continue; }
                match (src, &self.llm) {
                    (Source::Llm, Some(_)) => { let lead = army_of(w, h); match asks.iter_mut().find(|a| a.0 == lead) { Some(a) => a.1.push((h, subs)), None => asks.push((lead, vec![(h, subs)])) } }
                    _ => decided.push((h, self.su_doctrine_hq(w, tick, h, &subs), "по доктрине".into())),
                }
                continue;
            }
            match (src, &self.llm) {
                (Source::Llm, Some(cfg)) => {
                    let lead = if cfg.by_army { army_of(w, h) } else { h };
                    if !due(lead, cfg.sync || cfg.by_army) { continue; }
                    match asks.iter_mut().find(|a| a.0 == lead) { Some(a) => a.1.push((h, subs)), None => asks.push((lead, vec![(h, subs)])) }
                }
                (Source::Llm, None) => if due(h, false) { decided.push((h, self.doctrine_hq(w, tick, h, &subs), "по доктрине: модель не задана".into())) },
                _ => if due(h, false) { decided.push((h, self.doctrine_hq(w, tick, h, &subs), "по доктрине".into())) },
            }
        }
        if let (Some(cfg), false) = (&self.llm, asks.is_empty()) {
            let par = self.llm_parallel(cfg).min(asks.len()).max(1);
            let time = crate::time::format_hours(self.start_hour + tick as i64);
            if let Some(cb) = &self.on_progress { cb(format!("{time}: штабов к модели {}: {}, одновременно {par}…", cfg.model, asks.len())); }
            let next = std::sync::atomic::AtomicUsize::new(0);
            let done = std::sync::atomic::AtomicUsize::new(0);
            let mut res: Vec<(usize, Result<Decision, String>)> = std::thread::scope(|s| {
                let hs: Vec<_> = (0..par).map(|_| s.spawn(|| {
                    let mut out = Vec::new();
                    loop {
                        let k = next.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                        let Some((lead, groups)) = asks.get(k) else { break };
                        out.push((k, if w.hqs[*lead].side == Side::Su { self.su_llm_hq(w, tick, *lead, groups, cfg) } else { self.llm_hq(w, tick, *lead, groups, cfg) }));
                        let n = done.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1;
                        if let Some(cb) = &self.on_progress { cb(format!("{time}: ответов модели {n} из {}", asks.len())); }
                    }
                    out
                })).collect();
                hs.into_iter().flat_map(|h| h.join().unwrap_or_default()).collect()
            });
            // порядок применения — по порядку штабов, а не по времени ответа: прогон воспроизводим
            res.sort_by_key(|r| r.0);
            for (k, r) in res {
                let (lead, groups) = &asks[k];
                match r {
                    Ok(dec) => {
                        let how = if groups.len() > 1 || groups[0].0 != *lead { format!("языковая модель {}, за корпуса: {}", cfg.model, groups.iter().map(|g| w.hqs[g.0].name.as_str()).collect::<Vec<_>>().join(", ")) } else { format!("языковая модель {}", cfg.model) };
                        decided.push((*lead, dec, how));
                    }
                    Err(e) => for (h, subs) in groups {
                        let dec = if w.hqs[*h].side == Side::Su { self.su_doctrine_hq(w, tick, *h, subs) } else { self.doctrine_hq(w, tick, *h, subs) };
                        decided.push((*h, dec, format!("по доктрине: модель не дала решения — {e}")))
                    },
                }
            }
        }
        let mut orders = Vec::new();
        let mut journal = Vec::new();
        for (h, dec, how) in decided {
            if !dec.why.is_empty() {
                journal.push(Event { tick, agent: u32::MAX, text: format!("штаб «{}» ({how}): {}", w.hqs[h].name, dec.why.join("; ")) });
            }
            orders.extend(dec.orders);
        }
        (orders, journal)
    }

    /// Число одновременных запросов к модели: из настроек или замером один раз за прогон.
    fn llm_parallel(&self, cfg: &llm::LlmConfig) -> usize {
        if cfg.parallel > 0 { return cfg.parallel; }
        *self.llm_par.get_or_init(|| {
            if let Some(cb) = &self.on_progress { cb(format!("замер параллельных запросов к модели {}…", cfg.model)); }
            match llm::probe_parallel(cfg, 16) {
                Ok(p) => { if let Ok(mut l) = self.llm_probe.lock() { *l = Some(p.to_json()); } p.best }
                Err(e) => { if let Ok(mut l) = self.llm_probe.lock() { *l = Some(json!({ "best": 1, "error": e })); } 1 }
            }
        })
    }

    /// Приказ дивизии, если он отличается от действующего.
    pub(crate) fn order_for(&self, w: &World, tick: u32, h: usize, i: usize, kind: OrderKind, target: XY, note: String, src: &str, dec: &mut Decision) {
        let d = &w.divisions[i];
        if let Some(o) = &d.order { if o.kind == kind && o.target.dist(target) < 2.0 { return; } }
        dec.why.push(format!("{} — {}: {}", d.name, kind.label(), note));
        dec.orders.push(ScriptOrder { at: tick, hq: h as u32, to: vec![i as u32], kind, target: Some(target), forced: false, note: format!("решение штаба ({src}): {note}"), follow: None, offset: XY::default() });
    }

    fn doctrine_hq(&self, w: &World, tick: u32, h: usize, subs: &[usize]) -> Decision {
        let doc = &self.rules.doctrine;
        let mut dec = Decision { orders: Vec::new(), why: Vec::new() };
        let a: Vec<Assess> = subs.iter().map(|&i| self.assess(w, i)).collect();
        // прорывы на полосе штаба: противник продвинулся вглубь полосы дивизии на глубину главной полосы — часть главной
        // позиции потеряна (TM-E 30-451, A); ответ — немедленная контратака резервом во фланг вклинения, если резерва
        // хватает (не меньше 1/3 прорвавшегося — DA Pam 20-233, с. 9, B), иначе — закрыть направление рубежом за ней
        let pens: Vec<(usize, usize)> = a.iter().filter_map(|x| self.penetrator(w, x.i).map(|e| (x.i, e))).collect();
        let mut used: Vec<usize> = Vec::new();
        for x in &a {
            let d = &w.divisions[x.i];
            // окружена: прорыв к ближайшим своим (при угрозе окружения Буссе и Хейнрици выбирали прорыв вопреки приказам
            // держаться; 25.04 Буссе получил свободу направления — hold-orders-1945, LT_HALBE)
            if self.encircled(d, tick) {
                let going = d.state == crate::model::State::Attack(crate::model::AttackSub::Breakout);
                if let Some(t) = self.nearest_linked(w, d.side, d.vars.pos).filter(|_| !going) {
                    let h_cut = d.cut_since.map_or(0, |s| tick.saturating_sub(s));
                    self.order_for(w, tick, h, x.i, OrderKind::Attack, t, format!("окружена {h_cut} ч — прорыв к своим, до них {:.0} км", t.dist(d.vars.pos)), "доктрина", &mut dec);
                }
                continue;
            }
            let pen = pens.iter().find(|p| p.0 == x.i).map(|p| p.1);
            if x.broken || pen.is_some() {
                // разбита или обойдена: отход на следующий рубеж (угроза охвата — последовательные позиции через 8–10 км,
                // DA Pam 20-233, с. 64–70, B); при приказе «держаться» — держаться
                let why_txt = if let Some(e) = pen { format!("в тылу — {} (угроза охвата)", w.divisions[e].name) } else {
                    format!("боевая сила {:.0} % от исходной, организованность {:.2}", 100.0 * x.strength / d.vars.strength0.max(1e-9), d.vars.cohesion) };
                if doc.hold_orders {
                    self.order_for(w, tick, h, x.i, OrderKind::Hold, d.vars.pos, format!("{why_txt}; приказ «держаться» (Haltebefehl) — отход запрещён"), "доктрина", &mut dec);
                } else {
                    let t = self.line_behind(w, x.i);
                    self.order_for(w, tick, h, x.i, OrderKind::Withdraw, t, format!("{why_txt} — отход на следующий рубеж"), "доктрина", &mut dec);
                }
            } else if x.threat > 0.0 {
                let kind = if doc.hold_orders { OrderKind::Hold } else { OrderKind::Defend };
                self.order_for(w, tick, h, x.i, kind, d.vars.pos, format!("противник в соприкосновении, его сила в досягаемости — {:.1} от своей; удерживать полосу", x.threat), "доктрина", &mut dec);
            } else if let Some(&(hit, e)) = pens.iter().filter(|p| !used.contains(&p.1)).min_by(|p, q| w.divisions[p.1].vars.pos.dist(d.vars.pos).total_cmp(&w.divisions[q.1].vars.pos.dist(d.vars.pos))) {
                let ratio = x.strength / self.strength(&w.divisions[e]).max(1e-9);
                if ratio >= doc.counterattack_ratio {
                    used.push(e);
                    self.order_for(w, tick, h, x.i, OrderKind::Attack, w.divisions[e].vars.pos, format!("контратака во фланг вклинения: {} в тылу у {}, своих сил к прорвавшимся {:.2}", w.divisions[e].name, w.divisions[hit].name, ratio), "доктрина", &mut dec);
                } else {
                    let block = self.behind(w, hit, doc.block_depth_km);
                    self.order_for(w, tick, h, x.i, OrderKind::Defend, block, format!("сил для контратаки мало ({:.2} к прорвавшимся {}) — занять рубеж за {}", ratio, w.divisions[e].name, w.divisions[hit].name), "доктрина", &mut dec);
                }
            }
        }
        dec
    }

    /// Обстановка для штаба на модели: свои дивизии с оценкой, противник рядом, рубеж позади.
    fn situation(&self, w: &World, subs: &[usize]) -> Value {
        let km1 = |x: f64| (x * 10.0).round() / 10.0;
        let divs: Vec<Value> = subs.iter().map(|&i| {
            let x = self.assess(w, i);
            let d = &w.divisions[i];
            let mut enemies: Vec<(usize, f64)> = w.divisions.iter().enumerate()
                .filter(|(_, e)| e.side != d.side && !e.state.out())
                .map(|(j, e)| (j, e.vars.pos.dist(d.vars.pos))).filter(|x| x.1 <= 15.0).collect();
            enemies.sort_by(|a, b| a.1.total_cmp(&b.1));
            let line = self.line_behind(w, i);
            json!({
                "id": d.id, "name": d.name, "state": d.state.label(),
                "people": d.vars.personnel.round(), "tanks": d.vars.tanks.round(),
                "strength_pct_of_initial": (100.0 * x.strength / d.vars.strength0.max(1e-9)).round(),
                "cohesion": km1(d.vars.cohesion), "ammo": km1(d.vars.ammo),
                "enemy_strength_in_reach_vs_own": km1(x.threat),
                "penetrated_by": self.penetrator(w, i).map(|e| json!({ "id": w.divisions[e].id, "name": w.divisions[e].name })),
                "current_order": d.order.as_ref().map(|o| o.kind.label()),
                "enemies_within_15km": enemies.iter().take(4).map(|&(j, k)| json!({ "id": w.divisions[j].id, "name": w.divisions[j].name, "km": km1(k), "state": w.divisions[j].state.label() })).collect::<Vec<_>>(),
                "next_line_behind_km": km1(line.dist(d.vars.pos)),
                "encircled_hours": self.encircled(d, w.tick).then(|| d.cut_since.map_or(0, |s| w.tick.saturating_sub(s))),
                "own_lines_km": self.encircled(d, w.tick).then(|| self.nearest_linked(w, d.side, d.vars.pos).map(|p| km1(p.dist(d.vars.pos)))).flatten(),
            })
        }).collect();
        json!({ "divisions": divs })
    }

    /// Решение штаба на языковой модели: обстановка → JSON с приказами из тех же действий, что у доктрины. `lead` —
    /// штаб, который решает (корпус или армия при объединении), `groups` — его корпуса с дивизиями.
    fn llm_hq(&self, w: &World, tick: u32, lead: usize, groups: &[(usize, Vec<usize>)], cfg: &llm::LlmConfig) -> Result<Decision, String> {
        let hq = &w.hqs[lead];
        let time = crate::time::format_hours(self.start_hour + tick as i64);
        let doc = &self.rules.doctrine;
        let joint = groups.len() > 1 || groups[0].0 != lead;
        let who = if joint {
            format!("Ты — начальник штаба армии «{}» в Берлинской операции, апрель 1945 года. Раз в {} ч ты решаешь за подчинённые корпуса ({}), что приказать их дивизиям.",
                hq.name, doc.cycle_hours, groups.iter().map(|g| w.hqs[g.0].name.as_str()).collect::<Vec<_>>().join(", "))
        } else {
            format!("Ты — начальник штаба соединения «{}» ({}) в Берлинской операции, апрель 1945 года. Раз в {} ч ты решаешь, что приказать подчинённым дивизиям.",
                hq.name, match hq.echelon { Echelon::Corps => "корпус", Echelon::Army => "армия", Echelon::Front => "группа армий" }, doc.cycle_hours)
        };
        // доктрина: правила из базы знаний (текст из окна) заменяют только зашитые правила (контратака, отход);
        // жёсткие ограничения и словарь полей обстановки (encircled_hours, own_lines_km) остаются всегда
        let hold = if doc.hold_orders { "; действует приказ «держаться» — отход запрещён" } else { "" };
        let hard = format!("общий отход армии без приказа сверху запрещён{hold}; окружённой дивизии (encircled_hours — сколько часов нет пути к своим, own_lines_km — до своих) — прорыв к своим, пока есть боеприпасы.");
        let doctrine = match self.doctrine_text[side_idx(hq.side)].as_deref().filter(|t| !t.trim().is_empty()) {
            Some(t) => format!("Действуй по немецкой доктрине обороны 1944–1945 гг. — правила из базы знаний:\n{t}\nВсегда, поверх правил: {hard}"),
            None => format!("Действуй по немецкой доктрине обороны 1944–1945 гг.: вклинение противника — немедленная контратака резервом во фланг (силы не меньше 1/3 прорвавшегося), если сил мало — закрыть направление рубежом; обойдённой или разбитой дивизии — отход на следующий рубеж; {hard}"),
        };
        let system = format!(
            "{who} {doctrine}
Доступные действия: hold — держаться на месте, не отходить; defend — оборонять текущий район; withdraw — отойти на следующий рубеж позади; counterattack — контратаковать дивизию противника (target — её id); block — занять рубеж за своей дивизией (target — её id); breakout — окружённой дивизии прорываться к ближайшим своим.
Ответь только JSON без пояснений вокруг: {}. По дивизии, которой приказ не меняешь, приказ не давай.",
            REPLY_FORMAT);
        let situation = if joint {
            json!({ "corps": groups.iter().map(|(h, subs)| json!({ "corps": w.hqs[*h].name, "divisions": self.situation(w, subs)["divisions"] })).collect::<Vec<_>>() })
        } else { self.situation(w, &groups[0].1) };
        let user = format!("Время: {time} (МСК). Обстановка по дивизиям (сила противника — в долях своей; strength_pct — от исходной):\n{situation}");
        let list = self.ask_staff(tick, hq, system, user, cfg)?;
        let mut dec = Decision { orders: Vec::new(), why: Vec::new() };
        let id_of = |s: &str| w.divisions.iter().position(|d| d.id == s);
        for o in &list {
            let Some(i) = o.get("division").and_then(Value::as_str).and_then(id_of) else { continue };
            let Some(h) = groups.iter().find(|g| g.1.contains(&i)).map(|g| g.0) else { continue };
            let d = &w.divisions[i];
            let reason = o.get("reason").and_then(Value::as_str).unwrap_or("").to_string();
            let target = o.get("target").and_then(Value::as_str).and_then(id_of);
            match o.get("action").and_then(Value::as_str).unwrap_or("") {
                "hold" => self.order_for(w, tick, h, i, OrderKind::Hold, d.vars.pos, reason, "модель", &mut dec),
                "defend" => self.order_for(w, tick, h, i, OrderKind::Defend, d.vars.pos, reason, "модель", &mut dec),
                "withdraw" if !doc.hold_orders => { let t = self.line_behind(w, i); self.order_for(w, tick, h, i, OrderKind::Withdraw, t, reason, "модель", &mut dec) }
                "counterattack" => match target {
                    Some(j) if w.divisions[j].side != d.side && w.divisions[j].vars.pos.dist(d.vars.pos) <= 25.0 =>
                        self.order_for(w, tick, h, i, OrderKind::Attack, w.divisions[j].vars.pos, reason, "модель", &mut dec),
                    _ => dec.why.push(format!("{} — отклонено: цель контратаки не найдена рядом", d.name)),
                },
                "block" => match target {
                    Some(j) if w.divisions[j].side == d.side => { let t = self.behind(w, j, doc.block_depth_km); self.order_for(w, tick, h, i, OrderKind::Defend, t, reason, "модель", &mut dec) }
                    _ => dec.why.push(format!("{} — отклонено: не указана своя дивизия, за которой занять рубеж", d.name)),
                },
                "breakout" => match self.encircled(d, tick).then(|| self.nearest_linked(w, d.side, d.vars.pos)).flatten() {
                    Some(t) => self.order_for(w, tick, h, i, OrderKind::Attack, t, reason, "модель", &mut dec),
                    None => dec.why.push(format!("{} — отклонено: дивизия не в окружении", d.name)),
                },
                other => dec.why.push(format!("{} — отклонено: недопустимое действие «{other}»", d.name)),
            }
        }
        Ok(dec)
    }

    /// Запрос к модели штаба: поток в окно приложения, запись в журнал запросов; возвращает список orders ответа.
    pub(crate) fn ask_staff(&self, tick: u32, hq: &Hq, system: String, user: String, cfg: &llm::LlmConfig) -> Result<Vec<Value>, String> {
        let time = crate::time::format_hours(self.start_hour + tick as i64);
        if let Some(cb) = &self.on_progress { cb(format!("{time}: штаб «{}» запрашивает модель {}…", hq.name, cfg.model)); }
        // поток ответа — в окно приложения: хвосты размышлений и ответа, не чаще раза в 0,15 с
        let t0 = std::time::Instant::now();
        let (mut think, mut text, mut last, mut n) = (String::new(), String::new(), 0.0f64, 0u64);
        let tail = |s: &str, k: usize| { let c = s.chars().count(); s.chars().skip(c.saturating_sub(k)).collect::<String>() };
        let send = |phase: &str, think: &str, text: &str, n: u64| if let Some(cb) = &self.on_stream {
            cb(json!({ "hq": hq.id, "name": hq.name, "time": time, "phase": phase, "think": tail(think, 700), "text": tail(text, 400), "parts": n, "secs": (t0.elapsed().as_secs_f64() * 10.0).round() / 10.0 }));
        };
        send("wait", "", "", 0);
        let reply = llm::complete_stream(cfg, &[("system".into(), system.clone()), ("user".into(), user.clone())], &mut |p, s| {
            match p { llm::Part::Think => think.push_str(s), llm::Part::Text => text.push_str(s) }
            n += 1;
            let now = t0.elapsed().as_secs_f64();
            if now - last >= 0.15 { last = now; send(if text.trim().is_empty() { "think" } else { "answer" }, &think, &text, n); }
        }, None);
        send(if reply.is_ok() { "done" } else { "error" }, &think, &text, n);
        let log = |ok: bool, text: &str, r: Option<&llm::Reply>| {
            if let Ok(mut l) = self.llm_log.lock() {
                l.push(json!({ "tick": tick, "time": time, "hq": hq.id, "model": cfg.model, "system": system, "request": user, "reply": text, "ok": ok,
                    "reasoning": r.map(|r| r.reasoning.as_str()).unwrap_or(""), "tokens": r.and_then(|r| r.tokens), "secs": r.map(|r| (r.secs * 10.0).round() / 10.0), "truncated": r.map(|r| r.truncated) }));
            }
        };
        let reply = match reply { Ok(r) => r, Err(e) => { log(false, &e, None); return Err(e); } };
        let cut = if reply.truncated { format!("ответ оборван потолком токенов ({}) — поднимите потолок или поставьте 0", cfg.max_tokens) } else { String::new() };
        let Some(v) = llm::extract_json(&reply.text) else { log(false, &reply.text, Some(&reply)); return Err(if reply.truncated { cut } else { "ответ не в формате JSON".into() }); };
        let Some(list) = v.get("orders").and_then(Value::as_array) else { log(false, &reply.text, Some(&reply)); return Err(if reply.truncated { cut } else { "в ответе нет списка orders".into() }); };
        log(true, &reply.text, Some(&reply));
        Ok(list.clone())
    }

    fn assess(&self, w: &World, i: usize) -> Assess {
        let d = &w.divisions[i];
        let doc = &self.rules.doctrine;
        let reach = self.rules.contact_km + self.rules.combat.defense_frontage_km(d) / 2.0;
        let enemy_strength: f64 = w.divisions.iter()
            .filter(|e| e.side != d.side && !e.state.out() && e.vars.pos.dist(d.vars.pos) <= reach)
            .map(|e| self.strength(e)).sum();
        let strength = self.strength(d);
        let broken = strength / d.vars.strength0.max(1e-9) < doc.withdraw_strength_share || d.vars.cohesion < doc.withdraw_cohesion;
        Assess { i, strength, threat: enemy_strength / strength.max(1e-9), broken }
    }

    /// Направление «в тыл» каждой дивизии по исходной обстановке (от центра противника в 20 км к дивизии) и исходная
    /// глубина противника в её полосе — неизменны в прогоне: на плацдарме, где противник охватывает с трёх сторон, а
    /// дивизии — точки в центре своих районов, «тыл» и «прорыв» иначе сбиваются.
    pub(crate) fn fronts(&self, w: &World) -> &Vec<(XY, f64)> {
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
            .filter(move |(_, e)| e.side != d.side && !e.state.out())
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
            let v: Vec<XY> = w.divisions.iter().filter(|e| e.side != d.side && !e.state.out() && e.vars.pos.dist(d.vars.pos) <= lim).map(|e| e.vars.pos).collect();
            if v.is_empty() { None } else { Some(XY::new(v.iter().map(|p| p.x).sum::<f64>() / v.len() as f64, v.iter().map(|p| p.y).sum::<f64>() / v.len() as f64)) }
        };
        pick(20.0).or_else(|| pick(f64::INFINITY)).unwrap_or(d.vars.pos)
    }

    /// Точка в `km` за дивизией (по направлению «в тыл» исходной обстановки).
    pub(crate) fn behind(&self, w: &World, i: usize, km: f64) -> XY {
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

/// Армия, в которую входит штаб (сам штаб, если он армия или выше её нет).
fn army_of(w: &World, h: usize) -> usize {
    let mut k = h;
    loop {
        if w.hqs[k].echelon == Echelon::Army { return k; }
        match w.hqs[k].parent { Some(p) => k = p as usize, None => return h }
    }
}
