const DOMAIN_LABELS: Record<string, string> = {
  Map: 'Карта', Weather: 'Погода', Resources: 'Ресурсы', Tasks: 'Задачи', Documents: 'Документы',
  Communications: 'Связь', Decisions: 'Решения', Assessments: 'Оценки', MoralePsych: 'МПС',
  Readiness: 'Готовность', Equipment: 'Техника', ReadinessActivities: 'Мероприятия готовности',
  Formation: 'Оперативное построение', SupplyRequests: 'Заявки МТО', SupplyMovements: 'Движение поставок',
  RepairEvacuation: 'Ремонт и эвакуация', TerrainVersions: 'Версии местности', SchedulerAttempts: 'Попытки планировщика',
  AgentCycles: 'Циклы агентов', AgentInterceptions: 'Перехваты агентов', Observations: 'Наблюдения', EventFeed: 'Лента событий',
};

function printable(value: unknown): string {
  if (value === undefined) return 'Нет данных';
  const serialized = JSON.stringify(value);
  return serialized === undefined ? 'Нет данных' : serialized;
}

export function SynchronizedPanels({ domains, sequence }: { domains: Record<string, unknown>; sequence: number }) {
  return <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>
    {Object.entries(domains).map(([domain, value]) => <article
      key={domain} data-testid="replay-panel" data-sequence={sequence} data-domain={domain}
      style={{ border: '1px solid #75838b', borderRadius: 6, padding: 10, minWidth: 0 }}
    >
      <h3 style={{ marginTop: 0 }}>{DOMAIN_LABELS[domain] ?? domain}</h3>
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 150, overflow: 'auto' }}>{printable(value)}</pre>
      <small>Курсор: {sequence}</small>
    </article>)}
  </div>;
}
