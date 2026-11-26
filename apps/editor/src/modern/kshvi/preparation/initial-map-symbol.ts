import type { SymbolDefinition } from '@def-ops/tactical-symbols';
import type { MapSymbolUse } from '../../../../../../packages/kshvi/src/scenario/initial-map';
import { symbolForSide, type ScenarioSide } from '../../../../../../packages/kshvi/src/scenario/sides';
import { hashCanonical } from '../../../../../../packages/kshvi/src/scenario/initial-map-hash';

/** Исходный SVG остаётся неизменным, редактируемые глифы заменяет штатный renderer. */
export function editedSymbol(definition: SymbolDefinition, usage: MapSymbolUse, side?: ScenarioSide): SymbolDefinition {
  const colored = symbolForSide(definition, side);
  const allowed = new Set((colored.inscriptions ?? []).map(inscription => inscription.id));
  const labels = Object.fromEntries(Object.entries(usage.labels ?? {}).filter(([key]) => allowed.has(key)));
  return {
    ...colored, labels: { ...colored.labels, ...labels },
    ...(colored.inscriptions ? { inscriptions: colored.inscriptions.map(inscription => ({
      ...inscription, ...(usage.inscriptionStyles?.[inscription.id] ?? {}),
    })) } : {}),
  };
}

export function markerImageId(usage: MapSymbolUse): string {
  return `kshvi-symbol:${usage.id}:${hashCanonical({ version: usage.version, labels: usage.labels ?? {}, styles: usage.inscriptionStyles ?? {} })}`;
}
