export function AutonomyMonitor({ attempts }: { attempts: { id: string; category: string; selectedTemplateId: string | null; reason: string }[] }) {
  return <section><h2>Попытки планировщика</h2>{attempts.map(attempt => <p key={attempt.id}>{attempt.category}: <span>{attempt.selectedTemplateId ?? (attempt.reason === 'UNKNOWN_REQUIRED_PRECONDITION' ? 'Пустая попытка: обязательное значение неизвестно' : `Пустая попытка: ${attempt.reason}`)}</span></p>)}</section>;
}
