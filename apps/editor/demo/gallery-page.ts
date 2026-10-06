import './fonts';
import { exportSVG } from '@def-ops/core';
import { PALETTE } from '@def-ops/core';
import { buildGallery } from './gallery';

const root = document.getElementById('root')!;
for (const [g, paper] of [['Инфографика', PALETTE.inf.paper], ['Атлас', PALETTE.atlas.paper], ['Тактика', PALETTE.tac.paper]] as const) {
  const h = document.createElement('h2'); h.textContent = g; root.appendChild(h);
  const d = document.createElement('div'); d.className = 'sheet';
  d.innerHTML = exportSVG(buildGallery(g, paper), { padding: 50 });
  root.appendChild(d);
}
document.fonts.ready.then(() => document.body.setAttribute('data-ready', '1'));
