/** Экспорт: JSON-документ, SVG со встроенными шрифтами, PNG. */
import type { MapDocument } from '../core/model';
import { exportSVG } from '../core/render/index';
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
  const c = document.createElement('canvas');
  c.width = w * pixelRatio; c.height = h * pixelRatio;
  const g = c.getContext('2d')!;
  g.scale(pixelRatio, pixelRatio);
  g.drawImage(img, 0, 0, w, h);
  return new Promise((res) => c.toBlob((b) => res(b!), 'image/png'));
}
