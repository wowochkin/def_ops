export function AgentDecisionTraceView({ selected, alternatives, unknown, hiddenProjection }: { selected: string; alternatives: string[]; unknown: string[]; hiddenProjection?: unknown }) {
  void hiddenProjection;
  return <section><h2>След решения агента</h2><p>Выбрано: {selected}</p><p>Альтернативы отклонены: {alternatives.join(', ')}</p><p>Неизвестные данные: {unknown.join(', ') || 'нет'}</p><p>Проекция доступна только по назначению; скрытые поля не выводятся</p></section>;
}
