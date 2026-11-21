import type { SymbolDefinition } from '@def-ops/tactical-symbols';
import { fragmentUrl, sourceDocumentTitle } from './symbols-api';
import { SymbolPreview } from './SymbolPreview';

export function SymbolCard({ symbol }: { symbol: SymbolDefinition }) {
  return <article className="symbol-card">
    <h2>{symbol.name}</h2>
    <p>{symbol.purpose}</p>
    <p>Код: {symbol.code} · Версия: {symbol.version} · Геометрия: {symbol.geometry.version}</p>
    <p>Статус: <strong>{symbol.status}</strong></p>
    <SymbolPreview symbol={symbol} />
    <section>
      <h3>Источник и страница</h3>
      <p>{sourceDocumentTitle(symbol.source.fragmentId)}, страница {symbol.source.page}</p>
      <img src={fragmentUrl(symbol.source.fragmentId)} alt="Исходный фрагмент страницы" />
      {symbol.source.gaps.map(gap => <p key={gap}>{gap}</p>)}
    </section>
    <button disabled={symbol.status !== 'APPROVED'} title={symbol.status !== 'APPROVED' ? 'Сначала требуется методическое утверждение' : undefined}>Вставить на карту</button>
  </article>;
}
