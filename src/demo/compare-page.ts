/** Сверка рендера с образцом: оригинал | рендер | наложение 50%. */
import './fonts';
import { renderDocument } from '../core/render/index';
import { mercator, TILE_SIZE } from '../core/geo';
import { buildBerlinInfographic, buildAtlasOder, A1, A3 } from './scenes';
import ref1 from './reference/berlin-infographic.webp?url';
import ref3 from './reference/berlin-atlas.jpg?url';

const params = new URLSearchParams(location.search);
const atlas = params.get('scene') === 'atlas';
const crop = (params.get('crop') || (atlas ? '0,0,981,1357' : '0,0,1021,1169')).split(',').map(Number);
const zoom = +(params.get('z') || 1);
const doc = atlas ? buildAtlasOder() : buildBerlinInfographic();
const REF = atlas ? ref3 : ref1, REFW = atlas ? 981 : 1021;
const r = renderDocument(doc, 'c');
// мир документа → пиксели образца
const size = TILE_SIZE * Math.pow(2, doc.refZoom);
const om = mercator(doc.origin);
const { a, b, c, d, e, f } = atlas ? A3 : A1;
const m = [a / size, c / size, b / size, d / size, a * om[0] + b * om[1] + e, c * om[0] + d * om[1] + f];
const [x0, y0, x1, y1] = crop;
const W = (x1 - x0) * zoom, H = (y1 - y0) * zoom;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="${x0} ${y0} ${x1 - x0} ${y1 - y0}">` +
  `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${doc.paper}"/>` +
  `<g transform="matrix(${m.join(' ')})"><defs>${r.defs}</defs>${r.features.map((q) => q.svg).join('')}</g></svg>`;
const img = `<div style="width:${W}px;height:${H}px;overflow:hidden;position:relative"><img src="${REF}" style="position:absolute;left:${-x0 * zoom}px;top:${-y0 * zoom}px;width:${REFW * zoom}px"></div>`;
const mode = params.get('mode') || 'all';
document.getElementById('root')!.innerHTML = `<div class="wrap">` +
  (mode === 'all' || mode === 'orig' ? `<div class="cell"><h3>Образец</h3>${img}</div>` : '') +
  (mode === 'all' || mode === 'render' ? `<div class="cell"><h3>Рендер</h3>${svg}</div>` : '') +
  (mode === 'all' || mode === 'blend' ? `<div class="cell"><h3>Наложение</h3><div style="position:relative">${svg}<div style="position:absolute;left:0;top:0;opacity:${params.get('op') || 0.5}">${img}</div></div></div>` : '') + `</div>`;
document.fonts.ready.then(() => setTimeout(() => document.body.setAttribute('data-ready', '1'), 300));
