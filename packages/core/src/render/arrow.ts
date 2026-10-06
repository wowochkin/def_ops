/**
 * Стрелка направления удара.
 *
 * Геометрия строится вдоль сглаженной оси: тело с переменной шириной
 * (хвост → шейка), наконечник с отнесёнными назад «усами», хвост —
 * либо свободный (прямой/вырез/скруглённый), либо привязанный к линии
 * фронта: тогда основание хвоста идёт ВДОЛЬ линии фронта, а кромки тела
 * плавно выходят из неё. Заливка вдоль оси (цвет и прозрачность) делается
 * непрозрачными поперечными срезами внутри клипа по контуру — это даёт
 * точный градиент вдоль изогнутой стрелки без швов.
 */
import { type Vec2, add, sub, mul, dot, perp, lerp, clamp, cross } from '../vec';
import { Path, smoothPath, polylinePath, removeLoops, pathD, bbox } from '../curve';
import type { ArrowFeature, ArrowStyle, ColorStop, Decoration } from '../model';
import { type RenderContext, f2, strokeAttrs, mixColor } from './context';
import { GLYPHS, type GlyphCtx } from './glyphs';
import { fontAttrs } from './symbol';

export interface ArrowGeometry {
  axis: Path;
  neckS: number;
  barbS: number;
  /** Полный контур (замкнутый). */
  outline: Vec2[];
  /** Контур для обводки: у привязанной стрелки — без основания на линии фронта. */
  strokeOutline: Vec2[];
  strokeClosed: boolean;
  head: Vec2[];
  width(s: number): number;
  /** Полуширина, которую должен покрыть срез заливки на длине s. */
  extent(s: number): number;
  anchored: boolean;
  /** Насколько хвост заходит назад за s = 0. */
  backReach: number;
}

export function arrowAxisPoints(f: ArrowFeature, ctx: RenderContext): { pts: Vec2[]; anchorPath: Path | null; anchorS: number } {
  const pts = f.points.map((p) => ctx.proj.toWorld(p));
  let anchorPath: Path | null = null;
  let anchorS = 0;
  if (f.anchor) {
    const p = ctx.featurePath(f.anchor.featureId);
    if (p) {
      anchorPath = p;
      anchorS = clamp(f.anchor.t, 0, 1) * p.length;
      pts[0] = p.pointAt(anchorS);
    }
  }
  return { pts, anchorPath, anchorS };
}

