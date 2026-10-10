/** Миниатюры знаков для палитры и справочника (рендерятся тем же движком, что и карта). */
import { ARROW_PRESETS, emptyDocument, makeProjection, createFeature, exportSVG, type ArrowFeature, type MapDocument, type PresetKind, type Side } from '@def-ops/core';

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
  if (kind === 'arrow') {
    const fork = (ARROW_PRESETS as Record<string, { fork?: number }>)[id]?.fork;
    // разветвлённая стрелка: ствол вверх-вправо, ветвь — вниз-вправо
    f = fork
      ? { ...(createFeature(kind, id, { ...g, points: [ll(0, H * 0.6), ll(75, H * 0.35), ll(150, H * 0.12)] }, k, side) as ArrowFeature), branches: [{ t: 0.55, points: [ll(150, H * 0.82)] }] }
      : createFeature(kind, id, { ...g, points: [ll(0, H * 0.55), ll(70, H * 0.2), ll(150, H * 0.3)] }, k, side);
  }
  else if (kind === 'line') f = createFeature(kind, id, { ...g, points: [ll(0, H * 0.45), ll(50, H * 0.2), ll(100, H * 0.5), ll(150, H * 0.3)] }, k, side);
  else if (kind === 'area') f = createFeature(kind, id, { ...g, points: [ll(25, 4), ll(110, 2), ll(140, H * 0.4), ll(95, H - 6), ll(28, H - 8)] }, k, side);
  else if (kind === 'symbol') f = createFeature(kind, id, { ...g, at: ll(75, H * 0.55) }, k, side);
  else f = createFeature(kind, id, { ...g, at: ll(75, H * 0.45), text: 'Образец' }, k, side);
  doc.features = [f];
  let svg = exportSVG(doc, { padding: 6, background: paper });
  svg = svg
    .replace(/viewBox="[^"]*" width="\d+" height="\d+"/, `viewBox="-8 -6 ${W} ${H}" width="${W}" height="${H}"`)
    .replace(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="[^"]*"\/>/, `<rect x="-8" y="-6" width="${W}" height="${H}" fill="${paper}"/>`);
  svg = fitToContent(svg, -8, -6, W, H);
  cache.set(key, svg);
  return svg;
}

let probe: HTMLDivElement | null = null;

/**
 * Кадр миниатюры задан вокруг точки привязки, а знак может выходить за него
 * (у флагов привязка — низ древка, полотнище уходит вверх). Измеряем фактические
 * габариты знака и, если он не помещается, расширяем кадр с сохранением пропорций.
 * Масштаб знаков, которые помещаются, не меняется — миниатюры остаются сопоставимыми.
 */
const SKIP = new Set(['defs', 'clipPath', 'pattern', 'mask', 'marker', 'linearGradient', 'radialGradient', 'title', 'style']);
const SHAPES = new Set(['path', 'line', 'polyline', 'polygon', 'circle', 'ellipse', 'rect', 'text', 'image', 'use']);

/** Габариты нарисованного в координатах корневого SVG; обрезанные элементы — по контуру обрезки. */
function measure(root: SVGSVGElement): [number, number, number, number] | null {
  const inv = root.getScreenCTM()?.inverse();
  if (!inv) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const add = (el: SVGGraphicsElement) => {
    const b = el.getBBox();
    const ctm = el.getScreenCTM();
    if (!ctm || (!b.width && !b.height)) return;
    const mtx = inv.multiply(ctm);
    for (const [px, py] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
      const q = new DOMPoint(px, py).matrixTransform(mtx);
      x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
    }
  };
  const walk = (el: Element, isRoot = false) => {
    if (SKIP.has(el.tagName)) return;
    const clip = el.getAttribute('clip-path')?.match(/url\(#([^)]+)\)/)?.[1];
    if (clip) {
      // всё, что внутри, видно только в пределах контура обрезки — его и меряем
      const cp = root.querySelector(`[id="${CSS.escape(clip)}"]`);
      if (cp && el instanceof SVGGraphicsElement) {
        const ctm = el.getScreenCTM();
        for (const sh of Array.from(cp.children)) {
          if (!(sh instanceof SVGGraphicsElement) || !ctm) continue;
          const b = sh.getBBox();
          const mtx = inv.multiply(ctm);
          for (const [px, py] of [[b.x, b.y], [b.x + b.width, b.y], [b.x, b.y + b.height], [b.x + b.width, b.y + b.height]]) {
            const q = new DOMPoint(px, py).matrixTransform(mtx);
            x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y);
          }
        }
        return;
      }
    }
    if (isRoot && el.tagName === 'rect') return; // фон миниатюры
    if (SHAPES.has(el.tagName) && el instanceof SVGGraphicsElement) { add(el); return; }
    for (const c of Array.from(el.children)) walk(c);
  };
  for (const c of Array.from(root.children)) walk(c, true);
  return isFinite(x0) ? [x0, y0, x1, y1] : null;
}

function fitToContent(svg: string, x: number, y: number, w: number, h: number): string {
  if (typeof document === 'undefined' || !document.body) return svg;
  if (!probe) {
    probe = document.createElement('div');
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none';
    document.body.appendChild(probe);
  }
  probe.innerHTML = svg;
  const root = probe.querySelector('svg');
  if (!root) return svg;
  const box = measure(root);
  probe.innerHTML = '';
  if (!box) return svg;
  const m = 2.5; // запас на толщину обводки
  const x0 = box[0] - m, y0 = box[1] - m, x1 = box[2] + m, y1 = box[3] + m;
  const tol = 1.5; // мелкие выходы за кадр не стоят перекадрирования
  if (x0 >= x - tol && y0 >= y - tol && x1 <= x + w + tol && y1 <= y + h + tol) return svg;
  // объединение исходного кадра и габаритов знака, затем — до пропорций W:H вокруг центра
  let nx0 = Math.min(x, x0), ny0 = Math.min(y, y0), nx1 = Math.max(x + w, x1), ny1 = Math.max(y + h, y1);
  const k = Math.max((nx1 - nx0) / w, (ny1 - ny0) / h);
  const cx = (nx0 + nx1) / 2, cy = (ny0 + ny1) / 2;
  nx0 = cx - (w * k) / 2; ny0 = cy - (h * k) / 2;
  const vb = `${nx0.toFixed(2)} ${ny0.toFixed(2)} ${(w * k).toFixed(2)} ${(h * k).toFixed(2)}`;
  return svg
    .replace(/viewBox="[^"]*"/, `viewBox="${vb}"`)
    .replace(/<rect x="[^"]*" y="[^"]*" width="[^"]*" height="[^"]*" fill="([^"]*)"\/>/, `<rect x="${nx0.toFixed(2)}" y="${ny0.toFixed(2)}" width="${(w * k).toFixed(2)}" height="${(h * k).toFixed(2)}" fill="$1"/>`);
}
