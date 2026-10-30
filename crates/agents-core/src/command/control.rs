//! Управление штабами (раздел 4 спецификации): кто решает за штаб — приказы сценария, штаб-агент или игрок; кто изъят
//! из замысла своего старшего приказом через голову; журнал документов штабов.

use crate::command::directive::Directive;
use crate::model::State;
use crate::world::Sim;
use serde::Serialize;

/// Место в построении: первый, второй эшелон, подвижная группа, введён.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Default, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Role { #[default] Unset, First, Second, Mobile, Committed }

/// Кто решает за штаб.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Control { Script, Agent, Player }

/// Состояние управления по штабам и дивизиям мира.
#[derive(Clone, Debug, Default)]
pub struct CommandState {
    pub control: Vec<Control>,
    /// Штаб изъят из замысла старшего приказом через голову (ведёт игрок).
    pub led_hq: Vec<bool>,
    /// Дивизия изъята из замысла старшего приказом через голову.
    pub led_div: Vec<bool>,
    /// Штаб на задаче частной директивы старшей инстанции через голову своего (ПУ-39: устное указание Ставки армиям
    /// фронта) — свой штаб его в раздел полосы не берёт, пока не получит новый замысел.
    pub named_hq: Vec<bool>,
    /// Замысел старшего: последняя полученная директива штаба.
    pub intent: Vec<Option<Directive>>,
    /// Час последнего решения штаба-агента.
    pub last_cycle: Vec<u32>,
    /// Директивы в пути: (час прибытия, директива).
    pub in_transit: Vec<(u32, Directive)>,
    /// Замысел пришёл и ещё не разобран штабом.
    pub fresh: Vec<bool>,
    /// Задача дивизии по директиве: после выхода на ближайшую задачу — последующая.
    pub div_task: Vec<Option<Directive>>,
    /// Последняя задача, отданная подчинённому: (штаб, получатель) → (цель, задача).
    pub sent: std::collections::HashMap<(u32, crate::command::directive::Target), (crate::geo::XY, crate::command::directive::Task)>,
    /// Эшелоны: место штабов и дивизий в построении старшего, исходное положение, с какого часа в роли, сменена ли.
    pub role_hq: Vec<Role>,
    pub role_div: Vec<Role>,
    pub start_hq: Vec<Option<crate::geo::XY>>,
    pub start_div: Vec<Option<crate::geo::XY>>,
    pub since_hq: Vec<u32>,
    pub since_div: Vec<u32>,
    pub replaced_hq: Vec<bool>,
    pub replaced: Vec<bool>,
    /// Запросы на отход к верхней инстанции (немецкая сторона, приказ от 21.01.1945).
    pub requests: Vec<Request>,
    /// Час оттяжки армии перед артподготовкой (по штабам; один раз на угрозу).
    pub pulled: Vec<Option<u32>>,
    /// Последний час, когда у полосы армии развёртывался противник (оттяжка снова — после затишья 48 ч).
    pub pull_seen: Vec<u32>,
    /// До какого часа действует решение доктрины по дивизии (общий приказ по полосе её не перебивает).
    pub doc_until: Vec<u32>,
    /// Введённые подвижные группы, ещё не получившие задачи на глубину: (получатель, правило) — до ближайшего
    /// распределения полосы фронта (su.rs::commit_mobile).
    pub commits: Vec<(crate::command::directive::Target, String)>,
    /// Полосы армий для следа: (штаб, час, полоса) — при каждой смене (новый замысел, продление, войска вышли за
    /// нарисованную полосу); подпись последней записи по штабу — замысел и его границы.
    pub bands: Vec<(u32, u32, crate::command::band::Band)>,
    pub band_sig: std::collections::HashMap<u32, (String, u32, usize, usize)>,
    /// Полосы армий следуют за войсками (продление и запись в след) — режимы `intent`, `agents`, `commanders` и игра в
    /// них; прочие режимы (сценарий, фронты и журналы по истории, гибрид) — эталоны мерила, их полосы не трогаются.
    pub follow_bands: bool,
}