export function arrowGeometry(pts: Vec2[], st: ArrowStyle, anchorPath: Path | null = null, anchorS = 0): ArrowGeometry | null {
  if (pts.length < 2) return null;
  const axis = new Path(st.smooth ? smoothPath(pts) : polylinePath(pts, false, 1));
  const L = axis.length;
  if (L < 1e-3) return null;

  const hl = Math.min(st.headLength, L * 0.85);
  const neckS = L - hl;
  const sweep = clamp(st.barbSweep, -hl * 0.9, neckS);
  const barbS = neckS - sweep;
  const hw = st.headWidth / 2;

  const width = (s: number) => {
    const u = neckS > 0 ? clamp(s / neckS, 0, 1) : 1;
    return st.neckWidth + (st.tailWidth - st.neckWidth) * Math.pow(1 - u, st.taper || 1);
  };
  const extent = (s: number) => {
    let e = width(Math.min(s, neckS)) / 2;
    if (s >= Math.min(barbS, neckS)) e = Math.max(e, hw);
    return e;
  };

  // --- кромки тела
  const win = Math.max(1.5, Math.min(st.tailWidth, st.neckWidth) * 0.15);
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  const pushEdge = (s: number, p: Vec2) => {
    const n = axis.normalAt(s, win);
    const w = width(s) / 2;
    left.push(add(p, mul(n, w)));
    right.push(add(p, mul(n, -w)));
  };
  for (let i = 0; i < axis.pts.length && axis.cum[i] < neckS; i++) pushEdge(axis.cum[i], axis.pts[i]);
  pushEdge(neckS, axis.pointAt(neckS));

  // --- хвост
  let base: Vec2[]; // от правой кромки к левой
  let backReach = 0;
  let anchored = false;
  const t0 = axis.tangentAt(0, win);
  if (anchorPath) {
    anchored = true;
    const tl = anchorPath.tangentAt(anchorS, 3);
    const sinT = Math.abs(cross(t0, tl));
    const a = clamp((st.tailWidth / 2) / Math.max(sinT, 0.35), 0, anchorPath.length / 2);
    const sA = anchorS - a, sB = anchorS + a;
    const pA = anchorPath.pointAt(sA), pB = anchorPath.pointAt(sB);
    const n0 = perp(t0);
    const aIsLeft = dot(sub(pA, axis.pts[0]), n0) > dot(sub(pB, axis.pts[0]), n0);
    const back = mul(t0, -st.anchorOverlap);
    // основание идёт по линии фронта (с заходом под неё)
    const arc = anchorPath.slice(aIsLeft ? sB : sA, aIsLeft ? sA : sB).map((p) => add(p, back));
    const bl = arc[arc.length - 1], br = arc[0];
    // плавный выход кромок из линии фронта
    const blend = Math.min(neckS * 0.6, Math.max(st.tailWidth * 0.9, 4));
    const ease = (q: number) => q * q * (3 - 2 * q);
    for (let i = 0; i < left.length; i++) {
      const s = i < axis.pts.length ? axis.cum[i] : neckS;
      if (s >= blend) break;
      const e = ease(s / blend);
      left[i] = lerp(bl, left[i], e);
      right[i] = lerp(br, right[i], e);
    }
    base = arc;
    backReach = st.anchorOverlap + a + st.tailWidth;
  } else {
    const p0 = axis.pts[0];
    const l0 = left[0], r0 = right[0];
    if (st.tailShape === 'notch') {
      base = [r0, add(p0, mul(t0, st.tailNotch * st.tailWidth)), l0];
    } else if (st.tailShape === 'round') {
      base = [];
      const n0 = perp(t0);
      const w = width(0) / 2;
      for (let k = 0; k <= 16; k++) {
        const a = Math.PI * (k / 16);
        base.push(add(p0, add(mul(n0, -w * Math.cos(a)), mul(t0, -w * Math.sin(a)))));
      }
      backReach = w;
    } else {
      base = [r0, l0];
    }
  }

  const leftC = removeLoops(left);
  const rightC = removeLoops(right);

  // --- наконечник
  const curve = st.headCurve || 1;
  const sideL: Vec2[] = [];
  const sideR: Vec2[] = [];
  const span = L - barbS;
  const headPt = (s: number) => {
    const n = axis.normalAt(s, win);
    const w = hw * Math.pow(clamp((L - s) / span, 0, 1), curve);
    const p = axis.pointAt(s);
    sideL.push(add(p, mul(n, w)));
    sideR.push(add(p, mul(n, -w)));
  };
  headPt(barbS);
  for (let i = 0; i < axis.pts.length; i++) if (axis.cum[i] > barbS && axis.cum[i] < L) headPt(axis.cum[i]);
  const tip = axis.pointAt(L);

  const nl = leftC[leftC.length - 1], nr = rightC[rightC.length - 1];
  const head: Vec2[] = [nl, ...sideL, tip, ...sideR.slice().reverse(), nr];

  const rightRev = rightC.slice().reverse();
  const outline: Vec2[] = [...leftC, ...sideL, tip, ...sideR.slice().reverse(), ...rightRev];
  // основание: от правой кромки (последняя точка outline) к левой (первая) — без концевых точек
  const baseInner = base.slice(1, -1);
  const closedOutline = [...outline, ...baseInner];
  const strokeOutline = anchored || !st.outlineTail ? outline : closedOutline;

  return {
    axis, neckS, barbS, outline: closedOutline, strokeOutline, strokeClosed: !anchored && st.outlineTail, head, width, extent, anchored, backReach,
  };
}

function sampleStops(stops: ColorStop[], u: number): { color: string; opacity: number } {
  if (!stops.length) return { color: '#000000', opacity: 1 };
  const s = stops.slice().sort((a, b) => a.t - b.t);
  if (u <= s[0].t) return { color: s[0].color, opacity: s[0].opacity };
  for (let i = 0; i < s.length - 1; i++) {
    if (u <= s[i + 1].t) {
      const k = (u - s[i].t) / Math.max(1e-9, s[i + 1].t - s[i].t);
      return { color: mixColor(s[i].color, s[i + 1].color, k), opacity: s[i].opacity + (s[i + 1].opacity - s[i].opacity) * k };
    }
  }
  const last = s[s.length - 1];
  return { color: last.color, opacity: last.opacity };
}

