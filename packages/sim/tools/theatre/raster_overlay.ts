/**
 * Историческая поправка к местности по растровой карте (тайловый архив
 * .sqlitedb / .mbtiles): пиксели классифицируются по правилам «легенды»
 * (цветовой тон, насыщенность, яркость), доли классов сводятся на сетку
 * театра. Результат — JSON-маска классов, которую сборщик театра кладёт
 * поверх современного земного покрова (рецепт: overlays), и PNG для проверки.
 *
 *   npm run theatre:overlay -- rkka10km.sqlitedb --legend rkka-road-1m --bbox 11.0,50.9,15.6,54.45 --zoom 10 --out rkka-overlay.json
 *   npm run theatre:overlay -- retromap_151944.sqlitedb --legend berlin-plan-1945 --zoom 14 --out berlin-overlay.json
 *
 * Легенды — в tools/theatre/legends/<id>.json. Без --bbox — весь охват архива
 * на выбранном уровне. Шаг сетки по умолчанию — как у театра «Одер — Берлин»
 * (0,015° × 0,009°, ≈1 км); --cell dLng,dLat — свой.
 */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

interface Rule { h?: [number, number]; s?: [number, number]; v?: [number, number] }
interface Legend {
  id: string; name: string; note?: string;
  /** Классы пикселей: пиксель относится к первому подходящему. */
  pixels: Record<string, Rule[]>;
  /** Класс клетки: доля пикселей класса (или суммы классов) не меньше порога. Порядок — приоритет. */
  cells: { cls: string; of: string[]; min: number }[];
}

const args = process.argv.slice(2);
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
const file = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));
if (!file) { console.error('укажите архив .sqlitedb или .mbtiles'); process.exit(1); }
const legendId = opt('legend') ?? 'berlin-plan-1945';
const legend: Legend = JSON.parse(readFileSync(fileURLToPath(new URL(`./legends/${legendId}.json`, import.meta.url)), 'utf8'));
const [dLng, dLat] = (opt('cell') ?? '0.015,0.009').split(',').map(Number);
const out = opt('out') ?? `${legendId}-overlay.json`;

const db = new DatabaseSync(file, { readOnly: true });
const cols = (t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((r) => r.name.toLowerCase());
const mb = cols('tiles').includes('zoom_level');
let meta: Record<string, string> = {};
try {
  const t = mb ? 'metadata' : 'info', c = cols(t);
  if (c.includes('name') && c.includes('value')) meta = Object.fromEntries((db.prepare(`select name, value from ${t}`).all() as { name: string; value: unknown }[]).map((r) => [r.name.toLowerCase(), String(r.value)]));
  else { const row = db.prepare(`select * from ${t} limit 1`).get() as Record<string, unknown> | undefined; if (row) meta = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), String(v)])); }
} catch { /* без метаданных */ }
const simple = (meta.tilenumbering ?? '').toLowerCase() === 'simple';
const invY = ['1', 'true', 'yes'].includes((meta.inverted_y ?? '').toLowerCase());
const zq = mb ? 'zoom_level' : 'z', xq = mb ? 'tile_column' : 'x', yq = mb ? 'tile_row' : 'y', dq = mb ? 'tile_data' : 'image';
const toZoom = (z: number) => (mb || simple ? z : 17 - z);
const fromZoom = (zoom: number) => (mb || simple ? zoom : 17 - zoom);
const yToArchive = (zoom: number, y: number) => (mb || invY ? (1 << zoom) - 1 - y : y);

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const y2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

const zooms = (db.prepare(`select distinct ${zq} as z from tiles`).all() as { z: number }[]).map((r) => toZoom(Number(r.z))).sort((a, b) => a - b);
const zoom = Number(opt('zoom') ?? zooms[zooms.length - 1]);
let bbox: [number, number, number, number];
if (opt('bbox')) bbox = opt('bbox')!.split(',').map(Number) as typeof bbox;
else {
  const r = db.prepare(`select min(${xq}) as x0, max(${xq}) as x1, min(${yq}) as y0, max(${yq}) as y1 from tiles where ${zq} = ?`).get(fromZoom(zoom)) as { x0: number; x1: number; y0: number; y1: number };
  const ya = yToArchive(zoom, Number(r.y0)), yb = yToArchive(zoom, Number(r.y1));
  bbox = [x2lon(Number(r.x0), zoom), y2lat(Math.max(ya, yb) + 1, zoom), x2lon(Number(r.x1) + 1, zoom), y2lat(Math.min(ya, yb), zoom)];
}
const [w, s, e, n] = bbox;
const gc = Math.max(1, Math.round((e - w) / dLng)), gr = Math.max(1, Math.round((n - s) / dLat));
const names = Object.keys(legend.pixels);
const counts = names.map(() => new Float64Array(gc * gr));
const total = new Float64Array(gc * gr);

/** HSV: тон 0–360, насыщенность и яркость 0–1. */
function hsv(r: number, g: number, b: number): [number, number, number] {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  let h = 0;
  if (d > 0) h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, mx > 0 ? d / mx : 0, mx / 255];
}
const inR = (x: number, r?: [number, number]) => !r || (r[0] <= r[1] ? x >= r[0] && x <= r[1] : x >= r[0] || x <= r[1]);

