/** Миниатюры пресетов для палитры (рендерятся тем же движком, что и карта). */
import { emptyDocument, type MapDocument } from '../core/model';
import { makeProjection } from '../core/geo';
import { createFeature } from '../core/factory';
import { exportSVG } from '../core/render/index';
import type { PresetKind } from '../core/presets';

const cache = new Map<string, string>();

export function presetPreview(kind: PresetKind, id: string, paper: string): string {
  const key = `${kind}:${id}:${paper}`;
  if (cache.has(key)) return cache.get(key)!;
  const doc: MapDocument = emptyDocument([13.4, 52.5], 7.4);
  const proj = makeProjection(doc.origin, doc.refZoom);
  const ll = (x: number, y: number) => proj.toLngLat([x, y]);
  const k = kind === 'label' || kind === 'symbol' ? 0.8 : 0.55;
  let f;
  if (kind === 'arrow') f = createFeature(kind, id, { points: [ll(0, 22), ll(70, 6), ll(150, 12)] }, k);
  else if (kind === 'line') f = createFeature(kind, id, { points: [ll(0, 16), ll(50, 4), ll(100, 18), ll(150, 8)] }, k);
  else if (kind === 'area') f = createFeature(kind, id, { points: [ll(20, 2), ll(110, 0), ll(140, 16), ll(90, 30), ll(25, 26)] }, k);
  else if (kind === 'symbol') f = createFeature(kind, id, { at: ll(75, 16) }, k);
  else f = createFeature(kind, id, { at: ll(75, 16), text: 'Образец' }, k);
  doc.features = [f];
  // фиксированная рамка, чтобы миниатюры были сопоставимы
  let svg = exportSVG(doc, { padding: 6, background: paper });
  svg = svg.replace(/viewBox="[^"]*" width="\d+" height="\d+"/, 'viewBox="-8 -6 166 44" width="166" height="44"').replace(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="[^"]*"\/>/, `<rect x="-8" y="-6" width="166" height="44" fill="${paper}"/>`);
  cache.set(key, svg);
  return svg;
}