/** Поперечные срезы вдоль оси: [s0, s1, полигон]. */
function slices(g: ArrowGeometry, count: number): { s: number; poly: Vec2[] }[] {
  const { axis } = g;
  const L = axis.length;
  const out: { s: number; poly: Vec2[] }[] = [];
  const step = L / count;
  const quad = (sa: number, sb: number, ea: number, eb: number): Vec2[] => {
    const pa = axis.pointAt(sa), pb = axis.pointAt(sb);
    const na = axis.normalAt(Math.max(0, Math.min(L, sa)), 2), nb = axis.normalAt(Math.max(0, Math.min(L, sb)), 2);
    return [add(pa, mul(na, ea)), add(pb, mul(nb, eb)), add(pb, mul(nb, -eb)), add(pa, mul(na, -ea))];
  };
  // срез позади хвоста (основание по линии фронта / скругление)
  const back = g.backReach + 2;
  const e0 = g.extent(0) * 2.5 + back;
  out.push({ s: 0, poly: quad(-back, 0.01, e0, e0) });
  for (let i = 0; i < count; i++) {
    const sa = i * step;
    const sb = Math.min(L + 2, (i + 1) * step + step * 0.6); // перекрытие против швов
    const ea = g.extent(sa) * 1.2 + 2;
    const eb = g.extent(Math.min(sb, L)) * 1.2 + 2;
    out.push({ s: sa + step / 2, poly: quad(sa, sb, Math.max(ea, eb), Math.max(ea, eb)) });
  }
  return out;
}

export function renderArrow(f: ArrowFeature, ctx: RenderContext): string {
  const st = f.style;
  const { pts, anchorPath, anchorS } = arrowAxisPoints(f, ctx);
  const g = arrowGeometry(pts, st, anchorPath, anchorS);
  if (!g) return '';
  const { axis, neckS } = g;
  const L = axis.length;
  const outlineD = pathD(g.outline, true);

  const stops = st.fill.length ? st.fill : [{ t: 0, color: '#000000', opacity: 1 }];
  const colorAt = (s: number) => sampleStops(stops, neckS > 0 ? clamp(s / neckS, 0, 1) : 1);
  const uniformColor = stops.every((s) => s.color.toLowerCase() === stops[0].color.toLowerCase());
  const uniformAlpha = stops.every((s) => Math.abs(s.opacity - stops[0].opacity) < 1e-3);
  const headColor = st.headFill || colorAt(neckS).color;

  let inner = '';
  const count = Math.max(24, Math.min(160, Math.round(L / 3)));
  const sl = !uniformColor || !uniformAlpha ? slices(g, count) : [];

  // тело
  if (uniformColor) {
    inner += `<path d="${outlineD}" fill="${stops[0].color}"/>`;
  } else {
    const clip = ctx.uid('clip');
    ctx.defs.push(`<clipPath id="${clip}"><path d="${outlineD}"/></clipPath>`);
    inner += `<g clip-path="url(#${clip})">`;
    for (const q of sl) inner += `<path d="${pathD(q.poly, true)}" fill="${colorAt(q.s).color}"/>`;
    inner += `</g>`;
  }

  // объёмный блик
  if (st.highlight && st.highlight.opacity > 0) {
    const h = st.highlight;
    const N = 7;
    for (let k = 0; k < N; k++) {
      const r = h.widthRatio * (1 - k / N);
      const lp = axis.offset((s) => (g.width(Math.min(s, neckS)) / 2) * r).filter((_, i) => axis.cum[i] <= neckS);
      const rp = axis.offset((s) => (-g.width(Math.min(s, neckS)) / 2) * r).filter((_, i) => axis.cum[i] <= neckS);
      inner += `<path d="${pathD([...removeLoops(lp), ...removeLoops(rp).reverse()], true)}" fill="${h.color}" fill-opacity="${f2(h.opacity / N)}"/>`;
    }
  }

  // осевая линия
  if (st.centerLine) {
    const cp = axis.pts.filter((_, i) => axis.cum[i] < L - 0.5);
    inner += `<path d="${pathD(cp)}" ${strokeAttrs(st.centerLine)} stroke-linecap="butt"/>`;
  }

  // наконечник
  inner += `<path d="${pathD(g.head, true)}" fill="${headColor}"${st.headOpacity < 1 ? ` fill-opacity="${st.headOpacity}"` : ''}/>`;

  let body = inner;
  if (!uniformAlpha) {
    const m = ctx.uid('mask');
    const [x0, y0, x1, y1] = bbox(g.outline);
    const pad = 20 + g.backReach;
    let mc = '';
    for (const q of sl) {
      const v = Math.round(clamp(colorAt(q.s).opacity, 0, 1) * 255);
      mc += `<path d="${pathD(q.poly, true)}" fill="rgb(${v},${v},${v})"/>`;
    }
    // наконечник — по прозрачности конца тела
    const hv = Math.round(clamp(colorAt(L).opacity, 0, 1) * 255);
    mc += `<path d="${pathD(g.head, true)}" fill="rgb(${hv},${hv},${hv})"/>`;
    ctx.defs.push(
      `<mask id="${m}" maskUnits="userSpaceOnUse" x="${f2(x0 - pad)}" y="${f2(y0 - pad)}" width="${f2(x1 - x0 + 2 * pad)}" height="${f2(y1 - y0 + 2 * pad)}">${mc}</mask>`,
    );
    body = `<g mask="url(#${m})">${inner}</g>`;
  } else if (stops[0].opacity < 1) {
    body = `<g opacity="${stops[0].opacity}">${inner}</g>`;
  }

  let out = body;
  if (st.outline && st.outline.width > 0) {
    out += `<path d="${pathD(g.strokeOutline, g.strokeClosed)}" ${strokeAttrs(st.outline)} stroke-linecap="butt"/>`;
  }
  for (const d of st.decorations || []) out += renderDecoration(d, axis);
  return out;
}

