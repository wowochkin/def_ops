import { useMemo, useState } from 'react';
import { symbolSet } from '@def-ops/tactical-symbols';
import { sourceRegistry, type SourceTopic } from '@def-ops/tactical-symbols/source/browser';
import { SourceImage } from './SourceImage';

const topicLabels: Readonly<Record<SourceTopic, string>> = {
  COMMAND_POSTS: 'Пункты управления', BOUNDARY_LINES: 'Разграничительные линии', MOVEMENT: 'Движение и маршруты',
  GROUND_FORCES: 'Сухопутные силы', AIR_FORCES: 'Воздушные силы', NAVY: 'Военно-морские силы',
  STRATEGIC_MISSILE_FORCES: 'Ракетные войска стратегического назначения', RECONNAISSANCE: 'Разведка',
  SIGNALS: 'Связь', ELECTRONIC_WARFARE: 'Радиоэлектронная борьба', CAMOUFLAGE: 'Маскировка',
  ENGINEER_SUPPORT: 'Инженерное обеспечение', CBRN_PROTECTION: 'Защита от ОМП',
  TOPOGEODETIC_SUPPORT: 'Топогеодезическое обеспечение', HYDROMETEOROLOGICAL_SUPPORT: 'Гидрометеорологическое обеспечение',
  MORAL_PSYCHOLOGICAL_SUPPORT: 'Морально-психологическое обеспечение', TECHNICAL_SUPPORT: 'Техническое обеспечение',
  LOGISTICS_SUPPORT: 'Материально-техническое обеспечение', SPACE_FORCES: 'Космические силы',
  NUCLEAR_SUPPORT: 'Ядерное обеспечение', OTHER_ORGANIZATIONS: 'Другие организации',
};

export function SourceDocuments({ query, onSelectSymbol }: {
  query: string;
  onSelectSymbol(symbolId: string): void;
}) {
  const documents = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase('ru');
    return sourceRegistry.documents.filter(document => !normalized || [document.originalName, ...document.topics.map(topic => topicLabels[topic])]
      .some(value => value.toLocaleLowerCase('ru').includes(normalized)));
  }, [query]);
  const [documentId, setDocumentId] = useState(sourceRegistry.documents[0]?.id ?? '');
  const document = documents.find(item => item.id === documentId) ?? documents[0] ?? null;
  const [fragmentId, setFragmentId] = useState('');
  const [zoom, setZoom] = useState(1);
  const fragment = document?.fragmentIds
    .map(id => sourceRegistry.fragments.find(item => item.id === id))
    .find(item => item?.id === (fragmentId || document.fragmentIds[0])) ?? null;
  const related = fragment ? symbolSet.symbols.filter(symbol => symbol.source.fragmentId === fragment.id) : [];

  function selectDocument(id: string): void {
    setDocumentId(id);
    setFragmentId('');
    setZoom(1);
  }

  if (!document) return <section className="source-documents-empty"><h2>Документы не найдены</h2><p>Измените поисковый запрос.</p></section>;
  return <div className="source-documents">
    <nav className="source-document-list" aria-label="Оглавление исходных документов">
      <h2>Оглавление исходных документов</h2>
      <p>{documents.length} из {sourceRegistry.documents.length} документов</p>
      {documents.map(item => <button key={item.id} aria-pressed={document.id === item.id} onClick={() => selectDocument(item.id)}>
        <strong>{item.originalName}</strong>
        <small>{item.topics.map(topic => topicLabels[topic]).join(' · ')}</small>
        <span>{item.fragmentIds.length} стр.</span>
      </button>)}
    </nav>
    <section className="source-page-panel" aria-label="Исходная страница документа">
      <header>
        <div><h2>{document.originalName}</h2><p>{document.topics.map(topic => topicLabels[topic]).join(' · ')}</p></div>
        <div className="source-zoom-controls" aria-label="Масштаб страницы">
          <button type="button" disabled={zoom <= 0.75} onClick={() => setZoom(value => Math.max(0.75, value - 0.25))}>Уменьшить</button>
          <button type="button" onClick={() => setZoom(1)}>100%</button>
          <button type="button" disabled={zoom >= 2} onClick={() => setZoom(value => Math.min(2, value + 0.25))}>Увеличить</button>
        </div>
      </header>
      <div className="source-page-tabs" aria-label="Страницы документа">
        {document.fragmentIds.map(id => {
          const page = sourceRegistry.fragments.find(item => item.id === id);
          return page ? <button key={id} aria-pressed={fragment?.id === id} onClick={() => { setFragmentId(id); setZoom(1); }}>Страница {page.page}</button> : null;
        })}
      </div>
      {fragment ? <>
        <div className="source-page-scroll">
          <SourceImage fragmentId={fragment.id} style={{ width: `${zoom * 100}%` }} alt={`Исходная страница ${fragment.page} документа ${document.originalName}`} />
        </div>
        <footer>
          <p>SHA-256 фрагмента: <code title={fragment.referenceFragment.sha256}>{fragment.referenceFragment.sha256.slice(0, 16)}…</code></p>
          {fragment.ruleText && <blockquote>{fragment.ruleText}</blockquote>}
          {fragment.gaps.length > 0 && <details><summary>Ограничения страницы ({fragment.gaps.length})</summary>{fragment.gaps.map(gap => <p key={gap}>{gap}</p>)}</details>}
        </footer>
      </> : <p>Для этой страницы нет изображения.</p>}
    </section>
    <aside className="source-related">
      <h2>Связанные знаки</h2>
      {related.length ? related.map(symbol => <button key={symbol.id} onClick={() => onSelectSymbol(symbol.id)}>{symbol.name}<small>{symbol.purpose}</small></button>)
        : <p>Страница сохранена как исходный материал. Пообъектная связь с векторными знаками ещё не установлена.</p>}
      <h3>Покрытие документа</h3>
      <p>Извлечено страниц: {document.fragmentIds.length}. Исходный DOC зарегистрирован по SHA-256; шрифт для просмотра не требуется.</p>
      {document.gaps.map(gap => <p key={gap} className="source-gap">{gap}</p>)}
    </aside>
  </div>;
}
