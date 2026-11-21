use agents_kshvi::{
    evaluate_choices, modern_fixture, ModernAgentProfile, ModernStream, SeededModernRng,
};

fn selected(fixture: &agents_kshvi::ModernFixture) -> String {
    evaluate_choices(fixture).selected.id
}

#[test]
fn option_fork_does_not_change_official_world_or_random_stream() {
    let fixture = modern_fixture();
    let official_before = fixture.official_hash();
    let rng_before = fixture.official_rng_cursor();
    let evaluation = evaluate_choices(&fixture);
    assert!(evaluation
        .fork_hashes
        .iter()
        .all(|hash| hash != &official_before));
    assert_eq!(evaluation.destroyed_forks, evaluation.options.len());
    assert_eq!(fixture.official_hash(), official_before);
    assert_eq!(fixture.official_rng_cursor(), rng_before);
    assert!(fixture
        .profile_sources()
        .iter()
        .all(|source| source.era == "modern"));
}

#[test]
fn modern_profile_is_versioned_and_has_an_explicit_assumption() {
    let profile: ModernAgentProfile = serde_json::from_str(include_str!(
        "../../../packages/kshvi-agents/data/modern-profiles/balanced.json"
    ))
    .expect("современный профиль читается");
    profile.validate().expect("профиль имеет паспорт");
    assert_eq!(profile.version, "modern-opponent-1");
    assert_eq!(profile.source.kind, "ASSUMPTION");
    assert!(!profile.source.reference.is_empty());
    assert!(profile.search_depth >= 1);
    assert!(profile.option_count >= 2);
    assert!(profile.horizon_ticks >= 1);
    assert!(profile.review_cycle_ticks >= 1);
}

#[test]
fn same_seed_repeats_the_whole_decision_trace_and_separates_streams() {
    let fixture = modern_fixture();
    let first = evaluate_choices(&fixture);
    let second = evaluate_choices(&fixture);
    assert_eq!(first.trace_json(), second.trace_json());

    let mut a = SeededModernRng::new(17, 3, 8, ModernStream::Decision);
    let mut b = SeededModernRng::new(17, 3, 8, ModernStream::Decision);
    let mut other = SeededModernRng::new(17, 3, 8, ModernStream::Communication);
    assert_eq!(a.next_u64(), b.next_u64());
    assert_ne!(a.next_u64(), other.next_u64());
    assert_eq!(fixture.official_rng_cursor(), 0);
}

#[test]
fn ac27_accessible_observation_changes_choice_but_hidden_truth_does_not() {
    let baseline = modern_fixture();
    let baseline_evaluation = evaluate_choices(&baseline);

    let mut observed = baseline.clone();
    observed.projection.observations[0].strength = Some(4.0);
    observed.projection.observations[0].confidence = Some(1.0);
    let observed_evaluation = evaluate_choices(&observed);
    assert_ne!(
        baseline_evaluation.selected.id,
        observed_evaluation.selected.id
    );
    assert!(observed_evaluation.trace_json().contains("наблюд"));

    let mut hidden = baseline.clone();
    hidden.hidden_truth.enemy_strength = 1000.0;
    hidden.hidden_truth.trainee_drafts = vec!["секретный черновик".into()];
    hidden.hidden_truth.future_inputs = vec!["будущая вводная".into()];
    assert_eq!(
        baseline_evaluation.trace_json(),
        evaluate_choices(&hidden).trace_json()
    );
}

#[test]
fn decisions_depend_on_mps_equipment_supplies_terrain_and_weather() {
    let baseline = modern_fixture();
    assert_eq!(selected(&baseline), "advance");

    let mut low_mps = baseline.clone();
    low_mps.projection.own_forces[0].mps.confidence = Some(0.1);
    low_mps.projection.own_forces[0].mps.stress = Some(0.95);
    assert_ne!(selected(&baseline), selected(&low_mps));

    let mut broken = baseline.clone();
    broken.projection.own_forces[0].operational_equipment = Some(0);
    assert_ne!(selected(&baseline), selected(&broken));

    let mut no_supplies = baseline.clone();
    no_supplies.projection.resources.supply_fraction = Some(0.05);
    assert_eq!(selected(&no_supplies), "request-support");

    let mut closed_terrain = baseline.clone();
    closed_terrain.projection.terrain.route_open = Some(false);
    assert_ne!(selected(&baseline), selected(&closed_terrain));

    let mut severe_weather = baseline.clone();
    severe_weather.projection.weather.movement_factor = Some(0.1);
    assert_ne!(selected(&baseline), selected(&severe_weather));
}

#[test]
fn missing_data_uses_safe_order_or_escalation_without_inventing_events() {
    let mut fixture = modern_fixture();
    fixture.projection.observations[0].strength = None;
    let before = fixture.official_hash();
    let evaluation = evaluate_choices(&fixture);
    assert_eq!(evaluation.selected.id, "continue-order");
    assert_eq!(evaluation.selected.kind, "CONTINUE_ORDER");
    assert!(evaluation
        .unknown
        .contains(&"observations.strength".to_string()));
    assert!(evaluation.commands.is_empty());
    assert_eq!(fixture.official_hash(), before);

    let mut escalate = fixture.clone();
    escalate.profile.on_insufficient_data = "ESCALATE".into();
    assert_eq!(evaluate_choices(&escalate).selected.kind, "ESCALATE");
}

#[test]
fn hierarchy_delivers_orders_and_reports_through_communication_model() {
    let fixture = modern_fixture();
    let evaluation = evaluate_choices(&fixture);
    assert!(!evaluation.orders.is_empty());
    assert!(evaluation
        .orders
        .iter()
        .all(|order| order.delivery_tick >= order.issued_tick));
    assert!(evaluation
        .orders
        .iter()
        .all(|order| order.channel == "own-command-network"));
    assert!(evaluation
        .reports
        .iter()
        .all(|report| report.recipient.starts_with("hq-")));
}
