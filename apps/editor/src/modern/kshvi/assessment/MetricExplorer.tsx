export type MetricExplorerValue = {
  id: string;
  formula: string;
  version: number;
  unit: string;
  period: string;
  value: number | 'UNKNOWN';
  missingData: readonly string[];
  evidenceIds: readonly string[];
};

export function MetricExplorer({ metric, onEvidence }: { metric: MetricExplorerValue; onEvidence: (eventId: string) => void }) {
  return <section aria-label={`Метрика ${metric.id}`}>
    <h2>Показатель {metric.id}</h2>
    <code>{metric.formula}</code>
    <p>Версия {metric.version}; единицы: {metric.unit}; период: {metric.period}</p>
    <output>Значение: {metric.value}{typeof metric.value === 'number' ? ` ${metric.unit}` : ''}</output>
    {metric.value === 'UNKNOWN' && <p role="note">Неизвестное не заменяется нулём. Пропуски: {metric.missingData.join(', ')}</p>}
    <div>{metric.evidenceIds.map(eventId => <button key={eventId} onClick={() => onEvidence(eventId)}>Доказательство {eventId}</button>)}</div>
  </section>;
}
