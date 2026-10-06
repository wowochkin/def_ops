/** Сквозной тест платформы: шлюз → сервис документов / сервис рендера. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createService } from '@def-ops/service-kit';
import { emptyDocument, createFeature, makeProjection } from '@def-ops/core';
import { MemoryStore } from '../../documents/src/store';
import { EventBus } from '../../documents/src/events';
import { buildRouter as documentsRouter } from '../../documents/src/app';
import { buildRouter as renderRouter } from '../../render/src/app';
import { createGateway, parseKeys } from '../src/gateway';

let gw: http.Server;
let base = '';
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
  const docs = createService({ name: 'documents', port: 0, router: documentsRouter(new MemoryStore(), new EventBus()) });
  const dPort = await docs.listen();
  const render = createService({ name: 'render', port: 0, router: renderRouter(`http://127.0.0.1:${dPort}`) });
  const rPort = await render.listen();
  closers.push(docs.close, render.close);
  gw = createGateway({
    port: 0,
    services: { documents: `http://127.0.0.1:${dPort}`, render: `http://127.0.0.1:${rPort}` },
    routes: [
      ['/api/documents', 'documents', '/documents'], ['/api/events', 'documents', '/events'],
      ['/api/render', 'render', '/render'], ['/api/import', 'render', '/import'], ['/api/presets', 'render', '/presets'], ['/api/library', 'render', '/library'],
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
    expect(h.services).toEqual({ documents: 'up', render: 'up' });
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
});
