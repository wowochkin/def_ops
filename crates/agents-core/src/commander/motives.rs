//! Мотивы и состояние командующего по обстановке: веса мотивов от картины, уверенность и напряжение раз в час,
//! черты с поправкой на состояние. Чистые функции от картины; числа — из раздела `mood` и `gains` правил.

use super::picture::Picture;
use super::profile::{Gains, MoodRules, Motive, Motives, Trait, Traits};

/// Состояние командующего, 0…1.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Mood { pub confidence: f64, pub stress: f64 }

fn clamp01(x: f64) -> f64 { x.clamp(0.0, 1.0) }

/// Веса мотивов по картине: соперник ближе — растёт `Rival` (без соперника — 0), потери — `Preserve`,
/// открытые фланги — `NoEncircle`; остальные — как на начало.
pub fn current(base: &Motives, pic: &Picture, g: &Gains) -> Motives {
    let mut m = *base;
    let n = pic.armies.len() as f64;
    m.0[Motive::Rival as usize] = match (&pic.rival, pic.to_objective_km) {
        (Some(r), Some(own)) if own > 0.0 => base.get(Motive::Rival) + g.rival * ((own - r.to_objective_km) / own).max(0.0),
        (Some(_), _) => base.get(Motive::Rival),
        (None, _) => 0.0,
    };
    if n > 0.0 {
        let mean = pic.armies.iter().map(|a| a.strength).sum::<f64>() / n;
        m.0[Motive::Preserve as usize] += g.losses * (1.0 - mean).max(0.0);
        m.0[Motive::NoEncircle as usize] += g.flank * pic.open_flanks.len() as f64 / n;
    }
    m
}

/// Сколько земли в час (смещение центра войск армии, км/ч) обороняющийся может отдать и считать, что держит рубеж
/// (допущение: 0,25 км/ч — около 6 км в сутки).
pub const HOLD_KM_H: f64 = 0.25;

/// Шаг состояния за час. `task_behind` — отставание от срока задачи старшего, доля (0…1): оно давит долей в сутки,
/// то есть в час — его двадцать четвёртая часть. `attacking` — наступающий: успех и застревание меряются темпом
/// продвижения против ожидаемого; обороняющийся: успех — удержанная земля (смещение войск за час не больше
/// `HOLD_KM_H`), неудача — отданная сверх того. Без прежней картины действует только возврат к состоянию на начало.
pub fn mood_step(prev: &Mood, pic: &Picture, prev_pic: Option<&Picture>, task_behind: f64, attacking: bool, m: &MoodRules) -> Mood {
    let behind = clamp01(task_behind) / 24.0;
    let n = pic.armies.len() as f64;
    let (mut confidence, mut stress) = (prev.confidence, prev.stress);
    if let Some(pp) = prev_pic {
        if n > 0.0 {
            // смещение за час, среднее по армиям, имеющимся в обеих картинах
            let steps: Vec<(f64, f64)> = pic.armies.iter().filter_map(|a| pp.armies.iter().find(|b| b.hq == a.hq).map(|b| (a.advance_km - b.advance_km, b.strength - a.strength))).collect();
            if !steps.is_empty() {
                let k = steps.len() as f64;
                let rate = steps.iter().map(|s| s.0).sum::<f64>() / k;
                let loss = steps.iter().map(|s| s.1).sum::<f64>() / k;
                let (success, stall) = if attacking {
                    let pace = m.expected_km_day / 24.0;
                    let ratio = if pace > 0.0 { rate / pace } else { 1.0 };
                    ((ratio - 1.0).clamp(0.0, 1.0), (1.0 - ratio).clamp(0.0, 1.0))
                } else {
                    let lost = rate.max(0.0);
                    ((1.0 - lost / HOLD_KM_H).clamp(0.0, 1.0), ((lost - HOLD_KM_H) / HOLD_KM_H).clamp(0.0, 1.0))
                };
                let norm_loss = m.normal_loss_day / 24.0;
                let excess = if norm_loss > 0.0 { ((loss - norm_loss) / norm_loss).clamp(0.0, 1.0) } else { 0.0 };
                let encircling = (pic.pockets.len() as f64 / n).min(1.0);
                confidence += m.success_gain * (success + encircling) - m.setback_gain * (stall + excess);
            }
        }
    }
    confidence -= m.setback_gain * behind;
    if n > 0.0 {
        let flanks = (pic.open_flanks.len() as f64 / n).min(1.0);
        // охвата своих в картине нет: вместо него доля ослабевших армий
        let weak = pic.armies.iter().filter(|a| a.strength < 0.5).count() as f64 / n;
        stress += m.threat_gain * (flanks + weak);
    }
    stress += m.pressure_gain * behind;
    confidence += m.decay * (m.start.confidence - confidence);
    stress += m.decay * (m.start.stress - stress);
    Mood { confidence: clamp01(confidence), stress: clamp01(stress) }
}

/// Черты с поправкой на состояние: уверенность сдвигает риск и честолюбие; под напряжением послушный и
/// настойчивый костенеет (настойчивее, осторожнее в риске), прочие тянутся спасать армию (меньше терпят потерь).
pub fn effective(t: &Traits, mood: &Mood, m: &MoodRules) -> Traits {
    let mut e = *t;
    let c = mood.confidence - 0.5;
    e.0[Trait::Risk as usize] += m.risk_shift * c;
    e.0[Trait::Ambition as usize] += m.ambition_shift * c;
    if mood.stress > 0.5 {
        let s = m.rigid_shift * (mood.stress - 0.5);
        if t.get(Trait::Obedience) + t.get(Trait::Persistence) > 1.0 {
            e.0[Trait::Persistence as usize] += s;
            e.0[Trait::Risk as usize] -= s;
        } else {
            e.0[Trait::LossTolerance as usize] -= s;
        }
    }
    Traits(e.0.map(clamp01))
}

/// Обзор сужен: напряжение выше порога `narrow_at`.
pub fn narrowed(mood: &Mood, m: &MoodRules) -> bool { mood.stress > m.narrow_at }
