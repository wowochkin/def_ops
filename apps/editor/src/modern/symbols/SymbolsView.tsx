import { useMemo, useState } from 'react';
import { coverageReport, symbolSet } from '@def-ops/tactical-symbols';
import { searchSymbols } from './symbols-api';
import { SymbolCard } from './SymbolCard';
import './symbols.css';

export function SymbolsView() {
  const [query, setQuery] = useState('');
  const [forceType, setForceType] = useState('ALL');
  const [selectedId, setSelectedId] = useState(symbolSet.symbols[0].id);
  const symbols = useMemo(() => searchSymbols(query, forceType), [query, forceType]);
  const selected = symbols.find(symbol => symbol.id === selectedId) ?? symbols[0] ?? null;
  const coverage = coverageReport();
  const forceTypes = [...new Set(symbolSet.symbols.map(symbol => symbol.forceType))].sort();
  return <section className="symbols-view">
    <header><p>Современный режим · справочник</p><h1>Условные знаки</h1>
      <p>{coverage.documents} документов · {coverage.fonts} шрифта · {coverage.fragments} фрагмента</p>
      <p>Методическое утверждение ещё не выполнено</p>
    </header>
    <div className="symbols-toolbar">
      <label>Поиск знака<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название, код или назначение" /></label>
      <label>Категория<select value={forceType} onChange={event => setForceType(event.target.value)}><option value="ALL">Все категории</option>{forceTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
    </div>
    <div className="symbols-layout">
      <nav aria-label="Каталог знаков">{symbols.map(symbol => <button key={symbol.id} aria-pressed={selected?.id === symbol.id} onClick={() => setSelectedId(symbol.id)}>{symbol.name}<small>{symbol.forceType} · {symbol.status}</small></button>)}</nav>
      {selected ? <SymbolCard symbol={selected} /> : <p>Совпадений нет</p>}
    </div>
  </section>;
}
