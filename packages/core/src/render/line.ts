/**
 * Линии: фронт, рубежи, укрепления, позиции подразделений, ж/д.
 * Линия — набор параллельных слоёв штриха со смещением от оси;
 * у слоя могут быть зубцы (укрепления), пунктир, засечки на концах.
 */
import { type Vec2, add, mul, rotate } from '../vec';
import { Path, smoothPath, polylinePath, pathD } from '../curve';
import type { LineFeature, LineLabel, LineMark, StrokeLayer } from '../model';
import { GLYPHS } from './glyphs';
import { fontAttrs } from './symbol';
import { type RenderContext, f2, esc } from './context';

export function linePath(points: Vec2[], smooth: boolean, closed: boolean): Path {
  return new Path(smooth ? smoothPath(points, closed) : polylinePath(points, closed, 1), closed);
}

export function renderStrokeLayers(path: Path, layers: StrokeLayer[], closed: boolean): string {
  let out = '';
  for (const ly of layers) out += renderStrokeLayer(path, ly, closed);
  return out;
}

/** Ломаная «пила», волна или меандр вдоль пути (траншеи, ходы сообщения). */
function patterned(path: Path, ly: StrokeLayer): Vec2[] {
  const pt = ly.pattern!;
  const L = path.length, wl = Math.max(0.5, pt.wavelength), a = pt.amplitude;
  const out: Vec2[] = [];
  const at = (s: number, off: number) => add(path.pointAt(s), mul(path.normalAt(s, 3), ly.offset + off));
  if (pt.type === 'zigzag') {
    const n = Math.max(2, Math.round(L / (wl / 2)));
    for (let i = 0; i <= n; i++) out.push(at((L * i) / n, i === 0 || i === n ? 0 : i % 2 ? a : -a));
  } else if (pt.type === 'wave') {
    const n = Math.max(8, Math.round((L / wl) * 16));
    for (let i = 0; i <= n; i++) { const s = (L * i) / n; out.push(at(s, a * Math.sin((2 * Math.PI * s) / wl))); }
  } else if (pt.type === 'loops') {
    // петли (проволочная спираль, малозаметное заграждение): вытянутая циклоида
    const turns = Math.max(1, Math.round(L / wl)), step = L / turns, k = step / (2 * Math.PI);
    const r = Math.max(a, k * 1.25);
    const N = turns * 24;
    for (let i = 0; i <= N; i++) {
      const th = (2 * Math.PI * i) / 24;
      const sx = Math.min(L, Math.max(0, k * th - r * Math.sin(th) + (i === 0 ? 0 : 0)));
      out.push(at(sx, r * (1 - Math.cos(th)) * 0.9 - r * 0.9));
    }
  } else {
    // меандр: уступы на одну сторону
    const n = Math.max(2, Math.round(L / (wl / 2)));
    for (let i = 0; i < n; i++) {
      const s0 = (L * i) / n, s1 = (L * (i + 1)) / n, h = i % 2 ? a : 0;
      out.push(at(s0, h), at(s1, h));
    }
  }
  return out;
}

export function renderStrokeLayer(path: Path, ly: StrokeLayer, closed: boolean): string {
  let out = '';
  const pts = ly.pattern ? patterned(path, ly) : ly.offset ? path.offset(ly.offset, 3) : path.pts;
  if (ly.width > 0) {
    let a = `fill="none" stroke="${ly.color}" stroke-width="${f2(ly.width)}" stroke-linejoin="round" stroke-linecap="${ly.cap || 'butt'}"`;
    if (ly.opacity < 1) a += ` stroke-opacity="${ly.opacity}"`;
    if (ly.dash && ly.dash.length) a += ` stroke-dasharray="${ly.dash.map(f2).join(' ')}"`;
    out += `<path d="${pathD(pts, closed)}" ${a}/>`;
  }
  if (ly.ticks && ly.ticks.spacing > 0) out += renderTicks(path, ly, closed);
  if (ly.endCaps && !closed && path.length > 0) out += renderEndCaps(path, ly);
  if (ly.endTicks && !closed && path.length > 0) {
    const e = ly.endTicks;
    let d = '';
    for (const s of [0, path.length]) {
      const n = path.normalAt(s, 3);
      const p = add(path.pointAt(s), mul(n, ly.offset));
      const q = add(p, mul(n, e.side * e.length));
      d += pathD([p, q]);
    }
    out += `<path d="${d}" fill="none" stroke="${ly.color}" stroke-width="${f2(e.width)}" stroke-linecap="butt"${ly.opacity < 1 ? ` stroke-opacity="${ly.opacity}"` : ''}/>`;
  }
  return out;
}

