import type { SymbolDefinition } from '@def-ops/tactical-symbols';
import type { MapSymbolUse } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import { hashCanonical } from '../../../../../../packages/kshvi/src/scenario/initial-map-hash';

/** Исходный SVG остаётся неизменным, редактируемые глифы заменяет штатный renderer. */
export function editedSymbol(definition: SymbolDefinition, usage: MapSymbolUse): SymbolDefinition {
  const allowed = new Set((definition.inscriptions ?? []).map(inscription => inscription.id));
  const labels = Object.fromEntries(Object.entries(usage.labels ?? {}).filter(([key]) => allowed.has(key)));
  return {
    ...definition, labels: { ...definition.labels, ...labels },
    ...(definition.inscriptions ? { inscriptions: definition.inscriptions.map(inscription => ({
      ...inscription, ...(usage.inscriptionStyles?.[inscription.id] ?? {}),
    })) } : {}),
  };
}

export function markerImageId(usage: MapSymbolUse): string {
  return `kshvi-symbol:${usage.id}:${hashCanonical({ version: usage.version, labels: usage.labels ?? {}, styles: usage.inscriptionStyles ?? {} })}`;
}
