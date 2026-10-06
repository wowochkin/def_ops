/** Маршруты сервиса документов. */
import type { Layer, MapDocument } from '@def-ops/core';
import { migrateDocument, addLayer, updateLayer, removeLayer, toGeoJSON, fromGeoJSON, type GeoJSONCollection } from '@def-ops/core';
import { Router, HttpError, reply, type Ctx } from '@def-ops/service-kit';
import { type DocumentStore, ConflictError, validId } from './store';
import { EventBus } from './events';

export function buildRouter(store: DocumentStore, bus: EventBus): Router {
  const r = new Router();

  const load = async (c: Ctx): Promise<MapDocument> => {
    const id = c.params.id;
    if (!validId(id)) throw new HttpError(400, 'bad_id', 'Некорректный идентификатор');
    const d = await store.get(c.tenant, id);
    if (!d) throw new HttpError(404, 'not_found', 'Документ не найден');
    return d;
  };
  const source = (c: Ctx) => (c.req.headers['x-source-system'] as string) || undefined;
  const ifMatch = (c: Ctx): number | undefined => {
    const h = c.req.headers['if-match'] as string | undefined;
    if (!h) return undefined;
    const n = parseInt(h.replace(/[^0-9]/g, ''), 10);
    return Number.isFinite(n) ? n : undefined;
  };
  const saved = (d: MapDocument, status = 200) => reply(status, d, { ETag: `"${d.revision}"` });
  /** Сохранение с переводом конфликта ревизий в HTTP 409. */
  const save = async (c: Ctx, d: MapDocument, expected?: number) => {
    try { return await store.save(c.tenant, d, expected); } catch (e) {
      if (e instanceof ConflictError) throw new HttpError(409, 'conflict', e.message);
      throw e;
    }
  };
  const parseDoc = (body: unknown): MapDocument => {
    try { return migrateDocument(body); } catch (e) { throw new HttpError(422, 'invalid_document', (e as Error).message); }
  };

  /* ------------------------------ документы ------------------------------ */
  r.get('/documents', (c) => store.list(c.tenant));

  r.post('/documents', async (c) => {
    const d = parseDoc(await c.json());
    delete d.id; delete d.revision;
    const out = await save(c, d);
    bus.publish({ type: 'document.created', tenant: c.tenant, documentId: out.id!, revision: out.revision, source: source(c) });
    return saved(out, 201);
  });

  r.get('/documents/:id', async (c) => saved(await load(c)));

  r.put('/documents/:id', async (c) => {
    if (!validId(c.params.id)) throw new HttpError(400, 'bad_id', 'Некорректный идентификатор');
    const d = parseDoc(await c.json());
    d.id = c.params.id;
    const out = await save(c, d, ifMatch(c));
    bus.publish({ type: 'document.updated', tenant: c.tenant, documentId: out.id!, revision: out.revision, source: source(c) });
    return saved(out);
  });

  r.delete('/documents/:id', async (c) => {
    if (!(await store.delete(c.tenant, c.params.id))) throw new HttpError(404, 'not_found', 'Документ не найден');
    bus.publish({ type: 'document.deleted', tenant: c.tenant, documentId: c.params.id, source: source(c) });
    return reply(204, null);
  });

  r.get('/documents/:id/revisions', async (c) => { await load(c); return store.revisions(c.tenant, c.params.id); });
  r.get('/documents/:id/revisions/:rev', async (c) => {
    const d = await store.getRevision(c.tenant, c.params.id, Number(c.params.rev));
    if (!d) throw new HttpError(404, 'not_found', 'Ревизия не найдена');
    return d;
  });

  /* -------------------------------- слои -------------------------------- */
  const layerOp = async (c: Ctx, fn: (d: MapDocument) => MapDocument, ev: 'layer.updated' | 'layer.features.replaced', layerId?: string) => {
    const d = await load(c);
    const next = fn(d);
    const out = await save(c, next, ifMatch(c) ?? d.revision);
    bus.publish({ type: ev, tenant: c.tenant, documentId: out.id!, revision: out.revision, layerId, source: source(c) });
    return out;
  };
  const findLayer = (d: MapDocument, id: string): Layer => {
    const l = d.layers.find((x) => x.id === id);
    if (!l) throw new HttpError(404, 'not_found', 'Слой не найден');
    return l;
  };

  r.get('/documents/:id/layers', async (c) => (await load(c)).layers);

  r.post('/documents/:id/layers', async (c) => {
    const body = (await c.json<Partial<Layer> & { above?: string }>()) ?? {};
    let created: Layer | undefined;
    const out = await layerOp(c, (d) => { const x = addLayer(d, body, body.above); created = x.layer; return x.doc; }, 'layer.updated');
    return reply(201, { layer: created, revision: out.revision }, { ETag: `"${out.revision}"` });
  });

  r.patch('/documents/:id/layers/:layerId', async (c) => {
    const body = (await c.json<Partial<Layer>>()) ?? {};
    const out = await layerOp(c, (d) => { findLayer(d, c.params.layerId); return updateLayer(d, c.params.layerId, body); }, 'layer.updated', c.params.layerId);
    return reply(200, { layer: findLayer(out, c.params.layerId), revision: out.revision }, { ETag: `"${out.revision}"` });
  });

  r.delete('/documents/:id/layers/:layerId', async (c) => {
    const out = await layerOp(c, (d) => {
      findLayer(d, c.params.layerId);
      if (d.layers.length < 2) throw new HttpError(409, 'last_layer', 'Нельзя удалить последний слой');
      return removeLayer(d, c.params.layerId, c.query.get('moveTo'));
    }, 'layer.updated', c.params.layerId);
    return reply(200, { revision: out.revision }, { ETag: `"${out.revision}"` });
  });

  /** Объекты слоя в GeoJSON — для внешних систем. */
  r.get('/documents/:id/layers/:layerId/features', async (c) => {
    const d = await load(c);
    findLayer(d, c.params.layerId);
    return reply(200, toGeoJSON(d, { layers: [c.params.layerId] }), { 'Content-Type': 'application/geo+json; charset=utf-8' });
  });

  /**
   * Заменить содержимое слоя объектами из GeoJSON. Так внешняя система
   * «владеет» своим слоем на карте и обновляет его, не трогая остальное.
   */
  r.put('/documents/:id/layers/:layerId/features', async (c) => {
    const fc = await c.json<GeoJSONCollection>();
    const out = await layerOp(c, (d) => {
      findLayer(d, c.params.layerId);
      const cleared: MapDocument = { ...d, features: d.features.filter((f) => f.layerId !== c.params.layerId) };
      try {
        return fromGeoJSON(cleared, { ...fc, layers: [] }, { layerId: c.params.layerId }).doc;
      } catch (e) { throw new HttpError(422, 'invalid_geojson', (e as Error).message); }
    }, 'layer.features.replaced', c.params.layerId);
    return reply(200, { revision: out.revision, features: out.features.filter((f) => f.layerId === c.params.layerId).length }, { ETag: `"${out.revision}"` });
  });

  /* ------------------------------- события ------------------------------- */
  /** Поток событий (Server-Sent Events); ?documentId= — только по одному документу. */
  r.get('/events', (c) => {
    const only = c.query.get('documentId');
    c.res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    c.res.write(': connected\n\n');
    const off = bus.subscribe(c.tenant, (e) => {
      if (only && e.documentId !== only) return;
      c.res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
    });
    const ping = setInterval(() => c.res.write(': ping\n\n'), 25000);
    c.req.on('close', () => { off(); clearInterval(ping); });
  });

  return r;
}