/// Запрос корпуса на отход дивизии: ответ — да, нет или ещё нет.
#[derive(Clone, Debug)]
pub struct Request { pub hq: u32, pub tick: u32, pub division: u32, /// Рубеж отхода, который назвала доктрина при запросе.
    pub at: crate::geo::XY, pub answer: Option<bool>, /// Час ответа: ответ действует permissionHours.
    pub answered_at: u32 }

impl CommandState {
    /// Все штабы — по приказам сценария (как без командования по ступеням).
    pub fn new(hqs: usize, divisions: usize) -> CommandState {
        CommandState { control: vec![Control::Script; hqs], led_hq: vec![false; hqs], led_div: vec![false; divisions], named_hq: vec![false; hqs], intent: vec![None; hqs], last_cycle: vec![0; hqs], in_transit: Vec::new(), fresh: vec![false; hqs], div_task: vec![None; divisions], sent: Default::default(),
            role_hq: vec![Role::Unset; hqs], role_div: vec![Role::Unset; divisions], start_hq: vec![None; hqs], start_div: vec![None; divisions],
            since_hq: vec![0; hqs], since_div: vec![0; divisions], replaced_hq: vec![false; hqs], replaced: vec![false; divisions], requests: Vec::new(), pulled: vec![None; hqs], pull_seen: vec![0; hqs], doc_until: vec![0; divisions], commits: Vec::new(), bands: Vec::new(), band_sig: Default::default(), follow_bands: false }
    }
}

impl CommandState {
    /// Место подчинённого в построении старшего.
    pub fn role(&self, t: crate::command::directive::Target) -> Role { match t { crate::command::directive::Target::Hq(h) => self.role_hq[h as usize], crate::command::directive::Target::Division(i) => self.role_div[i as usize] } }
    pub fn set_role(&mut self, t: crate::command::directive::Target, r: Role) { match t { crate::command::directive::Target::Hq(h) => self.role_hq[h as usize] = r, crate::command::directive::Target::Division(i) => self.role_div[i as usize] = r } }
    pub fn start(&self, t: crate::command::directive::Target) -> Option<crate::geo::XY> { match t { crate::command::directive::Target::Hq(h) => self.start_hq[h as usize], crate::command::directive::Target::Division(i) => self.start_div[i as usize] } }
    pub fn mark(&mut self, t: crate::command::directive::Target, pos: crate::geo::XY, tick: u32) { match t { crate::command::directive::Target::Hq(h) => { self.start_hq[h as usize] = Some(pos); self.since_hq[h as usize] = tick; } crate::command::directive::Target::Division(i) => { self.start_div[i as usize] = Some(pos); self.since_div[i as usize] = tick; } } }
    pub fn since(&self, t: crate::command::directive::Target) -> u32 { match t { crate::command::directive::Target::Hq(h) => self.since_hq[h as usize], crate::command::directive::Target::Division(i) => self.since_div[i as usize] } }
    pub fn replaced_of(&self, t: crate::command::directive::Target) -> bool { match t { crate::command::directive::Target::Hq(h) => self.replaced_hq[h as usize], crate::command::directive::Target::Division(i) => self.replaced[i as usize] } }
    pub fn set_replaced(&mut self, t: crate::command::directive::Target) { match t { crate::command::directive::Target::Hq(h) => self.replaced_hq[h as usize] = true, crate::command::directive::Target::Division(i) => self.replaced[i as usize] = true } }
}

/// Вид документа журнала штабов.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DocKind { Directive, Order, Instruction, Notice, Report }

/// Документ штаба: директива, боевой приказ, распоряжение, извещение, донесение — с обоснованием.
#[derive(Clone, Debug)]
pub struct Document {
    pub tick: u32,
    /// Штаб, отдавший документ.
    pub hq: u32,
    pub kind: DocKind,
    /// Кому: id штабов и дивизий.
    pub to: Vec<String>,
    pub text: String,
    /// Правило (id норматива или статья устава), по которому принято решение.
    pub rule: Option<String>,
}