function renderTicks(path: Path, ly: StrokeLayer, closed: boolean): string {
  const t = ly.ticks!;
  const L = path.length;
  const color = t.color || ly.color;
  const fit = closed || t.fit;
  const n = fit ? Math.max(1, Math.round(L / t.spacing)) : Math.max(1, Math.floor(L / t.spacing));
  const step = fit ? L / n : t.spacing;
  const start = fit ? step * (t.phase ?? 0.5) : (L - (n - 1) * step) / 2;
  const every = Math.max(1, Math.round(t.every ?? 1));
  const ang = ((t.angle || 0) * Math.PI) / 180;
  const onLine = t.shape === 'cross' || t.shape === 'x' || t.shape === 'slash' || t.shape === 'chevron' || ((t.shape === 'circle' || t.shape === 'dot') && t.side === 0);
  const sides: (1 | -1)[] = t.side === 0 ? (onLine ? [1] : [1, -1]) : [t.side];
  let d = '';
  let tri = '';
  let dots = '';
  let rings = '';
  for (let i = 0; i < n; i++) {
    if (i % every) continue;
    const s = start + i * step;
    if (s < 0 || s > L) continue;
    const nrm = path.normalAt(s, 3);
    const tan = path.tangentAt(s, 3);
    const c = add(path.pointAt(s), mul(nrm, ly.offset));
    for (const side of sides) {
      const dir = rotate(mul(nrm, side), ang * side);
      const p0 = add(c, mul(dir, ly.width / 2 - 0.2));
      const p1 = add(c, mul(dir, ly.width / 2 + t.length));
      const mid = onLine ? c : add(c, mul(dir, ly.width / 2 + t.length / 2));
      const r = t.length / 2;
      if (t.shape === 'triangle') {
        const hw = t.width / 2;
        tri += pathD([add(p0, mul(tan, -hw)), p1, add(p0, mul(tan, hw))], true);
      } else if (t.shape === 'cross' || t.shape === 'x') {
        // крестик на линии (проволочное заграждение): по центру линии, а не сбоку
        const cc = t.side === 0 || t.shape === 'x' ? c : mid;
        const u = t.shape === 'x' ? rotate(tan, Math.PI / 4) : tan, v = t.shape === 'x' ? rotate(tan, -Math.PI / 4) : nrm;
        d += pathD([add(cc, mul(u, -r)), add(cc, mul(u, r))]) + pathD([add(cc, mul(v, -r)), add(cc, mul(v, r))]);
      } else if (t.shape === 'slash') {
        // косые штрихи поперёк линии (надолбы; ряды проволоки — по числу штрихов)
        const cnt = Math.max(1, t.count ?? 1), u = rotate(tan, -Math.PI / 3);
        for (let k = 0; k < cnt; k++) {
          const cc = add(c, mul(tan, (k - (cnt - 1) / 2) * t.width * 2.2));
          d += pathD([add(cc, mul(u, -r)), add(cc, mul(u, r))]);
        }
      } else if (t.shape === 'chevron') {
        // «ёлочка» (завал): вершина вперёд по ходу линии
        const back = add(c, mul(tan, -r));
        d += pathD([add(back, mul(nrm, r * 0.9)), c, add(back, mul(nrm, -r * 0.9))]);
      } else if (t.shape === 'circle') {
        rings += `M${f2(mid[0] + r)} ${f2(mid[1])}a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0Z`;
      } else if (t.shape === 'dot') {
        dots += `M${f2(mid[0] + r)} ${f2(mid[1])}a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0Z`;
      } else if (t.shape === 'semicircle') {
        // полукруг наружу (укреплённый район)
        const a0 = add(c, add(mul(dir, ly.width / 2), mul(tan, -r))), a1 = add(c, add(mul(dir, ly.width / 2), mul(tan, r)));
        const sweep = side > 0 ? 1 : 0;
        rings += `M${f2(a0[0])} ${f2(a0[1])}A${f2(r)} ${f2(r)} 0 0 ${sweep} ${f2(a1[0])} ${f2(a1[1])}`;
      } else d += pathD([p0, p1]);
    }
  }
  let out = '';
  if (d) out += `<path d="${d}" fill="none" stroke="${color}" stroke-width="${f2(t.width)}" stroke-linecap="butt"${ly.opacity < 1 ? ` stroke-opacity="${ly.opacity}"` : ''}/>`;
  if (tri) out += `<path d="${tri}" fill="${color}"${ly.opacity < 1 ? ` fill-opacity="${ly.opacity}"` : ''}/>`;
  if (dots) out += `<path d="${dots}" fill="${color}"${ly.opacity < 1 ? ` fill-opacity="${ly.opacity}"` : ''}/>`;
  if (rings) out += `<path d="${rings}" fill="none" stroke="${color}" stroke-width="${f2(t.width)}"${ly.opacity < 1 ? ` stroke-opacity="${ly.opacity}"` : ''}/>`;
  return out;
}

export function renderLine(f: LineFeature, ctx: RenderContext): string {
  if (f.points.length < 2) return '';
  const path = linePath(f.points.map((p) => ctx.proj.toWorld(p)), f.style.smooth, !!f.closed);
  let out = renderStrokeLayers(path, f.style.layers, !!f.closed);
  for (const mk of f.style.marks ?? []) out += renderMarks(path, mk, f.style.layers[0]?.color ?? '#000');
  for (const lb of f.style.labels ?? []) out += renderLineLabel(path, lb, ctx);
  return out;
}

