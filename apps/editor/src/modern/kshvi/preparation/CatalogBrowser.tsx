import { useState } from 'react';
import type { AutonomyCatalogItem } from '../kshvi-api';
import { EventTemplateCard } from './EventTemplateCard';

export function CatalogBrowser({ total, categories, operations, items }: {
  total?: number;
  categories?: number;
  operations?: number;
  items?: readonly AutonomyCatalogItem[];
}) {
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState('ALL');
  const visible = (items ?? []).filter(item => {
    const text = `${item.template.title} ${item.template.description} ${item.template.category}`.toLocaleLowerCase('ru');
    return (!query.trim() || text.includes(query.trim().toLocaleLowerCase('ru')))
      && (availability === 'ALL' || item.availability === availability);
  });
  return <section aria-label="Библиотека событий">
    <h2>Библиотека событий</h2>
    {items ? <>
      <p>{items.length} шаблонов · показано {visible.length}</p>
      <label>Поиск по событиям<input type="search" value={query} onChange={event => setQuery(event.target.value)} /></label>
      <label>Доступность<select value={availability} onChange={event => setAvailability(event.target.value)}>
        <option value="ALL">Все</option><option value="AVAILABLE">Допустимо</option>
        <option value="UNAVAILABLE">Недопустимо</option><option value="UNKNOWN_DATA">Недостаточно данных</option>
      </select></label>
      <div className="event-catalog-list">{visible.map(item => <EventTemplateCard key={`${item.template.templateId}@${item.template.version}`} item={item} />)}</div>
      {!visible.length && <p>По выбранным условиям событий нет</p>}
    </> : <p>{total} событий · {categories} категорий · {operations} операций</p>}
  </section>;
}
