/** Миниатюры знаков для палитры и справочника (рендерятся тем же движком, что и карта). */
import { emptyDocument, makeProjection, createFeature, exportSVG, type MapDocument, type PresetKind, type Side } from '@def-ops/core';

const cache = new Map<string, string>();

export function presetPreview(kind: PresetKind, id: string, paper: string, side?: Side, big = false): string {
  const key = `${kind}:${id}:${paper}:${side ?? ''}:${big}`;
  if (cache.has(key)) return cache.get(key)!;
  const doc: MapDocument = emptyDocument([13.4, 52.5], 7.4);
  doc.layers = [{ id: 'l', name: 'l', role: 'custom', visible: true, locked: false, opacity: 1 }];
  const proj = makeProjection(doc.origin, doc.refZoom);
  const ll = (x: number, y: number) => proj.toLngLat([x, y]);
  const W = 166, H = big ? 70 : 44;
  const k = kind === 'label' ? 0.8 : kind === 'symbol' ? (big ? 1.8 : 1.2) : big ? 0.75 : 0.55;
  const g = { layerId: 'l' };
  let f;
  if (kind === 'arrow') f = createFeature(kind, id, { ...g, points: [ll(0, H * 0.55), ll(70, H * 0.2), ll(150, H * 0.3)] }, k, side);
  else if (kind === 'line') f = createFeature(kind, id, { ...g, points: [ll(0, H * 0.45), ll(50, H * 0.2), ll(100, H * 0.5), ll(150, H * 0.3)] }, k, side);
  else if (kind === 'area') f = createFeature(kind, id, { ...g, points: [ll(25, 4), ll(110, 2), ll(140, H * 0.4), ll(95, H - 6), ll(28, H - 8)] }, k, side);
  else if (kind === 'symbol') f = createFeature(kind, id, { ...g, at: ll(75, H * 0.55) }, k, side);
  else f = createFeature(kind, id, { ...g, at: ll(75, H * 0.45), text: 'Образец' }, k, side);
  doc.features = [f];
  let svg = exportSVG(doc, { padding: 6, background: paper });
  svg = svg
    .replace(/viewBox="[^"]*" width="\d+" height="\d+"/, `viewBox="-8 -6 ${W} ${H}" width="${W}" height="${H}"`)
    .replace(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="[^"]*"\/>/, `<rect x="-8" y="-6" width="${W}" height="${H}" fill="${paper}"/>`);
  cache.set(key, svg);
  return svg;
}
