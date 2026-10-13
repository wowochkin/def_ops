//! Правила ядра. Источники — те же файлы, что у нынешней модели: профили сторон (`data/profiles`), откалиброванные
//! правила армий (`data/rules/ww2-berlin-cal.json`) и черновик правил агентов (`data/rules/agents-v0.json`, у каждого
//! числа — источник или пометка «допущение»).

use crate::model::{Mobility, Side, SizeClass};
use crate::theatre::TERRAIN;
use serde_json::Value;

/// Кусочно-линейная зависимость по точкам [x, y], за краями — крайние значения.
#[derive(Clone, Debug)]
pub struct Curve(pub Vec<(f64, f64)>);

impl Curve {
    pub fn at(&self, x: f64) -> f64 {
        let p = &self.0;
        if p.is_empty() { return 0.0; }
        if x <= p[0].0 { return p[0].1; }
        for w in p.windows(2) {
            if x <= w[1].0 { let t = (x - w[0].0) / (w[1].0 - w[0].0); return w[0].1 + t * (w[1].1 - w[0].1); }
        }
        p[p.len() - 1].1
    }
}

/// Действия, по которым считается расход (как в профилях сторон).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Activity { Attack = 0, Defend = 1, March = 2, Withdraw = 3, Reserve = 4 }
const ACTIVITIES: [&str; 5] = ["attack", "defend", "march", "withdraw", "reserve"];

#[derive(Clone, Debug)]
pub struct SideRules {
    /// Доля дорожной скорости вне дорог: [подвижность][класс местности].
    pub off_road: [[f64; 6]; 3],
    /// Расход в сутки: [действие] → (боекомплекты, заправки).
    pub consumption: [(f64, f64); 5],
    /// Задержка доведения приказа штабом уровня, ч: армия, корпус, дивизия.
    pub delay_army: f64,
    pub delay_corps: f64,
    pub delay_division: f64,
    /// Подвоз в сутки и предельные запасы.
    pub ammo_per_day: f64,
    pub fuel_per_day: f64,
    pub max_ammo: f64,
    pub max_fuel: f64,
    pub weights: (f64, f64, f64),
}

/// Ступенчатая таблица: значение для x не ниже нижней границы ступени; ниже первой — 0.
#[derive(Clone, Debug)]
pub struct Steps(pub Vec<(f64, f64)>);
impl Steps {
    pub fn step(&self, x: f64) -> f64 { self.0.iter().rev().find(|p| x >= p.0).map_or(0.0, |p| p.1) }
}

/// Бой дивизионного уровня: нормативы с источниками — data/rules/agents-v0.json, раздел combat
/// (docs/sources/division-combat-norms.json).
#[derive(Clone, Debug)]
pub struct Combat {
    /// Стандартные темпы, км/сут, по позе обороны: поспешная, подготовленная, укреплённая.
    pub advance: [Steps; 3],
    pub armor_factor: f64,
    pub attacker_loss_day: f64,
    pub defender_loss_day: f64,
    pub attacker_loss_max_day: f64,
    pub defender_loss_penetration_day: f64,
    /// Рост потерь обороны с перевесом наступающего: множитель (перевес / ratio_ref)^exp, не меньше 1; потолок в сутки.
    pub defender_ratio_ref: f64,
    pub defender_ratio_exp: f64,
    pub defender_loss_cap_day: f64,
    /// Множитель потерь наступающего против подготовленной и укреплённой обороны (калибровка по суточным потерям).
    pub attacker_loss_prepared: f64,
    /// Темп в городе, км/сут, по уровню города: внешний обвод, внутренний (кольцо S-Bahn), «Цитадель».
    pub urban_km_day: [f64; 3],
    pub penetration_km_day: f64,
    /// Поправка на размер (QJM): (до численности, множитель).
    pub size: Vec<(f64, f64)>,
    /// Поправка на размер — по силе армии в бою (иначе — по полосе одной обороняющейся дивизии).
    pub size_by_army: bool,
    /// Потери наступающего ∝ перевес^(−exp) (0 — не зависят).
    pub attacker_ratio_exp: f64,
    /// Потери в соприкосновении без боя, доля в сутки.
    pub contact_loss_day: f64,
    pub tank_loss_factor: f64,
    pub gun_loss_factor: f64,
    /// Участок наступления, км: советская стрелковая, советская танковая (механизированная), немецкая.
    pub attack_frontage: [f64; 3],
    /// Полоса обороны, км: советская, немецкая.
    pub defense_frontage: [f64; 2],
    pub breakpoint_loss: f64,
    pub artillery: Artillery,
}

