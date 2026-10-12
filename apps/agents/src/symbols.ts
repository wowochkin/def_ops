/**
 * Знаки дивизий — из библиотеки знаков редактора (@def-ops/core): стрелковые — овал, танковые и механизированные —
 * знак механизированного корпуса; советские — «свои», немецкие — «противник». Разметка знака берётся из SVG,
 * который строит библиотека, и вставляется в слой знаков приложения.
 */
import { createFeature, emptyDocument, exportSVG, type MapDocument } from '@def-ops/core';
import type { DivisionInfo } from './data';

const cache = new Map<string, string>();

export function symbolMarkup(d: DivisionInfo): string {
  const preset = d.mobility === 'foot' ? 'std.unitOval' : 'std.mechCorps';
  const side = d.side === 'su' ? 'own' : 'enemy';
  const key = `${preset}|${side}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const doc = emptyDocument() as MapDocument;
  const f = createFeature('symbol', preset, { at: [0, 0], layerId: doc.layers[0].id }, 1, side);
  doc.features = [f];
  const svg = exportSVG(doc, { padding: 0, background: null });
  // содержимое знака — внутри <g transform="translate(…)">…</g> элемента знака
  const m = svg.match(/<g data-id="[^"]+"><g transform="[^"]*">([\s\S]*?)<\/g><\/g>/);
  const inner = m ? m[1] : '<circle r="8" fill="#ccc"/>';
  cache.set(key, inner);
  return inner;
}
