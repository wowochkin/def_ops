import rawSymbolSet from '../data/sets/ru-modern-v3.json' with { type: 'json' };
import type {
  SymbolDefinition,
  SymbolDefinitionInput,
  SymbolSet,
  SymbolSetInput,
  SymbolSourceBinding,
  SymbolStatus,
  SymbolUsage,
} from './model';
import { sourceRegistry } from './source/registry';

function bindSource(source: SymbolDefinitionInput['source']): SymbolSourceBinding {
  const fragment = sourceRegistry.fragments.find(candidate => candidate.id === source.fragmentId);
  if (!fragment) throw new Error(`Не найден фрагмент источника ${source.fragmentId}`);
  if (fragment.sourceDocument !== source.sourceDocument || fragment.page !== source.page) {
    throw new Error(`Ссылка на источник не совпадает с реестром: ${source.fragmentId}`);
  }
  return { ...source, referenceFragment: fragment.referenceFragment };
}

function hydrateSet(input: SymbolSetInput): SymbolSet {
  const identities = new Set<string>();
  const symbols = input.symbols.map(symbol => {
    const identity = `${symbol.id}@${symbol.version}@${symbol.geometry.version}`;
    if (identities.has(identity)) throw new Error(`Дубликат версии знака ${identity}`);
    identities.add(identity);
    return { ...symbol, source: bindSource(symbol.source) };
  });
  return { ...input, symbols };
}

export const symbolSet: SymbolSet = hydrateSet(rawSymbolSet as unknown as SymbolSetInput);

export function getSymbol(id: string, set: SymbolSet = symbolSet): SymbolDefinition {
  const symbol = set.symbols.find(candidate => candidate.id === id)
    ?? (/^source-\d+$/.test(id) ? set.symbols.find(candidate => candidate.id === `${id}-1`) : undefined);
  if (!symbol) throw new Error(`Знак ${id} не найден в наборе ${set.version}`);
  return symbol;
}

export function pinSymbolUsage(set: SymbolSet, symbolId: string): SymbolUsage {
  const symbol = getSymbol(symbolId, set);
  return {
    symbolId: symbol.id,
    symbolVersion: symbol.version,
    setVersion: set.version,
    geometryVersion: symbol.geometry.version,
  };
}

function resolveUsage(usage: SymbolUsage, sets: readonly SymbolSet[]): SymbolDefinition {
  const set = sets.find(candidate => candidate.version === usage.setVersion);
  if (!set) throw new Error(`Не найден набор знаков версии ${usage.setVersion}`);
  const symbol = set.symbols.find(candidate => candidate.id === usage.symbolId);
  if (!symbol || symbol.version !== usage.symbolVersion || symbol.geometry.version !== usage.geometryVersion) {
    throw new Error(`Не найдена точная версия знака ${usage.symbolId}@${usage.symbolVersion}, геометрия ${usage.geometryVersion}`);
  }
  return symbol;
}

export interface SymbolLegendEntry {
  readonly symbolId: string;
  readonly name: string;
  readonly symbolVersion: string;
  readonly setVersion: string;
  readonly geometryVersion: number;
  readonly status: SymbolStatus;
}

export function symbolLegend(
  usages: readonly SymbolUsage[],
  sets: readonly SymbolSet[],
): readonly SymbolLegendEntry[] {
  const entries = new Map<string, SymbolLegendEntry>();
  for (const usage of usages) {
    const symbol = resolveUsage(usage, sets);
    const key = `${usage.setVersion}:${usage.symbolId}:${usage.symbolVersion}:${usage.geometryVersion}`;
    if (!entries.has(key)) {
      entries.set(key, {
        symbolId: usage.symbolId,
        name: symbol.name,
        symbolVersion: usage.symbolVersion,
        setVersion: usage.setVersion,
        geometryVersion: usage.geometryVersion,
        status: symbol.status,
      });
    }
  }
  return [...entries.values()];
}

export function assertSymbolsApproved(usages: readonly SymbolUsage[], sets: readonly SymbolSet[]): void {
  for (const usage of usages) {
    const symbol = resolveUsage(usage, sets);
    if (symbol.status !== 'APPROVED') {
      throw new Error(`Знак ${symbol.id}@${symbol.version} не имеет статуса APPROVED (текущий: ${symbol.status})`);
    }
  }
}
