/** Создание объектов из пресетов с пересчётом размеров в масштаб документа. */
import type { LngLat } from './geo';
import type { Feature, MapDocument, Side } from './model';
import { newId } from './model';
import { PRESETS, scaleStyle, type PresetKind } from './presets';

/**
 * k — во сколько раз размер знака в документе отличается от размера пресета.
 * Если объект создаётся на зуме z, то, чтобы на экране он выглядел как на образце,
 * k = 2^(refZoom − z).
 */
export function createFeature(kind: PresetKind, presetId: string, geom: { points?: LngLat[]; at?: LngLat; text?: string; layerId?: string }, k = 1, side?: Side): Feature {
  const table = PRESETS[kind] as Record<string, { style: (side?: Side) => unknown; closed?: boolean }>;
  const p = table[presetId];
  if (!p) throw new Error(`Неизвестный пресет ${kind}:${presetId}`);
  const style = scaleStyle(p.style(side), k) as never;
  const id = newId(kind[0]);
  const scale = k;
  const sideF = side ? { side } : {};
  const layerId = geom.layerId ?? '';
  switch (kind) {
    case 'arrow': return { id, kind, layerId, preset: presetId, points: geom.points ?? [], anchor: null, style, scale, ...sideF };
    case 'line': return { id, kind, layerId, preset: presetId, points: geom.points ?? [], closed: !!p.closed, style, scale, ...sideF };
    case 'area': return { id, kind, layerId, preset: presetId, points: geom.points ?? [], style, scale, ...sideF };
    case 'symbol': return { id, kind, layerId, preset: presetId, at: geom.at ?? [0, 0], rotation: 0, style, scale, ...sideF };
    case 'label': return { id, kind, layerId, preset: presetId, at: geom.at ?? [0, 0], text: geom.text ?? 'Надпись', rotation: 0, path: null, style, scale, ...sideF };
  }
}

export function zoomFactor(doc: MapDocument, zoom: number): number {
  return Math.pow(2, doc.refZoom - zoom);
}

/** Применить другой пресет к существующему объекту, сохранив геометрию и масштаб. */
export function restyle<T extends Feature>(f: T, presetId: string, side: Side | undefined = f.side): T {
  const table = PRESETS[f.kind] as Record<string, { style: (side?: Side) => unknown; closed?: boolean }>;
  const p = table[presetId];
  if (!p) return f;
  return { ...f, preset: presetId, side, style: scaleStyle(p.style(side), f.scale ?? 1) } as T;
}
