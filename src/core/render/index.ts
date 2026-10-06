/**
 * Сборка документа в SVG. Результат — разметка в «мировых пикселях»
 * документа; на карте она помещается в группу с аффинным преобразованием
 * (сдвиг/масштаб/поворот), поэтому при панорамировании и зуме
 * пересчитывать геометрию не нужно.
 */
import { makeProjection, type Projection } from '../geo';
import type { Path } from '../curve';
import { bbox } from '../curve';
import type { Feature, MapDocument } from '../model';
import type { RenderContext } from './context';
import { renderArrow } from './arrow';
import { renderLine, linePath } from './line';
import { renderArea } from './area';
import { renderSymbol, renderLabel } from './symbol';

export interface RenderedFeature {
  id: string;
  svg: string;
}

export interface RenderResult {
  defs: string;
  features: RenderedFeature[];
  proj: Projection;
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

export function renderDocument(doc: MapDocument, idPrefix = ''): RenderResult {
  const ctx = createContext(doc);
  if (idPrefix) {
    const base = ctx.uid;
    ctx.uid = (p) => idPrefix + base(p);
  }
  const features: RenderedFeature[] = [];
  for (const f of doc.features) {
    if (f.hidden) continue;
    try {
      features.push({ id: f.id, svg: renderFeature(f, ctx) });
    } catch (e) {
      console.error('render failed', f.id, e);
    }
  }
  return { defs: ctx.defs.join(''), features, proj: ctx.proj };
}

/** Самостоятельный SVG-файл (экспорт): границы по содержимому или по заданной рамке. */
export function exportSVG(doc: MapDocument, opts: { padding?: number; background?: string | null } = {}): string {
  const r = renderDocument(doc, 'x' + Math.random().toString(36).slice(2, 7));
  const pts = doc.features.flatMap((f) =>
    f.kind === 'symbol' || f.kind === 'label' ? [f.at] : f.points,
  ).map((p) => r.proj.toWorld(p));
  const pad = opts.padding ?? 40;
  const [x0, y0, x1, y1] = pts.length ? bbox(pts) : [0, 0, 100, 100];
  const w = x1 - x0 + 2 * pad, h = y1 - y0 + 2 * pad;
  const bg = opts.background === undefined ? doc.paper : opts.background;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0 - pad} ${y0 - pad} ${w} ${h}" width="${Math.round(w)}" height="${Math.round(h)}">` +
    `<defs>${r.defs}</defs>` +
    (bg ? `<rect x="${x0 - pad}" y="${y0 - pad}" width="${w}" height="${h}" fill="${bg}"/>` : '') +
    r.features.map((f) => `<g data-id="${f.id}">${f.svg}</g>`).join('') +
    `</svg>`
  );
}
