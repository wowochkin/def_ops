import type { AutonomyCatalogItem } from '../kshvi-api';

const availabilityLabels = { AVAILABLE: 'Допустимо', UNAVAILABLE: 'Недопустимо', UNKNOWN_DATA: 'Недостаточно данных' } as const;

export function EventTemplateCard({ item }: { item: AutonomyCatalogItem }) {
  const { template } = item;
  return <article className="event-template-card" data-availability={item.availability}>
    <details>
      <summary><strong>{template.title}</strong><span>{template.category} · {availabilityLabels[item.availability]}</span></summary>
      <p>{template.description}</p>
      <p>Учебный вопрос: {template.learningQuestion}</p>
      <p>Тяжесть: {template.severity.cost}; базовый вес: {template.baseWeight}; версия {template.version}</p>
      {!!item.reasons.length && <ul aria-label="Причины доступности">{item.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      <h4>Предусловия</h4>
      {template.preconditions.length ? <ul>{template.preconditions.map((condition, index) => <li key={index}>{condition.fact} {condition.operator} {String(condition.value)}</li>)}</ul> : <p>Дополнительных предусловий нет</p>}
      <h4>Последствия</h4>
      {template.effects.length ? <ul>{template.effects.map((effect, index) => <li key={index}>{effect.type}{effect.type === 'catalog.effect' ? `: ${effect.reason}` : ''}</li>)}</ul> : <p>Типизированных последствий нет</p>}
      <small>{template.provenance.type === 'TRAINING_ASSUMPTION'
        ? `${template.provenance.statement}; ${template.provenance.rationale}; ${template.provenance.approvedBy}`
        : `${template.provenance.citation}; ${template.provenance.locator}; ${template.provenance.approvedBy}`}</small>
    </details>
  </article>;
}
