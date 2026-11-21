import { useState } from 'react';
import { defaultConductEvents, type ConductEvent } from './types';

export function LinkedPanels({ events = defaultConductEvents, mapTitle = 'Карта', onSelect }: {
  events?: readonly ConductEvent[];
  mapTitle?: string;
  onSelect?: (event: ConductEvent) => void;
}) {
  const [selected, setSelected] = useState<ConductEvent | null>(null);
  const current = selected ?? events[0] ?? null;
  return <section className="kshvi-linked" aria-label="Связанные карта, лента, документы и время">
    <div className="kshvi-linked-grid">
      <article className="kshvi-conduct-panel kshvi-map" aria-label={mapTitle}>
        <h2>{mapTitle}</h2>
        <p>Единая зафиксированная картографическая основа</p>
        <div className="kshvi-map-marker" aria-label="Разрешённая геометрия">{current?.geometry ?? 'Нет разрешённой геометрии'}</div>
      </article>
      <article className="kshvi-conduct-panel">
        <h2>Лента событий</h2>
        {events.length ? <ol>{events.map(event => <li key={event.id}><span>{event.operationalAt} · {event.title}</span></li>)}</ol> : <p>Событий нет</p>}
        {events[0] && <button type="button" onClick={() => { setSelected(events[0]); onSelect?.(events[0]); }}>Просмотреть событие</button>}
      </article>
      <article className="kshvi-conduct-panel">
        <h2>Документы и расчёт</h2>
        {selected ? <>
          <p>Режим просмотра прошлого</p><p>Момент: {selected.operationalAt}</p>
          <p>Документ: {selected.document}</p><p>Расчёт: {selected.calculation}</p><p>Состояние: {selected.state}</p>
          <button type="button" onClick={() => setSelected(null)}>К текущему времени</button>
        </> : <p>Текущее время; выберите событие для связанного просмотра.</p>}
      </article>
    </div>
  </section>;
}
