import type { AutonomyRehearsalResponse } from '../kshvi-api';

export function RehearsalReport({ attempts, report }: {
  attempts?: { category: string; selected: string | null; reason: string }[];
  report?: AutonomyRehearsalResponse;
}) {
  if (report) return <section aria-label="Репетиция распределения">
    <h2>Репетиция распределения</h2>
    <p>Алгоритм {report.algorithmVersion}; каталог {report.catalogVersion}; SHA-256 {report.sha256}</p>
    <table><thead><tr><th>Зерно</th><th>Профиль</th><th>Попытки</th><th>События</th><th>Пустые интервалы</th><th>Предупреждения</th></tr></thead>
      <tbody>{report.runs.map(run => <tr key={`${run.seed}-${run.profileLevel}`}>
        <td>{run.seed}</td><td>{run.profileLevel}</td><td>{run.attemptCount}</td><td>{run.eventCount}</td><td>{run.emptyIntervals}</td><td>{run.overloadWarnings.length}</td>
      </tr>)}</tbody></table>
    <p>Репетиция выполнена изолированно и не записывает события в официальный журнал.</p>
  </section>;
  return <section><h2>Репетиция распределения</h2>{(attempts ?? []).map((attempt, index) => <p key={index}>{attempt.category}: <span>{attempt.selected ?? 'Нет допустимого шаблона; попытка сохранена'}</span></p>)}</section>;
}
