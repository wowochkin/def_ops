/** Болота исторического слоя: согласие на запись болот карты (режим «по современной сети»), сводка, счёт тайлов. */
import { tilesFor, WetlandLearner, type MarshCheck, type TheatreData, type Wetland } from '@def-ops/sim';

type NetWhat = 'all' | 'roads' | 'water' | 'marsh';
type Grid = { bbox: [number, number, number, number]; cols: number; rows: number };

/** Флажок «болота карты — в местность» по умолчанию: отмечен, только если пользователь выбрал проверку болот. */
export const marshToTerrainDefault = (what: NetWhat): boolean => what === 'marsh' || what === 'all';

/** Класс болота для записи (режим сети): только при маске болот и отмеченном флажке. */
export const netMarshApply = (hasMask: boolean, checked: boolean): 'marsh' | undefined => (hasMask && checked ? 'marsh' : undefined);

/** Заголовок сводки болот: откуда цвет штриховки; «и OSM» — только если болота OSM были в сверке. */
export function marshHeader(m: MarshCheck): string {
  if (m.unknown) return 'цвет штриховки не узнан';
  return `цвет штриховки узнан ${m.source === 'network' ? `по болотам театра${m.osm > 0 ? ' и OSM' : ''}` : 'по образцу'}`;
}

/** Строка окон: окна в современных болотах (из них прошедшие проверку штриховки) и вне болот. */
export const marshWindowsText = (m: MarshCheck): string =>
  `окон в современных болотах ${m.windows.inside}, из них со штриховкой ${m.windows.hatched}; вне болот ${m.windows.outside}`;

/** Тайлов прогона по сети: вся область и (если сверяются болота) тайлы у современных болот — первый проход. */
export function networkTiles(T: Pick<TheatreData, 'terrainGrid'>, wetlands: Wetland[], grid: Grid, z: number, what: NetWhat): number {
  const all = tilesFor(grid.bbox, z).length;
  return what === 'marsh' || what === 'all' ? all + new WetlandLearner(T, wetlands, grid, z).tileList().length : all;
}
