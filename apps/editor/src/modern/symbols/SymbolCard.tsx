import { renderSymbol, type SymbolDefinition, type SymbolUsage } from '@def-ops/tactical-symbols';
import { fragmentUrl, sourceDocumentTitle } from './symbols-api';
import { SymbolPreview } from './SymbolPreview';

export type SymbolVersionHistoryEntry = Readonly<{ symbol: SymbolDefinition; setVersion: string }>;
export type SymbolCardProps = Readonly<{
  symbol: SymbolDefinition;
  setVersion: string;
  history?: readonly SymbolVersionHistoryEntry[];
  canInsert?: boolean;
  onInsert?: (usage: SymbolUsage) => void;
}>;

function topography(symbol: SymbolDefinition): string {
  const preview = renderSymbol(symbol, { width: 180, height: 180 });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240" width="400" height="240">
    <rect width="400" height="240" fill="#f3f0df"/>
    <path d="M0 45 C70 10 140 80 220 40 S350 15 400 50 M0 90 C90 45 160 120 250 75 S340 55 400 95 M0 150 C70 110 145 180 225 140 S340 110 400 155 M0 205 C80 160 155 225 250 185 S345 170 400 205" fill="none" stroke="#a89968" stroke-width="1.2"/>
    <path d="M-10 210 C90 180 120 95 205 120 S300 195 410 35" fill="none" stroke="#7ea8c9" stroke-width="8" opacity="0.75"/>
    <path d="M0 190 L400 45" fill="none" stroke="#b58a62" stroke-width="4" stroke-dasharray="12 5"/>
    <g transform="translate(110 30)">${preview}</g>
  </svg>`;
}

export function SymbolCard({ symbol, setVersion, history = [], canInsert = false, onInsert }: SymbolCardProps) {
  const versions = history.length ? history : [{ symbol, setVersion }];
  const usage: SymbolUsage = {
    symbolId: symbol.id, symbolVersion: symbol.version, setVersion, geometryVersion: symbol.geometry.version,
  };
  const allowed = symbol.status === 'APPROVED' && canInsert && Boolean(onInsert);
  const title = symbol.status !== 'APPROVED'
    ? 'Сначала требуется методическое утверждение'
    : !canInsert ? 'Недостаточно права для вставки на карту' : !onInsert ? 'Команда вставки не подключена' : undefined;
  return <article className="symbol-card">
    <h2>{symbol.name}</h2>
    <p>{symbol.purpose}</p>
    <p>Код: {symbol.code} · Версия: {symbol.version} · Геометрия: {symbol.geometry.version}</p>
    <p>Статус: <strong>{symbol.status}</strong></p>
    <SymbolPreview symbol={symbol} />
    <section>
      <h3>Пример на топооснове</h3>
      <div role="img" aria-label="Пример на топооснове" dangerouslySetInnerHTML={{ __html: topography(symbol) }} />
    </section>
    <section>
      <h3>История версий</h3>
      <ol>{versions.map(entry => <li key={`${entry.setVersion}-${entry.symbol.version}-${entry.symbol.geometry.version}`}>
        Набор {entry.setVersion} · знак {entry.symbol.version} · геометрия {entry.symbol.geometry.version} · {entry.symbol.status}
      </li>)}</ol>
    </section>
    <section>
      <h3>Источник и страница</h3>
      <p>{sourceDocumentTitle(symbol.source.fragmentId)}, страница {symbol.source.page}</p>
      {symbol.source.ruleText && <p>{symbol.source.ruleText}</p>}
      <img src={fragmentUrl(symbol.source.fragmentId)} alt="Исходный фрагмент страницы" />
      {symbol.source.gaps.map(gap => <p key={gap}>{gap}</p>)}
    </section>
    <button disabled={!allowed} title={title} onClick={() => onInsert?.(usage)}>Вставить на карту</button>
  </article>;
}
