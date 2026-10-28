//! Профили командующих: характер (пять чисел 0…1), веса мотивов на начало, туман, коэффициенты выбора.
//! Числа в `commanders.json` — `{ value, range, source, confidence }`; поправки применяются до разбора,
//! после разбора каждое число проверяется на попадание в свой `range`.

use super::motives::Mood;
use crate::geo::LngLat;
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Trait { Risk = 0, Persistence = 1, Ambition = 2, LossTolerance = 3, Obedience = 4 }
const TRAITS: [(&str, Trait); 5] = [("risk", Trait::Risk), ("persistence", Trait::Persistence), ("ambition", Trait::Ambition), ("lossTolerance", Trait::LossTolerance), ("obedience", Trait::Obedience)];

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motive { Task = 0, Rival = 1, Preserve = 2, NoEncircle = 3, Destroy = 4, Hold = 5, Save = 6 }
const MOTIVES: [&str; 7] = ["task", "rival", "preserve", "noEncircle", "destroy", "hold", "save"];

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Traits(pub [f64; 5]);
impl Traits { pub fn get(&self, t: Trait) -> f64 { self.0[t as usize] } }

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Motives(pub [f64; 7]);
impl Motives { pub fn get(&self, m: Motive) -> f64 { self.0[m as usize] } }

#[derive(Clone, Debug)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub hqs: Vec<String>,
    pub traits: Traits,
    pub motives: Motives,
    /// Id профиля соперника (заданное состязание).
    pub rival: Option<String>,
    /// Id объекта из объектов сценария, к которому тянется командующий.
    pub objective: Option<String>,
}

/// Туман: ошибка оценки сил противника (доля) и задержка сводок.
#[derive(Clone, Debug)]
pub struct Fog { pub strength_error: f64, pub report_delay_hours: u32 }
/// Прибавки к оценке варианта: опередить соперника, потери, открытый фланг.
#[derive(Clone, Debug)]
pub struct Gains { pub rival: f64, pub losses: f64, pub flank: f64 }
/// Пороги появления вариантов: удаление армии от объекта соперника для поворота, просвет для замыкания котла, км.
#[derive(Clone, Debug)]
pub struct Opts { pub turn_km: f64, pub encircle_gap_km: f64 }
/// Состояние командующего: коэффициенты изменения уверенности и напряжения (в час), сдвиги черт, опорные величины.
#[derive(Clone, Debug)]
pub struct MoodRules {
    pub start: Mood,
    pub success_gain: f64,
    pub setback_gain: f64,
    pub threat_gain: f64,
    pub pressure_gain: f64,
    /// Доля возврата к `start` за час.
    pub decay: f64,
    pub risk_shift: f64,
    pub ambition_shift: f64,
    pub rigid_shift: f64,
    /// Напряжение, выше которого обзор сужен.
    pub narrow_at: f64,
    /// Продвижение фронта в сутки «по плану», км.
    pub expected_km_day: f64,
    /// Доля силы, теряемая в сутки в порядке вещей.
    pub normal_loss_day: f64,
}
/// Веса слагаемых выбора варианта.
#[derive(Clone, Debug)]
pub struct Weights { pub uncertainty: f64, pub losses: f64, pub persistence: f64, pub obedience: f64 }
/// Цикл решения командующего, ч: фронт, армия, высшее командование.
#[derive(Clone, Debug)]
pub struct Cycle { pub front: u32, pub army: u32, pub high: u32 }

#[derive(Clone, Debug)]
pub struct CommanderRules {
    pub profiles: Vec<Profile>,
    pub fog: Fog,
    pub gains: Gains,
    pub options: Opts,
    pub mood: MoodRules,
    pub weights: Weights,
    pub cycle: Cycle,
    pub lookahead_hours: u32,
    /// Проигрыш «в уме» — когда польза двух лучших вариантов различается меньше этого.
    pub mind_margin: f64,
    /// Объекты, к которым тянутся командующие: id и место (долгота, широта); в километры театра — в картине обстановки.
    pub objectives: Vec<(String, LngLat)>,
}

impl CommanderRules {
    /// Место объекта по id.
    pub fn objective_at(&self, id: &str) -> Option<LngLat> { self.objectives.iter().find(|o| o.0 == id).map(|o| o.1) }

    /// Профиль командующего штабом.
    pub fn for_hq(&self, hq_id: &str) -> Option<&Profile> { self.profiles.iter().find(|p| p.hqs.iter().any(|h| h == hq_id)) }

