export function AgentAssignmentPanel({ mode, currentTask, authorities }: { mode: 'ADVISORY' | 'DELEGATED' | 'AUTONOMOUS'; currentTask: string; authorities: string[] }) {
  return <section><h2>Электронный посредник</h2><p>Режим: <strong>{mode}</strong></p><p>Текущая задача: {currentTask}</p><p>Полномочия: {authorities.join(', ')}</p></section>;
}
