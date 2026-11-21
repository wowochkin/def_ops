pub mod choice;
pub mod fork;
pub mod hierarchy;
pub mod profile;
pub mod rng;
pub mod utility;

use choice::{
    AgentProjection, ModernCommand, ModernOrder, ModernReport, MpsState, Observation, OwnForce,
    OwnOrder, Resources, ScoredModernChoice, Terrain, Weather,
};
use fork::{hash_json, OfficialState, OfficialWorld, WorldFork};
use profile::ProfileSource;
use serde::{Deserialize, Serialize};

pub use choice::ModernChoice;
pub use profile::ModernAgentProfile;
pub use rng::{ModernStream, SeededModernRng};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HiddenTruth {
    pub enemy_strength: f64,
    pub trainee_drafts: Vec<String>,
    pub future_inputs: Vec<String>,
}

#[derive(Clone, Debug)]
pub struct ModernFixture {
    pub profile: ModernAgentProfile,
    pub projection: AgentProjection,
    pub official: OfficialWorld,
    pub hidden_truth: HiddenTruth,
    pub seed: u64,
}

impl ModernFixture {
    pub fn official_hash(&self) -> String {
        self.official.hash()
    }
    pub fn official_rng_cursor(&self) -> u64 {
        self.official.rng_cursor
    }
    pub fn profile_sources(&self) -> Vec<&ProfileSource> {
        vec![&self.profile.source]
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DecisionTrace {
    pub choice: String,
    pub input_hash: String,
    pub factors: Vec<String>,
    pub profile_version: String,
    pub search_depth: u32,
    pub horizon_ticks: u32,
    pub review_cycle_ticks: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Evaluation {
    pub selected: ModernChoice,
    pub options: Vec<ScoredModernChoice>,
    pub unknown: Vec<String>,
    pub fork_hashes: Vec<String>,
    pub destroyed_forks: usize,
    pub orders: Vec<ModernOrder>,
    pub reports: Vec<ModernReport>,
    pub commands: Vec<ModernCommand>,
    pub trace: DecisionTrace,
}

impl Evaluation {
    pub fn trace_json(&self) -> String {
        serde_json::to_string(self).expect("след решения сериализуется")
    }
}

pub fn modern_fixture() -> ModernFixture {
    let profile: ModernAgentProfile = serde_json::from_str(include_str!(
        "../../../packages/kshvi-agents/data/modern-profiles/balanced.json"
    ))
    .expect("встроенный современный профиль");
    ModernFixture {
        profile,
        projection: AgentProjection {
            instance_id: "instance-modern".into(),
            revision: 3,
            agent_id: "red-command".into(),
            tick: 8,
            own_orders: vec![OwnOrder {
                id: "order-current".into(),
                kind: "ADVANCE".into(),
                issued_tick: 2,
            }],
            observations: vec![Observation {
                id: "observation-own".into(),
                observed_tick: 7,
                strength: Some(0.5),
                confidence: Some(0.9),
                source: Some("own-reconnaissance".into()),
                uncertainty: Some(0.1),
            }],
            reports: vec![ModernReport {
                id: "report-own".into(),
                sender: "hq-sub".into(),
                recipient: "hq-red".into(),
                tick: 7,
                text: "Донесение собственного подчинённого штаба".into(),
            }],
            own_forces: vec![OwnForce {
                id: "force-own".into(),
                hq_id: "hq-red".into(),
                mps: MpsState {
                    confidence: Some(0.85),
                    stress: Some(0.1),
                },
                operational_equipment: Some(4),
                total_equipment: Some(4),
            }],
            resources: Resources {
                supply_fraction: Some(0.9),
            },
            terrain: Terrain {
                route_open: Some(true),
            },
            weather: Weather {
                movement_factor: Some(0.9),
            },
        },
        official: OfficialWorld {
            state: OfficialState {
                forces: vec!["force-own".into()],
                resources: vec!["supply-own".into()],
                events: vec!["official-start".into()],
            },
            rng_cursor: 0,
            outbox: Vec::new(),
        },
        hidden_truth: HiddenTruth {
            enemy_strength: 0.1,
            trainee_drafts: Vec::new(),
            future_inputs: Vec::new(),
        },
        seed: 41,
    }
}

pub fn evaluate_choices(fixture: &ModernFixture) -> Evaluation {
    fixture
        .profile
        .validate()
        .expect("современный профиль должен быть валиден");
    let unknown = required_unknowns(&fixture.projection);
    let mut choices = if unknown.is_empty() {
        available_choices(fixture)
    } else {
        vec![safe_choice(fixture)]
    };
    choices.truncate(fixture.profile.option_count.max(1));

    let current_kind = fixture
        .projection
        .own_orders
        .last()
        .map(|order| order.kind.as_str());
    let mut scored = Vec::new();
    let mut fork_hashes = Vec::new();
    let mut destroyed_forks = 0;
    for choice in &choices {
        let continuing =
            (choice.kind == "CONTINUE_ORDER") || (choice.kind == current_kind.unwrap_or(""));
        let mut utility = utility::modern_utility(choice, &fixture.profile, continuing);
        let mut local_rng = SeededModernRng::new(
            fixture.seed,
            stable_agent_id(&fixture.projection.agent_id),
            fixture.projection.tick,
            ModernStream::Decision,
        );
        let mut fork = WorldFork::create(
            &fixture.official,
            format!(
                "optionEvaluation:{}:{}:{}",
                fixture.projection.agent_id, fixture.projection.tick, choice.id
            ),
        );
        let jitter = fork
            .evaluate(
                &choice.id,
                fixture.profile.search_depth * fixture.profile.horizon_ticks,
                &mut local_rng,
            )
            .expect("новый форк доступен");
        utility += jitter;
        fork_hashes.push(fork.hash().expect("форк доступен до уничтожения"));
        fork.destroy();
        destroyed_forks += 1;
        scored.push((
            ScoredModernChoice {
                id: choice.id.clone(),
                utility,
                uncertainty: choice.uncertainty,
                losses: choice.losses,
            },
            utility,
        ));
    }
    let selected_index = scored
        .iter()
        .enumerate()
        .max_by(|(ai, (_, av)), (bi, (_, bv))| av.total_cmp(bv).then_with(|| bi.cmp(ai)))
        .map(|(index, _)| index)
        .unwrap_or(0);
    let selected = choices[selected_index].clone();
    scored.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.id.cmp(&b.0.id)));
    let options = scored.into_iter().map(|(choice, _)| choice).collect();
    let safe = selected.command_type.is_none();
    let orders = if safe {
        Vec::new()
    } else {
        hierarchy::issue_modern_orders(
            &fixture.projection,
            &selected,
            fixture.profile.communication_delay_ticks,
        )
    };
    let commands = selected
        .command_type
        .as_ref()
        .map(|command_type| {
            vec![ModernCommand {
                command_type: command_type.clone(),
                instance_id: fixture.projection.instance_id.clone(),
                expected_revision: fixture.projection.revision,
                idempotency_key: format!(
                    "opponent:{}:{}:{}:{}",
                    fixture.projection.instance_id,
                    fixture.projection.agent_id,
                    fixture.projection.tick,
                    selected.id
                ),
                choice_id: selected.id.clone(),
            }]
        })
        .unwrap_or_default();
    let mut factors = vec![
        format!(
            "наблюдения: {} собственных сведений",
            fixture.projection.observations.len()
        ),
        format!(
            "МПС, техника, запасы, местность и погода из разрешённой проекции; выбран {}",
            selected.id
        ),
    ];
    if !unknown.is_empty() {
        factors.push("Недостаток данных: безопасное поведение без новых событий".into());
    }
    Evaluation {
        selected: selected.clone(),
        options,
        unknown,
        fork_hashes,
        destroyed_forks,
        orders,
        reports: hierarchy::own_reports(&fixture.projection),
        commands,
        trace: DecisionTrace {
            choice: selected.id,
            input_hash: hash_json(&fixture.projection),
            factors,
            profile_version: fixture.profile.version.clone(),
            search_depth: fixture.profile.search_depth,
            horizon_ticks: fixture.profile.horizon_ticks,
            review_cycle_ticks: fixture.profile.review_cycle_ticks,
        },
    }
}

fn required_unknowns(projection: &AgentProjection) -> Vec<String> {
    let mut unknown = Vec::new();
    if projection.observations.is_empty() {
        unknown.push("observations".into());
    }
    for observation in &projection.observations {
        if observation.strength.is_none() {
            unknown.push("observations.strength".into());
        }
        if observation.confidence.is_none() {
            unknown.push("observations.confidence".into());
        }
    }
    if projection.own_forces.is_empty() {
        unknown.push("ownForces".into());
    }
    for force in &projection.own_forces {
        if force.mps.confidence.is_none() {
            unknown.push("ownForces.mps.confidence".into());
        }
        if force.mps.stress.is_none() {
            unknown.push("ownForces.mps.stress".into());
        }
        if force.operational_equipment.is_none() || force.total_equipment.is_none() {
            unknown.push("ownForces.equipment".into());
        }
    }
    if projection.resources.supply_fraction.is_none() {
        unknown.push("resources.supplyFraction".into());
    }
    if projection.terrain.route_open.is_none() {
        unknown.push("terrain.routeOpen".into());
    }
    if projection.weather.movement_factor.is_none() {
        unknown.push("weather.movementFactor".into());
    }
    unknown.sort();
    unknown.dedup();
    unknown
}

fn safe_choice(fixture: &ModernFixture) -> ModernChoice {
    match fixture.profile.on_insufficient_data.as_str() {
        "CONTINUE_ORDER" if !fixture.projection.own_orders.is_empty() => ModernChoice::new(
            "continue-order",
            "CONTINUE_ORDER",
            "Продолжить действующий приказ",
            None,
        ),
        "ESCALATE" => ModernChoice::new(
            "escalate",
            "ESCALATE",
            "Запросить решение руководства",
            Some("agent.escalation.requested.v1"),
        ),
        _ => ModernChoice::new("hold", "HOLD", "Сохранить безопасное состояние", None),
    }
}

fn available_choices(fixture: &ModernFixture) -> Vec<ModernChoice> {
    let p = &fixture.projection;
    let profile = &fixture.profile;
    let observation = &p.observations[0];
    let force = &p.own_forces[0];
    let threat = observation.strength.unwrap();
    let observation_confidence = observation.confidence.unwrap();
    let mps_confidence = force.mps.confidence.unwrap();
    let mps_stress = force.mps.stress.unwrap();
    let supply = p.resources.supply_fraction.unwrap();
    let weather = p.weather.movement_factor.unwrap();
    let route_open = p.terrain.route_open.unwrap();
    let equipment = force.operational_equipment.unwrap();
    let equipment_total = force.total_equipment.unwrap().max(1);
    let equipment_fraction = equipment as f64 / equipment_total as f64;

    let mut out = Vec::new();
    if !p.own_orders.is_empty() {
        let mut choice = ModernChoice::new(
            "continue-order",
            "CONTINUE_ORDER",
            "Продолжить действующий приказ",
            Some("order.continue.v1"),
        );
        choice.contrib = [0.45, 0.0, 0.1, 0.0, 0.0, 0.2, 0.0];
        choice.uncertainty = 0.12;
        choice.losses = 0.04;
        out.push(choice);
    }
    let mut defend = ModernChoice::new(
        "defend",
        "DEFEND",
        "Оборонять доступный район",
        Some("force.defend.v1"),
    );
    defend.contrib = [0.35, 0.0, 0.5, 0.2, 0.0, 0.8, 0.1];
    defend.uncertainty = (1.0 - observation_confidence) * 0.4 + mps_stress * 0.15;
    defend.losses = 0.08 + threat * 0.03;
    out.push(defend);

    let advance_allowed = profile.initiative > 0.0
        && mps_confidence >= profile.min_advance_confidence
        && mps_stress <= profile.max_advance_stress
        && threat <= profile.max_advance_threat
        && equipment > 0
        && supply >= profile.min_supply_fraction
        && route_open
        && weather >= profile.min_movement_factor;
    if advance_allowed {
        let mut advance = ModernChoice::new(
            "advance",
            "ADVANCE",
            "Наступать по доступному маршруту",
            Some("force.advance.v1"),
        );
        advance.contrib = [1.2, 0.3, -0.2, -0.1, 0.8, -0.3, -0.1];
        advance.uncertainty = (1.0 - observation_confidence)
            + threat * 0.12
            + (1.0 - weather) * 0.2
            + (1.0 - mps_confidence) * 0.2;
        advance.losses = threat * 0.12 + (1.0 - supply) * 0.4 + (1.0 - equipment_fraction) * 0.5;
        out.push(advance);
    }
    if supply < profile.min_supply_fraction {
        let mut support = ModernChoice::new(
            "request-support",
            "REQUEST_SUPPORT",
            "Запросить восстановление снабжения",
            Some("logistics.support.requested.v1"),
        );
        support.contrib = [0.5, 0.0, 1.0, 0.1, 0.0, 0.3, 0.5];
        support.uncertainty = 0.1;
        support.losses = 0.0;
        out.push(support);
    }
    let mut withdraw = ModernChoice::new(
        "withdraw",
        "WITHDRAW",
        "Сократить риск и сохранить силы",
        Some("force.withdraw.v1"),
    );
    withdraw.contrib = [-0.2, 0.0, 1.2, 0.8, -0.2, 0.0, 1.0];
    withdraw.uncertainty = 0.1 + (1.0 - observation_confidence) * 0.2;
    withdraw.losses = 0.05 + (1.0 - mps_confidence) * 0.1;
    out.push(withdraw);
    out
}

fn stable_agent_id(agent_id: &str) -> u32 {
    agent_id
        .bytes()
        .fold(0u32, |hash, byte| hash.wrapping_mul(16777619) ^ byte as u32)
}
