import { symbolSet, type SymbolAffiliation, type SymbolDefinition, type SymbolKind, type SymbolSet, type SymbolStatus } from '@def-ops/tactical-symbols';
import { sourceRegistry } from '@def-ops/tactical-symbols/source/browser';

export type SymbolSearchFilters = Readonly<{
  affiliation?: SymbolAffiliation | 'ALL';
  kind?: SymbolKind | 'ALL';
  status?: SymbolStatus | 'ALL';
  organizationalLevel?: string;
  documentId?: string;
}>;

export function searchSymbols(query: string, forceType = 'ALL', filters: SymbolSearchFilters = {}, set: SymbolSet = symbolSet): SymbolDefinition[] {
  const normalized = query.trim().toLocaleLowerCase('ru');
  return set.symbols.filter(symbol => {
    const documentId = sourceRegistry.fragments.find(fragment => fragment.id === symbol.source.fragmentId)?.documentId;
    return (forceType === 'ALL' || symbol.forceType === forceType)
      && (!filters.affiliation || filters.affiliation === 'ALL' || symbol.affiliation === filters.affiliation)
      && (!filters.kind || filters.kind === 'ALL' || symbol.kind === filters.kind)
      && (!filters.status || filters.status === 'ALL' || symbol.status === filters.status)
      && (!filters.organizationalLevel || filters.organizationalLevel === 'ALL' || symbol.organizationalLevel === filters.organizationalLevel)
      && (!filters.documentId || filters.documentId === 'ALL' || documentId === filters.documentId)
      && (!normalized || `${symbol.name} ${symbol.code} ${symbol.purpose} ${symbol.forceType}`.toLocaleLowerCase('ru').includes(normalized));
  });
}

export function fragmentUrl(fragmentId: string): string {
  if (!sourceRegistry.fragments.some(fragment => fragment.id === fragmentId)) throw new Error('Фрагмент источника не найден');
  return `/api/kshvi/symbols/fragments/${encodeURIComponent(fragmentId)}`;
}

export function sourceDocumentTitle(fragmentId: string): string {
  const documentId = sourceRegistry.fragments.find(fragment => fragment.id === fragmentId)?.documentId;
  return sourceRegistry.documents.find(document => document.id === documentId)?.originalName ?? fragmentId;
}
