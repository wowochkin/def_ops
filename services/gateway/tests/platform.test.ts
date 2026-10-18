/** Сквозной тест платформы: шлюз → сервис документов / сервис рендера / сервис реестра / сервис картографии. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { request as httpRequest } from 'node:http';
import { createService } from '@def-ops/service-kit';
import { emptyDocument, createFeature, makeProjection } from '@def-ops/core';
import { MemoryStore } from '../../documents/src/store';
import { EventBus } from '../../documents/src/events';
import { buildRouter as documentsRouter } from '../../documents/src/app';
import { buildRouter as renderRouter } from '../../render/src/app';
import { MemoryRepo } from '../../registry/src/repo';
import { EventBus as RegistryBus } from '../../registry/src/events';
import { buildRouter as registryRouter } from '../../registry/src/app';
import { MemoryRepo as MapMemoryRepo } from '../../cartography/src/repo';
import { EventBus as CartographyBus } from '../../cartography/src/events';
import { JobRunner } from '../../cartography/src/jobs';
import { TileStore } from '../../cartography/src/tiles';
import { buildRouter as cartographyRouter } from '../../cartography/src/app';
import { quadrantImage, pixel, near, QUADRANTS, tempDir } from '../../cartography/tests/helpers';
import { georefFromCorners, mercator, pixelToLngLat, tileOf, type LngLat, type MapJob } from '@def-ops/core';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import sharp from 'sharp';
import tar from 'tar-stream';
import { createGateway, forwardedPrefix, parseKeys } from '../src/gateway';
import { DefOpsClient } from '@def-ops/api-client';

let gw: http.Server;
let base = '';
let tilesDir = '';
let cartoBase = '';
let cartoJobs: JobRunner;
let cartoStore: TileStore;
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
  const docs = createService({ name: 'documents', port: 0, router: documentsRouter(new MemoryStore(), new EventBus()) });
  const dPort = await docs.listen();
  const render = createService({ name: 'render', port: 0, router: renderRouter(`http://127.0.0.1:${dPort}`) });
  const rPort = await render.listen();
  const registry = createService({ name: 'registry', port: 0, router: registryRouter(new MemoryRepo(), new RegistryBus()) });
  const gPort = await registry.listen();
  tilesDir = await tempDir('carto-gw-');
  const cBus = new CartographyBus();
  const cRepo = new MapMemoryRepo();
  cartoJobs = new JobRunner(cRepo, cBus, { progressMs: 50 });
  cartoStore = new TileStore(tilesDir);
  const carto = createService({ name: 'cartography', port: 0, router: cartographyRouter({ repo: cRepo, store: cartoStore, bus: cBus, jobs: cartoJobs }) });
  const cPort = await carto.listen();
  cartoBase = `http://127.0.0.1:${cPort}`;
  closers.push(docs.close, render.close, registry.close, async () => { await cartoJobs.stop(); await carto.close(); await fs.rm(tilesDir, { recursive: true, force: true }); });
  gw = createGateway({
    port: 0,
    services: { documents: `http://127.0.0.1:${dPort}`, render: `http://127.0.0.1:${rPort}`, registry: `http://127.0.0.1:${gPort}`, cartography: cartoBase },
    routes: [
      ['/api/documents', 'documents', '/documents'], ['/api/events', 'documents', '/events'],
      ['/api/render', 'render', '/render'], ['/api/import', 'render', '/import'], ['/api/presets', 'render', '/presets'], ['/api/library', 'render', '/library'],
      ['/api/registry', 'registry', '/registry'], ['/api/cartography', 'cartography', '/cartography'],
    ],
    auth: 'keys',
    apiKeys: parseKeys('keyA:orgA,keyB:orgB'),
    corsOrigin: '*',
  });
  await new Promise<void>((r) => gw.listen(0, () => r()));
  base = `http://127.0.0.1:${(gw.address() as AddressInfo).port}`;
});
afterAll(async () => { gw.close(); for (const c of closers) await c(); });

const api = (path: string, init: RequestInit & { key?: string } = {}) =>
  fetch(base + path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Api-Key': init.key ?? 'keyA', ...(init.headers as Record<string, string>) } });

function sampleDoc() {
  const d = emptyDocument([14, 52.5], 8);
  const p = makeProjection(d.origin, d.refZoom);
  const ll = (x: number, y: number) => p.toLngLat([x, y]);
  d.features.push(createFeature('line', 'atlas.front15', { points: [ll(0, -100), ll(0, 100)], layerId: 'front' }));
  d.features.push(createFeature('arrow', 'atlas.p1', { points: [ll(0, 0), ll(-200, 0)], layerId: 'friendly' }));
  return d;
}

describe('платформа через шлюз', () => {
  it('без ключа — 401, здоровье сервисов — ok', async () => {
    expect((await fetch(base + '/api/documents')).status).toBe(401);
    const h = await (await fetch(base + '/api/health')).json();
    expect(h.services).toEqual({ documents: 'up', render: 'up', registry: 'up', cartography: 'up' });
  });

  it('создание, ревизии, конфликт, изоляция организаций', async () => {
    const created = await api('/api/documents', { method: 'POST', body: JSON.stringify(sampleDoc()) });
    expect(created.status).toBe(201);
    const doc = await created.json();
    expect(doc.revision).toBe(1);
    expect(doc.layers.map((l: { id: string }) => l.id)).toContain('front');

    const upd = await api(`/api/documents/${doc.id}`, { method: 'PUT', body: JSON.stringify({ ...doc, name: 'Изменён' }), headers: { 'If-Match': '"1"' } });
    expect(upd.status).toBe(200);
    expect((await upd.json()).revision).toBe(2);
    // устаревшая ревизия → конфликт
    const stale = await api(`/api/documents/${doc.id}`, { method: 'PUT', body: JSON.stringify(doc), headers: { 'If-Match': '"1"' } });
    expect(stale.status).toBe(409);
    // другая организация документ не видит
    expect((await api(`/api/documents/${doc.id}`, { key: 'keyB' })).status).toBe(404);
    expect(await (await api('/api/documents', { key: 'keyB' })).json()).toEqual([]);
    // подмена организации заголовком не работает
    expect((await api(`/api/documents/${doc.id}`, { key: 'keyB', headers: { 'X-Tenant-Id': 'orgA' } })).status).toBe(404);
  });

  it('слои: скрытие, рендер только видимых, слой внешней системы через GeoJSON', async () => {
    const doc = await (await api('/api/documents', { method: 'POST', body: JSON.stringify(sampleDoc()) })).json();
    // скрыть «свои войска»
    const p = await api(`/api/documents/${doc.id}/layers/friendly`, { method: 'PATCH', body: JSON.stringify({ visible: false }) });
    expect(p.status).toBe(200);
    const svg = await (await api(`/api/render/documents/${doc.id}.svg`)).text();
    expect(svg).toContain('id="layer-front"');
    expect(svg).not.toContain('id="layer-friendly"');
    // явный выбор слоёв перекрывает видимость
    const only = await (await api(`/api/render/documents/${doc.id}.svg?layers=friendly`)).text();
    expect(only).toContain('id="layer-friendly"');

    // внешняя система создаёт свой слой и заливает в него объекты
    const nl = await (await api(`/api/documents/${doc.id}/layers`, {
      method: 'POST', headers: { 'X-Source-System': 'recon' },
      body: JSON.stringify({ name: 'Разведданные', role: 'enemy', source: { system: 'recon', readOnly: true } }),
    })).json();
    const fc = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [14.1, 52.6] }, properties: { name: 'Цель 1' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[14, 52.4], [14.2, 52.45]] }, properties: {} },
      ],
    };
    const put = await api(`/api/documents/${doc.id}/layers/${nl.layer.id}/features`, { method: 'PUT', body: JSON.stringify(fc) });
    expect(put.status).toBe(200);
    expect((await put.json()).features).toBe(2);
    // повторная заливка заменяет, а не добавляет
    await api(`/api/documents/${doc.id}/layers/${nl.layer.id}/features`, { method: 'PUT', body: JSON.stringify(fc) });
    const g = await (await api(`/api/documents/${doc.id}/layers/${nl.layer.id}/features`)).json();
    expect(g.features).toHaveLength(2);
    expect(g.features[0].properties.layerId).toBe(nl.layer.id);
  });

  it('рендер документа из тела запроса и каталог знаков', async () => {
    const r = await api('/api/render/svg', { method: 'POST', body: JSON.stringify({ document: sampleDoc() }) });
    expect(r.headers.get('content-type')).toContain('image/svg+xml');
    expect(await r.text()).toMatch(/^<svg/);
    const presets = await (await api('/api/presets')).json();
    expect(presets.arrow.length).toBeGreaterThan(10);
    const lib = await (await api('/api/library')).json();
    expect(lib.categories.length).toBe(18);
    expect(lib.sources.length).toBe(1);
    expect(lib.elements.length).toBeGreaterThan(120);
  });

  it('реестр: формирование, факты во времени, район на момент, изоляция, проверка', async () => {
    const body = (b: unknown) => ({ method: 'POST', body: JSON.stringify(b) });
    const types = await (await api('/api/registry/types')).json();
    expect(types.map((t: { id: string }) => t.id)).toContain('formation');

    const cr = await api('/api/registry/entities', body({
      type: 'formation', name: '79-й стрелковый корпус', shortName: '79 ск', side: 'own', attrs: { number: '79', echelon: 'corps', branch: 'rifle' },
    }));
    expect(cr.status).toBe(201);
    const corps = await cr.json();

    // факты на две даты: командир и численность, положение
    const f1 = await api(`/api/registry/entities/${corps.id}/facts`, body({
      validFrom: '1945-04-16', attrs: { commander: 'С. Н. Переверткин', personnel: 25000 }, geometry: { type: 'Point', coordinates: [14.4, 52.6] },
    }));
    expect(f1.status).toBe(201);
    const f2 = await api(`/api/registry/entities/${corps.id}/facts`, body({
      validFrom: '1945-04-28', attrs: { personnel: 18000, status: 'offensive' }, geometry: { type: 'Point', coordinates: [13.37, 52.52] },
    }));
    expect(f2.status).toBe(201);

    // состояние на даты между фактами
    const s1 = await (await api(`/api/registry/entities/${corps.id}?at=1945-04-20`)).json();
    expect(s1.state.attrs).toMatchObject({ number: '79', commander: 'С. Н. Переверткин', personnel: 25000 });
    expect(s1.state.geometry.coordinates).toEqual([14.4, 52.6]);
    const s2 = await (await api(`/api/registry/entities/${corps.id}?at=1945-04-30`)).json();
    expect(s2.state.attrs).toMatchObject({ commander: 'С. Н. Переверткин', personnel: 18000, status: 'offensive' });
    const many = await (await api('/api/registry/states', body({ ids: [corps.id], at: '1945-04-10' }))).json();
    expect(many.states[0].attrs.personnel).toBeUndefined();

    // объекты в районе Берлина на момент
    const berlin = 'bbox=13.2,52.4,13.6,52.6';
    expect(await (await api(`/api/registry/entities?${berlin}&at=1945-04-20`)).json()).toEqual([]);
    const inBerlin = await (await api(`/api/registry/entities?${berlin}&at=1945-04-30`)).json();
    expect(inBerlin.map((e: { id: string }) => e.id)).toEqual([corps.id]);
    expect(inBerlin[0].state.attrs.personnel).toBe(18000);
    expect((await api(`/api/registry/entities?${berlin}`)).status).toBe(400);

    // другая организация объект не видит
    expect((await api(`/api/registry/entities/${corps.id}`, { key: 'keyB' })).status).toBe(404);
    expect(await (await api('/api/registry/entities', { key: 'keyB' })).json()).toEqual([]);
    expect((await api(`/api/registry/entities/${corps.id}`, { key: 'keyB', headers: { 'X-Tenant-Id': 'orgA' } })).status).toBe(404);

    // проверка по схеме типа
    const bad = await api('/api/registry/entities', body({ type: 'formation', name: 'Без номера', attrs: { echelon: 'corps' } }));
    expect(bad.status).toBe(422);
    expect((await bad.json()).error.message).toContain('«Номер» — обязательное поле');
    const badFact = await api(`/api/registry/entities/${corps.id}/facts`, body({ validFrom: '1945-04-20', attrs: { personnel: 'много' } }));
    expect(badFact.status).toBe(422);
  });

  it('картография: скан через шлюз, задание, тайл, TileJSON, пакет', async () => {
    const corners: [LngLat, LngLat, LngLat, LngLat] = [[13.3, 52.55], [13.5, 52.55], [13.5, 52.45], [13.3, 52.45]];
    const map = await (await api('/api/cartography/maps', { method: 'POST', body: JSON.stringify({ name: 'План Берлина' }) })).json();
    expect(map.kind).toBe('xyz');

    // скан — двоичное тело, привязка — в параметре
    const img = await quadrantImage(1200, 900);
    const up = await fetch(`${base}/api/cartography/maps/${map.id}/import/raster?georef=${encodeURIComponent(JSON.stringify({ corners }))}`, {
      method: 'POST', body: new Uint8Array(img), headers: { 'Content-Type': 'image/png', 'X-Api-Key': 'keyA' },
    });
    expect(up.status).toBe(202);
    const { job } = await up.json();
    let j: MapJob = job;
    for (let i = 0; i < 400 && (j.status === 'queued' || j.status === 'running'); i++) {
      await new Promise((r) => setTimeout(r, 25));
      j = await (await api(`/api/cartography/jobs/${job.id}`)).json();
    }
    expect(j.status).toBe('done');

    // тайл через шлюз — тот же PNG, что на диске сервиса
    const ll = pixelToLngLat(georefFromCorners(1200, 900, corners), 250, 225);
    const [x, y] = tileOf(ll, 13);
    const t = await api(`/api/cartography/maps/${map.id}/tiles/13/${x}/${y}.png`);
    expect(t.status).toBe(200);
    expect(t.headers.get('content-type')).toBe('image/png');
    expect(t.headers.get('cache-control')).toContain('max-age');
    const data = Buffer.from(await t.arrayBuffer());
    const onDisk = await cartoStore.find('orgA', map.id, 13, x, y);
    expect(data.equals(await fs.readFile(onDisk!.file))).toBe(true);
    const m = mercator(ll);
    expect(near(await pixel(data, (m[0] * 8192 - x) * 256, (m[1] * 8192 - y) * 256), [...QUADRANTS.tl, 255])).toBe(true);
    // условный запрос проходит насквозь
    const etag = t.headers.get('etag')!;
    expect((await api(`/api/cartography/maps/${map.id}/tiles/13/${x}/${y}.png`, { headers: { 'If-None-Match': etag } })).status).toBe(304);
    // чужая организация не видит
    expect((await api(`/api/cartography/maps/${map.id}/tiles/13/${x}/${y}.png`, { key: 'keyB' })).status).toBe(404);

    // адреса тайлов — с префиксом шлюза
    const tj = await (await api(`/api/cartography/maps/${map.id}/tilejson`)).json();
    expect(tj.tiles[0].startsWith(`/api/cartography/maps/${map.id}/tiles/{z}/{x}/{y}.png?v=`)).toBe(true);
    const viaTj = await api(tj.tiles[0].replace('{z}', '13').replace('{x}', String(x)).replace('{y}', String(y)));
    expect(Buffer.from(await viaTj.arrayBuffer()).equals(data)).toBe(true);

    // пакет: выгрузка и загрузка через шлюз — архив не портится
    const pkg = await api(`/api/cartography/maps/${map.id}/package`);
    expect(pkg.headers.get('content-type')).toBe('application/x-tar');
    const tarBuf = Buffer.from(await pkg.arrayBuffer());
    const direct = Buffer.from(await (await fetch(`${cartoBase}/cartography/maps/${map.id}/package`, { headers: { 'X-Tenant-Id': 'orgA' } })).arrayBuffer());
    expect(tarBuf.length).toBe(direct.length);
    const imp = await fetch(`${base}/api/cartography/maps/import-package`, { method: 'POST', body: new Uint8Array(tarBuf), headers: { 'Content-Type': 'application/x-tar', 'X-Api-Key': 'keyB' } });
    expect(imp.status).toBe(201);
    const copy = (await imp.json()).map;
    expect(copy.stats).toEqual((await (await api(`/api/cartography/maps/${map.id}`)).json()).stats);
    const t2 = await api(`/api/cartography/maps/${copy.id}/tiles/13/${x}/${y}.png`, { key: 'keyB' });
    expect(Buffer.from(await t2.arrayBuffer()).equals(data)).toBe(true);

    expect(forwardedPrefix('/api/cartography', '/cartography')).toBe('/api');
    expect(forwardedPrefix('/api/events', '/events')).toBe('/api');
  });

  it('шлюз: большие двоичные тела (≈24 МБ) туда и обратно — потоком и без искажений', async () => {
    // пакет из четырёх «шумовых» PNG по ~6 МБ
    const tiles = await Promise.all([0, 1, 2, 3].map((i) =>
      sharp(randomBytes(1400 * 1400 * 3), { raw: { width: 1400, height: 1400, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer().then((b) => ({ i, b }))));
    const pack = tar.pack();
    pack.entry({ name: 'map.json' }, JSON.stringify({ name: 'Шум', bounds: [13, 52, 14, 53], minzoom: 1, maxzoom: 1 }));
    for (const { i, b } of tiles) pack.entry({ name: `tiles/1/${i % 2}/${i >> 1}.png` }, b);
    pack.finalize();
    const parts: Buffer[] = [];
    for await (const c of pack) parts.push(c as Buffer);
    const body = Buffer.concat(parts);
    expect(body.length).toBeGreaterThan(20 * 1024 * 1024);

    const imp = await fetch(`${base}/api/cartography/maps/import-package`, { method: 'POST', body: new Uint8Array(body), headers: { 'Content-Type': 'application/x-tar', 'X-Api-Key': 'keyA' } });
    expect(imp.status).toBe(201);
    const { map } = await imp.json();
    expect(map.stats.tiles).toBe(4);
    for (const { i, b } of tiles) {
      const f = await cartoStore.find('orgA', map.id, 1, i % 2, i >> 1);
      expect((await fs.readFile(f!.file)).equals(b)).toBe(true);
      const t = await api(`/api/cartography/maps/${map.id}/tiles/1/${i % 2}/${i >> 1}.png`);
      expect(Buffer.from(await t.arrayBuffer()).equals(b)).toBe(true);
    }
    const viaGw = Buffer.from(await (await api(`/api/cartography/maps/${map.id}/package`)).arrayBuffer());
    const direct = Buffer.from(await (await fetch(`${cartoBase}/cartography/maps/${map.id}/package`, { headers: { 'X-Tenant-Id': 'orgA' } })).arrayBuffer());
    expect(viaGw.length).toBeGreaterThan(20 * 1024 * 1024);
    // время изменения в заголовках tar совпадает (те же файлы) — архивы равны байт в байт
    expect(viaGw.equals(direct)).toBe(true);
  });

  it('клиент API: раздел картографии', async () => {
    const api2 = new DefOpsClient({ baseUrl: `${base}/api`, apiKey: 'keyA' });
    const m = await api2.cartography.maps.create({ name: 'Через клиент', tileSize: 256 });
    const corners: [LngLat, LngLat, LngLat, LngLat] = [[13.3, 52.55], [13.5, 52.55], [13.5, 52.45], [13.3, 52.45]];
    const up = await api2.cartography.uploadRaster(m.id, new Uint8Array(await quadrantImage(600, 450)), { corners }, 'image/png');
    expect(up.georef.width).toBe(600);
    let j = up.job;
    while (j.status === 'queued' || j.status === 'running') { await new Promise((r) => setTimeout(r, 25)); j = await api2.cartography.jobs.get(j.id); }
    expect(j.status).toBe('done');
    expect((await api2.cartography.jobs.list(m.id)).map((x) => x.id)).toEqual([j.id]);
    const map = await api2.cartography.maps.get(m.id);
    expect(api2.cartography.tileUrl(map)).toMatch(/\/api\/cartography\/maps\/.+\/tiles\/\{z\}\/\{x\}\/\{y\}\.png\?v=/);
    expect((await api2.cartography.tilejson(m.id)).tiles[0]).toContain('/api/cartography/');
    expect((await api2.cartography.scale(52.5, 12)).label).toMatch(/^1:/);
    const tarball = new Uint8Array(await (await fetch(api2.cartography.packageUrl(m.id))).arrayBuffer());
    const imp = await api2.cartography.importPackage(tarball);
    expect(imp.map.stats).toEqual(map.stats);
    await expect(api2.cartography.importXyz(m.id, { url: 'https://example.org/{z}/{x}/{y}.png', bounds: [13, 52, 14, 53], minzoom: 0, maxzoom: 20 }))
      .rejects.toMatchObject({ status: 422, code: 'too_many_tiles' });
    await api2.cartography.maps.remove(imp.map.id);
    expect((await api2.cartography.maps.list()).map((x) => x.id)).not.toContain(imp.map.id);
  });
});


describe('шлюз: языковая модель', () => {
  it('/llm/… — к серверу модели потоком, путь без /llm; недоступна — понятная ошибка', async () => {
    const httpMod = await import('node:http');
    const seen: string[] = [];
    const llm = httpMod.createServer((req, res) => {
      seen.push(`${req.method} ${req.url}`);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: {"choices":[{"delta":{"content":"при"}}]}\n\n');
      res.end('data: [DONE]\n\n');
    });
    await new Promise<void>((r) => llm.listen(0, '127.0.0.1', () => r()));
    const lPort = (llm.address() as AddressInfo).port;
    const g = createGateway({ port: 0, services: {}, routes: [], auth: 'open', apiKeys: new Map(), corsOrigin: '*', llmUrl: `http://127.0.0.1:${lPort}/v1` });
    await new Promise<void>((r) => g.listen(0, '127.0.0.1', () => r()));
    const gb = `http://127.0.0.1:${(g.address() as AddressInfo).port}`;
    const r = await fetch(`${gb}/llm/v1/chat/completions`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"stream":true}' });
    expect(r.status).toBe(200);
    expect(await r.text()).toContain('[DONE]');
    expect(seen).toEqual(['POST /v1/chat/completions']);
    await new Promise<void>((r2) => llm.close(() => r2()));
    const down = await fetch(`${gb}/llm/v1/models`);
    expect(down.status).toBe(502);
    expect((await down.json()).error.code).toBe('llm_unavailable');
    await new Promise<void>((r2) => g.close(() => r2()));
  });
});

describe('шлюз: состояние голоса', () => {
  const start = async (voiceState?: string) => {
    const g = createGateway({ port: 0, services: {}, routes: [], auth: 'keys', apiKeys: parseKeys('keyA:orgA'), corsOrigin: '*', voiceState });
    await new Promise<void>((r) => g.listen(0, () => r()));
    return { g, url: `http://127.0.0.1:${(g.address() as AddressInfo).port}` };
  };

  it('/api/voice — файл состояния как есть, без ключа; нет файла — off; шлюз не в приложении — unsupported', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'voice-gw-'));
    const file = join(dir, 'state.json');
    const a = await start(file);
    try {
      expect(await (await fetch(a.url + '/api/voice')).json()).toEqual({ state: 'off' });
      await fs.writeFile(file, JSON.stringify({ state: 'ready', port: 47645 }));
      const r = await fetch(a.url + '/api/voice');
      expect(r.status).toBe(200);
      expect(await r.json()).toEqual({ state: 'ready', port: 47645 });
      await fs.writeFile(file, '{битый');
      expect(await (await fetch(a.url + '/api/voice')).json()).toEqual({ state: 'off' });
    } finally { a.g.close(); await fs.rm(dir, { recursive: true, force: true }); }
    const b = await start();
    // шлюз не настольного приложения (браузер, сервер): голоса в этой версии нет
    try { expect(await (await fetch(b.url + '/api/voice')).json()).toEqual({ state: 'unsupported' }); } finally { b.g.close(); }
  });
});

describe('шлюз: сохранение файла в «Загрузки» (настольное приложение)', () => {
  const start = async (downloadsDir?: string, dev = false) => {
    const g = createGateway({ port: 0, services: {}, routes: [], auth: 'open', apiKeys: new Map(), corsOrigin: '*', downloadsDir, downloadsDev: dev });
    await new Promise<void>((r) => g.listen(0, '127.0.0.1', () => r()));
    const port = (g.address() as AddressInfo).port;
    return { g, port, url: `http://127.0.0.1:${port}` };
  };
  /** Сырой запрос: Host и Origin — какие угодно (как у страницы после DNS rebinding). */
  const raw = (port: number, name: string, body: string, headers: Record<string, string>) => new Promise<{ status: number; json: { path?: string } }>((res, rej) => {
    const r = httpRequest({ host: '127.0.0.1', port, method: 'POST', path: `/api/save?name=${encodeURIComponent(name)}`, headers: { 'Content-Type': 'text/markdown', ...headers } }, (x) => {
      let t = ''; x.setEncoding('utf8'); x.on('data', (c) => { t += c; }); x.on('end', () => res({ status: x.statusCode ?? 0, json: t ? JSON.parse(t) : {} }));
    });
    r.on('error', rej); r.end(body);
  });
  const own = (port: number) => ({ Host: `127.0.0.1:${port}`, Origin: `http://127.0.0.1:${port}` });

  it('своё окно: пишет файл в папку, занятое имя — «имя (2)», отвечает путём', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'save-gw-'));
    const a = await start(dir);
    try {
      const r1 = await raw(a.port, 'разбор.md', '# Разбор', own(a.port));
      expect(r1.status).toBe(200);
      expect(r1.json.path).toBe(join(dir, 'разбор.md'));
      expect(await fs.readFile(r1.json.path!, 'utf8')).toBe('# Разбор');
      expect((await raw(a.port, 'разбор.md', 'второй', own(a.port))).json.path).toBe(join(dir, 'разбор (2).md'));
      // localhost — тот же компьютер
      expect((await raw(a.port, 'журнал.md', 'x', { Host: `localhost:${a.port}`, Origin: `http://localhost:${a.port}` })).status).toBe(200);
    } finally { a.g.close(); await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('DNS rebinding, без Origin, чужой Origin, окно разработки без флага — 403, файла нет', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'save-gw-'));
    const a = await start(dir);
    try {
      expect((await raw(a.port, 'rebind.md', 'x', { Host: `evil.test:${a.port}`, Origin: `http://evil.test:${a.port}` })).status).toBe(403);
      expect((await raw(a.port, 'noorigin.md', 'x', { Host: `127.0.0.1:${a.port}` })).status).toBe(403);
      expect((await raw(a.port, 'evil.md', 'x', { Host: `127.0.0.1:${a.port}`, Origin: 'https://evil.example' })).status).toBe(403);
      expect((await raw(a.port, 'null.md', 'x', { Host: `127.0.0.1:${a.port}`, Origin: 'null' })).status).toBe(403);
      // Origin — адрес окна, а не Host запроса: чужой порт того же компьютера — не своё окно
      expect((await raw(a.port, 'port.md', 'x', { Host: `127.0.0.1:${a.port}`, Origin: `http://127.0.0.1:${a.port + 1}` })).status).toBe(403);
      expect((await raw(a.port, 'dev.md', 'x', { Host: `127.0.0.1:${a.port}`, Origin: 'http://localhost:5173' })).status).toBe(403);
      expect(await fs.readdir(dir)).toEqual([]);
    } finally { a.g.close(); await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('разработка (флаг): окно vite :5173 через прокси — можно', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'save-gw-'));
    const a = await start(dir, true);
    try {
      expect((await raw(a.port, 'dev.md', 'x', { Host: `localhost:${a.port}`, Origin: 'http://localhost:5173' })).status).toBe(200);
    } finally { a.g.close(); await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('имена: путь и чужое расширение — 400; управляющие символы — заменены; длинное — обрезано по байтам (не 500)', async () => {
    const dir = await fs.mkdtemp(join(tmpdir(), 'save-gw-'));
    const a = await start(dir);
    try {
      expect((await raw(a.port, '../x.md', 'x', own(a.port))).status).toBe(400);
      expect((await raw(a.port, 'x.sh', 'x', own(a.port))).status).toBe(400);
      const c = await raw(a.port, 'раз\nбор\u0000:*.md', 'x', own(a.port));
      expect(c.status).toBe(200);
      expect(c.json.path).toBe(join(dir, 'раз_бор___.md'));
      const long = await raw(a.port, `${'ж'.repeat(200)}.md`, 'x', own(a.port));
      expect(long.status).toBe(200);
      const base = long.json.path!.slice(dir.length + 1);
      expect(Buffer.byteLength(base)).toBeLessThanOrEqual(240);
      expect(base.endsWith('.md')).toBe(true);
    } finally { a.g.close(); await fs.rm(dir, { recursive: true, force: true }); }
  });
  it('вне приложения — нет такого адреса', async () => {
    const b = await start();
    try { expect((await raw(b.port, 'x.md', 'x', own(b.port))).status).toBe(404); } finally { b.g.close(); }
  });
});
