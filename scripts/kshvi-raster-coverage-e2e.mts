import { chromium } from 'playwright';
import sharp from 'sharp';
import { createHash } from 'node:crypto';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { EnvironmentSnapshotStore } from '../services/kshvi/src/environment/snapshot-store';
import { readSnapshotTile } from '../services/kshvi/src/environment/snapshot-tiles';
import { styleWithBounds } from '../services/kshvi/src/environment/snapshot-style';

const snapshotId = 'fb04b410b836475abeebcb9cb66ff89ac75d0ef54f9b2da794825a7d3437a9bc';
const atlasId = '949776f7-6ba4-4340-8a77-df2ab17d1c70';
const store = new EnvironmentSnapshotStore(path.resolve('data/kshvi/environment'));
const snapshot = await store.load(snapshotId);
const atlas = snapshot.atlases.find(item => item.id === atlasId);
if (!atlas) throw new Error('Контрольный атлас не найден');
const sourceFile = path.join(store.root, snapshot.id, atlas.export.contentRef!.path);
const sourceHash = async () => createHash('sha256').update(await readFile(sourceFile)).digest('hex');
const hashBefore = await sourceHash();
const savedStyle = await store.readJson<unknown>(atlas.style.contentRef!, snapshot.id);
const resolved = JSON.parse(JSON.stringify(savedStyle).split('{snapshotId}').join(snapshot.id));
const style = styleWithBounds(resolved, atlas.meta.bounds);
style.sources.atlas.tiles = ['http://map.test/tiles/{z}/{x}/{y}'];

const { build } = await import('esbuild');
const maplibreBundle = path.resolve('.kimi-tmp/maplibre-gl-iife.js');
await build({
  entryPoints: [path.resolve('node_modules/maplibre-gl/dist/maplibre-gl.mjs')],
  bundle: true, format: 'iife', globalName: 'maplibregl', outfile: maplibreBundle, logLevel: 'silent',
});
const workerBundle = path.resolve('.kimi-tmp/maplibre-gl-worker-iife.js');
await build({
  entryPoints: [path.resolve('node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs')],
  bundle: true, format: 'iife', outfile: workerBundle, logLevel: 'silent',
});

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
try {
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 }, deviceScaleFactor: 1 });
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText ?? 'запрос не выполнен'}`));
  await page.route('**/tiles/**', async route => {
    const match = /\/tiles\/(\d+)\/(\d+)\/(\d+)$/.exec(new URL(route.request().url()).pathname);
    if (!match) throw new Error(`Некорректный адрес тайла: ${route.request().url()}`);
    const tile = await readSnapshotTile(store, snapshot, atlasId, Number(match[1]), Number(match[2]), Number(match[3]));
    if (!tile) return route.fulfill({ status: 204 });
    return route.fulfill({ status: 200, contentType: tile.format === 'jpg' ? 'image/jpeg' : `image/${tile.format}`, body: tile.bytes });
  });
  await page.route('http://map.test/worker.js', async route => route.fulfill({ contentType: 'text/javascript', body: await readFile(workerBundle) }));
  await page.route('http://map.test/', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><html><head><style>html,body,#map{margin:0;width:100%;height:100%}</style></head><body><div id="map"></div></body></html>',
  }));
  await page.goto('http://map.test/');
  await page.addStyleTag({ path: path.resolve('node_modules/maplibre-gl/dist/maplibre-gl.css') });
  await page.addScriptTag({ path: maplibreBundle });
  await page.evaluate(styleDocument => {
    const maplibre = (window as unknown as { maplibregl: typeof import('maplibre-gl') }).maplibregl;
    maplibre.setWorkerUrl('http://map.test/worker.js');
    const map = new maplibre.Map({ container: 'map', style: styleDocument, center: [34.727193, 48.4666535], zoom: 8, attributionControl: false });
    (window as unknown as { map: typeof map }).map = map;
    map.on('load', () => { (window as unknown as { mapReady: boolean }).mapReady = true; });
    map.on('error', event => { (window as unknown as { mapError: string }).mapError = event.error.message; });
  }, style);
  await page.waitForFunction(() => {
    const state = window as unknown as { mapReady?: boolean; mapError?: string };
    return state.mapReady === true || Boolean(state.mapError);
  });
  const mapError = await page.evaluate(() => (window as unknown as { mapError?: string }).mapError);
  if (mapError) throw new Error(`${mapError}\n${errors.join('\n')}`);
  const west = atlas.meta.bounds[0], lat = (atlas.meta.bounds[1] + atlas.meta.bounds[3]) / 2;
  for (const zoom of [8, 9, 10, 11, 12, 13, 14]) {
    await page.evaluate(async ({ west, lat, zoom }) => {
      const map = (window as unknown as { map: import('maplibre-gl').Map }).map;
      map.jumpTo({ center: [west, lat], zoom });
      await new Promise<void>(resolve => map.once('idle', () => resolve()));
    }, { west, lat, zoom });
    const points = await page.evaluate(({ lat }) => {
      const map = (window as unknown as { map: import('maplibre-gl').Map }).map;
      const west = map.getCenter().lng;
      return { outside: map.project([west - 0.02, lat]), inside: map.project([west + 0.02, lat]) };
    }, { lat });
    const image = await page.screenshot({ type: 'png' });
    const { data, info } = await sharp(image).raw().toBuffer({ resolveWithObject: true });
    const pixel = (point: { x: number; y: number }) => {
      const x = Math.max(0, Math.min(info.width - 1, Math.round(point.x)));
      const y = Math.max(0, Math.min(info.height - 1, Math.round(point.y)));
      const offset = (y * info.width + x) * info.channels;
      return [data[offset], data[offset + 1], data[offset + 2]];
    };
    const outside = pixel(points.outside), inside = pixel(points.inside);
    const backgroundDistance = Math.abs(outside[0] - 237) + Math.abs(outside[1] - 232) + Math.abs(outside[2] - 216);
    const insideDifference = Math.abs(inside[0] - outside[0]) + Math.abs(inside[1] - outside[1]) + Math.abs(inside[2] - outside[2]);
    if (backgroundDistance > 30 || insideDifference < 15) throw new Error(`z${zoom}: граница не подтверждена пикселями: outside=${outside}, inside=${inside}`);
    console.log(`z${zoom}: снаружи=${outside.join(',')}, внутри=${inside.join(',')}`);
  }
  await mkdir('docs/img', { recursive: true });
  await page.screenshot({ path: 'docs/img/kshvi-raster-coverage.jpg', type: 'jpeg', quality: 88 });
  if (errors.length) throw new Error(errors.join('\n'));
  if (await sourceHash() !== hashBefore) throw new Error('Исходный MBTiles изменился');
  console.log('Растровая граница подтверждена на z8–z14; исходный MBTiles не изменён');
} finally {
  await browser.close();
}