/** Окончания линии: крюк, загиб, засечка «Т», точка, стрелка. */
function renderEndCaps(path: Path, ly: StrokeLayer): string {
  const e = ly.endCaps!;
  const r = e.size / 2, side = e.side ?? -1;
  let d = '', fill = '';
  const ends: [number, number][] = [];
  if (e.start !== false) ends.push([0, -1]);
  if (e.end !== false) ends.push([path.length, 1]);
  for (const [s, dir] of ends) {
    const tan = mul(path.tangentAt(s, 3), dir); // наружу от линии
    const nrm = path.normalAt(s, 3);
    const p = add(path.pointAt(s), mul(nrm, ly.offset));
    if (e.type === 'bar') {
      d += pathD([add(p, mul(nrm, e.size / 2)), add(p, mul(nrm, -e.size / 2))]);
    } else if (e.type === 'hook') {
      // полуокружность за концом линии: «◡—————◡»
      const c = add(p, mul(tan, r));
      const pts: Vec2[] = [];
      for (let k = 0; k <= 12; k++) {
        const a = (Math.PI * k) / 12;
        pts.push(add(c, add(mul(tan, -r * Math.cos(a)), mul(nrm, side * r * Math.sin(a)))));
      }
      d += pathD(pts);
    } else if (e.type === 'bend') {
      // загиб конца к своим (линия соприкосновения, положение подразделения)
      const pts: Vec2[] = [];
      for (let k = 0; k <= 8; k++) {
        const a = (Math.PI / 2) * (k / 8);
        pts.push(add(p, add(mul(tan, r * Math.sin(a)), mul(nrm, side * r * (1 - Math.cos(a))))));
      }
      d += pathD(pts);
    } else if (e.type === 'dot') {
      fill += `M${f2(p[0] + r)} ${f2(p[1])}a${f2(r)} ${f2(r)} 0 1 0 ${f2(-2 * r)} 0a${f2(r)} ${f2(r)} 0 1 0 ${f2(2 * r)} 0Z`;
    } else if (e.type === 'arrow') {
      const tip = add(p, mul(tan, e.size));
      fill += pathD([tip, add(p, mul(nrm, e.size * 0.4)), add(p, mul(nrm, -e.size * 0.4))], true);
    }
  }
  const op = ly.opacity < 1 ? ` stroke-opacity="${ly.opacity}"` : '';
  let out = '';
  if (d) out += `<path d="${d}" fill="none" stroke="${ly.color}" stroke-width="${f2(ly.width || 1)}" stroke-linecap="butt"${op}/>`;
  if (fill) out += `<path d="${fill}" fill="${ly.color}"/>`;
  return out;
}

/** Знаки на линии (стрелка в середине рубежа атаки, ромбы огневого рубежа и т.п.). */
function renderMarks(path: Path, mk: LineMark, defColor: string): string {
  const glyph = GLYPHS[mk.glyph];
  if (!glyph) return '';
  const color = mk.color ?? defColor;
  let out = '';
  for (const u of mk.at) {
    const s = Math.max(0, Math.min(1, u)) * path.length;
    const nrm = path.normalAt(s, 4), tan = path.tangentAt(s, 4);
    const p = add(path.pointAt(s), mul(nrm, mk.offset ?? 0));
    const dir = mk.orient === 'tangent' ? tan : nrm;
    const deg = (Math.atan2(dir[0], -dir[1]) * 180) / Math.PI;
    const g = {
      s: mk.size, color, fill: '#ffffff', sw: Math.max(0.8, mk.size * 0.08),
      font: (size: number, weight = 700, c?: string) => fontAttrs({ font: 'PT Sans Narrow', size, weight, italic: true, color: c ?? color, halo: null, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1 }),
    };
    out += `<g transform="translate(${f2(p[0])} ${f2(p[1])}) rotate(${f2(deg)})">${glyph(g)}</g>`;
  }
  return out;
}

/** Надпись вдоль линии; текст всегда читается слева направо. */
function renderLineLabel(path: Path, lb: LineLabel, ctx: RenderContext): string {
  let out = '';
  for (const u of lb.at) {
    const s = Math.max(0, Math.min(1, u)) * path.length;
    const tan = path.tangentAt(s, 4);
    const flip = tan[0] < 0;
    const p = add(path.pointAt(s), mul(path.normalAt(s, 4), lb.offset));
    let ang = (Math.atan2(tan[1], tan[0]) * 180) / Math.PI;
    if (flip) ang += 180;
    out += `<text transform="translate(${f2(p[0])} ${f2(p[1])}) rotate(${f2(ang)})" text-anchor="middle" dy="${f2(lb.style.size * 0.35)}" ${fontAttrs(lb.style)}>${esc(lb.style.uppercase ? lb.text.toUpperCase() : lb.text)}</text>`;
  }
  void ctx;
  return out;
}
