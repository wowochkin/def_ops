export type ObservationCardModel = {
  id: string;
  source: { id: string; kind: string; sideId: string; profileVersion: string };
  observedAt: string;
  deliveredAt: string;
  validUntil: string;
  reportedGeometry: { lon: number; lat: number };
  reportedAttributes: Record<string, unknown>;
  reportedAccuracyMeters: number;
  completeness: number;
  reliability: number;
  status: 'CURRENT' | 'STALE' | 'CONTRADICTED';
  staleSince?: string;
};

export function ObservationCard({ observation }: { observation: ObservationCardModel }) {
  return <article className={`kshvi-observation kshvi-observation-${observation.status.toLowerCase()}`} aria-labelledby={`observation-${observation.id}`}>
    <h3 id={`observation-${observation.id}`}>Наблюдение {observation.id}</h3>
    <p>{observation.source.kind} · {observation.source.id}</p>
    <dl>
      <div><dt>Наблюдено</dt><dd>{observation.observedAt}</dd></div>
      <div><dt>Доставлено</dt><dd>{observation.deliveredAt}</dd></div>
      <div><dt>Действительно до</dt><dd>{observation.validUntil}</dd></div>
      <div><dt>Предполагаемое положение</dt><dd>{observation.reportedGeometry.lon.toFixed(5)}, {observation.reportedGeometry.lat.toFixed(5)}</dd></div>
    </dl>
    <p>±{observation.reportedAccuracyMeters} м</p>
    <p>Полнота: {Math.round(observation.completeness * 100)} %; достоверность: {Math.round(observation.reliability * 100)} %</p>
    {observation.status === 'STALE' && <p className="kshvi-data-stale">Устарело</p>}
    {observation.status === 'CONTRADICTED' && <p className="kshvi-data-unknown">Противоречивые сведения</p>}
  </article>;
}