/// Артподготовка: потери по позициям при норме плотности и длительности, доли войск по позициям.
#[derive(Clone, Debug)]
pub struct Artillery {
    pub loss_by_position: [f64; 3],
    pub positions: [f64; 3],
    pub norm_density: f64,
    pub norm_duration_min: f64,
    /// Глубина огня за передний край (сверх дистанции соприкосновения), км.
    pub depth_km: f64,
    /// Падение организованности на долю потерь от огня.
    pub cohesion_factor: f64,
}

impl Combat {
    pub fn size_factor(&self, people: f64) -> f64 {
        self.size.iter().find(|&&(lim, _)| people < lim).map_or(1.0, |&(_, f)| f)
    }
    pub fn attack_frontage_km(&self, d: &crate::model::Division) -> f64 {
        match (d.side, d.params.mobility) { (Side::De, _) => self.attack_frontage[2], (Side::Su, Mobility::Foot) => self.attack_frontage[0], _ => self.attack_frontage[1] }
    }
    pub fn defense_frontage_km(&self, d: &crate::model::Division) -> f64 {
        match d.side { Side::Su => self.defense_frontage[0], Side::De => self.defense_frontage[1] }
    }
}

/// Штабы по доктрине (staff.rs): правила — data/rules/agents-v0.json, раздел doctrine.
#[derive(Clone, Debug)]
pub struct Doctrine {
    pub cycle_hours: f64,
    pub counterattack_trigger: f64,
    pub counterattack_ratio: f64,
    pub withdraw_strength_share: f64,
    pub withdraw_cohesion: f64,
    pub hold_orders: bool,
    pub block_depth_km: f64,
    pub withdraw_step_km: f64,
    pub penetration_depth_km: f64,
}

/// Окружение: data/rules/agents-v0.json, раздел pocket (pocket.rs).
#[derive(Clone, Debug)]
pub struct Pocket {
    /// Путь к своим не проходит ближе этого к дивизиям противника, км.
    pub zoc_km: f64,
    /// Территория противника — преграда не дальше этого от его войск, км.
    pub hold_km: f64,
    /// Ближе этого к своим войскам путь есть всегда, км.
    pub own_km: f64,
    /// Дивизия связана со своими, если путь доходит до клетки в этом радиусе, км.
    pub link_km: f64,
    /// Пути нет дольше — окружена, ч.
    pub encircle_hours: f64,
    /// Окружение снимается, когда путь есть столько часов подряд.
    pub release_hours: f64,
    /// Доля танков и орудий, вынесенных при прорыве.
    pub breakout_keep: f64,
    /// Потери прорывающихся из окружения в сутки, пока рядом противник.
    pub breakout_loss_day: f64,
    /// Темп прорыва из окружения, км/сут.
    pub breakout_km_day: f64,
    /// Капитуляция окружённой немецкой дивизии без боеприпасов (меньше, бк): через часов; с приказом держаться или на прорыв.
    pub surrender_ammo: f64,
    pub surrender_hours: f64,
    pub surrender_hours_firm: f64,
}