    /// Разбор узла `commanders` (после поправок): числа проверяются на попадание в `range`.
    pub fn parse(c: &Value) -> Result<CommanderRules, String> {
        let n = |path: &str| num(c, path);
        let profiles = c.get("profiles").and_then(Value::as_object).ok_or("правила командующих: нет profiles")?;
        let mut out = Vec::new();
        for (id, p) in profiles {
            let at = |sub: &str| format!("profiles.{id}.{sub}");
            let mut traits = [0.0; 5];
            for (k, t) in TRAITS { traits[t as usize] = num(c, &at(&format!("traits.{k}")))?; }
            let mut motives = [0.0; 7];
            for (i, k) in MOTIVES.iter().enumerate() { motives[i] = num(c, &at(&format!("motives.{k}")))?; }
            let text = |k: &str| p.get(k).and_then(Value::as_str).map(str::to_string);
            let hqs = p.get("hqs").and_then(Value::as_array).ok_or_else(|| format!("правила командующих: {} — нет hqs", at("")))?
                .iter().map(|h| h.as_str().map(str::to_string).ok_or_else(|| format!("правила командующих: {} — штаб не строка: {h}", at("hqs")))).collect::<Result<Vec<_>, _>>()?;
            for h in &hqs {
                if let Some(q) = out.iter().find(|q: &&Profile| q.hqs.contains(h)) { return Err(format!("правила командующих: штаб {h} в двух профилях: {} и {id}", q.id)); }
            }
            out.push(Profile {
                id: id.clone(),
                name: text("name").ok_or_else(|| format!("правила командующих: {} — нет name", at("")))?,
                hqs,
                traits: Traits(traits),
                motives: Motives(motives),
                rival: text("rival"),
                objective: text("objective"),
            });
        }
        let mut objectives = Vec::new();
        if let Some(m) = c.get("objectives").and_then(Value::as_object) {
            for (id, o) in m {
                let at = o.get("at").and_then(Value::as_array).filter(|a| a.len() == 2).and_then(|a| Some([a[0].as_f64()?, a[1].as_f64()?]))
                    .ok_or_else(|| format!("правила командующих: объект {id} — нужны координаты at [долгота, широта]"))?;
                objectives.push((id.clone(), at));
            }
        }
        for p in &out {
            if let Some(o) = &p.objective { if !objectives.iter().any(|q| &q.0 == o) { return Err(format!("правила командующих: объект {o} профиля {} не найден", p.id)); } }
            if let Some(r) = &p.rival { if !out.iter().any(|q| &q.id == r) { return Err(format!("правила командующих: соперник {r} профиля {} не найден", p.id)); } }
        }
        let hours = |path: &str| -> Result<u32, String> { let v = n(path)?; if v < 0.0 || v.fract() != 0.0 { return Err(format!("правила командующих: {path} — целое число часов")); } Ok(v as u32) };
        Ok(CommanderRules {
            profiles: out,
            fog: Fog { strength_error: n("fog.strengthError")?, report_delay_hours: hours("fog.reportDelayHours")? },
            gains: Gains { rival: n("gains.rival")?, losses: n("gains.losses")?, flank: n("gains.flank")? },
            options: Opts { turn_km: n("options.turnKm")?, encircle_gap_km: n("options.encircleGapKm")? },
            mood: MoodRules {
                start: Mood { confidence: n("mood.startConfidence")?, stress: n("mood.startStress")? },
                success_gain: n("mood.successGain")?, setback_gain: n("mood.setbackGain")?, threat_gain: n("mood.threatGain")?,
                pressure_gain: n("mood.pressureGain")?, decay: n("mood.decay")?, risk_shift: n("mood.riskShift")?,
                ambition_shift: n("mood.ambitionShift")?, rigid_shift: n("mood.rigidShift")?, narrow_at: n("mood.narrowAt")?,
                expected_km_day: n("mood.expectedKmDay")?, normal_loss_day: n("mood.normalLossDay")?,
            },
            weights: Weights { uncertainty: n("weights.uncertainty")?, losses: n("weights.losses")?, persistence: n("weights.persistence")?, obedience: n("weights.obedience")? },
            cycle: Cycle { front: hours("cycleHours.front")?, army: hours("cycleHours.army")?, high: hours("cycleHours.high")? },
            lookahead_hours: hours("lookaheadHours")?,
            mind_margin: n("mindMargin")?,
            objectives,
        })
    }
}

/// Число узла `{ value, range }` по пути через точку; значение вне `range` — ошибка с путём.
fn num(c: &Value, path: &str) -> Result<f64, String> {
    let mut cur = c;
    for k in path.split('.') { cur = cur.get(k).ok_or_else(|| format!("правила командующих: нет поля {path}"))?; }
    let v = cur.get("value").and_then(Value::as_f64).ok_or_else(|| format!("правила командующих: {path} — не число"))?;
    if let Some(r) = cur.get("range").and_then(Value::as_array) {
        if let (Some(lo), Some(hi)) = (r.first().and_then(Value::as_f64), r.get(1).and_then(Value::as_f64)) {
            if v < lo || v > hi { return Err(format!("правила командующих: commanders.{path} = {v} вне пределов [{lo}; {hi}]")); }
        }
    }
    Ok(v)
}
