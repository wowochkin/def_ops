/** Экспорт: JSON-документ, SVG со встроенными шрифтами, PNG. */
import type { MapDocument } from '@def-ops/core';
import { exportSVG, formatScale, scaleBar, scaleDenominator } from '@def-ops/core';
import { FONT_FILES } from './fontFiles';

const LATIN = 'U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+2000-206F,U+2074,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD';
const CYR = 'U+0301,U+0400-045F,U+0490-0491,U+04B0-04B1,U+2116';

let fontCss: Promise<string> | null = null;

async function toDataUrl(url: string): Promise<string> {
  const b = await (await fetch(url)).blob();
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); });
}

/** @font-face со встроенными шрифтами — чтобы SVG/PNG выглядели одинаково на любой машине. */
export function embeddedFonts(): Promise<string> {
  fontCss ??= (async () => {
    const rules: string[] = [];
    for (const [family, weight, style, subset, url] of FONT_FILES) {
      try {
        const data = await toDataUrl(url);
        rules.push(`@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};src:url(${data}) format('woff2');unicode-range:${subset === 'latin' ? LATIN : CYR}}`);
      } catch { /* шрифт недоступен — пропускаем */ }
    }
    return rules.join('\n');
  })();
  return fontCss;
}

export async function svgWithFonts(doc: MapDocument, background: string | null): Promise<string> {
  const svg = exportSVG(doc, { padding: 40, background });
  const css = await embeddedFonts();
  return svg.replace('<defs>', `<defs><style>${css}</style>`);
}

export function download(name: string, data: Blob | string, type = 'application/octet-stream') {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export async function exportPNG(doc: MapDocument, background: string | null, pixelRatio = 2): Promise<Blob> {
  const svg = await svgWithFonts(doc, background);
  const m = /width="(\d+)" height="(\d+)"/.exec(svg)!;
  const w = +m[1], h = +m[2];
  const img = new Image();
  img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  await img.decode();
  await new Promise((r) => setTimeout(r, 250)); // шрифты внутри SVG-картинки
  const c = document.createElement('canvas');
  c.width = w * pixelRatio; c.height = h * pixelRatio;
  const g = c.getContext('2d')!;
  g.scale(pixelRatio, pixelRatio);
  g.drawImage(img, 0, 0, w, h);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}

/**
 * PNG «как на экране»: снимок карты (подложка, сканы, слой бумаги — холст MapLibre) и поверх — знаки из
 * слоя SVG над картой (со встроенными шрифтами). Размер — как у холста карты (на Retina — вдвое).
 */
export async function exportViewPNG(mapEl: HTMLElement, view?: { center: [number, number]; zoom: number }): Promise<Blob> {
  const canvas = mapEl.querySelector('canvas');
  const overlay = mapEl.parentElement?.querySelector('svg.overlay') as SVGSVGElement | null;
  if (!canvas) throw new Error('карта ещё не готова');
  const w = mapEl.clientWidth, h = mapEl.clientHeight;
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const g = c.getContext('2d')!;
  g.drawImage(canvas, 0, 0, c.width, c.height);
  if (overlay) {
    const svg = overlay.cloneNode(true) as SVGSVGElement;
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(w)); svg.setAttribute('height', String(h)); svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
    style.textContent = await embeddedFonts();
    svg.insertBefore(style, svg.firstChild);
    const img = new Image();
    img.src = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    await img.decode();
    // шрифты внутри SVG-картинки догружаются после decode — рисуем, когда они готовы
    await new Promise((r) => setTimeout(r, 250));
    g.drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(img.src);
  }
  if (view) drawScale(g, c.width / w, w, h, view.center[1], view.zoom);
  return new Promise((res, rej) => {
    try { c.toBlob((b) => (b ? res(b) : rej(new Error('не удалось собрать изображение'))), 'image/png'); }
    catch { rej(new Error('подложка загружена с другого сервера без разрешения (CORS) — браузер не даёт сохранить её в файл; выберите локальную подложку')); }
  });
}

/** Линейка и численный масштаб — в правом нижнем углу снимка, как на экране. */
function drawScale(g: CanvasRenderingContext2D, k: number, w: number, h: number, lat: number, zoom: number) {
  const bar = scaleBar(lat, zoom, 130), num = formatScale(scaleDenominator(lat, zoom));
  g.save();
  g.scale(k, k);
  g.font = "500 11.5px 'Roboto Condensed', 'PT Sans Narrow', sans-serif";
  const lw = g.measureText(bar.label).width, nw = g.measureText(num).width + 4;
  const bw = Math.ceil(bar.px) + 2, boxW = 6 + bw + 6 + lw + 8 + nw + 6, boxH = 20;
  const x0 = w - boxW - 12, y0 = h - boxH - 12;
  g.fillStyle = 'rgba(255,255,255,.9)'; g.strokeStyle = '#bbb'; g.lineWidth = 1;
  g.beginPath(); g.roundRect(x0, y0, boxW, boxH, 4); g.fill(); g.stroke();
  bar.ticks.slice(0, -1).forEach((t, i) => {
    g.fillStyle = i % 2 ? '#fff' : '#222'; g.fillRect(x0 + 6 + 1 + t, y0 + 7.5, bar.ticks[i + 1] - t, 5);
    g.strokeStyle = '#222'; g.strokeRect(x0 + 6 + 1 + t, y0 + 7.5, bar.ticks[i + 1] - t, 5);
  });
  g.fillStyle = '#222'; g.textBaseline = 'middle';
  g.fillText(bar.label, x0 + 6 + bw + 6, y0 + boxH / 2 + 0.5);
  g.font = "700 11.5px 'Roboto Condensed', 'PT Sans Narrow', sans-serif";
  g.fillText(num, x0 + 6 + bw + 6 + lw + 8, y0 + boxH / 2 + 0.5);
  g.restore();
}