/// Остатки разгромленных дивизий: data/rules/agents-v0.json, раздел remnants.
#[derive(Clone, Debug)]
pub struct Remnants {
    /// Немецкая: доля исходной численности, ниже которой дивизия разгромлена.
    pub de_share: f64,
    pub de_consolidate_hours: f64,
    pub de_search_km: f64,
    pub de_personnel_share: f64,
    pub de_heavy_share: f64,
    /// Советская: численность, ниже которой дивизия выводится из боя.
    pub su_personnel: f64,
    pub rear_km: f64,
}

/// Советские штабы по доктрине (staff_su.rs): правила — data/rules/agents-v0.json, раздел doctrine.su.
#[derive(Clone, Debug)]
pub struct DoctrineSu {
    pub cycle_hours: f64,
    pub first_echelon_share: f64,
    pub commit_depth_km: f64,
    pub second_echelon_fallback_hours: f64,
    pub tank_commit_depth_km: f64,
    pub tank_commit_fallback_hours: f64,
}

#[derive(Clone, Debug)]
pub struct Rules {
    pub doctrine: Doctrine,
    pub doctrine_su: DoctrineSu,
    pub remnants: Remnants,
    pub pocket: Pocket,
    pub combat: Combat,
    pub su: SideRules,
    pub de: SideRules,
    // марш
    pub march_kmh: [f64; 3],
    pub night_factor: f64,
    pub march_hours_normal: f64,
    pub march_hours_forced: f64,
    pub column_km: [f64; 3],
    /// Темп продвижения по территории противника вне боя, км/сут: [подвижность].
    pub enemy_territory_km_day: [f64; 3],
    /// Приказы на начало сценария действуют сразу.
    pub start_orders_delivered: bool,
    pub deploy_hours: [f64; 3],
    pub frontage_km: [f64; 3],
    pub contact_km: f64,
    // бой (из правил армий)
    pub advance: Curve,
    pub attacker_loss: Curve,
    pub defender_loss: Curve,
    pub defense_terrain: [f64; 6],
    pub prepared: f64,
    pub prepare_hours: f64,
    pub fortification_per_level: f64,
    /// Предельный темп прорыва укреплённой полосы по уровням, км/сут (индекс — уровень).
    pub fort_advance_km: Vec<f64>,
    /// Доля обычного темпа наступления по местности обороняющегося.
    pub advance_terrain: [f64; 6],
    pub river_cross_hours: f64,
    /// Наведение переправы для техники через большую реку без моста, ч.
    pub bridging_hours: f64,
    pub ammo_short: f64,
    pub fuel_out: f64,
    pub fatigue_effect: f64,
    pub fatigue_gain: (f64, f64, f64),
    pub noise: f64,
    // пороги агента
    pub stop_ammo: f64,
    pub rout_cohesion: f64,
    pub cohesion_loss_factor: f64,
    pub cohesion_recover: f64,
    pub destroyed_personnel: f64,
}

fn num(v: &Value, path: &str) -> Result<f64, String> {
    let mut cur = v;
    for k in path.split('.') { cur = cur.get(k).ok_or_else(|| format!("правила: нет поля {path}"))?; }
    if let Some(x) = cur.as_f64() { return Ok(x); }
    cur.get("value").and_then(Value::as_f64).ok_or_else(|| format!("правила: {path} — не число"))
}

fn curve(v: &Value, key: &str) -> Result<Curve, String> {
    let arr = v.get(key).and_then(Value::as_array).ok_or_else(|| format!("правила: нет кривой {key}"))?;
    Ok(Curve(arr.iter().filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect()))
}

fn read(path: &str) -> Result<Value, String> {
    let t = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    serde_json::from_str(&t).map_err(|e| format!("{path}: {e}"))
}

