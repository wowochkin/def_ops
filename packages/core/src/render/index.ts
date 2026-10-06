/**
 * Сборка документа в SVG. Результат — разметка в «мировых пикселях»
 * документа; на карте она помещается в группу с аффинным преобразованием
 * (сдвиг/масштаб/поворот), поэтому при панорамировании и зуме
 * пересчитывать геометрию не нужно.
 */
import { makeProjection, type Projection } from '../geo';
import type { Path } from '../curve';
import { bbox } from '../curve';
import { documentAt } from '../temporal';
import type { Feature, MapDocument } from '../model';
import { scaleStyle } from '../presets';
import { sizeFactor, sizingOf, visibleAtScale } from '../scaling';
import { type RenderContext, esc } from './context';
import { orderedFeatures } from '../layers';
import { renderArrow } from './arrow';
import { renderLine, linePath } from './line';
import { renderArea } from './area';
import { renderSymbol, renderLabel } from './symbol';

export interface RenderedFeature {
  id: string;
  svg: string;
}

export interface RenderedLayer {
  id: string;
  name: string;
  opacity: number;
  features: RenderedFeature[];
}

export interface RenderResult {
  defs: string;
  /** Все видимые объекты в порядке отрисовки. */
  features: RenderedFeature[];
  /** Те же объекты, сгруппированные по видимым слоям (снизу вверх). */
  layers: RenderedLayer[];
  proj: Projection;
}

export interface RenderOptions {
  /** Префикс id в <defs> — чтобы несколько SVG на одной странице не конфликтовали. */
  idPrefix?: string;
  /** Рендерить только эти слои (независимо от их видимости в документе). */
  layers?: string[];
  /** Игнорировать видимость слоёв (например, для превью отдельного слоя). */
  includeHidden?: boolean;
  /** Обстановка на момент времени (знаки вне периода скрыты, положение — по ключевым кадрам). */
  time?: string | null;
  /**
   * Вид на экране: зум (размер оформления — в коридоре doc.sizing) и масштаб
   * «1 : N» (знаки и слои вне своих диапазонов масштабов скрыты). Без вида —
   * всё в размере, с которым нарисовано, на любом масштабе (экспорт, печать).
   */
  view?: { zoom: number; denominator?: number } | null;
}

export function createContext(doc: MapDocument, proj: Projection = makeProjection(doc.origin, doc.refZoom)): RenderContext {
  const byId = new Map(doc.features.map((f) => [f.id, f]));
  const pathCache = new Map<string, Path | null>();
  let n = 0;
  const ctx: RenderContext = {
    proj,
    defs: [],
    uid: (p) => `${p}-${(n++).toString(36)}`,
    feature: (id) => byId.get(id),
    featurePath(id) {
      if (pathCache.has(id)) return pathCache.get(id)!;
      const f = byId.get(id);
      let p: Path | null = null;
      if (f && (f.kind === 'line' || f.kind === 'area') && f.points.length >= 2) {
        const closed = f.kind === 'area' || !!(f.kind === 'line' && f.closed);
        p = linePath(f.points.map((q) => proj.toWorld(q)), f.style.smooth, closed);
      }
      pathCache.set(id, p);
      return p;
    },
  };
  return ctx;
}

export function renderFeature(f: Feature, ctx: RenderContext): string {
  switch (f.kind) {
    case 'arrow': return renderArrow(f, ctx);
    case 'line': return renderLine(f, ctx);
    case 'area': return renderArea(f, ctx);
    case 'symbol': return renderSymbol(f, ctx);
    case 'label': return renderLabel(f, ctx);
  }
}

export function renderDocument(input: MapDocument, opts: RenderOptions | string = {}): RenderResult {
  const o: RenderOptions = typeof opts === 'string' ? { idPrefix: opts } : opts;
  const doc = documentAt(input, o.time);
  const ctx = createContext(doc);
  if (o.idPrefix) {
    const base = ctx.uid;
    ctx.uid = (p) => o.idPrefix + base(p);
  }
  const only = o.layers ? new Set(o.layers) : null;
  const sizing = sizingOf(input);
  const denom = o.view?.denominator;
  const features: RenderedFeature[] = [];
  const layers: RenderedLayer[] = [];
  for (const { layer, features: list } of orderedFeatures(doc)) {
    if (only ? !only.has(layer.id) : !layer.visible && !o.includeHidden) continue;
    const out: RenderedFeature[] = [];
    for (const f of list) {
      if (f.hidden) continue;
      if (denom != null && !visibleAtScale(f, layer, denom)) continue;
      try {
        const m = o.view ? sizeFactor(f, doc.refZoom, o.view.zoom, sizing) : 1;
        const g = Math.abs(m - 1) < 1e-3 ? f : ({ ...f, style: scaleStyle(f.style, m) } as Feature);
        out.push({ id: f.id, svg: renderFeature(g, ctx) });
      } catch (e) {
        console.error('render failed', f.id, e);
      }
    }
    features.push(...out);
    layers.push({ id: layer.id, name: layer.name, opacity: layer.opacity, features: out });
  }
  return { defs: ctx.defs.join(''), features, layers, proj: ctx.proj };
}

/** Самостоятельный SVG-файл (экспорт): границы по содержимому или по заданной рамке. */
export function exportSVG(input: MapDocument, opts: { padding?: number; background?: string | null; layers?: string[]; time?: string | null } = {}): string {
  const doc = documentAt(input, opts.time);
  const r = renderDocument(doc, { idPrefix: 'x' + Math.random().toString(36).slice(2, 7), layers: opts.layers });
  const shown = new Set(r.features.map((f) => f.id));
  const pts = doc.features.filter((f) => shown.has(f.id)).flatMap((f) =>
    f.kind === 'symbol' || f.kind === 'label' ? [f.at] : f.points,
  ).map((p) => r.proj.toWorld(p));
  const pad = opts.padding ?? 40;
  const [x0, y0, x1, y1] = pts.length ? bbox(pts) : [0, 0, 100, 100];
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  const bg = opts.background === undefined ? doc.paper : opts.background;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="${x0 - pad} ${y0 - pad} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}">` +
    `<defs>${r.defs}</defs>` +
    (bg ? `<rect x="${x0 - pad}" y="${y0 - pad}" width="${w}" height="${h}" fill="${bg}"/>` : '') +
    // слои — группами (в Inkscape/Illustrator открываются как слои)
    r.layers.map((l) =>
      `<g id="layer-${esc(l.id)}" inkscape:groupmode="layer" inkscape:label="${esc(l.name)}"${l.opacity < 1 ? ` opacity="${l.opacity}"` : ''}>` +
      l.features.map((f) => `<g data-id="${f.id}">${f.svg}</g>`).join('') + '</g>',
    ).join('') +
    `</svg>`
  );
}
