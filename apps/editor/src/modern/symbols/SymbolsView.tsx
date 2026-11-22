import { useMemo, useState } from 'react';
import { coverageReport, symbolSet, type SymbolAffiliation, type SymbolKind, type SymbolSet, type SymbolStatus, type SymbolUsage } from '@def-ops/tactical-symbols';
import { sourceRegistry } from '@def-ops/tactical-symbols/source/browser';
import { searchSymbols } from './symbols-api';
import { SymbolCard } from './SymbolCard';
import './symbols.css';

export type SymbolsViewProps = Readonly<{
  set?: SymbolSet;
  historySets?: readonly SymbolSet[];
  canInsert?: boolean;
  onInsert?: (usage: SymbolUsage) => void;
}>;

export function SymbolsView({ set = symbolSet, historySets, canInsert = false, onInsert }: SymbolsViewProps) {
  const [query, setQuery] = useState('');
  const [forceType, setForceType] = useState('ALL');
  const [affiliation, setAffiliation] = useState<SymbolAffiliation | 'ALL'>('ALL');
  const [kind, setKind] = useState<SymbolKind | 'ALL'>('ALL');
  const [status, setStatus] = useState<SymbolStatus | 'ALL'>('ALL');
  const [organizationalLevel, setOrganizationalLevel] = useState('ALL');
  const [documentId, setDocumentId] = useState('ALL');
  const [selectedId, setSelectedId] = useState(set.symbols[0]?.id ?? '');
  const symbols = useMemo(
    () => searchSymbols(query, forceType, { affiliation, kind, status, organizationalLevel, documentId }, set),
    [query, forceType, affiliation, kind, status, organizationalLevel, documentId, set],
  );
  const selected = symbols.find(symbol => symbol.id === selectedId) ?? symbols[0] ?? null;
  const coverage = coverageReport();
  const forceTypes = [...new Set(set.symbols.map(symbol => symbol.forceType))].sort();
  const levels = [...new Set(set.symbols.map(symbol => symbol.organizationalLevel).filter((value): value is string => Boolean(value)))].sort();
  const history = selected
    ? (historySets ?? [set]).flatMap(item => item.symbols.filter(symbol => symbol.id === selected.id).map(symbol => ({ symbol, setVersion: item.version })))
    : [];
  return <section className="symbols-view">
    <header><p>Современный режим · справочник</p><h1>Условные знаки</h1>
      <p>{coverage.documents} документов · {coverage.fonts} шрифта · {coverage.fragments} фрагмента</p>
      <p>Методическое утверждение ещё не выполнено</p>
      {coverage.missingDocuments.length > 0 && <p role="alert">Отсутствуют документы: {coverage.missingDocuments.join(', ')}</p>}
      {coverage.gaps.map(gap => <p key={gap}>{gap}</p>)}
      {set.gaps.map(gap => <p key={gap}>{gap}</p>)}
    </header>
    <div className="symbols-toolbar">
      <label>Поиск знака<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Название, код или назначение" /></label>
      <label>Категория<select value={forceType} onChange={event => setForceType(event.target.value)}><option value="ALL">Все категории</option>{forceTypes.map(type => <option key={type} value={type}>{type}</option>)}</select></label>
      <label>Принадлежность<select value={affiliation} onChange={event => setAffiliation(event.target.value as SymbolAffiliation | 'ALL')}><option value="ALL">Все</option>{['FRIENDLY', 'HOSTILE', 'NEUTRAL', 'UNKNOWN'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Геометрия<select value={kind} onChange={event => setKind(event.target.value as SymbolKind | 'ALL')}><option value="ALL">Все</option>{['POINT', 'LINE', 'AREA'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Статус<select value={status} onChange={event => setStatus(event.target.value as SymbolStatus | 'ALL')}><option value="ALL">Все</option>{['IMPORTED', 'MAPPED', 'VERIFIED', 'APPROVED', 'DEPRECATED'].map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Уровень<select value={organizationalLevel} onChange={event => setOrganizationalLevel(event.target.value)}><option value="ALL">Все</option>{levels.map(value => <option key={value}>{value}</option>)}</select></label>
      <label>Глава документа<select value={documentId} onChange={event => setDocumentId(event.target.value)}><option value="ALL">Все главы</option>{sourceRegistry.documents.map(document => <option key={document.id} value={document.id}>{document.originalName}</option>)}</select></label>
    </div>
    <nav aria-label="Главы исходных документов">{sourceRegistry.documents.map(document => <button key={document.id} aria-pressed={documentId === document.id} onClick={() => setDocumentId(document.id)}>
      {document.originalName}<small>{document.topics.join(', ')}</small>
    </button>)}</nav>
    <div className="symbols-layout">
      <nav aria-label="Каталог знаков">{symbols.map(symbol => <button key={symbol.id} aria-pressed={selected?.id === symbol.id} onClick={() => setSelectedId(symbol.id)}>{symbol.name}<small>{symbol.forceType} · {symbol.status}</small></button>)}</nav>
      {selected ? <SymbolCard key={selected.id} symbol={selected} setVersion={set.version} history={history} canInsert={canInsert} onInsert={onInsert} /> : <p>Совпадений нет</p>}
    </div>
  </section>;
}