fn side_rules(p: &Value) -> Result<SideRules, String> {
    let mob = ["foot", "motor", "tracked"];
    let mut off_road = [[0.0; 6]; 3];
    for (m, name) in mob.iter().enumerate() {
        let road = num(p, &format!("road.{name}"))?;
        for (t, cls) in TERRAIN.iter().enumerate() { off_road[m][t] = num(p, &format!("offRoad.{name}.{cls}"))? / road; }
    }
    let mut consumption = [(0.0, 0.0); 5];
    for (i, a) in ACTIVITIES.iter().enumerate() { consumption[i] = (num(p, &format!("consumption.{a}.ammo"))?, num(p, &format!("consumption.{a}.fuel"))?); }
    Ok(SideRules {
        off_road,
        consumption,
        delay_army: num(p, "orderDelayHours.army")?,
        delay_corps: num(p, "orderDelayHours.corps")?,
        delay_division: num(p, "orderDelayHours.division")?,
        ammo_per_day: num(p, "supply.ammoPerDay")?,
        fuel_per_day: num(p, "supply.fuelPerDay")?,
        max_ammo: num(p, "supply.maxAmmo")?,
        max_fuel: num(p, "supply.maxFuel")?,
        weights: (num(p, "weights.personnel")?, num(p, "weights.tanks")?, num(p, "weights.guns")?),
    })
}

