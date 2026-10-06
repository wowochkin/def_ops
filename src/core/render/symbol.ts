/**
 * Точечные знаки: населённые пункты, условные знаки объединений
 * (танковая армия, кавкорпус), резервы, укреплённые города, авиация,
 * Знамя Победы, флажки огневых точек, даты встреч и т.д.
 */
import type { Vec2 } from '../vec';
import type { LabelFeature, SymbolFeature, TextStyle } from '../model';
import { type RenderContext, f2, esc } from './context';
import { pathD, smoothPath } from '../curve';

export function renderSymbol(f: SymbolFeature, ctx: RenderContext): string {
  const p = ctx.proj.toWorld(f.at);
  const st = f.style;
  const s = st.size;
  const sw = st.strokeWidth;
  let g = '';
  switch (st.type) {
    case 'settlement':
      g = `<circle r="${f2(s / 2)}" fill="${st.fill}" stroke="${st.color}" stroke-width="${f2(sw)}"/>`;
      break;
    case 'town':
      g = `<circle r="${f2(s / 2)}" fill="${st.fill}" stroke="${st.color}" stroke-width="${f2(sw)}"/>`;
      break;
    case 'armyOval':
    case 'tankArmy':
    case 'cavalryCorps': {
      const rx = s / 2, ry = (s / 2) * st.aspect;
      g = `<ellipse rx="${f2(rx)}" ry="${f2(ry)}" fill="${st.fill}" stroke="${st.color}" stroke-width="${f2(sw)}"/>`;
      if (st.type === 'tankArmy') {
        const h = ry * 1.25, w = ry * 0.62;
        g += `<path d="M0 ${f2(-h / 2)}L${f2(w / 2)} 0L0 ${f2(h / 2)}L${f2(-w / 2)} 0Z" fill="${st.color}"/>`;
      }
      if (st.type === 'cavalryCorps') {
        const cid = ctx.uid('cav');
        ctx.defs.push(`<clipPath id="${cid}"><ellipse rx="${f2(rx - sw / 2)}" ry="${f2(ry - sw / 2)}"/></clipPath>`);
        let d = '';
        const step = s * 0.075;
        for (let x = 0; x < rx * 2.2; x += step) d += `M${f2(x - ry)} ${f2(ry)}L${f2(x + ry)} ${f2(-ry)}`;
        g += `<g clip-path="url(#${cid})"><path d="${d}" stroke="${st.color}" stroke-width="${f2(sw * 0.55)}" fill="none"/></g>`;
      }
      break;
    }
    case 'reserve': {
      const rx = s / 2, ry = (s / 2) * st.aspect;
      g = `<ellipse rx="${f2(rx)}" ry="${f2(ry)}" fill="${st.fill}" stroke="${st.color}" stroke-width="${f2(sw)}"/>`;
      g += `<text y="${f2(ry * 0.42)}" text-anchor="middle" font-family="PT Serif, serif" font-size="${f2(ry * 1.25)}" fill="${st.color}">${esc(st.text || 'Р')}</text>`;
      break;
    }
    case 'fortifiedCity': {
      const R = s / 2, teeth = 10;
      const pts: Vec2[] = [];
      for (let i = 0; i < teeth * 2; i++) {
        const r = i % 2 === 0 ? R : R * 0.78;
        const a0 = (Math.PI * 2 * i) / (teeth * 2), a1 = (Math.PI * 2 * (i + 1)) / (teeth * 2);
        pts.push([Math.cos(a0) * r, Math.sin(a0) * r], [Math.cos(a1) * r, Math.sin(a1) * r]);
      }
      g = `<path d="${pathD(pts, true)}" fill="${st.color}"/>`;
      g += `<circle r="${f2(R * 0.56)}" fill="${st.fill}"/><circle r="${f2(R * 0.22)}" fill="${st.color}"/>`;
      break;
    }
    case 'aviation': {
      // силуэт самолёта, нос — по оси +X
      const k = s / 24;
      const d =
        'M12 0C11 -1.2 9.5 -1.8 8 -1.8L4 -1.9L1.2 -11.5L-2.4 -11.5L-1.6 -1.9L-8 -1.7L-10 -5.6L-12.4 -5.6L-11.4 0L-12.4 5.6L-10 5.6L-8 1.7L-1.6 1.9L-2.4 11.5L1.2 11.5L4 1.9L8 1.8C9.5 1.8 11 1.2 12 0Z';
      g = `<path d="${d}" fill="${st.color}" transform="scale(${f2(k)})"/>`;
      break;
    }
    case 'victoryFlag': {
      const h = s, w = s * 0.62;
      g = `<line x1="0" y1="0" x2="0" y2="${f2(-h)}" stroke="${st.color}" stroke-width="${f2(sw)}"/>`;
      g += `<path d="M0 ${f2(-h)}C${f2(w * 0.3)} ${f2(-h - w * 0.12)} ${f2(w * 0.6)} ${f2(-h + w * 0.12)} ${f2(w)} ${f2(-h)}L${f2(w * 0.92)} ${f2(-h + w * 0.55)}C${f2(w * 0.6)} ${f2(-h + w * 0.68)} ${f2(w * 0.3)} ${f2(-h + w * 0.42)} 0 ${f2(-h + w * 0.55)}Z" fill="${st.fill}"/>`;
      break;
    }
    case 'pennant': {
      // флажок: вертикальная кромка + треугольник
      g = `<path d="M0 0L0 ${f2(-s)}L${f2(s * 0.55)} ${f2(-s * 0.15)}Z" fill="${st.color}"/>`;
      break;
    }
    case 'dateBox': {
      const ts = st.textStyle;
      const fs = ts?.size ?? s;
      const text = st.text || '8.V.1945';
      const w = text.length * fs * 0.52 + fs * 0.7, h = fs * 1.45;
      g = `<rect x="${f2(-w / 2)}" y="${f2(-h / 2)}" width="${f2(w)}" height="${f2(h)}" fill="${st.fill}" stroke="${st.color}" stroke-width="${f2(sw)}"/>`;
      g += `<text y="${f2(fs * 0.36)}" text-anchor="middle" ${fontAttrs(ts ?? defaultSymbolText(st.color, fs))}>${esc(text)}</text>`;
      break;
    }
    case 'meeting': {
      // дата встречи войск: две стрелки навстречу и дата
      const a = s * 0.9, hw = s * 0.22;
      const half = (x0: number, dir: number) =>
        `<path d="M${f2(x0)} 0L${f2(x0 + dir * a)} 0" stroke="${st.color}" stroke-width="${f2(sw)}"/>` +
        `<path d="M${f2(x0 + dir * a)} 0L${f2(x0 + dir * (a - hw * 2.2))} ${f2(-hw)}L${f2(x0 + dir * (a - hw * 1.5))} 0L${f2(x0 + dir * (a - hw * 2.2))} ${f2(hw)}Z" fill="${st.color}"/>`;
      g = half(-a - s * 0.08, 1) + half(a + s * 0.08, -1);
      if (st.text) {
        const ts = st.textStyle ?? defaultSymbolText(st.color, s * 0.7);
        g += `<text y="${f2(-s * 0.35)}" text-anchor="middle" ${fontAttrs(ts)}>${esc(st.text)}</text>`;
      }
      break;
    }
  }
  return `<g transform="translate(${f2(p[0])} ${f2(p[1])})${f.rotation ? ` rotate(${f2(f.rotation)})` : ''}">${g}</g>`;
}