/// Действующие прямые подчинённые штаба: штабы и дивизии, кроме изъятых через голову, выбывших, ещё не введённых и
/// остатков.
pub fn active_subs(sim: &Sim, h: u32) -> (Vec<u32>, Vec<u32>) {
    let w = &sim.world;
    let c = &sim.command;
    // штаб без действующих дивизий в поддереве — не подчинённый для задачи
    let alive = |k: u32| w.divisions.iter().any(|d| !d.state.out() && d.state != State::Remnant && { let mut x = d.hq; let mut ok = false; for _ in 0..8 { if x == k { ok = true; break; } match w.hqs[x as usize].parent { Some(p) => x = p, None => break } } ok });
    let hqs = (0..w.hqs.len() as u32).filter(|&k| w.hqs[k as usize].parent == Some(h) && !c.led_hq.get(k as usize).copied().unwrap_or(false) && !c.named_hq.get(k as usize).copied().unwrap_or(false) && alive(k)).collect();
    let divs = (0..w.divisions.len() as u32).filter(|&i| {
        let d = &w.divisions[i as usize];
        d.hq == h && !c.led_div.get(i as usize).copied().unwrap_or(false) && !d.state.out() && d.state != State::Remnant
    }).collect();
    (hqs, divs)
}

/// Сторона `side` под командованием по ступеням: верхняя инстанция — игрок, ниже — штабы-агенты.
pub fn agents_side(sim: &mut Sim, side: crate::model::Side) {
    for (k, h) in sim.world.hqs.iter().enumerate() {
        if h.side != side { continue; }
        sim.command.control[k] = if h.echelon == crate::model::Echelon::HighCommand { Control::Player } else { Control::Agent };
    }
}

/// Исторические директивы верхней инстанции стороны (все или с id `only`): (час, директива) к подаче; до начала
/// операции — `ready`. В «гибриде» (`hybrid`) поддерево получателя переходит на приказы сценария, подавать нечего.
pub fn historical_for(sim: &mut Sim, side: crate::model::Side, only: Option<&str>, hybrid: bool) -> Vec<(u32, Directive)> {
    use crate::command::directive::Target;
    let Some(top) = sim.world.hqs.iter().position(|h| h.side == side && h.echelon == crate::model::Echelon::HighCommand) else { return Vec::new() };
    let ds: Vec<(u32, Directive)> = sim.historical.iter().filter(|(_, d)| d.from == top as u32 && only.is_none_or(|id| d.id == id)).cloned().collect();
    let start = sim.world.tick == 0;
    if !hybrid { return ds.into_iter().map(|(at, mut d)| { d.ready = at == 0 && start; (at, d) }).collect(); }
    for (_, d) in ds {
        let Target::Hq(h) = d.to else { continue };
        let w = &sim.world;
        let under = |mut k: usize| { for _ in 0..8 { if k == h as usize { return true; } match w.hqs[k].parent { Some(p) => k = p as usize, None => return false } } false };
        let sub: Vec<usize> = (0..w.hqs.len()).filter(|&k| under(k)).collect();
        for k in sub { sim.command.control[k] = Control::Script; }
    }
    Vec::new()
}

/// Прогон «фронты по истории»: верхняя инстанция и фронты стороны ведутся по приказам сценария (их собственные приказы
/// дивизиям — резервам фронта — исполняются), армии и ниже — штабы-агенты; подавать — исторические распоряжения фронтов
/// армиям: (час, директива), до начала операции — `ready`; `journals` — и задачи армий по журналам между ними.
pub fn front_historical(sim: &mut Sim, side: crate::model::Side, journals: bool) -> Vec<(u32, Directive)> {
    use crate::model::Echelon;
    for (k, h) in sim.world.hqs.iter().enumerate() {
        if h.side != side { continue; }
        sim.command.control[k] = if matches!(h.echelon, Echelon::HighCommand | Echelon::Front) { Control::Script } else { Control::Agent };
    }
    let start = sim.world.tick == 0;
    let w = &sim.world;
    // задачи армий по журналам (id «…:journal») — только в режиме «армии по журналам»
    sim.historical.iter().filter(|(_, d)| w.hqs[d.from as usize].side == side && w.hqs[d.from as usize].echelon == Echelon::Front && (journals || !d.id.ends_with(":journal")))
        .cloned().map(|(at, mut d)| { d.ready = at == 0 && start; (at, d) }).collect()
}

