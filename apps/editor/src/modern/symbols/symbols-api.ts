import { symbolSet, type SymbolDefinition } from '@def-ops/tactical-symbols';
import { sourceRegistry } from '@def-ops/tactical-symbols/source/browser';

export function searchSymbols(query: string, forceType = 'ALL'): SymbolDefinition[] {
  const normalized = query.trim().toLocaleLowerCase('ru');
  return symbolSet.symbols.filter(symbol => (
    (forceType === 'ALL' || symbol.forceType === forceType)
    && (!normalized || `${symbol.name} ${symbol.code} ${symbol.purpose} ${symbol.forceType}`.toLocaleLowerCase('ru').includes(normalized))
  ));
}

export function fragmentUrl(fragmentId: string): string {
  if (!sourceRegistry.fragments.some(fragment => fragment.id === fragmentId)) throw new Error('Фрагмент источника не найден');
  return `/api/kshvi/symbols/fragments/${encodeURIComponent(fragmentId)}`;
}

export function sourceDocumentTitle(fragmentId: string): string {
  const documentId = sourceRegistry.fragments.find(fragment => fragment.id === fragmentId)?.documentId;
  return sourceRegistry.documents.find(document => document.id === documentId)?.originalName ?? fragmentId;
}
