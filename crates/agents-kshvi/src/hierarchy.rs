use crate::choice::{AgentProjection, ModernChoice, ModernOrder, ModernReport};

/// Формирует только приказы по собственной иерархии. Доставка — предложение для серверной модели связи,
/// а не запись в официальный журнал.
pub fn issue_modern_orders(
    projection: &AgentProjection,
    choice: &ModernChoice,
    delay: u32,
) -> Vec<ModernOrder> {
    if choice.command_type.is_none() || choice.kind == "ESCALATE" {
        return Vec::new();
    }
    let mut recipients: Vec<String> = projection
        .reports
        .iter()
        .map(|report| report.sender.clone())
        .filter(|sender| sender.starts_with("hq-") && sender != &projection.agent_id)
        .collect();
    recipients.sort();
    recipients.dedup();
    recipients
        .into_iter()
        .map(|recipient| ModernOrder {
            id: format!(
                "modern-order:{}:{}:{}",
                projection.agent_id, projection.tick, recipient
            ),
            recipient,
            channel: "own-command-network".into(),
            issued_tick: projection.tick,
            delivery_tick: projection.tick + delay,
            choice_id: choice.id.clone(),
        })
        .collect()
}

/// Донесения остаются в пределах уже разрешённой проекции и собственной сети штабов.
pub fn own_reports(projection: &AgentProjection) -> Vec<ModernReport> {
    projection
        .reports
        .iter()
        .filter(|report| report.recipient.starts_with("hq-"))
        .cloned()
        .collect()
}