function defaultSymbolText(color: string, size: number): TextStyle {
  return { font: 'PT Serif', size, weight: 700, italic: false, color, halo: null, letterSpacing: 0, uppercase: false, align: 'middle', lineHeight: 1.15 };
}

export function fontAttrs(t: TextStyle): string {
  let a = `font-family="${esc(t.font)}, 'PT Sans Narrow', sans-serif" font-size="${f2(t.size)}" font-weight="${t.weight}" fill="${t.color}"`;
  if (t.italic) a += ' font-style="italic"';
  if (t.letterSpacing) a += ` letter-spacing="${f2(t.letterSpacing)}"`;
  if (t.halo && t.halo.width > 0)
    a += ` stroke="${t.halo.color}" stroke-width="${f2(t.halo.width * 2)}" stroke-linejoin="round" paint-order="stroke"`;
  return a;
}

export function renderLabel(f: LabelFeature, ctx: RenderContext): string {
  const st = f.style;
  const text = st.uppercase ? f.text.toUpperCase() : f.text;
  if (f.path && f.path.length >= 2) {
    const pts = smoothPath(f.path.map((p) => ctx.proj.toWorld(p)));
    const pid = ctx.uid('tp');
    ctx.defs.push(`<path id="${pid}" d="${pathD(pts)}"/>`);
    return `<text ${fontAttrs(st)} text-anchor="middle" dy="${f2(st.size * 0.35)}"><textPath href="#${pid}" startOffset="50%">${esc(text)}</textPath></text>`;
  }
  const p = ctx.proj.toWorld(f.at);
  const lines = text.split('\n');
  const lh = st.size * st.lineHeight;
  const y0 = st.size * 0.35 - ((lines.length - 1) * lh) / 2;
  const tspans = lines.map((ln, i) => `<tspan x="0" y="${f2(y0 + i * lh)}">${esc(ln)}</tspan>`).join('');
  return `<g transform="translate(${f2(p[0])} ${f2(p[1])})${f.rotation ? ` rotate(${f2(f.rotation)})` : ''}"><text ${fontAttrs(st)} text-anchor="${st.align}">${tspans}</text></g>`;
}
