/** Создание объектов из пресетов с пересчётом размеров в масштаб документа. */
import type { LngLat } from './geo';
import type { Feature, MapDocument } from './model';
import { newId } from './model';
import { PRESETS, scaleStyle, type PresetKind } from './presets';

/**
 * k — во сколько раз размер знака в документе отличается от размера пресета.
 * Если объект создаётся на зуме z, то, чтобы на экране он выглядел как на образце,
 * k = 2^(refZoom − z).
 */
export function createFeature(kind: PresetKind, presetId: string, geom: { points?: LngLat[]; at?: LngLat; text?: string }, k = 1): Feature {
  const table = PRESETS[kind] as Record<string, { style: () => unknown; closed?: boolean }>;
  const p = table[presetId];
  if (!p) throw new Error(`Неизвестный пресет ${kind}:${presetId}`);
  const style = scaleStyle(p.style(), k) as never;
  const id = newId(kind[0]);
  const scale = k;
  switch (kind) {
    case 'arrow': return { id, kind, preset: presetId, points: geom.points ?? [], anchor: null, style, scale };
    case 'line': return { id, kind, preset: presetId, points: geom.points ?? [], closed: !!p.closed, style, scale };
    case 'area': return { id, kind, preset: presetId, points: geom.points ?? [], style, scale };
    case 'symbol': return { id, kind, preset: presetId, at: geom.at ?? [0, 0], rotation: 0, style, scale };
    case 'label': return { id, kind, preset: presetId, at: geom.at ?? [0, 0], text: geom.text ?? 'Надпись', rotation: 0, path: null, style, scale };
  }
}

export function zoomFactor(doc: MapDocument, zoom: number): number {
  return Math.pow(2, doc.refZoom - zoom);
}

/** Применить другой пресет к существующему объекту, сохранив геометрию и масштаб. */
export function restyle<T extends Feature>(f: T, presetId: string): T {
  const table = PRESETS[f.kind] as Record<string, { style: () => unknown; closed?: boolean }>;
  const p = table[presetId];
  if (!p) return f;
  return { ...f, preset: presetId, style: scaleStyle(p.style(), f.scale ?? 1) } as T;
}
