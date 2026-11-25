import { useMemo, useState } from 'react';
import { renderSymbol, type SymbolDefinition } from '@def-ops/tactical-symbols';
import { topicLabels } from '../../symbols/SourceDocuments';

const kindLabel = { POINT: 'Точка', LINE: 'Линия', AREA: 'Область' };

export function InitialMapSymbolPalette({ symbols, selectedId, onSelect, disabled = false }: {
  symbols: readonly SymbolDefinition[];
  selectedId: string;
  onSelect(symbol: SymbolDefinition): void;
  disabled?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('');
  const [category, setCategory] = useState('');
  const [limit, setLimit] = useState(24);
  const categories = useMemo(() => [...new Set(symbols.map(symbol => symbol.forceType))].sort(), [symbols]);
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase('ru');
    return symbols.filter(symbol => (!kind || symbol.kind === kind) && (!category || symbol.forceType === category)
      && (!search || [symbol.id, symbol.name, symbol.code, symbol.source.symbolNumber, symbol.purpose]
        .some(value => value?.toLocaleLowerCase('ru').includes(search))));
  }, [symbols, query, kind, category]);
  return <aside className="initial-editor-palette" aria-label="Палитра знаков">
    <h3>Знаки и инструменты</h3>
    <label>Поиск знака<input value={query} onChange={event => { setQuery(event.target.value); setLimit(24); }} /></label>
    <label>Геометрия знака<select value={kind} onChange={event => { setKind(event.target.value); setLimit(24); }}>
      <option value="">Все виды</option>{Object.entries(kindLabel).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
    </select></label>
    <label>Категория знака<select value={category} onChange={event => { setCategory(event.target.value); setLimit(24); }}>
      <option value="">Все категории</option>{categories.map(id => <option key={id} value={id}>{(topicLabels as Readonly<Record<string, string>>)[id] ?? 'Другие знаки'}</option>)}
    </select></label>
    <p role="status">Найдено {matches.length} · показано {Math.min(limit, matches.length)}</p>
    <div className="initial-editor-symbols">{matches.slice(0, limit).map(symbol => <button type="button" key={symbol.id}
      aria-pressed={selectedId === symbol.id} disabled={disabled || !['MAPPED', 'VERIFIED', 'APPROVED'].includes(symbol.status)}
      title={`${symbol.name}. ${symbol.status === 'APPROVED' ? symbol.purpose : 'Черновое нанесение: знак ещё не утверждён'}`} onClick={() => onSelect(symbol)}>
      <img alt="" width={64} height={56} src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderSymbol(symbol, { width: 96, height: 80 }))}`} />
      <span>{symbol.name}</span><small>{symbol.source.symbolNumber ?? symbol.code} · {kindLabel[symbol.kind]}</small>
      {symbol.status !== 'APPROVED' && <small>{symbol.status === 'VERIFIED' ? 'Нужно утверждение' : 'Нужна сверка'}</small>}
    </button>)}</div>
    {matches.length > limit && <button type="button" onClick={() => setLimit(value => value + 24)}>Показать ещё</button>}
    {!matches.length && <p>Нет подходящих знаков. Измените поиск или категорию.</p>}
  </aside>;
}
