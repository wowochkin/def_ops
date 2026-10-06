/** Сквозной тест платформы: шлюз → сервис документов / сервис рендера / сервис реестра. */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { AddressInfo } from 'node:net';
import type http from 'node:http';
import { createService } from '@def-ops/service-kit';
import { emptyDocument, createFeature, makeProjection } from '@def-ops/core';
import { MemoryStore } from '../../documents/src/store';
import { EventBus } from '../../documents/src/events';
import { buildRouter as documentsRouter } from '../../documents/src/app';
import { buildRouter as renderRouter } from '../../render/src/app';
import { MemoryRepo } from '../../registry/src/repo';
import { EventBus as RegistryBus } from '../../registry/src/events';
import { buildRouter as registryRouter } from '../../registry/src/app';
import { createGateway, parseKeys } from '../src/gateway';

let gw: http.Server;
let base = '';
const closers: (() => Promise<void>)[] = [];

beforeAll(async () => {
  const docs = createService({ name: 'documents', port: 0, router: documentsRouter(new MemoryStore(), new EventBus()) });
  const dPort = await docs.listen();
  const render = createService({ name: 'render', port: 0, router: renderRouter(`http://127.0.0.1:${dPort}`) });
  const rPort = await render.listen();
  const registry = createService({ name: 'registry', port: 0, router: registryRouter(new MemoryRepo(), new RegistryBus()) });
  const gPort = await registry.listen();
  closers.push(docs.close, render.close, registry.close);
  gw = createGateway({
    port: 0,
    services: { documents: `http://127.0.0.1:${dPort}`, render: `http://127.0.0.1:${rPort}`, registry: `http://127.0.0.1:${gPort}` },
    routes: [
      ['/api/documents', 'documents', '/documents'], ['/api/events', 'documents', '/events'],
      ['/api/render', 'render', '/render'], ['/api/import', 'render', '/import'], ['/api/presets', 'render', '/presets'], ['/api/library', 'render', '/library'],
      ['/api/registry', 'registry', '/registry'],
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
    expect(h.services).toEqual({ documents: 'up', render: 'up', registry: 'up' });
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
});
