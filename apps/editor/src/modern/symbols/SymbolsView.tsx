import { useMemo, useState } from 'react';
import { coverageReport, symbolSet, type SymbolAffiliation, type SymbolKind, type SymbolSet, type SymbolStatus, type SymbolUsage } from '@def-ops/tactical-symbols';
import { sourceRegistry } from '@def-ops/tactical-symbols/source/browser';
import { searchSymbols } from './symbols-api';
import { SymbolCard } from './SymbolCard';
import { SourceDocuments } from './SourceDocuments';
import { affiliationLabels, forceTypeLabels, kindLabels, symbolStatusLabels } from './symbol-labels';
import './symbols.css';

export type SymbolsViewProps = Readonly<{
  set?: SymbolSet;
  historySets?: readonly SymbolSet[];
  canInsert?: boolean;
  onInsert?: (usage: SymbolUsage) => void;
}>;

export function SymbolsView({ set = symbolSet, historySets, canInsert = false, onInsert }: SymbolsViewProps) {
  const [mode, setMode] = useState<'SYMBOLS' | 'DOCUMENTS'>('SYMBOLS');
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
  const levelLabels: Record<string, string> = { ARMY: 'Армия', BATTALION: 'Батальон' };

  return <section className="symbols-view">
    <header className="symbols-heading">
      <div><p>Современный режим · справочник</p><h1>Условные знаки</h1><p>{coverage.documents} документов · {coverage.fonts} шрифта · {coverage.fragments} фрагмента</p></div>
      <div className="symbols-coverage"><strong>{coverage.documents}</strong> документов<strong>{coverage.fonts}</strong> шрифта<strong>{coverage.fragments}</strong> страницы</div>
      <div className="symbols-mode" role="group" aria-label="Представление справочника">
        <button aria-pressed={mode === 'SYMBOLS'} onClick={() => setMode('SYMBOLS')}>По знакам</button>
        <button aria-pressed={mode === 'DOCUMENTS'} onClick={() => setMode('DOCUMENTS')}>По документам</button>
      </div>
    </header>

    <div className="symbols-toolbar">
      <label>{mode === 'SYMBOLS' ? 'Поиск знака' : 'Поиск по документам'}<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={mode === 'SYMBOLS' ? 'Название, код или назначение' : 'Название документа или тема'} /></label>
      {mode === 'SYMBOLS' && <>
        <label>Категория<select value={forceType} onChange={event => setForceType(event.target.value)}><option value="ALL">Все категории</option>{forceTypes.map(type => <option key={type} value={type}>{forceTypeLabels[type] ?? type}</option>)}</select></label>
        <label>Принадлежность<select value={affiliation} onChange={event => setAffiliation(event.target.value as SymbolAffiliation | 'ALL')}><option value="ALL">Все</option>{Object.entries(affiliationLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Геометрия<select value={kind} onChange={event => setKind(event.target.value as SymbolKind | 'ALL')}><option value="ALL">Все</option>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Статус<select value={status} onChange={event => setStatus(event.target.value as SymbolStatus | 'ALL')}><option value="ALL">Все</option>{Object.entries(symbolStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>Уровень<select value={organizationalLevel} onChange={event => setOrganizationalLevel(event.target.value)}><option value="ALL">Все</option>{levels.map(value => <option key={value} value={value}>{levelLabels[value] ?? value}</option>)}</select></label>
        <label>Глава документа<select value={documentId} onChange={event => setDocumentId(event.target.value)}><option value="ALL">Все главы</option>{sourceRegistry.documents.map(document => <option key={document.id} value={document.id}>{document.originalName}</option>)}</select></label>
      </>}
    </div>

    {mode === 'SYMBOLS' ? <>
      <div className="symbols-result-summary"><span>{symbols.length} знаков</span><span>Сверка ещё не завершена</span></div>
      <div className="symbols-layout">
        <nav className="symbols-catalog" aria-label="Каталог знаков">{symbols.map(symbol => <button key={symbol.id} aria-pressed={selected?.id === symbol.id} onClick={() => setSelectedId(symbol.id)}>
          <strong>{symbol.name}</strong><small>Код {symbol.code} · {forceTypeLabels[symbol.forceType] ?? symbol.forceType}</small><span>{symbolStatusLabels[symbol.status]}</span>
        </button>)}</nav>
        {selected ? <SymbolCard key={selected.id} symbol={selected} setVersion={set.version} history={history} canInsert={canInsert} onInsert={onInsert} /> : <section className="symbols-empty"><h2>Совпадений нет</h2><p>Измените запрос или сбросьте фильтры.</p></section>}
      </div>
    </> : <SourceDocuments query={query} onSelectSymbol={id => { setSelectedId(id); setMode('SYMBOLS'); }} />}

    <details className="symbols-limitations"><summary>Ограничения справочника и сверки</summary>
      <p>Методическое утверждение ещё не выполнено</p>
      {coverage.missingDocuments.length > 0 && <p role="alert">Отсутствуют документы: {coverage.missingDocuments.join(', ')}</p>}
      {[...new Set([...coverage.gaps, ...set.gaps])].map(gap => <p key={gap}>{gap}</p>)}
    </details>
  </section>;
}