/// Распоряжение фронта без оси («армии — к такому-то району»): ось — от нынешнего места получателя к середине ближайшей
/// задачи, в час подачи (иначе оно не сменило бы прежний замысел армии с осью).
pub fn with_axis(sim: &Sim, mut d: Directive) -> Directive {
    if d.axis.is_empty() {
        if let Some(goal) = d.immediate.as_ref().and_then(|l| crate::command::agent::mid(&l.pts)) {
            let from = crate::command::agent::place(sim, d.to);
            if from.dist(goal) > 1.0 { d.axis = vec![from, goal]; }
        }
    }
    d
}

/// Режим командования прогона стороны `side`: `script` — приказы сценария; `agents` — штабы-агенты под историческими
/// директивами Ставки (верхняя инстанция — агент: отвечает на запросы отхода); `hybrid` — поддеревья получателей
/// директив по приказам сценария; `fronts` — Ставка и фронты по истории, армии и ниже — штабы-агенты; `journals` — то же
/// и задачи армий по журналам между распоряжениями фронта (подсказка: проверка армейских агентов и ядра);
/// `commanders` — как `agents` плюс командующие (`commander::enable`); `intent` — история как замысел (`intent::enable`,
/// подаёт сам — список пуст). Возвращает
/// директивы к подаче по часам (`feed`).
pub fn command_mode(sim: &mut Sim, mode: &str, side: crate::model::Side) -> Result<Vec<(u32, Directive)>, String> {
    match mode {
        "script" => Ok(Vec::new()),
        "agents" | "hybrid" => {
            if mode == "agents" { sim.command.follow_bands = true; }
            agents_side(sim, side);
            for (k, h) in sim.world.hqs.iter().enumerate() { if h.side == side && h.echelon == crate::model::Echelon::HighCommand { sim.command.control[k] = Control::Agent; } }
            Ok(historical_for(sim, side, None, mode == "hybrid"))
        }
        "fronts" | "journals" => Ok(front_historical(sim, side, mode == "journals")),
        // командующие: путь «агенты» плюс командующие у штабов с профилем; Гитлер — агент, его исторические
        // директивы после начала не подаются (остаются только готовые к началу)
        "commanders" => {
            sim.command.follow_bands = true;
            agents_side(sim, side);
            for (k, h) in sim.world.hqs.iter().enumerate() { if h.side == side && h.echelon == crate::model::Echelon::HighCommand { sim.command.control[k] = Control::Agent; } }
            crate::commander::enable(sim, side);
            let ds = historical_for(sim, side, None, false);
            Ok(if side == crate::model::Side::De { ds.into_iter().filter(|(_, d)| d.ready).collect() } else { ds })
        }
        // история как замысел: советская сторона — как «фронты по истории» (Ставка и фронты по приказам сценария, армии
        // и ниже — штабы-агенты), немецкие штабы — по приказам сценария; исторические директивы и приказы подаёт
        // цепочками intent::step (по часу или выполнению, пока имеют смысл); командующие — у обеих сторон
        "intent" => {
            sim.command.follow_bands = true;
            if side == crate::model::Side::Su { let _ = front_historical(sim, side, false); }
            crate::commander::enable(sim, side);
            crate::intent::enable(sim, side);
            Ok(Vec::new())
        }
        x => Err(format!("режим командования: script | agents | hybrid | fronts | journals | commanders | intent, а не {x}")),
    }
}

/// Подать директивы, срок которых наступил (до шага этого часа); в режиме `fronts` — с осью от места получателя.
pub fn feed(sim: &mut Sim, pending: &mut Vec<(u32, Directive)>, fronts: bool) {
    let now = sim.world.tick;
    let (due, rest): (Vec<_>, Vec<_>) = std::mem::take(pending).into_iter().partition(|(at, _)| *at <= now);
    *pending = rest;
    for (_, d) in due {
        let d = if fronts { with_axis(sim, d) } else { d };
        crate::command::passing::issue(sim, d, now);
    }
}