function renderDecoration(d: Decoration, axis: Path): string {
  const L = axis.length;
  const positions: number[] = [];
  if (d.repeat && d.repeat > 0.01) {
    for (let u = d.at; u <= (d.to ?? 1) + 1e-9; u += d.repeat) positions.push(u);
  } else positions.push(d.at);
  let out = '';
  const strokeA = d.stroke ? ` stroke="${d.stroke.color}" stroke-width="${f2(d.stroke.width)}" stroke-linejoin="miter"` : '';
  for (const u of positions) {
    const s = u * L;
    const c = axis.pointAt(s);
    const t = axis.tangentAt(s, 3);
    const n = perp(t);
    if (d.type === 'diamond') {
      const poly = [add(c, mul(t, d.length / 2)), add(c, mul(n, d.width / 2)), add(c, mul(t, -d.length / 2)), add(c, mul(n, -d.width / 2))];
      out += `<path d="${pathD(poly, true)}" fill="${d.fill || 'none'}"${strokeA}/>`;
    } else if (d.type === 'bar') {
      const s1 = (d.to ?? u + 0.1) * L;
      const p = axis.slice(s, s1);
      out += `<path d="${pathD(p)}" fill="none" stroke="${d.fill || '#000'}" stroke-width="${f2(d.width)}" stroke-linecap="butt" stroke-linejoin="round"/>`;
    } else if (d.type === 'tick') {
      const a = add(c, mul(n, d.width / 2)), b = add(c, mul(n, -d.width / 2));
      out += `<path d="${pathD([a, b])}" fill="none" stroke="${d.fill || '#000'}" stroke-width="${f2(d.length)}"/>`;
    } else if (d.type === 'glyph' && d.glyph && GLYPHS[d.glyph]) {
      // знак на оси (самолёт — удар авиации, якорь — морской десант), развёрнут по ходу стрелки
      const ang = (Math.atan2(t[1], t[0]) * 180) / Math.PI + 90;
      const g: GlyphCtx = {
        s: d.length, color: d.fill || '#000', fill: d.stroke?.color ?? '#ffffff', sw: d.stroke?.width ?? d.length * 0.06,
        font: (size, weight = 700, color) => fontAttrs({ font: 'PT Sans Narrow', size, weight, italic: false, color: color ?? d.fill ?? '#000', halo: null, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1 }),
      };
      out += `<g transform="translate(${f2(c[0])} ${f2(c[1])}) rotate(${f2(ang)})">${GLYPHS[d.glyph](g)}</g>`;
    } else if (d.type === 'chevron') {
      const back = add(c, mul(t, -d.length));
      const a = add(back, mul(n, d.width / 2)), b = add(back, mul(n, -d.width / 2));
      const sw = d.stroke?.width ?? 1;
      out += `<path d="${pathD([a, c, b])}" fill="none" stroke="${d.fill || d.stroke?.color || '#000'}" stroke-width="${f2(sw)}" stroke-linejoin="miter"/>`;
    }
  }
  return out;
}

/** Вспомогательная функция для редактора: точка на оси стрелки по доле длины. */
export function arrowAxis(f: ArrowFeature, ctx: RenderContext): Path | null {
  const { pts, anchorPath, anchorS } = arrowAxisPoints(f, ctx);
  const g = arrowGeometry(pts, f.style, anchorPath, anchorS);
  return g ? g.axis : null;
}