const tx0 = Math.floor(lon2x(w, zoom) + 1e-9), tx1 = Math.floor(lon2x(e, zoom) - 1e-9), ty0 = Math.floor(lat2y(n, zoom) + 1e-9), ty1 = Math.floor(lat2y(s, zoom) - 1e-9);
const get = db.prepare(`select ${dq} as d from tiles where ${zq} = ? and ${xq} = ? and ${yq} = ?`);
let tiles = 0;
const PW = Math.min(2400, (tx1 - tx0 + 1) * 64), PH = Math.round(PW * (ty1 - ty0 + 1) / (tx1 - tx0 + 1));
const preview = Buffer.alloc(PW * PH * 3, 255);
const palette: Record<string, [number, number, number]> = { urban: [210, 80, 70], built: [210, 80, 70], dark: [40, 40, 40], road: [240, 140, 40], rail: [60, 60, 60], forest: [60, 140, 70], water: [50, 100, 220], marsh: [120, 180, 170] };
for (let tx = tx0; tx <= tx1; tx++) for (let ty = ty0; ty <= ty1; ty++) {
  const row = get.get(fromZoom(zoom), tx, yToArchive(zoom, ty)) as { d: Uint8Array } | undefined;
  if (!row?.d) continue;
  tiles++;
  const { data, info } = await sharp(Buffer.from(row.d)).removeAlpha().resize(256, 256).raw().toBuffer({ resolveWithObject: true });
  for (let py = 0; py < 256; py++) {
    const lat = y2lat(ty + (py + 0.5) / 256, zoom);
    const r0 = Math.floor((n - lat) / dLat);
    for (let px = 0; px < 256; px++) {
      const lng = x2lon(tx + (px + 0.5) / 256, zoom);
      const c0 = Math.floor((lng - w) / dLng);
      if (c0 < 0 || r0 < 0 || c0 >= gc || r0 >= gr) continue;
      const o = (py * 256 + px) * info.channels;
      const [h, sat, val] = hsv(data[o], data[o + 1], data[o + 2]);
      const cell = r0 * gc + c0;
      total[cell]++;
      const k = names.findIndex((nm) => legend.pixels[nm].some((rule) => inR(h, rule.h) && inR(sat, rule.s) && inR(val, rule.v)));
      if (k >= 0) counts[k][cell]++;
      // превью: каждый пиксель — в масштабе превью
      const X = Math.floor(((tx - tx0) * 256 + px) * PW / ((tx1 - tx0 + 1) * 256)), Y = Math.floor(((ty - ty0) * 256 + py) * PH / ((ty1 - ty0 + 1) * 256));
      if (k >= 0 && X < PW && Y < PH) { const c = palette[names[k]] ?? [200, 0, 200]; preview.set(c, (Y * PW + X) * 3); }
    }
  }
}
if (!tiles) { console.error('в охвате нет тайлов этого уровня'); process.exit(1); }

// классы клеток
const masks: Record<string, Uint8Array> = {};
const cellCls = new Array<string | null>(gc * gr).fill(null);
for (const c of legend.cells) masks[c.cls] ??= new Uint8Array(gc * gr);
for (let i = 0; i < gc * gr; i++) {
  if (!total[i]) continue;
  for (const c of legend.cells) {
    const f = c.of.reduce((sum, nm) => sum + counts[names.indexOf(nm)][i], 0) / total[i];
    if (f >= c.min) { masks[c.cls][i] = 1; cellCls[i] ??= c.cls; }
  }
}
const rle = (m: Uint8Array) => { let out = '', i = 0; while (i < m.length) { let j = i; while (j < m.length && m[j] === m[i]) j++; out += (j - i > 1 ? j - i : '') + (m[i] ? '1' : '0') + ','; i = j; } return out.slice(0, -1); };
const covered = new Uint8Array(gc * gr).map((_, i) => (total[i] > 0 ? 1 : 0));
const result = {
  legend: legend.id, name: legend.name, source: file, zoom, bbox: [w, s, e, n], cols: gc, rows: gr, cellDeg: [dLng, dLat],
  note: 'маски классов по клеткам (RLE «число+0/1» через запятую, строки с севера на юг); covered — где карта есть',
  covered: rle(covered),
  masks: Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, rle(m)])),
  stats: Object.fromEntries(Object.entries(masks).map(([k, m]) => [k, m.reduce((a, x) => a + x, 0)])),
};
writeFileSync(out, JSON.stringify(result));
await sharp(preview, { raw: { width: PW, height: PH, channels: 3 } }).png().toFile(out.replace(/\.json$/, '') + '-preview.png');
console.log(`тайлов ${tiles}, сетка ${gc}×${gr}; клеток по классам: ${JSON.stringify(result.stats)}`);
console.log(`маска: ${out}\nпроверка: ${out.replace(/\.json$/, '')}-preview.png (цветом — распознанные пиксели)`);