impl Rules {
    /// `data` — папка `packages/sim/data`.
    pub fn load(data: &str) -> Result<Rules, String> {
        let su = side_rules(&read(&format!("{data}/profiles/rkka-1945.json"))?)?;
        let de = side_rules(&read(&format!("{data}/profiles/wehrmacht-1945.json"))?)?;
        let cal = read(&format!("{data}/rules/ww2-berlin-cal.json"))?;
        let ag = read(&format!("{data}/rules/agents-v0.json"))?;
        let sz = |k: &str| -> Result<[f64; 3], String> {
            Ok([num(&ag, &format!("{k}.rifle"))?, num(&ag, &format!("{k}.tank"))?, num(&ag, &format!("{k}.other"))?])
        };
        let mut defense_terrain = [1.0; 6];
        for (t, cls) in TERRAIN.iter().enumerate() { defense_terrain[t] = num(&cal, &format!("defense.terrain.{cls}"))?; }
        let steps = |k: &str| -> Result<Steps, String> {
            let arr = ag.pointer(&format!("/combat/advance/{k}/value")).and_then(Value::as_array).ok_or_else(|| format!("правила: нет combat.advance.{k}"))?;
            Ok(Steps(arr.iter().filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect()))
        };
        let combat = Combat {
            advance: [steps("hasty")?, steps("prepared")?, steps("fortified")?],
            armor_factor: num(&ag, "combat.armorFactor")?,
            attacker_loss_day: num(&ag, "combat.attackerLossDay")?,
            defender_loss_day: num(&ag, "combat.defenderLossDay")?,
            attacker_loss_max_day: num(&ag, "combat.attackerLossMaxDay")?,
            defender_loss_penetration_day: num(&ag, "combat.defenderLossPenetrationDay")?,
            defender_ratio_ref: num(&ag, "combat.defenderRatio.ref")?,
            defender_ratio_exp: num(&ag, "combat.defenderRatio.exp")?,
            defender_loss_cap_day: num(&ag, "combat.defenderRatio.capDay")?,
            attacker_loss_prepared: num(&ag, "combat.attackerLossPrepared")?,
            urban_km_day: [num(&ag, "combat.urban.outer")?, num(&ag, "combat.urban.inner")?, num(&ag, "combat.urban.citadel")?],
            penetration_km_day: num(&ag, "combat.penetrationKmDay")?,
            size_by_army: num(&ag, "combat.sizeByArmy")? > 0.0,
            attacker_ratio_exp: num(&ag, "combat.attackerRatioExp")?,
            contact_loss_day: num(&ag, "combat.contactLossDay")?,
            size: ag.pointer("/combat/sizeFactor/value").and_then(Value::as_array).map(|a| a.iter().filter_map(|p| Some((p.get(0)?.as_f64()?, p.get(1)?.as_f64()?))).collect()).unwrap_or_default(),
            tank_loss_factor: num(&ag, "combat.tankLossFactor")?,
            gun_loss_factor: num(&ag, "combat.gunLossFactor")?,
            attack_frontage: [num(&ag, "combat.attackFrontageKm.suRifle")?, num(&ag, "combat.attackFrontageKm.suTank")?, num(&ag, "combat.attackFrontageKm.de")?],
            defense_frontage: [num(&ag, "combat.defenseFrontageKm.su")?, num(&ag, "combat.defenseFrontageKm.de")?],
            breakpoint_loss: num(&ag, "combat.breakpointLoss")?,
            artillery: {
                let tri = |k: &str| -> Result<[f64; 3], String> {
                    let a = ag.pointer(&format!("/combat/artillery/{k}/value")).and_then(Value::as_array).ok_or_else(|| format!("правила: нет combat.artillery.{k}"))?;
                    let v: Vec<f64> = a.iter().filter_map(Value::as_f64).collect();
                    if v.len() != 3 { return Err(format!("правила: combat.artillery.{k} — три числа")); }
                    Ok([v[0], v[1], v[2]])
                };
                Artillery {
                    loss_by_position: tri("lossByPosition")?,
                    positions: tri("troopsByPosition")?,
                    norm_density: num(&ag, "combat.artillery.normDensityPerKm")?,
                    norm_duration_min: num(&ag, "combat.artillery.normDurationMin")?,
                    depth_km: num(&ag, "combat.artillery.depthKm")?,
                    cohesion_factor: num(&ag, "combat.artillery.cohesionFactor")?,
                }
            },
        };
        let doctrine = Doctrine {
            cycle_hours: num(&ag, "doctrine.de.cycleHours")?,
            counterattack_trigger: num(&ag, "doctrine.de.counterattackTrigger")?,
            counterattack_ratio: num(&ag, "doctrine.de.counterattackRatio")?,
            withdraw_strength_share: num(&ag, "doctrine.de.withdrawStrengthShare")?,
            withdraw_cohesion: num(&ag, "doctrine.de.withdrawCohesion")?,
            hold_orders: ag.pointer("/doctrine/de/holdOrders/value").and_then(Value::as_bool).unwrap_or(false),
            block_depth_km: num(&ag, "doctrine.de.blockDepthKm")?,
            withdraw_step_km: num(&ag, "doctrine.de.withdrawStepKm")?,
            penetration_depth_km: num(&ag, "doctrine.de.penetrationDepthKm")?,
        };
        let pocket = Pocket {
            zoc_km: num(&ag, "pocket.zocKm")?,
            hold_km: num(&ag, "pocket.holdKm")?,
            own_km: num(&ag, "pocket.ownKm")?,
            link_km: num(&ag, "pocket.linkKm")?,
            encircle_hours: num(&ag, "pocket.encircleHours")?,
            release_hours: num(&ag, "pocket.releaseHours")?,
            breakout_keep: num(&ag, "pocket.breakoutKeep")?,
            breakout_loss_day: num(&ag, "pocket.breakoutLossDay")?,
            breakout_km_day: num(&ag, "pocket.breakoutKmDay")?,
            surrender_ammo: num(&ag, "pocket.surrenderAmmo")?,
            surrender_hours: num(&ag, "pocket.surrenderHours")?,
            surrender_hours_firm: num(&ag, "pocket.surrenderHoursFirm")?,
        };
        let remnants = Remnants {
            de_share: num(&ag, "remnants.de.share")?,
            de_consolidate_hours: num(&ag, "remnants.de.consolidateHours")?,
            de_search_km: num(&ag, "remnants.de.searchKm")?,
            de_personnel_share: num(&ag, "remnants.de.personnelShare")?,
            de_heavy_share: num(&ag, "remnants.de.heavyShare")?,
            su_personnel: num(&ag, "remnants.su.personnel")?,
            rear_km: num(&ag, "remnants.rearKm")?,
        };
        let doctrine_su = DoctrineSu {
            cycle_hours: num(&ag, "doctrine.su.cycleHours")?,
            first_echelon_share: num(&ag, "doctrine.su.firstEchelonShare")?,
            commit_depth_km: num(&ag, "doctrine.su.commitDepthKm")?,
            second_echelon_fallback_hours: num(&ag, "doctrine.su.secondEchelonFallbackHours")?,
            tank_commit_depth_km: num(&ag, "doctrine.su.tankCommitDepthKm")?,
            tank_commit_fallback_hours: num(&ag, "doctrine.su.tankCommitFallbackHours")?,
        };
        Ok(Rules {
            doctrine,
            doctrine_su,
            remnants,
            pocket,
            combat,
            su,
            de,
            march_kmh: [num(&ag, "march.kmh.foot")?, num(&ag, "march.kmh.motor")?, num(&ag, "march.kmh.tracked")?],
            night_factor: num(&ag, "march.nightFactor")?,
            march_hours_normal: num(&ag, "march.hoursPerDay.normal")?,
            march_hours_forced: num(&ag, "march.hoursPerDay.forced")?,
            column_km: sz("march.columnKm")?,
            start_orders_delivered: num(&ag, "orders.startDelivered")? > 0.0,
            enemy_territory_km_day: [num(&ag, "march.enemyTerritoryKmDay.foot")?, num(&ag, "march.enemyTerritoryKmDay.motor")?, num(&ag, "march.enemyTerritoryKmDay.tracked")?],
            deploy_hours: sz("deployHours")?,
            frontage_km: sz("frontageKm")?,
            contact_km: num(&ag, "contactKm")?,
            advance: curve(&cal, "advance")?,
            attacker_loss: curve(&cal, "attackerLoss")?,
            defender_loss: curve(&cal, "defenderLoss")?,
            defense_terrain,
            prepared: num(&cal, "defense.prepared")?,
            prepare_hours: num(&cal, "defense.prepareHours")?,
            fortification_per_level: num(&cal, "defense.fortificationPerLevel")?,
            fort_advance_km: cal.get("fortAdvanceKm").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_f64).collect()).unwrap_or_default(),
            advance_terrain: {
                let mut a = [1.0; 6];
                for (t, cls) in TERRAIN.iter().enumerate() { if let Some(v) = cal.get("advanceTerrain").and_then(|x| x.get(*cls)).and_then(Value::as_f64) { a[t] = v; } }
                a
            },
            river_cross_hours: num(&cal, "riverCrossHours")?,
            bridging_hours: num(&ag, "march.bridgingHours")?,
            ammo_short: num(&cal, "ammoShort")?,
            fuel_out: num(&cal, "fuelOut")?,
            fatigue_effect: num(&cal, "fatigueEffect")?,
            fatigue_gain: (num(&cal, "fatigueGain.combat")?, num(&cal, "fatigueGain.march")?, num(&cal, "fatigueGain.rest")?),
            noise: num(&cal, "noise")?,
            stop_ammo: num(&ag, "attackStop.ammo")?,
            rout_cohesion: num(&ag, "routThreshold.cohesion")?,
            cohesion_loss_factor: num(&ag, "cohesion.combatLossFactor")?,
            cohesion_recover: num(&ag, "cohesion.recoverPerHour")?,
            destroyed_personnel: num(&ag, "destroyedPersonnel")?,
        })
    }

    pub fn side(&self, s: Side) -> &SideRules { match s { Side::Su => &self.su, Side::De => &self.de } }

    /// Скорость, км/ч, в клетке с дорогой `road` и местностью `terrain`, днём или ночью.
    #[inline]
    pub fn speed_kmh(&self, side: Side, mob: Mobility, road: u8, terrain: u8, night: bool) -> f64 {
        let base = self.march_kmh[mob as usize] * if night { self.night_factor } else { 1.0 };
        if road > 0 { base } else { base * self.side(side).off_road[mob as usize][terrain as usize] }
    }

    pub fn size(&self, arr: &[f64; 3], c: SizeClass) -> f64 { arr[c as usize] }
}
