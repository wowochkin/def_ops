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
import type { Feature, Layer, MapDocument } from '../model';
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
  // видимые знаки в размере на экране (оформление в коридоре размеров)
  const shown: { layer: Layer; list: Feature[] }[] = [];
  for (const { layer, features: list } of orderedFeatures(doc)) {
    if (only ? !only.has(layer.id) : !layer.visible && !o.includeHidden) continue;
    const vis: Feature[] = [];
    for (const f of list) {
      if (f.hidden) continue;
      if (denom != null && !visibleAtScale(f, layer, denom)) continue;
      const m = o.view ? sizeFactor(f, doc.refZoom, o.view.zoom, sizing) : 1;
      vis.push(Math.abs(m - 1) < 1e-3 ? f : ({ ...f, style: scaleStyle(f.style, m) } as Feature));
    }
    shown.push({ layer, list: vis });
  }
  const mute = o.view && input.declutter ? declutter(shown.flatMap((x) => x.list), ctx.proj) : null;
  for (const { layer, list } of shown) {
    const out: RenderedFeature[] = [];
    for (const f of list) {
      try {
        const g = mute?.has(f.id) && f.kind === 'symbol' ? ({ ...f, style: { ...f.style, text: '' } } as Feature) : f;
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

type Box = [number, number, number, number];
const overlap = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
/**
 * Разрежение подписей знаков-объединений (овал, танковый, кавалерийский знак): подписи идут по важности
 * (labelRank, затем порядок на карте); подпись, которая налезает на уже поставленную подпись или на тело
 * другого знака, снимается. Всё — в мировых координатах с размерами на экране, поэтому внутри коридора
 * размеров результат от зума не зависит. Возвращает id знаков, у которых подпись не рисуется.
 */
function declutter(list: Feature[], proj: RenderContext['proj']): Set<string> {
  type C = { id: string; rank: number; i: number; body: Box; text: Box | null };
  const cs: C[] = [];
  list.forEach((f, i) => {
    if (f.kind !== 'symbol' || !['armyOval', 'tankArmy', 'cavalryCorps'].includes(f.style.type)) return;
    const st = f.style, p = proj.toWorld(f.at), rx = st.size / 2, ry = rx * st.aspect;
    const body: Box = [p[0] - rx, p[1] - ry, p[0] + rx, p[1] + ry];
    let text: Box | null = null;
    if (st.text) {
      const fs = st.textStyle?.size ?? ry * 1.1, w = st.text.length * fs * 0.5 + fs * 0.3;
      const y = p[1] + (st.type === 'armyOval' ? fs * 0.35 : ry + fs * 0.95);
      text = [p[0] - w / 2, y - fs * 0.85, p[0] + w / 2, y + fs * 0.25];
    }
    cs.push({ id: f.id, rank: f.labelRank ?? 0, i, body, text });
  });
  const mute = new Set<string>();
  // знаки, лежащие друг на друге, — одна группа: подпись только у верхнего (нарисован последним — его видно),
  // очередь группы — по самому важному её знаку
  const grp = cs.map((_, k) => k);
  const root = (k: number): number => (grp[k] === k ? k : (grp[k] = root(grp[k])));
  cs.forEach((c, k) => cs.forEach((o, j) => { if (j > k && overlap(c.body, o.body)) grp[root(j)] = root(k); }));
  const groups = new Map<number, C[]>();
  cs.forEach((c, k) => groups.set(root(k), [...(groups.get(root(k)) ?? []), c]));
  const heads: { c: C; rank: number; members: Set<string> }[] = [];
  for (const g of groups.values()) {
    const labelled = g.filter((c) => c.text);
    if (!labelled.length) continue;
    const top = labelled.reduce((a, c) => (c.i > a.i ? c : a));
    for (const c of labelled) if (c !== top) mute.add(c.id);
    heads.push({ c: top, rank: Math.max(...g.map((c) => c.rank)), members: new Set(g.map((c) => c.id)) });
  }
  const kept: Box[] = [];
  for (const h of heads.sort((a, b) => b.rank - a.rank || a.c.i - b.c.i)) {
    const t = h.c.text!;
    // подпись не заходит под знаки других групп и на уже поставленные подписи
    if (kept.some((k) => overlap(k, t)) || cs.some((o) => !h.members.has(o.id) && overlap(o.body, t))) mute.add(h.c.id);
    else kept.push(t);
  }
  return mute;
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
