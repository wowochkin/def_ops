import { useState } from 'react';
import type { ConductEvent, ConductProjection } from './types';

export function LinkedPanels({ events, live, mapTitle, onSelect }: {
  events: readonly ConductEvent[];
  live: ConductProjection['live'];
  mapTitle: string;
  onSelect?: (event: ConductEvent) => void;
}) {
  const [selected, setSelected] = useState<ConductEvent | null>(null);
  const current = selected ? { geometry: selected.geometry, document: selected.document, calculation: selected.calculation, state: selected.state } : live;
  return <section className="kshvi-linked" aria-label="Связанные карта, лента, документы и время">
    <div className="kshvi-linked-grid">
      <article className="kshvi-conduct-panel kshvi-map" aria-label={mapTitle}><h2>{mapTitle}</h2><p>Зафиксированная картографическая основа снимка учения</p><div className="kshvi-map-marker" aria-label="Разрешённая геометрия">{current.geometry}</div></article>
      <article className="kshvi-conduct-panel"><h2>Лента событий</h2>
        {events.length ? <ol>{events.map(event => <li key={event.id}><span>{event.operationalAt} · {event.title}</span><button type="button" aria-label={`Просмотреть событие ${event.id}`} onClick={() => { setSelected(event); onSelect?.(event); }}>Просмотреть</button></li>)}</ol> : <p>Событий нет</p>}
      </article>
      <article className="kshvi-conduct-panel"><h2>Документы и расчёт</h2>
        {selected ? <><p>Режим просмотра прошлого</p><p>Момент: {selected.operationalAt}</p><p>Документ: {selected.document}</p><p>Расчёт: {selected.calculation}</p><p>Состояние: {selected.state}</p><button type="button" onClick={() => setSelected(null)}>К текущему времени</button></>
          : <><p>Документ: {live.document}</p><p>Расчёт: {live.calculation}</p><p>Состояние: {live.state}</p></>}
      </article>
    </div>
  </section>;
}
