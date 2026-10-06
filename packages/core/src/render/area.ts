/**
 * Районы: занятая территория (фронтовая зона), окружённые группировки
 * (штриховка, контур с зубцами, крест «уничтожено»), города и т.п.
 */
import { type Vec2, add, mul, dot } from '../vec';
import { pathD } from '../curve';
import type { AreaFeature } from '../model';
import { type RenderContext, f2 } from './context';
import { linePath, renderStrokeLayers } from './line';

export function renderArea(f: AreaFeature, ctx: RenderContext): string {
  if (f.points.length < 3) return '';
  const st = f.style;
  const path = linePath(f.points.map((p) => ctx.proj.toWorld(p)), st.smooth, true);
  const d = pathD(path.pts, true);
  let out = '';
  if (st.fill) out += `<path d="${d}" fill="${st.fill}"${st.fillOpacity < 1 ? ` fill-opacity="${st.fillOpacity}"` : ''}/>`;
  if (st.hatch) {
    const h = st.hatch;
    const pid = ctx.uid('hatch');
    const sp = Math.max(0.5, h.spacing);
    const op = h.opacity < 1 ? ` stroke-opacity="${h.opacity}" fill-opacity="${h.opacity}"` : '';
    const stroke = `stroke="${h.color}" stroke-width="${f2(h.width)}"${op}`;
    let tile: string;
    switch (h.pattern ?? 'lines') {
      case 'cross':
        tile = `<path d="M0 ${f2(sp / 2)}H${f2(sp)}M${f2(sp / 2)} 0V${f2(sp)}" fill="none" ${stroke}/>`;
        break;
      case 'dots':
        tile = `<circle cx="${f2(sp / 2)}" cy="${f2(sp / 2)}" r="${f2(h.width)}" fill="${h.color}"${op}/>`;
        break;
      case 'circles':
        tile = `<circle cx="${f2(sp / 2)}" cy="${f2(sp / 2)}" r="${f2(sp * 0.28)}" fill="none" ${stroke}/>`;
        break;
      case 'swamp':
        // болото: короткие горизонтальные штрихи вразбежку
        tile = `<path d="M${f2(sp * 0.1)} ${f2(sp * 0.3)}h${f2(sp * 0.45)}M${f2(sp * 0.5)} ${f2(sp * 0.8)}h${f2(sp * 0.45)}" fill="none" ${stroke}/>`;
        break;
      case 'trees':
        // лес: кружки-кроны
        tile = `<circle cx="${f2(sp * 0.3)}" cy="${f2(sp * 0.3)}" r="${f2(sp * 0.14)}" fill="none" ${stroke}/><circle cx="${f2(sp * 0.78)}" cy="${f2(sp * 0.75)}" r="${f2(sp * 0.14)}" fill="none" ${stroke}/>`;
        break;
      default:
        tile = `<line x1="0" y1="${f2(sp / 2)}" x2="${f2(sp)}" y2="${f2(sp / 2)}" ${stroke}/>`;
    }
    ctx.defs.push(`<pattern id="${pid}" patternUnits="userSpaceOnUse" width="${f2(sp)}" height="${f2(sp)}" patternTransform="rotate(${h.angle})">${tile}</pattern>`);
    out += `<path d="${d}" fill="url(#${pid})"/>`;
  }
  out += renderStrokeLayers(path, st.edge, true);
  if (st.cross) out += renderCross(path.pts, st.cross);
  return out;
}

function renderCross(pts: Vec2[], c: NonNullable<AreaFeature['style']['cross']>): string {
  // центр — центр масс контура, длина плеча — протяжённость по направлению
  let cx = 0, cy = 0;
  for (const p of pts) { cx += p[0]; cy += p[1]; }
  const ctr: Vec2 = [cx / pts.length, cy / pts.length];
  let d = '';
  for (const a of [c.angle - c.spread / 2, c.angle + c.spread / 2]) {
    const r = (a * Math.PI) / 180;
    const dir: Vec2 = [Math.cos(r), Math.sin(r)];
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) {
      const v = dot([p[0] - ctr[0], p[1] - ctr[1]], dir);
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    const mid = (lo + hi) / 2, half = ((hi - lo) / 2) * c.extend;
    d += pathD([add(ctr, mul(dir, mid - half)), add(ctr, mul(dir, mid + half))]);
  }
  return `<path d="${d}" fill="none" stroke="${c.color}" stroke-width="${f2(c.width)}" stroke-linecap="butt"${c.opacity < 1 ? ` stroke-opacity="${c.opacity}"` : ''}/>`;
}
