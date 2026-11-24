export function RehearsalReport({ attempts }: { attempts: { category: string; selected: string | null; reason: string }[] }) {
  return <section><h2>Репетиция распределения</h2>{attempts.map((attempt, index) => <p key={index}>{attempt.category}: <span>{attempt.selected ?? 'Нет допустимого шаблона; попытка сохранена'}</span></p>)}</section>;
}
