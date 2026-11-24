import type { AtlasMeta } from '../../../../services/cartography/src/atlas';
import type { BBox } from '@def-ops/core';

export type RegionGroup = Readonly<{ key: string; bounds: BBox; maps: readonly AtlasMeta[] }>;
export type AtlasRegionSettings = Readonly<{
  selected: readonly string[];
  disabled: readonly string[];
  terrainId: string | null;
}>;
export type AtlasRegionState = AtlasRegionSettings & Readonly<{
  regionKey: string;
  showOverview: boolean | null;
  byRegion: Readonly<Record<string, AtlasRegionSettings>>;
}>;

export function resolveOverview(input: { requested: boolean | null }): boolean {
  return input.requested === true;
}

export function openAtlasRegion(current: AtlasRegionState, group: RegionGroup): AtlasRegionState {
  const saved = current.byRegion[group.key];
  const vectorBases = group.maps.filter(map => map.kind === 'vector');
  const selected = saved?.selected ?? (vectorBases.length === 1 ? [vectorBases[0]!.id] : []);
  const disabled = saved?.disabled ?? [];
  const terrainId = saved?.terrainId ?? null;
  const hasLocalBase = selected.some(id => vectorBases.some(map => map.id === id));
  return {
    regionKey: group.key,
    selected,
    disabled,
    terrainId,
    showOverview: hasLocalBase ? false : null,
    byRegion: { ...current.byRegion, [group.key]: { selected, disabled, terrainId } },
  };
}
