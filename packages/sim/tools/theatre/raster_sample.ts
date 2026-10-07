/**
 * Образец растровой карты из тайлового архива (.sqlitedb RMaps/Locus или
 * .mbtiles): сведения об архиве и склейка участка в один PNG — чтобы
 * настроить распознавание местности (лес, населённые пункты, болота, вода)
 * по исторической карте.
 *
 *   npm run theatre:sample -- rkka10km.sqlitedb                     # уровни и охват
 *   npm run theatre:sample -- rkka10km.sqlitedb --bbox 14.25,52.45,14.55,52.62 --zoom 13 --out seelow.png
 *
 * bbox — запад,юг,восток,север в градусах; zoom — уровень тайлов (по умолчанию
 * самый подробный); размер склейки ограничен 6000 px по стороне.
 */
import { DatabaseSync } from 'node:sqlite';
import sharp from 'sharp';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--') && !/^[\d.,-]+$/.test(a));
const opt = (k: string) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : undefined; };
if (!file) { console.error('укажите файл .sqlitedb или .mbtiles'); process.exit(1); }

const db = new DatabaseSync(file, { readOnly: true });
const cols = (t: string) => (db.prepare(`pragma table_info(${t})`).all() as { name: string }[]).map((r) => r.name.toLowerCase());
const mb = cols('tiles').includes('zoom_level');
let meta: Record<string, string> = {};
try {
  const t = mb ? 'metadata' : 'info';
  const c = cols(t);
  if (c.includes('name') && c.includes('value')) meta = Object.fromEntries((db.prepare(`select name, value from ${t}`).all() as { name: string; value: unknown }[]).map((r) => [r.name.toLowerCase(), String(r.value)]));
  else { const row = db.prepare(`select * from ${t} limit 1`).get() as Record<string, unknown> | undefined; if (row) meta = Object.fromEntries(Object.entries(row).map(([k, v]) => [k.toLowerCase(), String(v)])); }
} catch { /* без метаданных */ }
const simple = (meta.tilenumbering ?? '').toLowerCase() === 'simple';
const invY = ['1', 'true', 'yes'].includes((meta.inverted_y ?? '').toLowerCase());

// уровень в архиве ↔ обычный z/x/y
const zq = mb ? 'zoom_level' : 'z', xq = mb ? 'tile_column' : 'x', yq = mb ? 'tile_row' : 'y', dq = mb ? 'tile_data' : 'image';
const toZoom = (z: number) => (mb || simple ? z : 17 - z);
const fromZoom = (zoom: number) => (mb || simple ? zoom : 17 - zoom);
const toY = (zoom: number, y: number) => (mb ? (1 << zoom) - 1 - y : invY ? (1 << zoom) - 1 - y : y);

const lon2x = (lon: number, z: number) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat: number, z: number) => ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z;
const x2lon = (x: number, z: number) => (x / 2 ** z) * 360 - 180;
const y2lat = (y: number, z: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

const levels = (db.prepare(`select ${zq} as z, count(*) as n, min(${xq}) as x0, max(${xq}) as x1, min(${yq}) as y0, max(${yq}) as y1 from tiles group by ${zq}`).all() as { z: number; n: number; x0: number; x1: number; y0: number; y1: number }[])
  .map((r) => {
    const zoom = toZoom(Number(r.z));
    const ya = toY(zoom, Number(r.y0)), yb = toY(zoom, Number(r.y1));
    return { zoom, tiles: Number(r.n), bbox: [x2lon(Number(r.x0), zoom), y2lat(Math.max(ya, yb) + 1, zoom), x2lon(Number(r.x1) + 1, zoom), y2lat(Math.min(ya, yb), zoom)].map((v) => +v.toFixed(4)) };
  }).sort((a, b) => a.zoom - b.zoom);
console.log(JSON.stringify({ file, format: mb ? 'mbtiles' : 'sqlitedb', meta, levels }, null, 1));

const bboxArg = opt('bbox');
if (bboxArg) {
  const [w, s, e, n] = bboxArg.split(',').map(Number);
  const zoom = Number(opt('zoom') ?? levels[levels.length - 1].zoom);
  const tx0 = Math.floor(lon2x(w, zoom)), tx1 = Math.floor(lon2x(e, zoom)), ty0 = Math.floor(lat2y(n, zoom)), ty1 = Math.floor(lat2y(s, zoom));
  const W = (tx1 - tx0 + 1) * 256, H = (ty1 - ty0 + 1) * 256;
  if (W > 6000 || H > 6000) { console.error(`слишком большой участок: ${W}×${H} px — уменьшите bbox или zoom`); process.exit(1); }
  const get = db.prepare(`select ${dq} as d from tiles where ${zq} = ? and ${xq} = ? and ${yq} = ?`);
  const parts: sharp.OverlayOptions[] = [];
  let found = 0;
  for (let x = tx0; x <= tx1; x++) for (let y = ty0; y <= ty1; y++) {
    const r = get.get(fromZoom(zoom), x, toY(zoom, y)) as { d: Uint8Array } | undefined;
    if (!r?.d) continue;
    found++;
    parts.push({ input: await sharp(Buffer.from(r.d)).resize(256, 256).png().toBuffer(), left: (x - tx0) * 256, top: (y - ty0) * 256 });
  }
  const out = opt('out') ?? 'sample.png';
  await sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } }).composite(parts).png().toFile(out);
  const geo = { bbox: [x2lon(tx0, zoom), y2lat(ty1 + 1, zoom), x2lon(tx1 + 1, zoom), y2lat(ty0, zoom)], zoom, width: W, height: H, tiles: found, projection: 'Web Mercator' };
  console.log(`склейка: ${out} (${W}×${H}, тайлов ${found}); охват ${JSON.stringify(geo.bbox.map((v) => +v.toFixed(5)))}`);
}
